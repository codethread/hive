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
		setupFiles: viewerFixture().setupFiles,
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
		recipes: ["/worktree/.bv/recipes.yaml", "/selected/tracker/.bv/recipes.yaml"],
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

// eslint-disable-next-line max-statements -- Verify preservation and repeatability across both checkout files.
test("Bee setup fills missing viewer recipes in both checkouts and preserves unrelated recipes", async () => {
	const { files, setupFiles } = viewerFixture();
	const personal = { filters: { status: ["in_progress"] } };
	files.set(
		"/worktree/.bv/recipes.yaml",
		Bun.YAML.stringify({ theme: "dark", recipes: { personal } }),
	);
	const dependencies = {
		beads: createMemoryBeads(),
		resolveRepository: () => Promise.resolve(repository),
		setupFiles,
	};
	await setupBee(
		{ repo: "/worktree", beadsDb: repository.beadsDb, actor: endpoint.actor },
		dependencies,
	);
	const original = new Map(files);
	await setupBee(
		{ repo: "/worktree", beadsDb: repository.beadsDb, actor: endpoint.actor },
		dependencies,
	);
	expect(files).toEqual(original);
	for (const path of ["/worktree/.bv/recipes.yaml", "/selected/tracker/.bv/recipes.yaml"]) {
		expect(Bun.YAML.parse(files.get(path) ?? "")).toMatchObject({
			recipes: {
				work: { filters: { exclude_tags: ["system"] } },
				system: { filters: { tags: ["system"] } },
			},
		});
	}
	expect(Bun.YAML.parse(files.get("/worktree/.bv/recipes.yaml") ?? "")).toMatchObject({
		theme: "dark",
		recipes: { personal },
	});
});

test("a conflicting tracker recipe prevents writes to either checkout or saved queries", async () => {
	const { files, setupFiles } = viewerFixture();
	files.set(
		"/selected/tracker/.bv/recipes.yaml",
		"recipes:\n  work:\n    filters:\n      tags: [personal]\n",
	);
	const original = new Map(files);
	const beads = createMemoryBeads();
	await expect(
		setupBee(
			{ repo: "/worktree", beadsDb: repository.beadsDb, actor: endpoint.actor },
			{
				beads,
				resolveRepository: () => Promise.resolve(repository),
				setupFiles,
			},
		),
	).rejects.toMatchObject({
		name: "BeeSetupError",
		context: { presetInstalled: false, recipesInstalled: [] },
	});
	expect(files).toEqual(original);
	expect(await beads.query.list(endpoint)).toMatchObject({ queries: [] });
});

test("a failed second viewer write retains the first file and query in the receipt", async () => {
	const { files, setupFiles } = viewerFixture();
	const { write } = setupFiles;
	setupFiles.write = (path, contents) => {
		if (path.startsWith("/selected/")) {
			return Promise.reject(new Error("unwritable tracker"));
		}
		return write(path, contents);
	};
	await expect(
		setupBee(
			{ repo: "/worktree", beadsDb: repository.beadsDb, actor: endpoint.actor },
			{
				beads: createMemoryBeads(),
				resolveRepository: () => Promise.resolve(repository),
				setupFiles,
			},
		),
	).rejects.toMatchObject({
		context: { presetInstalled: true, recipesInstalled: ["/worktree/.bv/recipes.yaml"] },
	});
	expect(files.has("/worktree/.bv/recipes.yaml")).toBe(true);
});

function viewerFixture() {
	const files = new Map<string, string>();
	return {
		files,
		setupFiles: {
			checkouts: () => Promise.resolve(["/worktree", "/selected/tracker"]),
			read: (path: string) => Promise.resolve(files.get(path) ?? ""),
			write: (path: string, contents: string) => {
				files.set(path, contents);
				return Promise.resolve();
			},
		},
	};
}
