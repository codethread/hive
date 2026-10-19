import type { Extension, LoadExtensionsResult } from "@earendil-works/pi-coding-agent";
import { defaultProjectConfig, writeProjectConfig } from "../../src/config.ts";
import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable native Pi module fixture.
import { mkdtemp, rm } from "node:fs/promises";
import { applyOnboarding } from "../../src/onboarding.ts";
import { createLiveDependencies } from "../../src/live.ts";
import { fixture } from "../support.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Fixture paths.
import { join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Temporary fixture root.
import { tmpdir } from "node:os";
import { writeProjectLock } from "../../src/project.ts";

const FIRST = 0;
const vendor = new URL(
	"core/extensions/loader.js",
	import.meta.resolve("@earendil-works/pi-coding-agent"),
);
const {
	loadExtensions,
}: {
	/** Pinned vendor module loading, independent of its CLI/bootstrap process. */
	loadExtensions: (paths: string[], cwd: string) => Promise<LoadExtensionsResult>;
} = await import(vendor.href);

// eslint-disable-next-line max-statements -- Verify native imports, reload and callbacks at the vendor boundary.
test("supported Pi loader delegates callbacks and reloads the accepted payload at the same path", async () => {
	const root = await mkdtemp(join(tmpdir(), "beeswax pi loader "));
	const io = { ...createLiveDependencies(), command: fixture().deps.command };
	const config = {
		...defaultProjectConfig("none"),
		onboarding: { harnesses: ["pi" as const], include: [], exclude: [] },
	};
	try {
		await writeProjectConfig(root, config, io);
		await writeProjectLock(root, io);
		await applyOnboarding(root, config, io);
		const bridge = join(root, "fixture.js");
		await io.write(bridge, fixtureBridge());
		const original = await loadExtensions([bridge], root);
		expect(original.errors).toEqual([]);
		expect(await primer(original.extensions[FIRST]!)).toBe("prime");
		const nextConfig = { ...config, onboarding: { ...config.onboarding, include: ["colony"] } };
		await writeProjectConfig(root, nextConfig, io);
		await writeProjectLock(root, io);
		await applyOnboarding(root, nextConfig, io);
		const next = await loadExtensions([bridge], root);
		expect(next.errors).toEqual([]);
		expect(await primer(next.extensions[FIRST]!)).toBe("prime --include colony");
		const context = await next.extensions[FIRST]!.handlers.get("context")![FIRST]!(
			{ messages: [] },
			{ cwd: root, sessionManager: { getSessionId: () => "fixture" } },
		);
		expect(context).toMatchObject({ messages: [{ content: "fixture alert" }] });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

// --- Private functions ---

async function primer(extension: Extension): Promise<string | undefined> {
	const sections: Record<string, string> = {};
	await extension.handlers.get("before_agent_start")![FIRST]!(
		{ systemPromptOptions: { sections } },
		{},
	);
	return sections["beeswax"];
}

function fixtureBridge(): string {
	return `
import register from "./.pi/extensions/beeswax.js";
import { fileURLToPath } from "node:url";
export default async function (pi) {
  const root = fileURLToPath(new URL(".", import.meta.url));
  await register({ ...pi, exec: async (command, args) => {
    if (command !== "beeswax") throw new Error("Unexpected command");
    let stdout;
    if (args[0] === "system" && args[1] === "pi-check") {
      if (args[2] !== "--repo" || args[3] !== root || args[4] !== "--json") {
        throw new Error("Validation must target the adapter checkout");
      }
      const payload = await Bun.file(new URL("./.hive/beeswax/generated/pi-beeswax.js", import.meta.url)).text();
      stdout = JSON.stringify({ payloadDigest: new Bun.CryptoHasher("sha256").update(payload).digest("hex") });
    } else if (args[0] === "prime") {
      stdout = args.join(" ");
    } else if (args[0] === "system" && args[1] === "harness-alert") {
      stdout = JSON.stringify({ context: "fixture alert" });
    } else {
      throw new Error("Unexpected Beeswax operation");
    }
    return { code: 0, stdout, stderr: "" };
  } });
}
`;
}
