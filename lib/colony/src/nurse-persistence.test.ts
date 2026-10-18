/* eslint-disable import/no-nodejs-modules -- The persistence regression requires a temporary on-disk store. */
import { activateNurse, reconcileNurse } from "./nurse.ts";
import { afterAll, expect, test } from "bun:test";
import { assessment, nurseFixture, seal, seedReports } from "./nurse.test-support.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { openStore } from "./store.ts";
import { tmpdir } from "node:os";
/* eslint-enable import/no-nodejs-modules */

const BATCH = 25;
const NONE = 0;
const ONE = 1;
const state = await mkdtemp(join(tmpdir(), "colony-nurse-reopen-"));
const original = openStore(state);
const fixture = await nurseFixture(state, original);
await fixture.activate();
const reports = seedReports(fixture, BATCH);
await reconcileNurse(fixture.runtime);
await seal(fixture);
const before = original.nurseCheckpoint(fixture.repository.root)!;
// Reopen private state after native receipt publication, before the cursor commit.
original.close();
const reopened = openStore(state);
fixture.runtime.store = reopened;
afterAll(async () => {
	reopened.close();
	await rm(state, { recursive: true, force: true });
});

// eslint-disable-next-line max-statements -- Verify retained coverage and replay across one real reopen.
test("file-backed SQLite reopen retains the batch and consumes delivered coverage once", async () => {
	expect(reopened.nurseCheckpoint(fixture.repository.root)).toEqual(before);
	expect(reopened.assessmentCompletionHead(fixture.repository)).toBe(BATCH);
	reopened.saveAssessment(fixture.repository.root, reports[NONE]!);
	expect(reopened.assessmentCompletionHead(fixture.repository)).toBe(BATCH);
	await activateNurse(fixture.runtime);
	await reconcileNurse(fixture.runtime);
	const saved = reopened.nurseCheckpoint(fixture.repository.root)!;
	expect(saved.baseline).toBe(before.baseline);
	expect(saved.cursor).toBe(BATCH);
	expect(saved.active).toBeNull();
	expect(fixture.submissions).toHaveLength(ONE);
	reopened.saveAssessment(fixture.repository.root, assessment("after-reopen"));
	await reconcileNurse(fixture.runtime);
	expect(reopened.assessmentCompletionHead(fixture.repository)).toBeGreaterThan(BATCH);
	expect(fixture.submissions).toHaveLength(ONE);
});
