/* eslint-disable unicorn/no-null -- Captured recipe uses canonical execution-directory default. */
import { COLONY_STDOUT_PREFIX, execute, latestStdoutActivity, showBead } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Owned stdout artifacts and private tracker cleanup.
import { appendFile, mkdir, mkdtemp, rm, utimes } from "node:fs/promises";
import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- OS temporary fixture root.
import { hostname, tmpdir } from "node:os";
import { publishObservation, publishStdoutActivity, readStdoutActivity } from "./observations.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Private fixture paths.
import { join } from "node:path";

const INITIAL = 1;
const FIRST_OUTPUT = 2;
const FINAL_OUTPUT = 3;
const SMOKE_TIMEOUT = 10_000;

test(
	"stdout evidence ignores empty logs and stderr, coalesces writes and survives publisher restart",
	// eslint-disable-next-line max-statements -- Real metadata and native comments exercise one publication lifecycle.
	async () => {
		const root = await mkdtemp(join(tmpdir(), "colony-stdout-"));
		const repository = { beadsDb: join(root, ".beads", "beads.db"), root };
		const env = { ...process.env, BD_ACTOR: "smoke-seed", BEADS_DB: repository.beadsDb };
		const run = (args: string[]) => execute(args, root, env);
		try {
			await run(["br", "init", "--prefix", "smoke"]);
			const recipe = {
				cwd: null,
				effort: "low",
				harness: "fixture",
				kind: "worker",
				model: "fixture",
				prompt: "",
				system_prompt: "",
			};
			const description = JSON.stringify({ ...recipe, host: hostname() });
			const spawn = JSON.parse(
				await run([
					"br",
					"create",
					"--title",
					"Stdout fixture",
					"--owner",
					"ct",
					"--assignee",
					"fixture-bee",
					"--labels",
					"system,bee,agent:worker",
					"--description",
					description,
					"--json",
				]),
			);
			const receipt = {
				attemptNumber: 1,
				directory: join(root, "first"),
				id: "first-attempt",
				spawnId: spawn.id,
			};
			await mkdir(receipt.directory);
			const log = join(receipt.directory, "stdout.log");
			const inspect = () => showBead(repository, "smoke-seed", spawn.id);
			const comments = async () => {
				const bead = await inspect();
				return bead.comments.filter(({ text }) => text.startsWith(COLONY_STDOUT_PREFIX));
			};
			expect(await readStdoutActivity(receipt.directory)).toBeNull();
			await publishStdoutActivity(repository, receipt);
			await Bun.write(log, "");
			await Bun.write(join(receipt.directory, "stderr.log"), "stderr only");
			await publishStdoutActivity(repository, receipt);
			expect(await comments()).toHaveLength(INITIAL);
			expect(latestStdoutActivity(await inspect())?.lastOutputAt).toBeNull();
			await appendFile(log, "actual stdout");
			const sourceTime = "2026-10-04T10:55:31.123Z";
			await utimes(log, new Date(sourceTime), new Date(sourceTime));
			await publishStdoutActivity(repository, receipt);
			const published = latestStdoutActivity(await inspect());
			expect(published?.lastOutputAt).toBe(sourceTime);
			expect(published?.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
			await appendFile(log, "more stdout");
			const latestTime = "2026-10-04T10:55:32.456Z";
			await utimes(log, new Date(latestTime), new Date(latestTime));
			const module = new URL("observations.ts", import.meta.url).href;
			await run([
				process.execPath,
				"-e",
				`import {publishStdoutActivity} from ${JSON.stringify(module)}; await publishStdoutActivity(${JSON.stringify(repository)}, ${JSON.stringify(receipt)});`,
			]);
			expect(latestStdoutActivity(await inspect())).toEqual(published);
			expect(await comments()).toHaveLength(FIRST_OUTPUT);
			await publishStdoutActivity(repository, receipt, true);
			expect(latestStdoutActivity(await inspect())?.lastOutputAt).toBe(latestTime);
			await publishStdoutActivity(repository, receipt, true);
			expect(await comments()).toHaveLength(FINAL_OUTPUT);
			const next = {
				...receipt,
				attemptNumber: 2,
				directory: join(root, "second"),
				id: "second-attempt",
			};
			await publishStdoutActivity(repository, next);
			expect(latestStdoutActivity(await inspect())).toMatchObject({
				attemptId: next.id,
				attemptNumber: 2,
				// eslint-disable-next-line unicorn/no-null -- New attempt has no output even though the old log remains.
				lastOutputAt: null,
			});
			/* eslint-disable no-await-in-loop -- Reuse the same isolated request for each nonlocal observation boundary. */
			for (const host of ["foreign-host", undefined]) {
				await run([
					"br",
					"update",
					spawn.id,
					"--description",
					JSON.stringify({ ...recipe, host }),
					"--json",
				]);
				const before = await inspect();
				await expect(publishStdoutActivity(repository, next, true)).rejects.toBeInstanceOf(Error);
				await expect(
					publishObservation(repository, spawn.id, "must not publish"),
				).rejects.toBeInstanceOf(Error);
				expect(await inspect()).toEqual(before);
			}
			/* eslint-enable no-await-in-loop */
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	},
	SMOKE_TIMEOUT,
);
