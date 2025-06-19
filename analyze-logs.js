const fs = require("fs").promises;
const path = require("path");

async function analyzeLogs() {
	try {
		const logsDir = path.join(__dirname, "logs");

		// Check if logs directory exists
		try {
			await fs.access(logsDir);
		} catch (err) {
			console.log(
				"❌ No logs directory found. Run the application first to generate logs."
			);
			return;
		}

		// Get all log files
		const files = await fs.readdir(logsDir);
		const logFiles = files.filter(
			(file) => file.startsWith("chat-interactions-") && file.endsWith(".json")
		);

		if (logFiles.length === 0) {
			console.log("❌ No log files found.");
			return;
		}

		console.log(`📊 Analyzing ${logFiles.length} log files...\n`);

		let allInteractions = [];

		// Read all log files
		for (const file of logFiles) {
			const filePath = path.join(logsDir, file);
			const data = await fs.readFile(filePath, "utf8");
			const logs = JSON.parse(data);
			allInteractions = allInteractions.concat(logs);
		}

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

		// Generate report
		console.log("📈 API Usage Analysis Report");
		console.log("=".repeat(50));
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
		console.log(`\nAPI Endpoints Used:`);
		analysis.uniquePaths.forEach((path) => {
			const count = allInteractions.filter((log) => log.path === path).length;
			console.log(`  ${path}: ${count} calls`);
		});

		console.log(`\nUnique User Agents: ${analysis.userAgents.length}`);
		console.log(`Unique IP Addresses: ${analysis.ipAddresses.length}`);

		// Save analysis to file
		const analysisFile = path.join(logsDir, "analysis-report.json");
		await fs.writeFile(analysisFile, JSON.stringify(analysis, null, 2));
		console.log(`\n✅ Analysis saved to: ${analysisFile}`);
	} catch (err) {
		console.error("❌ Error analyzing logs:", err);
	}
}

// Run analysis if called directly
if (require.main === module) {
	analyzeLogs();
}

module.exports = { analyzeLogs };
