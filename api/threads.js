const { Firestore } = require("@google-cloud/firestore");

// Helper functions (same as in local-server.js)
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

								// Extract text content
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
															const imageId = output.image.file_id;
															// Extract the actual file ID from the image reference
															const actualFileId = imageId
																.replace(/^\[Image:\s*/, "")
																.replace(/\s*\]$/, "");
															const imageInfo = imageFiles[actualFileId];
															console.log(
																`🖼️ Processing image output: ${imageId} -> ${actualFileId}`,
																{
																	hasImageInfo: !!imageInfo,
																	hasBase64Data: !!(
																		imageInfo && imageInfo.base64Data
																	),
																	dataLength: imageInfo?.base64Data?.length,
																}
															);

															messages.push({
																role: "assistant",
																content: `[Generated Image: ${imageId}]`,
																timestamp: log.timestamp,
																responseTime: log.responseTime || null,
																contentType: "code_output",
																outputType: "image",
																imageId: imageId,
																imageData: imageInfo
																	? {
																			contentType: imageInfo.contentType,
																			base64Data: imageInfo.base64Data,
																			size: imageInfo.size,
																	  }
																	: null,
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
															const imageId = output.image.file_id;
															// Extract the actual file ID from the image reference
															const actualFileId = imageId
																.replace(/^\[Image:\s*/, "")
																.replace(/\s*\]$/, "");
															const imageInfo = imageFiles[actualFileId];
															console.log(
																`🖼️ Processing image output: ${imageId} -> ${actualFileId}`,
																{
																	hasImageInfo: !!imageInfo,
																	hasBase64Data: !!(
																		imageInfo && imageInfo.base64Data
																	),
																	dataLength: imageInfo?.base64Data?.length,
																}
															);

															messages.push({
																role: "assistant",
																content: `[Generated Image: ${imageId}]`,
																timestamp: log.timestamp,
																responseTime: log.responseTime || null,
																contentType: "code_output",
																outputType: "image",
																imageId: imageId,
																imageData: imageInfo
																	? {
																			contentType: imageInfo.contentType,
																			base64Data: imageInfo.base64Data,
																			size: imageInfo.size,
																	  }
																	: null,
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
								contentType: "text",
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
			console.log("✅ Firestore initialized with environment credentials");
		} else {
			console.error("❌ No credentials available for Firestore");
			return res
				.status(500)
				.json({ error: "Firestore credentials not available" });
		}

		// Fetch all logs
		const snapshot = await firestore.collection("api_logs").get();
		if (snapshot.empty) {
			return res.status(200).json({ threads: [] });
		}

		// Fetch all run steps
		const runStepsSnapshot = await firestore.collection("run_steps").get();
		const runSteps = {};

		if (!runStepsSnapshot.empty) {
			runStepsSnapshot.docs.forEach((doc) => {
				const data = doc.data();
				const threadId = data.threadId;
				if (!runSteps[threadId]) {
					runSteps[threadId] = [];
				}
				runSteps[threadId].push({
					id: doc.id,
					...data,
					timestamp:
						data.timestamp || data.stepCreatedAt || new Date().toISOString(),
				});
			});
		}

		console.log(`📊 Found ${Object.keys(runSteps).length} run steps`);

		// Fetch all image files for inclusion in thread data
		const imageFilesSnapshot = await firestore.collection("image_files").get();
		const imageFiles = {};

		if (!imageFilesSnapshot.empty) {
			imageFilesSnapshot.docs.forEach((doc) => {
				const data = doc.data();
				imageFiles[data.fileId] = {
					fileId: data.fileId,
					contentType: data.contentType,
					base64Data: data.base64Data,
					size: data.size,
					createdAt: data.createdAt,
					accessedAt: data.accessedAt,
				};
			});
		}

		console.log(
			`📊 Found ${Object.keys(imageFiles).length} image files in database`
		);

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

		// Add run steps to threads
		Object.keys(runSteps).forEach((threadId) => {
			if (!threads[threadId]) {
				threads[threadId] = [];
			}

			runSteps[threadId].forEach((step) => {
				// Add code inputs as assistant messages
				if (step.codeInput) {
					threads[threadId].push({
						role: "assistant",
						content: step.codeInput,
						timestamp: step.timestamp,
						contentType: "code_input",
						language: step.language || "python",
						toolCallId: step.toolCallId,
						messageType: "run_step",
						stepId: step.stepId,
						runId: step.runId,
					});
				}

				// Add code outputs as assistant messages
				if (step.codeOutputs && Array.isArray(step.codeOutputs)) {
					step.codeOutputs.forEach((output) => {
						if (output.type === "logs" && output.content) {
							threads[threadId].push({
								role: "assistant",
								content: output.content,
								timestamp: step.timestamp,
								contentType: "code_output",
								outputType: "logs",
								toolCallId: step.toolCallId,
								messageType: "run_step",
								stepId: step.stepId,
								runId: step.runId,
							});
						} else if (output.type === "image") {
							const imageId = output.content;
							// Extract the actual file ID from the image reference
							const actualFileId = imageId
								.replace(/^\[Image:\s*/, "")
								.replace(/\s*\]$/, "");
							const imageInfo = imageFiles[actualFileId];
							console.log(
								`🖼️ Processing image output: ${imageId} -> ${actualFileId}`,
								{
									hasImageInfo: !!imageInfo,
									hasBase64Data: !!(imageInfo && imageInfo.base64Data),
									dataLength: imageInfo?.base64Data?.length,
								}
							);

							threads[threadId].push({
								role: "assistant",
								content: `[Generated Image: ${imageId}]`,
								timestamp: step.timestamp,
								contentType: "code_output",
								outputType: "image",
								imageId: imageId,
								imageData: imageInfo
									? {
											contentType: imageInfo.contentType,
											base64Data: imageInfo.base64Data,
											size: imageInfo.size,
									  }
									: null,
								toolCallId: step.toolCallId,
								messageType: "run_step",
								stepId: step.stepId,
								runId: step.runId,
							});
						} else if (output.type === "error") {
							threads[threadId].push({
								role: "assistant",
								content: `Error: ${output.content}`,
								timestamp: step.timestamp,
								contentType: "code_output",
								outputType: "error",
								toolCallId: step.toolCallId,
								messageType: "run_step",
								stepId: step.stepId,
								runId: step.runId,
							});
						}
					});
				}

				// Add function calls
				if (step.functionName) {
					threads[threadId].push({
						role: "assistant",
						content: `[Function Call: ${step.functionName}]`,
						timestamp: step.timestamp,
						contentType: "function_call",
						functionName: step.functionName,
						functionArgs: step.functionArgs,
						messageType: "run_step",
						stepId: step.stepId,
						runId: step.runId,
					});
				}

				// Add file search
				if (step.searchQuery) {
					threads[threadId].push({
						role: "assistant",
						content: `[File Search: ${step.searchQuery}]`,
						timestamp: step.timestamp,
						contentType: "file_search",
						searchQuery: step.searchQuery,
						searchResults: step.searchResults,
						messageType: "run_step",
						stepId: step.stepId,
						runId: step.runId,
					});
				}
			});
		});

		console.log(`\n📊 FINAL STATS:`);
		console.log(`📊 User messages found: ${userMessageCount}`);
		console.log(`📊 Assistant messages found: ${assistantMessageCount}`);
		console.log(`📊 Threads with messages: ${Object.keys(threads).length}`);

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
