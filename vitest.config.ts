import { defineConfig } from "vitest/config";

// Keep CI annotations, but otherwise print failures in full with no passing output.
const reporters = ["minimal"];
if (process.env.GITHUB_ACTIONS === "true") {
	reporters.push("github-actions");
}

export default defineConfig({
	test: {
		projects: ["lib/*"],
		reporters,
	},
});
