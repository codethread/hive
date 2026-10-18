/* eslint-disable unicorn/no-null -- Verify explicit public absence. */
/* eslint-disable require-await -- Inject application boundaries to verify only public CLI behavior. */
import { alertFixture, fixture } from "../support.ts";
import { expect, test } from "bun:test";
import { runCli } from "../../src/cli.ts";

const database = "/repo/tracker/.beads/beads.db";
const SUCCESS = 0;
const FAILURE = 1;
const ONE = 1;

test.each([
	{ command: ["alert", "status"] },
	{ command: ["alert", "wait", "--timeout", "0"] },
	{ command: ["recover"] },
])("alert command %j returns one document without Git checkout discovery", async ({ command }) => {
	const fx = fixture();
	const alerts = alertFixture();
	fx.deps.beads.alertStatus = async () => alerts.store.observe(database);
	fx.deps.beads.alertWait = async () => alerts.store.observe(database);
	expect(await runCli(["beads", ...command, "--beads-db", database, "--json"], fx.deps)).toBe(
		SUCCESS,
	);
	expect(fx.commands).toEqual([]);
	expect(fx.errors).toEqual([]);
	expect(fx.output).toHaveLength(ONE);
	expect(JSON.parse(fx.output.join(""))).toMatchObject({ ok: true, database, alert: null });
});

test("unselected status reports selection absence rather than clearance", async () => {
	const fx = fixture();
	fx.deps.beads.alertStatus = async () => {};
	expect(await runCli(["beads", "alert", "status", "--json"], fx.deps)).toBe(FAILURE);
	expect(fx.commands).toEqual([]);
	expect(fx.errors).toEqual([]);
	expect(JSON.parse(fx.output.join(""))).toMatchObject({ ok: false, reason: "tracker_unselected" });
});

test.each([
	{ flags: ["--recover", "incident"] },
	{ flags: ["--writers-paused"] },
	{ flags: ["--recover", "incident", "--writers-paused", "--evidence", "  "] },
])("incomplete recovery confirmation is rejected before publication: %j", async ({ flags }) => {
	const fx = fixture();
	expect(await runCli(["beads", "sync", ...flags, "--json"], fx.deps)).not.toBe(SUCCESS);
	expect(fx.commands).toEqual([]);
	expect(fx.errors).toEqual([]);
	expect(fx.output).toHaveLength(ONE);
});

test("explicit recovery reaches the publication seam with identity and evidence", async () => {
	const fx = fixture();
	const captured: unknown[] = [];
	fx.deps.beads.sync = async (_repo, selected, options) => {
		captured.push({ database: selected, ...options });
	};
	expect(
		await runCli(
			[
				"beads",
				"sync",
				"--beads-db",
				database,
				"--recover",
				"incident",
				"--writers-paused",
				"--evidence",
				"user authorized; writers paused; state reviewed",
				"--json",
			],
			fx.deps,
		),
	).toBe(SUCCESS);
	expect(captured).toEqual([
		{
			database,
			actor: "codex",
			recovery: {
				id: "incident",
				writersPaused: true,
				evidence: "user authorized; writers paused; state reviewed",
			},
		},
	]);
});
