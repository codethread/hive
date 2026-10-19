import { BeeswaxError } from "./errors.ts";
import type { OnboardingConfig } from "./config.ts";
import { version } from "../package.json";
import { z } from "zod";

export const piPayloadPath = ".hive/beeswax/generated/pi-beeswax.js";
const FORMAT = 1;
const FIRST = 0;
const NEXT = 1;
const header = "// beeswax:pi-payload ";
const identitySchema = z.strictObject({
	format: z.literal(FORMAT),
	generator: z.literal("pi-onboarding"),
	beeswaxVersion: z.string(),
	configDigest: z.string(),
	contentDigest: z.string(),
});
export const piAdapterSection = [
	"// beeswax:begin onboarding v3",
	'import { fileURLToPath } from "node:url";',
	"export default async function (pi) {",
	'\tconst root = fileURLToPath(new URL("../../", import.meta.url));',
	'\tconst checked = await pi.exec("beeswax", ["system", "pi-check", "--repo", root, "--json"]);',
	// eslint-disable-next-line no-template-curly-in-string -- Evaluated by the emitted adapter.
	"\tif (checked.code !== 0) throw new Error(`Beeswax Pi prerequisite failed: ${checked.stderr || checked.stdout}. " +
		"Run beeswax sync with the accepted release before loading Pi.`);",
	"\tconst identity = JSON.parse(checked.stdout);",
	// eslint-disable-next-line no-template-curly-in-string -- Content identity invalidates the native module cache.
	"\tconst payload = await import(`../../.hive/beeswax/generated/pi-beeswax.js?${identity.payloadDigest}`);",
	"\treturn payload.default(pi);",
	"}",
	"// beeswax:end onboarding",
	"",
].join("\n");

export function renderPiPayload(config: OnboardingConfig, configDigest: string): string {
	const body = renderPiBehavior(config);
	const metadata: Omit<z.infer<typeof identitySchema>, "contentDigest"> = {
		format: 1,
		generator: "pi-onboarding",
		beeswaxVersion: version,
		configDigest,
	};
	const identity = {
		...metadata,
		contentDigest: digest(`${header}${JSON.stringify(metadata)}\n${body}`),
	};
	return `${header}${JSON.stringify(identity)}\n${body}`;
}

export function requireOwnedPiPayload(path: string, contents: string): void {
	const newline = contents.indexOf("\n");
	const identity = parsePiIdentity(path, contents.slice(header.length, newline));
	const { contentDigest, ...metadata } = identity;
	const body = contents.slice(newline + NEXT);
	if (
		contents.slice(FIRST, newline) !== `${header}${JSON.stringify(identity)}` ||
		contentDigest !== digest(`${header}${JSON.stringify(metadata)}\n${body}`)
	) {
		throw piPrerequisite(path, "Payload was edited; review it before regenerating.");
	}
}

export function renderPreviousPiSection(config: OnboardingConfig): string {
	return `// beeswax:begin onboarding v2\n${renderPiBehavior(config)}// beeswax:end onboarding\n`;
}

export function isPreviousPiSection(section: string): boolean {
	const invocation = section.match(/pi\.exec\("beeswax", (?<args>\[[^\n]*\])\)/u);
	if (!invocation) {
		return false;
	}
	try {
		const args = z.array(z.string()).parse(JSON.parse(invocation.groups!["args"]!));
		const include = args.filter(
			(_arg, index) => index > FIRST && args[index - NEXT] === "--include",
		);
		const exclude = args.filter(
			(_arg, index) => index > FIRST && args[index - NEXT] === "--exclude",
		);
		return section === renderPreviousPiSection({ harnesses: ["pi"], include, exclude });
	} catch {
		return false;
	}
}

// --- Private functions ---

function parsePiIdentity(path: string, contents: string): z.infer<typeof identitySchema> {
	try {
		return identitySchema.parse(JSON.parse(contents));
	} catch {
		throw piPrerequisite(path, "Payload has an unfamiliar format; review it before regenerating.");
	}
}

function digest(contents: string): string {
	return new Bun.CryptoHasher("sha256").update(contents).digest("hex");
}

function piPrerequisite(path: string, observed: string): BeeswaxError {
	return new BeeswaxError(
		"pi_prerequisite",
		`${path}: ${observed} Run beeswax sync with the accepted release before loading Pi.`,
		{
			context: { path, observed, nextCommand: "beeswax sync" },
		},
	);
}

function renderPiBehavior(config: OnboardingConfig): string {
	const flags = [
		...config.include.flatMap((name) => ["--include", name]),
		...config.exclude.flatMap((name) => ["--exclude", name]),
	];
	return [
		"export default function (pi) {",
		'\tpi.on("before_agent_start", async (event) => {',
		`\t\tconst result = await pi.exec("beeswax", ${JSON.stringify(["prime", ...flags])});`,
		// eslint-disable-next-line no-template-curly-in-string -- This template is evaluated by the emitted Pi extension.
		"\t\tif (result.code !== 0) throw new Error(`beeswax prime failed: ${result.stderr}`);",
		"\t\tevent.systemPromptOptions.sections.beeswax = result.stdout.trimEnd();",
		"\t});",
		'\tpi.on("context", async (event, ctx) => {',
		"\t\tconst payload = JSON.stringify({ session_id: ctx.sessionManager.getSessionId(), cwd: ctx.cwd, " +
			'hook_event_name: "context" });',
		"\t\tlet context;",
		"\t\ttry {",
		'\t\t\tconst result = await pi.exec("beeswax", ' +
			'["system", "harness-alert", "--harness", "pi", "--input", payload], { timeout: 5000 });',
		"\t\t\tif (result.code !== 0) throw new Error(result.stderr);",
		"\t\t\tconst output = JSON.parse(result.stdout);",
		'\t\t\tif (typeof output.context !== "string") throw new Error("Invalid alert callback output");',
		"\t\t\tcontext = output.context;",
		"\t\t} catch (error) {",
		'\t\t\tcontext = "Beeswax tracker alert check failed. ' +
			"Stop Beads workflows and ordinary tracker operations on the selected endpoint; do not merge. " +
			"Unrelated non-Beads work and explicitly user-authorized native tracker inspection/recovery may continue. " +
			"Recheck independent alert status. With no known hold, a healthy check of this endpoint " +
			"with no active incident restores baseline; do not announce clearance. " +
			"Clearance is unverified for any known hold, including a handoff or sync failure. " +
			"A failed check or missing receipt cannot release it. " +
			"Announce verified matching or newer clearance before resuming that work. " +
			'Diagnostics: " + String(error);',
		"\t\t}",
		'\t\tconst messages = event.messages.filter((message) => message.customType !== "beeswax-tracker-alert");',
		'\t\tif (context) messages.push({ role: "custom", customType: "beeswax-tracker-alert", ' +
			"content: context, display: true, timestamp: Date.now() });",
		"\t\treturn { messages };",
		"\t});",
		"}",
		"",
	].join("\n");
}
