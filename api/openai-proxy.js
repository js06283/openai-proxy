const fetch = require("node-fetch");
const fs = require("fs").promises;
const path = require("path");
const { Firestore } = require("@google-cloud/firestore");

// Initialize Firestore with credentials
let firestore;
try {
	// For Vercel deployment, use service account JSON from environment variable
	if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
		const credentials = JSON.parse(
			process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON
		);
		firestore = new Firestore({
			projectId: credentials.project_id,
			credentials: credentials,
		});
	} else {
		// For local development, use default credentials
		firestore = new Firestore();
	}
} catch (err) {
	console.error("❌ Failed to initialize Firestore:", err);
	firestore = null;
}

// Direct Firestore logging function
async function logToFirestore(data) {
	try {
		if (!firestore) {
			console.log("⚠️ Firestore not initialized, skipping logging");
			return;
		}

		const logEntry = {
			timestamp: new Date().toISOString(),
			...data,
		};

		// Add document to Firestore
		const docRef = await firestore.collection("api_logs").add(logEntry);

		console.log(
			`📝 Logged to Firestore: ${data.path} - ${logEntry.timestamp} (ID: ${docRef.id})`
		);
	} catch (err) {
		console.error("❌ Firestore logging error:", err);
	}
}

// Enhanced logging for tool calls and responses
async function logToolInteractions(data) {
	try {
		if (!firestore) {
			console.log("⚠️ Firestore not initialized, skipping tool logging");
			return;
		}

		if (data.data && Array.isArray(data.data)) {
			for (const message of data.data) {
				if (message.role === "assistant") {
					// Log tool calls
					if (message.tool_calls && Array.isArray(message.tool_calls)) {
						for (const toolCall of message.tool_calls) {
							const toolLogEntry = {
								timestamp: new Date().toISOString(),
								type: "tool_call",
								messageId: message.id,
								toolCallId: toolCall.id,
								toolType: toolCall.type,
								threadId: data.threadId || "unknown",
								path: data.path || "unknown",
							};

							if (
								toolCall.type === "code_interpreter" &&
								toolCall.code_interpreter
							) {
								toolLogEntry.codeInput = toolCall.code_interpreter.input;
								toolLogEntry.language = "python";
							} else if (toolCall.type === "function" && toolCall.function) {
								toolLogEntry.functionName = toolCall.function.name;
								toolLogEntry.functionArgs = toolCall.function.arguments;
							} else if (
								toolCall.type === "file_search" &&
								toolCall.file_search
							) {
								toolLogEntry.searchQuery = toolCall.file_search.query;
							}

							await firestore.collection("tool_logs").add(toolLogEntry);
							console.log(
								`🔧 Logged tool call: ${toolCall.type} - ${toolCall.id}`
							);
						}
					}

					// Log tool responses
					if (message.tool_responses && Array.isArray(message.tool_responses)) {
						for (const toolResponse of message.tool_responses) {
							const responseLogEntry = {
								timestamp: new Date().toISOString(),
								type: "tool_response",
								messageId: message.id,
								toolCallId: toolResponse.tool_call_id,
								toolType: toolResponse.type,
								threadId: data.threadId || "unknown",
								path: data.path || "unknown",
							};

							if (
								toolResponse.type === "code_interpreter" &&
								toolResponse.code_interpreter &&
								toolResponse.code_interpreter.outputs
							) {
								responseLogEntry.outputs =
									toolResponse.code_interpreter.outputs.map((output) => ({
										type: output.type,
										content:
											output.type === "logs"
												? output.logs
												: output.type === "image"
												? `[Image: ${output.image.file_id}]`
												: output.type === "error"
												? output.error
												: null,
									}));
							} else if (
								toolResponse.type === "function" &&
								toolResponse.function
							) {
								responseLogEntry.functionName = toolResponse.function.name;
								responseLogEntry.functionOutput = toolResponse.function.output;
							} else if (
								toolResponse.type === "file_search" &&
								toolResponse.file_search
							) {
								responseLogEntry.fileCount = toolResponse.file_search.results
									? toolResponse.file_search.results.length
									: 0;
							}

							await firestore.collection("tool_logs").add(responseLogEntry);
							console.log(
								`📤 Logged tool response: ${toolResponse.type} - ${toolResponse.tool_call_id}`
							);
						}
					}
				}
			}
		}
	} catch (err) {
		console.error("❌ Tool logging error:", err);
	}
}

// Data logging functions
async function logInteraction(data) {
	try {
		const timestamp = new Date().toISOString();
		const logEntry = {
			timestamp,
			...data,
		};

		// Create logs directory if it doesn't exist
		const logsDir = path.join(__dirname, "..", "logs");
		await fs.mkdir(logsDir, { recursive: true });

		// Log to daily file
		const dateStr = new Date().toISOString().split("T")[0];
		const logFile = path.join(logsDir, `chat-interactions-${dateStr}.json`);

		// Read existing logs or create new array
		let logs = [];
		try {
			const existingData = await fs.readFile(logFile, "utf8");
			logs = JSON.parse(existingData);
		} catch (err) {
			// File doesn't exist or is empty, start with empty array
		}

		logs.push(logEntry);
		await fs.writeFile(logFile, JSON.stringify(logs, null, 2));

		console.log(`📝 Logged interaction: ${data.path} - ${timestamp}`);
	} catch (err) {
		console.error("❌ Failed to log interaction:", err);
	}
}

