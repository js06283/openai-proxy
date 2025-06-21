const { Firestore } = require("@google-cloud/firestore");

// Helper functions (same as in analyze-conversations.js)
function extractMessagesFromLog(log) {
	const messages = [];
	try {
		// For user messages: extract from request body
		if (isUserSentMessage(log)) {
			if (log.body) {
				const bodyData = JSON.parse(log.body);
				if (bodyData.content) {
					messages.push({
						role: "user",
						content: bodyData.content,
						timestamp: log.timestamp,
					});
				}
			}
		}

		// For assistant responses: extract all assistant messages from response data
		if (isAssistantResponse(log)) {
			if (log.responseData) {
				try {
					const responseData = JSON.parse(log.responseData);
					if (responseData.data && Array.isArray(responseData.data)) {
						for (const message of responseData.data) {
							if (message.role === "assistant" && message.content) {
								for (const contentItem of message.content) {
									if (
										contentItem.type === "text" &&
										contentItem.text &&
										contentItem.text.value
									) {
										messages.push({
											role: "assistant",
											content: contentItem.text.value,
											timestamp: log.timestamp,
											responseTime: log.responseTime || null,
										});
									}
								}
							}
						}
					}
				} catch (e) {
					// Try to extract assistant content from raw string as fallback
					if (log.responseData.includes('"role":"assistant"')) {
						// Simple regex to extract text content from assistant messages
						const assistantMatch = log.responseData.match(
							/"role":"assistant".*?"text":\s*{\s*"value":\s*"([^"]+)"/
						);
						if (assistantMatch) {
							messages.push({
								role: "assistant",
								content: assistantMatch[1],
								timestamp: log.timestamp,
								responseTime: log.responseTime || null,
							});
						}
					}
				}
			}
		}
		return messages;
	} catch (err) {
		return [];
	}
}
function isUserSentMessage(log) {
	return (
		log.method === "POST" &&
		log.path.includes("/messages") &&
		log.body &&
		log.type === "request"
	);
}
function isAssistantResponse(log) {
	// Assistant responses only come from GET requests (fetching messages)
	// and must contain assistant messages in the response data
	if (
		log.method === "GET" &&
		log.path.includes("/messages") &&
		log.responseData &&
		log.type === "response"
	) {
		try {
			const responseData = JSON.parse(log.responseData);
			// Check if the response contains assistant messages
			if (responseData.data && Array.isArray(responseData.data)) {
				return responseData.data.some(
					(message) => message.role === "assistant"
				);
			}
		} catch (e) {
			// Try to find assistant role without parsing full JSON
			if (log.responseData.includes('"role":"assistant"')) {
				return true;
			}
		}
	}
	return false;
}

module.exports = async (req, res) => {
	// CORS headers
	res.setHeader("Access-Control-Allow-Origin", "*");
	res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
	if (req.method === "OPTIONS") {
		return res.status(200).end();
	}

	try {
		// Initialize Firestore
		let firestore;
		if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
			const credentials = JSON.parse(
				process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
			);
			firestore = new Firestore({
				projectId: credentials.project_id,
				credentials: credentials,
			});
		} else {
			firestore = new Firestore();
		}

		// Fetch all logs
		const snapshot = await firestore.collection("api_logs").get();
		if (snapshot.empty) {
			return res.status(200).json({ threads: [] });
		}

		// Filter and group by thread
		const allInteractions = snapshot.docs.map((doc) => {
			const data = doc.data();
			return {
				id: doc.id,
				timestamp: data.timestamp || "",
				type: data.type || "",
				path: data.path || "",
				method: data.method || "",
				body: data.body || "",
				responseData: data.responseData || "",
				responseTime: data.responseTime || null,
			};
		});

		const threads = {};
		let systemPrompts = {};

		allInteractions.forEach((log) => {
			if (!log.path || !log.path.includes("/threads/")) return;
			// Extract threadId
			const threadMatch = log.path.match(/\/threads\/([^\/]+)/);
			const threadId = threadMatch ? threadMatch[1] : null;
			if (!threadId) return;
			// Only keep user/assistant messages
			const messages = extractMessagesFromLog(log);

			// Detect system prompt (if present as a system message in body)
			if (
				log.body &&
				log.method === "POST" &&
				log.path.includes("/messages") &&
				log.type === "request"
			) {
				try {
					const bodyData = JSON.parse(log.body);
					if (bodyData.role === "system" && bodyData.content) {
						systemPrompts[threadId] = bodyData.content;
					}
				} catch (e) {}
			}

			if (messages.length === 0) return;
			if (!threads[threadId]) threads[threadId] = [];
			messages.forEach((message) => {
				threads[threadId].push(message);
			});
		});

		// Sort messages in each thread
		const threadList = Object.keys(threads).map((threadId) => ({
			threadId,
			messages: threads[threadId].sort(
				(a, b) => new Date(a.timestamp) - new Date(b.timestamp)
			),
			systemPrompt: systemPrompts[threadId] || null,
		}));

		// Sort threads by most recent message
		threadList.sort((a, b) => {
			const lastA = a.messages[a.messages.length - 1]?.timestamp || 0;
			const lastB = b.messages[b.messages.length - 1]?.timestamp || 0;
			return new Date(lastB) - new Date(lastA);
		});

		return res.status(200).json({ threads: threadList });
	} catch (err) {
		console.error("❌ Error fetching threads:", err);
		return res
			.status(500)
			.json({ error: "Failed to fetch threads", details: err.message });
	}
};
