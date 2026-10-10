import { BeadsGitConflictError, CommandError } from "@hive/shared";
import { expect, test } from "bun:test";
import type { Command } from "./beads-environment.ts";
import { syncBeads } from "./beads-publish.ts";

const FIRST = 0;
const ONE = 1;
const originalErrors = {
	IO_ERROR: nativeFailure("IO_ERROR"),
	SYNC_CONFLICT: nativeFailure("SYNC_CONFLICT"),
};
const environment = { BEADS_DB: "/repo/.worktrees/tracker--state/.beads/beads.db" };
interface FailureFixture {
	kind: string;
	nativeCode: keyof typeof originalErrors;
	alerts: number;
	gitConflict: boolean;
}

test.each([
	{ kind: "existing Git", nativeCode: "IO_ERROR", alerts: 1, gitConflict: true },
	{ kind: "merge Git", nativeCode: "IO_ERROR", alerts: 1, gitConflict: true },
	{ kind: "native", nativeCode: "SYNC_CONFLICT", alerts: 1, gitConflict: false },
	{ kind: "other", nativeCode: "IO_ERROR", alerts: 0, gitConflict: false },
	{ kind: "merge error", nativeCode: "IO_ERROR", alerts: 0, gitConflict: false },
] as const)("publication stops and alerts only a verified conflict: $kind", async (fixture) => {
	const { command, original, calls } = publicationFixture(fixture);
	const bodies: string[] = [];
	const result = syncBeads(environment, command, {
		notify: (body) => {
			bodies.push(body);
			return Promise.resolve();
		},
		report: () => {},
	});
	const failure = await result.catch((error: unknown) => error);
	expect(failure instanceof BeadsGitConflictError).toBe(fixture.gitConflict);
	if (!fixture.gitConflict) {
		expect(failure).toBe(original);
	}
	expect(bodies).toHaveLength(fixture.alerts);
	expect(calls.some((call) => call.startsWith("git push"))).toBe(false);
});

test("failed notification does not mask publication failure", async () => {
	const { command, original } = publicationFixture({
		kind: "native",
		nativeCode: "SYNC_CONFLICT",
		alerts: ONE,
		gitConflict: false,
	});
	const reports: string[] = [];
	await expect(
		syncBeads(environment, command, {
			notify: () => Promise.reject(new Error("delivery unavailable")),
			report: (message) => {
				reports.push(message);
			},
		}),
	).rejects.toBe(original);
	expect(reports[FIRST]).toContain("delivery unavailable");
	expect(reports[FIRST]).toContain(original.message);
});

function publicationFixture(fixture: FailureFixture) {
	const original = originalErrors[fixture.nativeCode];
	const calls: string[] = [];
	let merging = false;
	// eslint-disable-next-line require-await, max-statements -- Fake the serial subprocess boundary without IO or timing.
	const command: Command = async (argv) => {
		const key = argv.join(" ");
		calls.push(key);
		switch (key) {
			case "git branch --show-current": {
				return "tracker/state";
			}
			case "git config --get branch.tracker/state.remote": {
				return "origin";
			}
			case "git config --get branch.tracker/state.merge": {
				return "refs/heads/tracker/state";
			}
			case "git rev-parse @{upstream}": {
				return "remote-revision";
			}
			case "git diff --name-only --diff-filter=U": {
				if (fixture.kind === "existing Git" || merging) {
					return ".beads/issues.jsonl";
				}
				return "";
			}
			default: {
				break;
			}
		}
		if (argv[FIRST] === "br" && (fixture.kind === "native" || fixture.kind === "other")) {
			throw original;
		}
		if (argv[ONE] === "merge-base") {
			return "common-revision";
		}
		if (argv[ONE] === "merge") {
			merging = fixture.kind === "merge Git";
			throw original;
		}
		return "";
	};
	return { command, original, calls };
}

function nativeFailure(code: string): CommandError {
	return new CommandError("operation", {
		code: 6,
		stderr: "original command failure",
		stdout: JSON.stringify({ error: { code, message: "native diagnostic" } }),
	});
}
