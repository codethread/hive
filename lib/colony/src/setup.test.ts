import { expect, test } from "bun:test";
import { createMemoryBeads } from "@hive/beads";
import { setupBee } from "./setup.ts";

const repository = { root: "/repo", beadsDb: "/selected/tracker/.beads/beads.db" };
const endpoint = { actor: "setup-test", cwd: repository.root, db: repository.beadsDb };

// eslint-disable-next-line max-statements -- Exercise refresh, selection and preservation through the memory contract.
test("Bee setup refreshes its attention preset in the selected tracker and preserves personal queries", async () => {
	const beads = createMemoryBeads();
	const failed = await beads.create(endpoint, {
		title: "Closed failure",
		labels: ["system", "bee", "bee-outcome:failed", "bee-resolution:unresolved"],
	});
	await beads.close(endpoint, failed.id);
	const pending = await beads.create(endpoint, { title: "Pending" });
	await beads.query.save(endpoint, "personal", { titleContains: "Pending" });
	await beads.query.save(endpoint, "bee-attention", { titleContains: "Pending" });
	const selections: { repo: string; database: string }[] = [];
	const dependencies = {
		beads,
		resolveRepository: (repo: string, database: string) => {
			selections.push({ repo, database });
			return Promise.resolve(repository);
		},
	};
	const options = { repo: "/worktree", beadsDb: repository.beadsDb, actor: endpoint.actor };
	await setupBee(options, dependencies);
	expect(await setupBee(options, dependencies)).toEqual({
		kind: "bee_setup",
		repository,
		preset: "bee-attention",
	});
	expect(selections).toEqual([
		{ repo: options.repo, database: repository.beadsDb },
		{ repo: options.repo, database: repository.beadsDb },
	]);
	expect(await beads.query.run(endpoint, "bee-attention")).toMatchObject({
		issues: [{ id: failed.id, status: "closed" }],
	});
	expect(await beads.query.run(endpoint, "personal")).toMatchObject({
		issues: [{ id: pending.id }],
	});
});
