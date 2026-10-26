/* eslint-disable capitalized-comments, import/no-anonymous-default-export, func-names */
/* eslint-disable curly, no-magic-numbers */
// beeswax:begin onboarding v2
export default function (pi) {
	pi.on("before_agent_start", async (event) => {
		const result = await pi.exec("beeswax", ["prime"]);
		if (result.code !== 0) throw new Error(`beeswax prime failed: ${result.stderr}`);
		event.systemPromptOptions.sections.beeswax = result.stdout.trimEnd();
	});
	pi.on("context", async (event, ctx) => {
		const payload = JSON.stringify({ session_id: ctx.sessionManager.getSessionId(), cwd: ctx.cwd, hook_event_name: "context" });
		let context;
		try {
			const result = await pi.exec("beeswax", ["system", "harness-alert", "--harness", "pi", "--input", payload], { timeout: 5000 });
			if (result.code !== 0) throw new Error(result.stderr);
			const output = JSON.parse(result.stdout);
			if (typeof output.context !== "string") throw new Error("Invalid alert callback output");
			context = output.context;
		} catch (error) {
			context = "Beeswax tracker alert check failed; the selected endpoint's incident state is unverified. Pause Beads work and merges involving this endpoint; independent non-Beads work may continue. This failure does not establish a new incident or clear a known hold. Read beeswax skills get tracker-recovery to recheck status and decide when work can resume. Diagnostics: " + String(error);
		}
		const messages = event.messages.filter((message) => message.customType !== "beeswax-tracker-alert");
		if (context) messages.push({ role: "custom", customType: "beeswax-tracker-alert", content: context, display: true, timestamp: Date.now() });
		return { messages };
	});
}
// beeswax:end onboarding
