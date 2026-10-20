import { defaultProjectConfig, readProjectConfig, writeProjectConfig } from "../../src/config.ts";
import { expect, test } from "bun:test";
import { fixture } from "../support.ts";
import { synchronizeProject } from "../../src/synchronize.ts";
import { writeProjectLock } from "../../src/project.ts";

const root = "/repo";
const template = fixture();
await writeProjectConfig(root, defaultProjectConfig("none"), template.deps);
await writeProjectLock(root, template.deps);

test(
	"update selects harnesses, sync refreshes recognizable entries and deselection " +
		"keeps user settings #test-337",
	// eslint-disable-next-line max-statements -- Exercise one selection through update, refresh and removal.
	async () => {
		const fx = fixture();
		const execute = fx.deps.exec;
		const childCommands: string[] = [];
		fx.deps.exec = (argv, cwd) => {
			childCommands.push(argv.join(" "));
			return execute(argv, cwd);
		};
		fx.files.set(`${root}/.agents/skills/hive/SKILL.md`, "custom workflow");
		for (const [path, contents] of template.files) {
			fx.files.set(path, contents);
		}
		await synchronizeProject(
			{ root, executable: "/opt/bin/beeswax", update: true, harness: ["codex"] },
			fx.deps,
		);
		const config = await readProjectConfig(root, fx.deps);
		expect(config?.onboarding?.harnesses).toEqual(["codex"]);
		const path = `${root}/.codex/hooks.json`;
		fx.files.set(path, (fx.files.get(path) ?? "").replace("onboarding v1", "onboarding v0"));
		await synchronizeProject({ root, executable: "/opt/bin/beeswax", update: false }, fx.deps);
		expect(fx.files.get(path)).toContain("onboarding v1");
		await synchronizeProject(
			{ root, executable: "/opt/bin/beeswax", update: true, harness: ["none"] },
			fx.deps,
		);
		expect(fx.files.get(path)).not.toContain("Beeswax onboarding");
		expect(fx.files.get(`${root}/.agents/skills/hive/SKILL.md`)).toBe("custom workflow");
		expect(childCommands.some((command) => command.startsWith("npx "))).toBe(false);
	},
);
