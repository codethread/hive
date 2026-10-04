import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Own a disposable native Beads database.
import { mkdtemp, rm } from "node:fs/promises";
import { installAttentionQuery } from "./beads-setup.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve private fixture paths.
import { join } from "node:path";
import { runCommand } from "./beads-environment.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Isolated native IO test root.
import { tmpdir } from "node:os";

const TIMEOUT = 15_000;

test(
	"setup installs a native AND attention preset that includes closed failures and preserves other presets",
	// eslint-disable-next-line max-statements -- Native filter semantics and preset replacement share one disposable tracker.
	async () => {
		const repo = await mkdtemp(join(tmpdir(), "bee-queries-"));
		const database = join(repo, ".beads", "beads.db");
		const command = (args: readonly string[]) => runCommand(args, repo);
		const br = async (args: string[]) =>
			JSON.parse(
				await command(["br", ...args, "--db", database, "--actor", "smoke-seed", "--json"]),
			);
		try {
			await command(["git", "init"]);
			await br(["init", "--prefix", "smoke"]);
			const expected: string[] = [];
			const failures: string[] = [];
			/* eslint-disable no-await-in-loop -- Seed each native lifecycle before checking its query membership. */
			for (const fixture of [
				{
					attention: false,
					closed: false,
					failed: false,
					labels: "system,bee,bee-outcome:pending,bee-resolution:unresolved",
					title: "pending",
				},
				{
					attention: false,
					closed: true,
					failed: false,
					labels: "system,bee,bee-outcome:succeeded,bee-resolution:resolved",
					title: "succeeded",
				},
				{
					attention: false,
					closed: true,
					failed: false,
					labels: "system,bee,bee-outcome:cancelled,bee-resolution:resolved",
					title: "cancelled",
				},
				{
					attention: true,
					closed: true,
					failed: true,
					labels: "system,bee,bee-outcome:failed,bee-resolution:unresolved",
					title: "unresolved failure",
				},
				{
					attention: false,
					closed: true,
					failed: true,
					labels: "system,bee,bee-outcome:failed,bee-resolution:resolved",
					title: "superseded failure",
				},
				{
					attention: false,
					closed: true,
					failed: true,
					labels: "bee,bee-outcome:failed,bee-resolution:unresolved",
					title: "missing system marker",
				},
				{
					attention: false,
					closed: true,
					failed: true,
					labels: "system,bee-outcome:failed,bee-resolution:unresolved",
					title: "missing bee marker",
				},
			]) {
				const created = await br([
					"create",
					"--title",
					fixture.title,
					"--owner",
					"ct",
					"--labels",
					fixture.labels,
				]);
				if (fixture.closed) {
					await br(["close", created.id]);
				}
				if (fixture.attention) {
					expected.push(created.id);
				}
				if (fixture.failed) {
					failures.push(created.id);
				}
			}
			/* eslint-enable no-await-in-loop */
			await br(["query", "save", "personal", "--title-contains", "pending"]);
			await installAttentionQuery(repo, database, command);
			await installAttentionQuery(repo, database, command);
			const saved = await br(["query", "run", "bee-attention"]);
			expect(saved.issues.map((issue: { id: string }) => issue.id)).toEqual(expected);
			expect(saved.issues.every((issue: { status: string }) => issue.status === "closed")).toBe(
				true,
			);
			const direct = await br([
				"list",
				"--label",
				"system",
				"--label",
				"bee",
				"--label",
				"bee-outcome:failed",
				"--label",
				"bee-resolution:unresolved",
				"--all",
				"--limit",
				"0",
			]);
			expect(direct.issues).toEqual(saved.issues);
			const withoutClosed = await br([
				"list",
				"--label",
				"system",
				"--label",
				"bee",
				"--label",
				"bee-outcome:failed",
				"--label",
				"bee-resolution:unresolved",
			]);
			expect(withoutClosed.issues).toEqual([]);
			const personal = await br(["query", "run", "personal"]);
			expect(personal.issues.map((issue: { title: string }) => issue.title)).toEqual(["pending"]);
			const override = await br(["query", "run", "bee-attention", "--label", "bee-outcome:failed"]);
			expect(override.issues.map((issue: { id: string }) => issue.id).toSorted()).toEqual(
				failures.toSorted(),
			);
		} finally {
			await rm(repo, { force: true, recursive: true });
		}
	},
	TIMEOUT,
);
