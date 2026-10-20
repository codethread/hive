/* eslint-disable require-await -- Memory adapters satisfy the native promise boundary. */
/* eslint-disable unicorn/no-null -- Verify public absence versus explicit clearance. */
import { expect, test } from "bun:test";
import { BeeswaxError } from "../errors.ts";
import { alertFixture } from "../../tests/support.ts";
import { waitForAlert } from "./alerts.ts";

const database = "/missing/tracker/.beads/beads.db";
const SECOND_GENERATION = 2;
const TICK_MS = 250;
const TIMEOUT_SECONDS = 1;

test(
	"absence remains unverified; selected endpoint identity normalizes without native " +
		"DB access #test-410",
	async () => {
		const fx = alertFixture();
		expect(await fx.store.observe(database)).toEqual({
			ok: true,
			kind: "tracker_alert",
			database,
			alert: null,
		});
		await fx.store.activate("/missing/other/../tracker/.beads/beads.db", "publication failed");
		const active = await fx.store.observe(database);
		expect(active.alert?.state).toBe("active");
		const different = await fx.store.observe("/different/tracker/.beads/beads.db");
		expect(different.alert).toBeNull();
	},
);

test("new failures retain newer incidents; old recovery cannot clear them #test-475", async () => {
	const fx = alertFixture();
	const first = await fx.store.activate(database, "first conflict");
	const second = await fx.store.activate(database, "second conflict");
	expect(second.alert?.id).not.toBe(first.alert?.id);
	expect(second.alert?.generation).toBe(SECOND_GENERATION);
	await expect(fx.store.clear(database, first.alert!.id, "reviewed")).rejects.toBeInstanceOf(
		BeeswaxError,
	);
	expect(await fx.store.observe(database)).toEqual(second);
	const cleared = await fx.store.clear(
		database,
		second.alert!.id,
		"user authorized; native/Git publication passed",
	);
	expect(cleared.alert).toMatchObject({
		state: "cleared",
		id: second.alert!.id,
		evidence: "user authorized; native/Git publication passed",
	});
	await expect(fx.store.clear(database, second.alert!.id, "again")).rejects.toBeInstanceOf(
		BeeswaxError,
	);
});

test.each(["not-json", "{}", JSON.stringify({ version: 1, database: "/wrong", alert: null })])(
	"corrupt alert state is an error rather than clearance: %s #test-432",
	async (contents) => {
		const fx = alertFixture();
		fx.files.set(database, contents);
		await expect(fx.store.observe(database)).rejects.toBeInstanceOf(BeeswaxError);
	},
);

test("unavailable reads and writes fail rather than returning an all-clear", async () => {
	const fx = alertFixture();
	fx.storage.read = () => Promise.reject(new Error("unreadable state"));
	await expect(fx.store.observe(database)).rejects.toMatchObject({
		reason: "tracker_alert_unavailable",
	});
	fx.storage.read = async () => {};
	fx.storage.write = () => Promise.reject(new Error("disk full"));
	await expect(fx.store.activate(database, "conflict")).rejects.toMatchObject({
		reason: "tracker_alert_unavailable",
	});
});

test("bounded wait emits the changed receipt and preserves absence at timeout", async () => {
	const fx = alertFixture();
	const initial = await fx.store.activate(database, "conflict");
	let now = 0;
	const observed = await waitForAlert(database, TIMEOUT_SECONDS, {
		observe: fx.store.observe,
		now: () => now,
		sleep: async (milliseconds) => {
			now += milliseconds;
			await fx.store.clear(database, initial.alert!.id, "publication succeeded");
		},
	});
	expect(now).toBe(TICK_MS);
	expect(observed.alert?.state).toBe("cleared");
	const missing = await waitForAlert("/other/.beads/beads.db", TIMEOUT_SECONDS, {
		observe: fx.store.observe,
		now: () => now,
		sleep: async (milliseconds) => {
			now += milliseconds;
		},
	});
	expect(missing.alert).toBeNull();
});
