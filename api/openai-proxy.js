const fetch = require("node-fetch");

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

	console.log(process.env.OPENAI_API_KEY);

	req.on("end", async () => {
		try {
			if (!bodyData) {
				return res.status(400).json({ error: "Empty request body" });
			}

			const { path, method = "POST", body } = JSON.parse(bodyData);

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

			const openaiRes = await fetch(
				`https://api.openai.com/v1${path}`,
				options
			);

			// ✅ Log full response details
			const text = await openaiRes.text();

			try {
				const data = JSON.parse(text);
				return res.status(openaiRes.status).json(data);
			} catch (parseErr) {
				console.error("❌ Failed to parse OpenAI response as JSON");
				console.error("🔁 Response status:", openaiRes.status);
				console.error("🔁 Response body:", text);

				return res.status(500).json({
					error: "Proxy server error",
					details: `OpenAI response could not be parsed as JSON`,
					status: openaiRes.status,
					raw: text,
				});
			}
		} catch (err) {
			console.error("Proxy error:", err);
			return res
				.status(500)
				.json({ error: "Proxy server error", details: err.message });
		}
	});
};
