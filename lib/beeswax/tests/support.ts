/* eslint-disable require-await -- Async in-memory adapters satisfy the production IO interface. */
import type { Dependencies } from "../src/cli.ts";
import type { SetupOptions } from "../src/setup.ts";
import { createBundledSkills } from "../src/skills.ts";
import { version } from "../package.json";

/** Small in-memory workspace seam; unexpected effects fail instead of silently passing. */
const FIRST = 0;
const SECOND = 1;
const skills = createBundledSkills();

export function fixture() {
	const files = new Map<string, string>();
	const commands: string[][] = [];
	const output: string[] = [];
	const errors: string[] = [];
	const trackers: SetupOptions[] = [];
	const unexpected = async (): Promise<never> => {
		throw new Error("Unexpected test operation");
	};
	const deps: Dependencies = {
		context: {
			cwd: "/repo",
			actor: "codex",
			owner: "operator",
			beadsDb: "",
			tty: false,
			executable: "/opt/bin/beeswax",
		},
		source: "/repo",
		environmentFile: "",
		binDirectory: "/bin",
		read: async (path) => files.get(path) ?? "",
		write: async (path, value) => {
			files.set(path, value);
		},
		exists: async (path) => files.has(path),
		chmod: async () => {},
		list: async () => [],
		exec: async () => ({ exitCode: 1, stdout: "", stderr: "" }),
		// eslint-disable-next-line max-statements -- One fake dispatcher accepts only known workspace operations.
		command: async (argv) => {
			commands.push([...argv]);
			if (argv[FIRST] === "git" && argv[SECOND] === "rev-parse") {
				if (argv.includes("--git-path")) {
					return "/repo/.git/beeswax";
				}
				if (argv.includes("--git-common-dir")) {
					return "/repo/.git";
				}
				return "/repo";
			}
			if (argv[SECOND] === "--version") {
				return version;
			}
			if (argv[FIRST] === "git" && argv[SECOND] === "branch") {
				return "tracker/state";
			}
			if (argv[FIRST] === "git" && argv[SECOND] === "worktree") {
				return "worktree /repo\0\0";
			}
			if (argv[FIRST] === "git" && argv[SECOND] === "config") {
				return "";
			}
			throw new Error(`Unexpected command ${argv.join(" ")}`);
		},
		stdout: (text) => {
			output.push(text);
		},
		stderr: (text) => {
			errors.push(text);
		},
		stdin: unexpected,
		wizard: unexpected,
		installArtifacts: unexpected,
		skills,
		operations: {
			tracker: async (options) => {
				trackers.push(options);
				return options.beadsDb;
			},
		},
		beads: {
			setup: unexpected,
			bootstrap: unexpected,
			initialize: unexpected,
			environment: unexpected,
			sync: unexpected,
			automatic: unexpected,
			sessionStart: unexpected,
		},
		git: { merge: unexpected, validate: unexpected, pack: unexpected },
	};
	return { deps, files, commands, output, errors, trackers };
}
