/* eslint-disable require-await -- Memory adapters satisfy the native promise boundary. */
/* eslint-disable unicorn/no-null -- Verify public absence versus explicit clearance. */
import { expect, test } from "bun:test";
import { BeeswaxError } from "../errors.ts";
import { alertFixture } from "../../tests/support.ts";

const database = "/missing/tracker/.beads/beads.db";
const SECOND_GENERATION = 2;

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
