import { expect, test } from "bun:test";
// eslint-disable-next-line import/no-nodejs-modules -- Disposable real tracker and BV snapshot fixtures.
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { execute } from "@hive/shared";
// eslint-disable-next-line import/no-nodejs-modules -- Own fixture paths.
import { join } from "node:path";
import { pageRanks } from "./ranking.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Private OS temporary fixture root.
import { tmpdir } from "node:os";
import { z } from "zod";

const TASK_COUNT = 12;
const FIRST = 0;
const NEXT = 1;
const TIMEOUT = 30_000;
const createdSchema = z.object({ id: z.string() });

test(
	"BV ranks the complete selected snapshot beyond ten tasks, including closed tasks, and rejects missing scores",
	// eslint-disable-next-line max-statements -- One real tracker lifecycle shares isolated endpoints and deterministic teardown.
	async () => {
		const temporary = await mkdtemp(join(tmpdir(), "colony-ranking-"));
		const root = await realpath(temporary);
		const repository = { beadsDb: join(root, ".beads", "beads.db"), root };
		const env = {
			...process.env,
			BD_ACTOR: "colony",
			BEADS_DB: repository.beadsDb,
			BEADS_JSONL: join(root, ".beads", "issues.jsonl"),
		};
		const tracker = (args: string[]) =>
			execute(
				["br", ...args, "--db", repository.beadsDb, "--actor", "colony", "--json"],
				root,
				env,
			);
		try {
			await execute(["git", "init", "--quiet"], root, env);
			await tracker(["init", "--prefix", "rank"]);
			const ids: string[] = [];
			for (let index = FIRST; index < TASK_COUNT; index += NEXT) {
				// eslint-disable-next-line no-await-in-loop -- Real tracker fixture writes are deliberately serial.
				const result = await tracker([
					"create",
					"--title",
					`Ranked task ${index}`,
					"--owner",
					"ct",
				]);
				ids.push(createdSchema.parse(JSON.parse(result)).id);
			}
			await tracker(["close", ids[FIRST]!]);
			await tracker(["sync", "--flush-only"]);
			await tracker([
				"update",
				ids[FIRST]!,
				"--title",
				"Preserved after ranking",
				"--no-auto-flush",
			]);
			const scores = await pageRanks(repository, root, ids);
			expect(Object.keys(scores)).toHaveLength(TASK_COUNT);
			expect(ids.every((id) => Number.isFinite(scores[id]))).toBe(true);
			await expect(pageRanks(repository, root, [...ids, "rank-missing"])).rejects.toBeInstanceOf(
				Error,
			);
			await tracker(["sync", "--flush-only"]);
			const exportedText = await Bun.file(env.BEADS_JSONL).text();
			const records = exportedText
				.trim()
				.split("\n")
				.map((line) => z.object({ id: z.string(), title: z.string() }).parse(JSON.parse(line)));
			expect(records.find(({ id }) => id === ids[FIRST])?.title).toBe("Preserved after ranking");
		} finally {
			await rm(root, { force: true, recursive: true });
		}
	},
	TIMEOUT,
);
