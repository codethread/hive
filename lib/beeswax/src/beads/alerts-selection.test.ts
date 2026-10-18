/* eslint-disable require-await -- In-memory endpoint discovery has no runtime DB or subprocess access. */
import { expect, test } from "bun:test";
import type { AlertSelectionServices } from "./alerts-selection.ts";
import { alertFixture } from "../../tests/support.ts";
import { selectAlertDatabase } from "./alerts-selection.ts";

const database = "/selected/.beads/beads.db";
const canonical = "/repo/.worktrees/tracker--state/.beads/beads.db";

test.each([
	{ explicit: database, inherited: "/other/.beads/beads.db" },
	{ explicit: undefined, inherited: database },
])(
	"supplied selection bypasses all repository/database discovery: %j",
	async ({ explicit, inherited }) => {
		const fx = selectionFixture();
		fx.services.beadsDb = inherited;
		expect(await selectAlertDatabase("/not-a-git-repo", explicit, fx.services)).toBe(database);
		expect(fx.calls).toEqual([]);
	},
);

test("environment:none discovers the canonical tracker without requiring mise", async () => {
	const fx = selectionFixture();
	fx.services.commandAvailable = (name) => name === "git";
	fx.services.exists = async (path) => path === canonical;
	expect(await selectAlertDatabase("/repo", undefined, fx.services)).toBe(canonical);
	expect(fx.calls).toEqual(["git rev-parse --path-format=absolute --git-common-dir"]);
});

test("configured endpoint selection is shared by observation and publication", async () => {
	const fx = selectionFixture();
	fx.services.commandAvailable = () => true;
	expect(await selectAlertDatabase("/repo", undefined, fx.services)).toBe(database);
	expect(fx.calls).toEqual([
		"git rev-parse --path-format=absolute --git-common-dir",
		"mise env --json",
	]);
});

test(
	"no selection is distinct from malformed inherited or configured selection",
	// eslint-disable-next-line max-statements -- Compare missing and invalid selections through one boundary.
	async () => {
		const fx = selectionFixture();
		expect(await selectAlertDatabase("/repo", undefined, fx.services)).toBeUndefined();
		fx.services.beadsDb = "bad endpoint";
		await expect(selectAlertDatabase("/repo", undefined, fx.services)).rejects.toBeInstanceOf(
			Error,
		);
		expect(fx.calls).toEqual([]);
		fx.services.beadsDb = undefined;
		fx.services.commandAvailable = (name) => name === "mise";
		fx.services.command = async () => JSON.stringify({ BEADS_DB: "bad endpoint" });
		await expect(selectAlertDatabase("/repo", undefined, fx.services)).rejects.toBeInstanceOf(
			Error,
		);
		fx.services.command = async () => "{}";
		expect(await selectAlertDatabase("/repo", undefined, fx.services)).toBeUndefined();
	},
);

function selectionFixture() {
	const alerts = alertFixture();
	const calls: string[] = [];
	const services: AlertSelectionServices = {
		beadsDb: undefined,
		observe: alerts.store.observe,
		commandAvailable: () => false,
		exists: async () => false,
		command: async (argv) => {
			calls.push(argv.join(" "));
			if (argv.includes("--git-common-dir")) {
				return "/repo/.git";
			}
			return JSON.stringify({ BEADS_DB: database });
		},
	};
	return { ...alerts, services, calls };
}

test("an independent conventional hold survives disappearance of SQLite without mise", async () => {
	const fx = selectionFixture();
	fx.services.commandAvailable = (name) => name === "git";
	await fx.store.activate(canonical, "publication failed before database disappeared");
	expect(await selectAlertDatabase("/repo", undefined, fx.services)).toBe(canonical);
	expect(fx.calls).toEqual(["git rev-parse --path-format=absolute --git-common-dir"]);
});

test("corrupt conventional receipt fails discovery rather than hiding a missing-database hold", async () => {
	const fx = selectionFixture();
	fx.services.commandAvailable = (name) => name === "git";
	fx.files.set(canonical, "corrupt");
	await expect(selectAlertDatabase("/repo", undefined, fx.services)).rejects.toMatchObject({
		reason: "tracker_alert_invalid",
	});
	expect(fx.calls).toEqual(["git rev-parse --path-format=absolute --git-common-dir"]);
});

test.each(["active", "cleared"])(
	"a receipt-only %s candidate cannot shadow current Mise selection",
	async (state) => {
		const fx = selectionFixture();
		fx.services.commandAvailable = () => true;
		const active = await fx.store.activate(canonical, "previous endpoint incident");
		if (state === "cleared") {
			await fx.store.clear(canonical, active.alert!.id, "previous endpoint recovered");
		}
		expect(await selectAlertDatabase("/repo", undefined, fx.services)).toBe(database);
		expect(fx.calls).toEqual([
			"git rev-parse --path-format=absolute --git-common-dir",
			"mise env --json",
		]);
	},
);
