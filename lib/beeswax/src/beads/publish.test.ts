import type { BeadsScope, BeadsService } from "@hive/beads";
import { CommandError, createMemoryBeads } from "@hive/beads";
import { expect, test } from "bun:test";
import { BeadsGitConflictError } from "@hive/shared";
import type { Command } from "./environment.ts";
import { syncBeads } from "./publish.ts";

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
	{ kind: "native", nativeCode: "SYNC_CONFLICT", alerts: 1, gitConflict: false },
	{ kind: "other", nativeCode: "IO_ERROR", alerts: 0, gitConflict: false },
	{ kind: "fetch error", nativeCode: "IO_ERROR", alerts: 0, gitConflict: false },
] as const)(
	"publication stops and alerts only a verified conflict: $kind #test-494",
	// Verify notification policy and tracker attribution across each typed sync failure.
	// eslint-disable-next-line max-statements
	async (fixture) => {
		const { services, original, calls, scopes } = publicationFixture(fixture);
		const bodies: string[] = [];
		const result = syncBeads(environment, services, {
			notify: (body) => {
				bodies.push(body);
				return Promise.resolve();
			},
			report: () => {},
		});
		const failure = await result.catch((error: unknown) => error);
		if (fixture.gitConflict) {
			expect(failure).toBeInstanceOf(BeadsGitConflictError);
		} else {
			expect(failure).toBe(original);
		}
		expect(bodies).toHaveLength(fixture.alerts);
		expect(calls.some((call) => call.startsWith("git push"))).toBe(false);
		for (const scope of scopes) {
			expect(scope).toEqual({ cwd: "/repo/.worktrees/tracker--state", db: environment.BEADS_DB });
		}
	},
);

test("failed notification does not mask publication failure #test-495", async () => {
	const { services, original } = publicationFixture({
		kind: "native",
		nativeCode: "SYNC_CONFLICT",
		alerts: ONE,
		gitConflict: false,
	});
	const reports: string[] = [];
	await expect(
		syncBeads(environment, services, {
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
	const scopes: BeadsScope[] = [];
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
				if (fixture.kind === "existing Git") {
					return ".beads/issues.jsonl";
				}
				return "";
			}
			default: {
				break;
			}
		}
		if (argv[ONE] === "merge-base") {
			return "common-revision";
		}
		if (argv[ONE] === "fetch" && fixture.kind === "fetch error") {
			throw original;
		}
		return "";
	};
	const synchronize = (scope: BeadsScope) => {
		scopes.push(scope);
		calls.push("sync");
		if (fixture.kind === "native" || fixture.kind === "other") {
			return Promise.reject(original);
		}
		return Promise.resolve();
	};
	const memory = createMemoryBeads();
	const beads: BeadsService = {
		...memory,
		sync: {
			...memory.sync,
			merge: synchronize,
			flush: synchronize,
		},
	};
	return { services: { beads, command, write: () => Promise.resolve() }, original, calls, scopes };
}

function nativeFailure(code: string): CommandError {
	return new CommandError("operation", {
		code: 6,
		stderr: "original command failure",
		stdout: JSON.stringify({ error: { code, message: "native diagnostic" } }),
	});
}
