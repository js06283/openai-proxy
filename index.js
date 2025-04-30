const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
const app = express();

const apiKey = process.env.OPENAI_API_KEY; // 🔥 Use environment variable!

app.use(cors({ origin: "*" }));
app.use(express.json());

app.post("/openai-proxy", async (req, res) => {
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
		res.json(data);
	} catch (err) {
		console.error(err);
		res.status(500).send("Error communicating with OpenAI");
	}
});

module.exports = app;
