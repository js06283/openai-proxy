const express = require("express");
const path = require("path");
const { Firestore } = require("@google-cloud/firestore");

const app = express();
const PORT = 3000;

// Serve static files
app.use(express.static(__dirname));

// CORS middleware
app.use((req, res, next) => {
	res.header("Access-Control-Allow-Origin", "*");
	res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
	res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
	if (req.method === "OPTIONS") {
		return res.status(200).end();
	}
	next();
});

// Helper functions
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
					console.log(`🔍 Extracting assistant messages from responseData:`);
					console.log(`   ResponseData length: ${log.responseData.length}`);
					console.log(
						`   ResponseData preview: ${log.responseData.substring(0, 300)}...`
					);

					const responseData = JSON.parse(log.responseData);
					if (responseData.data && Array.isArray(responseData.data)) {
						console.log(
							`   Found ${responseData.data.length} messages in data array`
						);
						for (const message of responseData.data) {
							console.log(`   Processing message with role: ${message.role}`);
							if (message.role === "assistant" && message.content) {
								console.log(
									`   Found assistant message with ${message.content.length} content items`
								);
								for (const contentItem of message.content) {
									if (
										contentItem.type === "text" &&
										contentItem.text &&
										contentItem.text.value
									) {
										console.log(
											`   Extracting text content: ${contentItem.text.value.substring(
												0,
												50
											)}...`
										);
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
					console.log(
						`❌ Error parsing responseData in extractMessagesFromLog:`,
						e.message
					);
					console.log(`   ResponseData: ${log.responseData}`);
					// Try to extract assistant content from raw string as fallback
					if (log.responseData.includes('"role":"assistant"')) {
						console.log(`   Attempting fallback extraction from raw string...`);
						// Simple regex to extract text content from assistant messages
						const assistantMatch = log.responseData.match(
							/"role":"assistant".*?"text":\s*{\s*"value":\s*"([^"]+)"/
						);
						if (assistantMatch) {
							console.log(
								`   Fallback extraction successful: ${assistantMatch[1].substring(
									0,
									50
								)}...`
							);
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
		console.log("Error parsing message content:", err);
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
			console.log(`🔍 Parsing responseData for ${log.path}:`);
			console.log(`   ResponseData length: ${log.responseData.length}`);
			console.log(
				`   ResponseData preview: ${log.responseData.substring(0, 200)}...`
			);

			const responseData = JSON.parse(log.responseData);
			// Check if the response contains assistant messages
			if (responseData.data && Array.isArray(responseData.data)) {
				const hasAssistant = responseData.data.some(
					(message) => message.role === "assistant"
				);
				console.log(`   Has assistant messages: ${hasAssistant}`);
				return hasAssistant;
			}
		} catch (e) {
			console.log(
				`❌ Error parsing responseData in isAssistantResponse:`,
				e.message
			);
			console.log(`   ResponseData: ${log.responseData}`);
			// Try to find assistant role without parsing full JSON
			if (log.responseData.includes('"role":"assistant"')) {
				console.log(`   Found assistant role in raw string, returning true`);
				return true;
			}
		}
	}
	return false;
}

// API endpoint for threads
app.get("/api/threads", async (req, res) => {
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
			return res.json({ threads: [] });
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

		console.log(`📊 Found ${allInteractions.length} total interactions`);
		console.log(
			`📊 Thread-related interactions: ${
				allInteractions.filter(
					(log) => log.path && log.path.includes("/threads/")
				).length
			}`
		);

		// Log all interactions for debugging
		console.log("\n🔍 ALL INTERACTIONS:");
		allInteractions.forEach((log, index) => {
			console.log(`${index + 1}. ${log.method} ${log.path} (${log.type})`);
			if (log.body) console.log(`   Body: ${log.body.substring(0, 100)}...`);
			if (log.responseData)
				console.log(`   Response: ${log.responseData.substring(0, 100)}...`);
		});

		const threads = {};
		let userMessageCount = 0;
		let assistantMessageCount = 0;
		let systemPrompts = {};

		console.log("\n🔍 PROCESSING EACH LOG:");
		allInteractions.forEach((log, index) => {
			if (!log.path || !log.path.includes("/threads/")) {
				console.log(`⏭️  Skipping ${index + 1}: Not a thread-related path`);
				return;
			}

			// Extract threadId
			const threadMatch = log.path.match(/\/threads\/([^\/]+)/);
			const threadId = threadMatch ? threadMatch[1] : null;
			if (!threadId) {
				console.log(`⏭️  Skipping ${index + 1}: No thread ID found in path`);
				return;
			}

			console.log(`\n📝 Processing log ${index + 1} for thread ${threadId}:`);
			console.log(
				`   Method: ${log.method}, Path: ${log.path}, Type: ${log.type}`
			);

			// Only keep user/assistant messages
			const extractedMessages = extractMessagesFromLog(log);
			const isUser = isUserSentMessage(log);
			const isAssistant = isAssistantResponse(log);

			console.log(`   Is user message: ${isUser}`);
			console.log(`   Is assistant response: ${isAssistant}`);
			console.log(`   Extracted ${extractedMessages.length} messages:`);
			extractedMessages.forEach((msg, msgIndex) => {
				console.log(
					`     ${msgIndex + 1}. Role: ${
						msg.role
					}, Content: ${msg.content.substring(0, 50)}...`
				);
			});

			// Debug logging for assistant message detection
			if (
				log.method === "GET" &&
				log.path.includes("/messages") &&
				log.type === "response"
			) {
				console.log(`🔍 Checking assistant response for thread ${threadId}:`);
				console.log(`  - Path: ${log.path}`);
				console.log(`  - Has responseData: ${!!log.responseData}`);
				console.log(`  - Is assistant response: ${isAssistant}`);
				if (log.responseData) {
					try {
						const responseData = JSON.parse(log.responseData);
						console.log(`  - Response data structure:`, {
							hasData: !!responseData.data,
							dataIsArray: Array.isArray(responseData.data),
							dataLength: responseData.data ? responseData.data.length : 0,
							messageRoles: responseData.data
								? responseData.data.map((m) => m.role)
								: [],
						});
					} catch (e) {
						console.log(`  - Error parsing responseData:`, e.message);
					}
				}
			}

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
						console.log(
							`   🎯 Found system prompt: ${bodyData.content.substring(
								0,
								50
							)}...`
						);
					}
				} catch (e) {}
			}

			if (extractedMessages.length > 0) {
				if (!threads[threadId]) threads[threadId] = [];
				console.log(
					`   ✅ Adding ${extractedMessages.length} messages to thread ${threadId}`
				);
				for (const messageObj of extractedMessages) {
					threads[threadId].push(messageObj);
					if (messageObj.role === "user") userMessageCount++;
					if (messageObj.role === "assistant") assistantMessageCount++;
				}
			} else {
				console.log(`   ❌ No messages extracted from this log`);
			}
		});

		console.log(`\n📊 FINAL STATS:`);
		console.log(`📊 User messages found: ${userMessageCount}`);
		console.log(`📊 Assistant messages found: ${assistantMessageCount}`);
		console.log(`📊 Threads with messages: ${Object.keys(threads).length}`);

		console.log(`\n🧵 FINAL THREAD STRUCTURE:`);
		Object.keys(threads).forEach((threadId) => {
			console.log(`Thread ${threadId}:`);
			threads[threadId].forEach((msg, index) => {
				console.log(
					`  ${index + 1}. [${msg.role}] ${msg.content.substring(0, 50)}...`
				);
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

		res.json({ threads: threadList });
	} catch (err) {
		console.error("❌ Error fetching threads:", err);
		res
			.status(500)
			.json({ error: "Failed to fetch threads", details: err.message });
	}
});

// Serve the HTML file
app.get("/", (req, res) => {
	res.sendFile(path.join(__dirname, "thread-viewer.html"));
});

app.listen(PORT, () => {
	console.log(`🚀 Server running at http://localhost:${PORT}`);
	console.log(`📊 Thread viewer available at http://localhost:${PORT}`);
	console.log(`🔗 API endpoint at http://localhost:${PORT}/api/threads`);
});
