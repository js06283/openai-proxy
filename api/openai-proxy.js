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

	req.on("end", async () => {
		try {
			if (!bodyData) {
				return res.status(400).json({ error: "Empty request body" });
			}

			const { path, method = "POST", body } = JSON.parse(bodyData);

			const openaiRes = await fetch(`https://api.openai.com/v1${path}`, {
				method,
				headers: {
					Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
					"Content-Type": "application/json",
					"OpenAI-Beta": "assistants=v2",
				},
				body: JSON.stringify(body || {}),
			});

			const data = await openaiRes.json();
			return res.status(200).json(data);
		} catch (err) {
			console.error("Proxy error:", err);
			return res
				.status(500)
				.json({ error: "Proxy server error", details: err.message });
		}
	});
};
