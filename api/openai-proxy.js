const fetch = require("node-fetch");

module.exports = async (req, res) => {
	// ✅ CORS headers
	res.setHeader("Access-Control-Allow-Origin", "*"); // or 'https://nyu.qualtrics.com'
	res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

	// ✅ Preflight response for OPTIONS
	if (req.method === "OPTIONS") {
		return res.status(200).end();
	}

	// ✅ Read and parse JSON body
	let bodyData = "";
	req.on("data", (chunk) => {
		bodyData += chunk;
	});

	req.on("end", async () => {
		try {
			const { path, method = "POST", body } = JSON.parse(bodyData);

			const openaiRes = await fetch(`https://api.openai.com/v1${path}`, {
				method,
				headers: {
					Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
					"Content-Type": "application/json",
					"OpenAI-Beta": "assistants=v1",
				},
				body: JSON.stringify(body),
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