module.exports = async (req, res) => {
	// ✅ CORS headers for Qualtrics
	res.setHeader("Access-Control-Allow-Origin", "*"); // Or restrict to 'https://nyu.qualtrics.com'
	res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

	// ✅ Respond to preflight requests
	if (req.method === "OPTIONS") {
		return res.status(200).end();
	}

	let bodyData = "";
	req.on("data", (chunk) => {
		bodyData += chunk;
	});

	req.on("end", async () => {
		try {
			if (!bodyData) {
				return res.status(400).json({ error: "Empty request body" });
			}

			const { path, method = "POST", body } = JSON.parse(bodyData);
			const startTime = Date.now();

			const url = `https://api.openai.com/v1${path}`;
			const headers = {
				Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
				"Content-Type": "application/json",
				"OpenAI-Beta": "assistants=v2",
			};

			const options = {
				method,
				headers,
			};

			if (method !== "GET" && method !== "HEAD") {
				options.body = JSON.stringify(body || {});
			}

			// Log the request to Firestore
			await logToFirestore({
				type: "request",
				path,
				method,
				body: body ? JSON.stringify(body).substring(0, 1000) : null, // Truncate large bodies
				userAgent: req.headers["user-agent"],
				ip: req.headers["x-forwarded-for"] || req.connection.remoteAddress,
			});

			const openaiRes = await fetch(
				`https://api.openai.com/v1${path}`,
				options
			);

			// ✅ Log full response details
			const text = await openaiRes.text();
			const responseTime = Date.now() - startTime;

			try {
				const data = JSON.parse(text);

				// Enhanced logging for tool calls and responses
				if (data.data && Array.isArray(data.data)) {
					data.data.forEach((message, index) => {
						if (message.role === "assistant") {
							console.log(`🔍 Assistant message ${index + 1}:`, {
								hasToolCalls: !!message.tool_calls,
								hasToolResponses: !!message.tool_responses,
								toolCallsCount: message.tool_calls
									? message.tool_calls.length
									: 0,
								toolResponsesCount: message.tool_responses
									? message.tool_responses.length
									: 0,
								contentTypes: message.content
									? message.content.map((c) => c.type)
									: [],
							});

							// Log tool calls if present
							if (message.tool_calls && Array.isArray(message.tool_calls)) {
								message.tool_calls.forEach((toolCall, toolIndex) => {
									console.log(`🔧 Tool Call ${toolIndex + 1}:`, {
										type: toolCall.type,
										id: toolCall.id,
										hasCodeInput:
											toolCall.code_interpreter &&
											!!toolCall.code_interpreter.input,
										codeInput: toolCall.code_interpreter
											? toolCall.code_interpreter.input.substring(0, 200) +
											  "..."
											: null,
									});
								});
							}

							// Log tool responses if present
							if (
								message.tool_responses &&
								Array.isArray(message.tool_responses)
							) {
								message.tool_responses.forEach((toolResponse, toolIndex) => {
									console.log(`📤 Tool Response ${toolIndex + 1}:`, {
										type: toolResponse.type,
										toolCallId: toolResponse.tool_call_id,
										hasOutputs:
											toolResponse.code_interpreter &&
											!!toolResponse.code_interpreter.outputs,
										outputCount: toolResponse.code_interpreter
											? toolResponse.code_interpreter.outputs.length
											: 0,
									});
								});
							}
						}
					});
				}

				// Log tool interactions to separate collection
				await logToolInteractions(data);

				// Log the response to Firestore
				await logToFirestore({
					type: "response",
					path,
					method,
					status: openaiRes.status,
					responseTime,
					responseSize: text.length,
					responseData: JSON.stringify(data).substring(0, 10000), // Increased limit for complete responses
				});

				return res.status(openaiRes.status).json(data);
			} catch (parseErr) {
				console.error("❌ Failed to parse OpenAI response as JSON");
				console.error("🔁 Response status:", openaiRes.status);
				console.error("🔁 Response body:", text);

				// Log the error to Firestore
				await logToFirestore({
					type: "error",
					path,
					method,
					status: openaiRes.status,
					responseTime,
					error: "JSON parse error",
					rawResponse: text.substring(0, 1000), // Truncate large responses
				});

				return res.status(500).json({
					error: "Proxy server error",
					details: `OpenAI response could not be parsed as JSON`,
					status: openaiRes.status,
					raw: text,
				});
			}
		} catch (err) {
			console.error("Proxy error:", err);

			// Log the error to Firestore
			await logToFirestore({
				type: "error",
				error: err.message,
				stack: err.stack?.substring(0, 1000), // Truncate large stack traces
			});

			return res
				.status(500)
				.json({ error: "Proxy server error", details: err.message });
		}
	});
};
