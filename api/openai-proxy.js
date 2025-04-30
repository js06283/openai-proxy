const fetch = require("node-fetch");

module.exports = async (req, res) => {
	// ✅ Set proper CORS headers
	res.setHeader("Access-Control-Allow-Origin", "*"); // or "https://nyu.qualtrics.com"
	res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
	res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

	// ✅ Handle preflight request
	if (req.method === "OPTIONS") {
		return res.status(200).end(); // Must respond to OPTIONS
	}

	// 🔒 Parse the incoming request
	const { path, method = "POST", body } = req.body;

	try {
		const response = await fetch(`https://api.openai.com/v1${path}`, {
			method,
			headers: {
				Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
				"Content-Type": "application/json",
				"OpenAI-Beta": "assistants=v1",
			},
			body: JSON.stringify(body),
		});

		const data = await response.json();
		return res.status(200).json(data);
	} catch (error) {
		console.error("Proxy error:", error);
		return res.status(500).json({ error: "Proxy server error" });
	}
};
