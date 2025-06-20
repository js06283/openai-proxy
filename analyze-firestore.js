const { Firestore } = require("@google-cloud/firestore");

async function analyzeFirestoreLogs() {
	try {
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
			console.log(
				"Please set up Google Cloud credentials as described in FIRESTORE_SETUP.md"
			);
			return;
		}

		console.log("📊 Fetching data from Google Cloud Firestore...\n");

		// Get all documents from the api_logs collection
		const snapshot = await firestore.collection("api_logs").get();

		if (snapshot.empty) {
			console.log("❌ No log documents found in Firestore.");
			return;
		}

		console.log(`📊 Found ${snapshot.size} log entries...\n`);

		// Convert Firestore documents to our format
		const allInteractions = snapshot.docs.map((doc) => {
			const data = doc.data();
			return {
				id: doc.id,
				timestamp: data.timestamp || "",
				type: data.type || "",
				path: data.path || "",
				method: data.method || "",
				status: data.status || 0,
				responseTime: data.responseTime || 0,
				responseSize: data.responseSize || 0,
				userAgent: data.userAgent || "",
				ip: data.ip || "",
				body: data.body || "",
				responseData: data.responseData || "",
				error: data.error || "",
				rawResponse: data.rawResponse || "",
				stack: data.stack || "",
			};
		});

		// Analyze data
		const analysis = {
			totalInteractions: allInteractions.length,
			requests: allInteractions.filter((log) => log.type === "request").length,
			responses: allInteractions.filter((log) => log.type === "response")
				.length,
			errors: allInteractions.filter((log) => log.type === "error").length,
			uniquePaths: [...new Set(allInteractions.map((log) => log.path))],
			averageResponseTime: 0,
			totalResponseTime: 0,
			responseTimes: [],
			userAgents: [
				...new Set(
					allInteractions
						.filter((log) => log.userAgent)
						.map((log) => log.userAgent)
				),
			],
			ipAddresses: [
				...new Set(
					allInteractions.filter((log) => log.ip).map((log) => log.ip)
				),
			],
			dateRange: {
				earliest: null,
				latest: null,
			},
		};

		// Calculate response times
		const responses = allInteractions.filter(
			(log) => log.type === "response" && log.responseTime
		);
		if (responses.length > 0) {
			analysis.totalResponseTime = responses.reduce(
				(sum, log) => sum + log.responseTime,
				0
			);
			analysis.averageResponseTime =
				analysis.totalResponseTime / responses.length;
			analysis.responseTimes = responses.map((log) => log.responseTime);
		}

		// Calculate date range
		const timestamps = allInteractions
			.map((log) => log.timestamp)
			.filter((t) => t);
		if (timestamps.length > 0) {
			analysis.dateRange.earliest = new Date(
				Math.min(...timestamps.map((t) => new Date(t)))
			);
			analysis.dateRange.latest = new Date(
				Math.max(...timestamps.map((t) => new Date(t)))
			);
		}

		// Generate report
		console.log("📈 API Usage Analysis Report (Firestore)");
		console.log("=".repeat(60));
		console.log(`Total Interactions: ${analysis.totalInteractions}`);
		console.log(`Requests: ${analysis.requests}`);
		console.log(`Responses: ${analysis.responses}`);
		console.log(`Errors: ${analysis.errors}`);
		console.log(
			`Success Rate: ${((analysis.responses / analysis.requests) * 100).toFixed(
				2
			)}%`
		);
		console.log(
			`Average Response Time: ${analysis.averageResponseTime.toFixed(2)}ms`
		);

		if (analysis.dateRange.earliest && analysis.dateRange.latest) {
			console.log(
				`Date Range: ${
					analysis.dateRange.earliest.toISOString().split("T")[0]
				} to ${analysis.dateRange.latest.toISOString().split("T")[0]}`
			);
		}

		console.log(`\nAPI Endpoints Used:`);
		analysis.uniquePaths.forEach((path) => {
			const count = allInteractions.filter((log) => log.path === path).length;
			console.log(`  ${path}: ${count} calls`);
		});

		console.log(`\nUnique User Agents: ${analysis.userAgents.length}`);
		console.log(`Unique IP Addresses: ${analysis.ipAddresses.length}`);

		// Show some recent interactions
		console.log(`\n📋 Recent Interactions (last 5):`);
		const recentInteractions = allInteractions
			.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
			.slice(0, 5);

		recentInteractions.forEach((interaction, index) => {
			console.log(
				`  ${index + 1}. ${interaction.timestamp} - ${interaction.type} ${
					interaction.path
				} (${interaction.responseTime || 0}ms)`
			);
		});

		// Save analysis to file
		const analysisData = {
			generatedAt: new Date().toISOString(),
			...analysis,
			sampleInteractions: recentInteractions,
		};

		const fs = require("fs").promises;
		const analysisFile = "firestore-analysis-report.json";
		await fs.writeFile(analysisFile, JSON.stringify(analysisData, null, 2));
		console.log(`\n✅ Analysis saved to: ${analysisFile}`);
	} catch (err) {
		console.error("❌ Error analyzing Firestore logs:", err);
	}
}

// Run analysis if called directly
if (require.main === module) {
	analyzeFirestoreLogs();
}

module.exports = { analyzeFirestoreLogs };
