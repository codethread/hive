/* eslint-disable require-await -- In-memory operations keep publication tests independent of Git/br. */
import { expect, test } from "bun:test";
import type { AlertPublicationServices } from "./alerts-publication.ts";
import { alertFixture } from "../../tests/support.ts";
import { publishWithAlert } from "./alerts-publication.ts";

const database = "/healthy/tracker/.beads/beads.db";
const ZERO = 0;
const ONE = 1;

test(
	"a healthy native endpoint does not authorize routine publication during an alert #test-420",
	// eslint-disable-next-line max-statements -- Assert failure, retained hold and subsequent admission together.
	async () => {
		const fx = publicationFixture();
		const original = new Error("Git tracker merge conflict; SQLite remains healthy");
		fx.services.publish = () => Promise.reject(original);
		await expect(publishWithAlert(database, fx.services)).rejects.toMatchObject({
			reason: "tracker_sync_failed",
		});
		const active = await fx.store.observe(database);
		expect(active.alert?.state).toBe("active");
		fx.services.publish = async () => {
			fx.calls.push("native reconciliation and Git publication");
		};
		fx.calls.length = ZERO;
		await expect(publishWithAlert(database, fx.services)).rejects.toMatchObject({
			reason: "tracker_held",
		});
		expect(fx.calls).toEqual([]);
		expect(await fx.store.observe(database)).toEqual(active);
	},
);

test("only successful recovery publication clears the exact current incident with evidence", async () => {
	const fx = publicationFixture();
	const initial = await fx.store.activate(database, "conflict");
	const recovery = {
		id: initial.alert!.id,
		writersPaused: true as const,
		evidence: "authorized and reconciled",
	};
	await publishWithAlert(database, fx.services, recovery);
	expect(fx.calls).toEqual(["lock", "publish"]);
	const observed = await fx.store.observe(database);
	expect(observed.alert).toMatchObject({
		state: "cleared",
		id: recovery.id,
		evidence: recovery.evidence,
	});
});

test("failed recovery retains a newer active hold and refuses the stale incident", async () => {
	const fx = publicationFixture();
	const first = await fx.store.activate(database, "conflict");
	const recovery = { id: first.alert!.id, writersPaused: true as const, evidence: "reviewed" };
	fx.services.publish = () => Promise.reject(new Error("Git push failed"));
	await expect(publishWithAlert(database, fx.services, recovery)).rejects.toMatchObject({
		reason: "tracker_sync_failed",
	});
	const current = await fx.store.observe(database);
	expect(current.alert?.state).toBe("active");
	expect(current.alert?.id).not.toBe(recovery.id);
	await expect(publishWithAlert(database, fx.services, recovery)).rejects.toMatchObject({
		reason: "tracker_alert_changed",
	});
	expect(await fx.store.observe(database)).toEqual(current);
});

test("queued ordinary sync rechecks a hold created while awaiting the publication lock", async () => {
	const fx = publicationFixture();
	fx.services.withPublicationLock = async (action) => {
		await fx.store.activate(database, "preceding sync failed");
		await action();
	};
	await expect(publishWithAlert(database, fx.services)).rejects.toMatchObject({
		reason: "tracker_held",
	});
	expect(fx.calls).toHaveLength(ZERO);
});

test("alert write failure preserves publication failure diagnostics", async () => {
	const fx = publicationFixture();
	fx.services.publish = () => Promise.reject(new Error("native merge conflict"));
	fx.storage.write = () => Promise.reject(new Error("state disk full"));
	await expect(publishWithAlert(database, fx.services)).rejects.toMatchObject({
		reason: "tracker_sync_alert_failed",
		context: {
			database,
			publicationError: "native merge conflict",
			alertError: expect.stringContaining("state disk full"),
		},
	});
	expect(fx.calls).toHaveLength(ONE);
});

function publicationFixture() {
	const fx = alertFixture();
	const calls: string[] = [];
	const services: AlertPublicationServices = {
		alerts: fx.store,
		withPublicationLock: async (action) => {
			calls.push("lock");
			await action();
		},
		publish: async () => {
			calls.push("publish");
		},
	};
	return { ...fx, calls, services };
}
