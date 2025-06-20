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

				// Log the response to Firestore
				await logToFirestore({
					type: "response",
					path,
					method,
					status: openaiRes.status,
					responseTime,
					responseSize: text.length,
					responseData: JSON.stringify(data).substring(0, 1000), // Truncate large responses
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
