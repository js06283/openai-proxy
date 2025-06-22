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
								// Extract text content
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
											contentType: "text",
										});
									}
								}

								// Extract tool calls (what the assistant requests)
								if (message.tool_calls && Array.isArray(message.tool_calls)) {
									message.tool_calls.forEach((toolCall) => {
										if (toolCall.type === "code_interpreter") {
											// Extract code input from tool call
											if (
												toolCall.code_interpreter &&
												toolCall.code_interpreter.input
											) {
												messages.push({
													role: "assistant",
													content: toolCall.code_interpreter.input,
													timestamp: log.timestamp,
													responseTime: log.responseTime || null,
													contentType: "code_input",
													language: "python",
													toolCallId: toolCall.id,
													messageType: "tool_call",
												});
											}
										} else if (toolCall.type === "function") {
											// Extract function calls
											messages.push({
												role: "assistant",
												content: `[Function Call: ${toolCall.function.name}]`,
												timestamp: log.timestamp,
												responseTime: log.responseTime || null,
												contentType: "function_call",
												functionName: toolCall.function.name,
												functionArgs: toolCall.function.arguments,
												toolCallId: toolCall.id,
												messageType: "tool_call",
											});
										} else if (toolCall.type === "file_search") {
											// Extract file search calls
											messages.push({
												role: "assistant",
												content: `[File Search: ${
													toolCall.file_search.query || "query"
												}]`,
												timestamp: log.timestamp,
												responseTime: log.responseTime || null,
												contentType: "file_search",
												searchQuery: toolCall.file_search.query,
												toolCallId: toolCall.id,
												messageType: "tool_call",
											});
										}
									});
								}

								// Extract tool responses (what the tools return)
								if (
									message.tool_responses &&
									Array.isArray(message.tool_responses)
								) {
									message.tool_responses.forEach((toolResponse) => {
										if (toolResponse.type === "code_interpreter") {
											// Extract code outputs from tool response
											if (
												toolResponse.code_interpreter &&
												toolResponse.code_interpreter.outputs &&
												Array.isArray(toolResponse.code_interpreter.outputs)
											) {
												toolResponse.code_interpreter.outputs.forEach(
													(output) => {
														if (output.type === "logs") {
															messages.push({
																role: "assistant",
																content: output.logs,
																timestamp: log.timestamp,
																responseTime: log.responseTime || null,
																contentType: "code_output",
																outputType: "logs",
																toolCallId: toolResponse.tool_call_id,
																messageType: "tool_response",
															});
														} else if (output.type === "image") {
															messages.push({
																role: "assistant",
																content: `[Generated Image: ${output.image.file_id}]`,
																timestamp: log.timestamp,
																responseTime: log.responseTime || null,
																contentType: "code_output",
																outputType: "image",
																imageId: output.image.file_id,
																toolCallId: toolResponse.tool_call_id,
																messageType: "tool_response",
															});
														} else if (output.type === "error") {
															messages.push({
																role: "assistant",
																content: `Error: ${output.error}`,
																timestamp: log.timestamp,
																responseTime: log.responseTime || null,
																contentType: "code_output",
																outputType: "error",
																toolCallId: toolResponse.tool_call_id,
																messageType: "tool_response",
															});
														}
													}
												);
											}
										} else if (toolResponse.type === "function") {
											// Extract function responses
											messages.push({
												role: "assistant",
												content: `[Function Response: ${toolResponse.function.name}]`,
												timestamp: log.timestamp,
												responseTime: log.responseTime || null,
												contentType: "function_response",
												functionName: toolResponse.function.name,
												functionOutput: toolResponse.function.output,
												toolCallId: toolResponse.tool_call_id,
												messageType: "tool_response",
											});
										} else if (toolResponse.type === "file_search") {
											// Extract file search responses
											messages.push({
												role: "assistant",
												content: `[File Search Results: ${
													toolResponse.file_search.results
														? toolResponse.file_search.results.length
														: 0
												} files found]`,
												timestamp: log.timestamp,
												responseTime: log.responseTime || null,
												contentType: "file_search_response",
												fileCount: toolResponse.file_search.results
													? toolResponse.file_search.results.length
													: 0,
												toolCallId: toolResponse.tool_call_id,
												messageType: "tool_response",
											});
										}
									});
								}

								// Also check for legacy content-based tool outputs (fallback)
								if (message.content && Array.isArray(message.content)) {
									for (const contentItem of message.content) {
										if (
											contentItem.type === "code_interpreter" &&
											contentItem.code_interpreter
										) {
											// Extract code input
											if (contentItem.code_interpreter.input) {
												messages.push({
													role: "assistant",
													content: contentItem.code_interpreter.input,
													timestamp: log.timestamp,
													responseTime: log.responseTime || null,
													contentType: "code_input",
													language: "python",
													legacy: true,
													messageType: "legacy_content",
												});
											}

											// Extract code outputs
											if (
												contentItem.code_interpreter.outputs &&
												Array.isArray(contentItem.code_interpreter.outputs)
											) {
												contentItem.code_interpreter.outputs.forEach(
													(output) => {
														if (output.type === "logs") {
															messages.push({
																role: "assistant",
																content: output.logs,
																timestamp: log.timestamp,
																responseTime: log.responseTime || null,
																contentType: "code_output",
																outputType: "logs",
																legacy: true,
																messageType: "legacy_content",
															});
														} else if (output.type === "image") {
															messages.push({
																role: "assistant",
																content: `[Generated Image: ${output.image.file_id}]`,
																timestamp: log.timestamp,
																responseTime: log.responseTime || null,
																contentType: "code_output",
																outputType: "image",
																imageId: output.image.file_id,
																legacy: true,
																messageType: "legacy_content",
															});
														} else if (output.type === "error") {
															messages.push({
																role: "assistant",
																content: `Error: ${output.error}`,
																timestamp: log.timestamp,
																responseTime: log.responseTime || null,
																contentType: "code_output",
																outputType: "error",
																legacy: true,
																messageType: "legacy_content",
															});
														}
													}
												);
											}
										}

										// Extract file search outputs
										if (
											contentItem.type === "file_search" &&
											contentItem.file_search
										) {
											messages.push({
												role: "assistant",
												content: `[File Search Results: ${
													contentItem.file_search.results
														? contentItem.file_search.results.length
														: 0
												} files found]`,
												timestamp: log.timestamp,
												responseTime: log.responseTime || null,
												contentType: "file_search",
												fileCount: contentItem.file_search.results
													? contentItem.file_search.results.length
													: 0,
												legacy: true,
												messageType: "legacy_content",
											});
										}

										// Extract function call outputs
										if (
											contentItem.type === "function" &&
											contentItem.function
										) {
											messages.push({
												role: "assistant",
												content: `[Function Call: ${contentItem.function.name}]`,
												timestamp: log.timestamp,
												responseTime: log.responseTime || null,
												contentType: "function_call",
												functionName: contentItem.function.name,
												functionArgs: contentItem.function.arguments,
												legacy: true,
												messageType: "legacy_content",
											});
										}
									}
								}
							}
						}
					}
				} catch (e) {
					console.log("Error parsing responseData:", e.message);
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
								contentType: "text",
							});
						}
					}
				}
			}
		}
		return messages;
	} catch (err) {
		console.log("Error in extractMessagesFromLog:", err);
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
