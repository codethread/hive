import { expect, test } from "bun:test";
import type { ProcessDescriptor } from "ps-list";
import type { ProcessFingerprint } from "./processes.ts";
import { currentOwnedProcesses } from "./processes.ts";

const EPOCH = 0;
const ROOT = { cmd: "harness", pid: 10, ppid: 1, startTime: 1000 };
const CHILD = { cmd: "child", pid: 20, ppid: 10, startTime: 2000 };
const REPLACEMENT = { cmd: "unrelated", pid: 20, ppid: 1, startTime: 3000 };
const GRANDCHILD = { cmd: "descendant", pid: 30, ppid: 20, startTime: 4000 };

test.each([
	{ name: "absent", snapshot: [ROOT] },
	{ name: "reused between polls", snapshot: [ROOT, REPLACEMENT, GRANDCHILD] },
])("historical descendant $name cannot seed live lineage", ({ snapshot }) => {
	expect(
		currentOwnedProcesses(
			[ROOT, CHILD],
			snapshot.map((recorded) => descriptor(recorded)),
		),
	).toEqual([ROOT]);
});

test("recorded descendant survives reparenting and discovers its own children", () => {
	const reparented = { ...CHILD, cmd: "renamed child", ppid: 1 };
	expect(
		currentOwnedProcesses(
			[ROOT, CHILD],
			[reparented, GRANDCHILD].map((recorded) => descriptor(recorded)),
		),
	).toEqual([CHILD, GRANDCHILD]);
});

test("reused PID is admitted only as a new lifetime beneath verified live lineage", () => {
	const replacement = { ...REPLACEMENT, ppid: ROOT.pid };
	const snapshot = [ROOT, replacement, GRANDCHILD].map((recorded) => descriptor(recorded));
	const live = currentOwnedProcesses([ROOT, CHILD], snapshot);
	expect(live).toEqual([ROOT, replacement, GRANDCHILD]);
	expect(currentOwnedProcesses([ROOT, CHILD, replacement, GRANDCHILD], snapshot)).toEqual(live);
});

test("historical root reuse cannot acquire an unrelated replacement tree", () => {
	const replacement = { ...ROOT, startTime: 5000 };
	expect(
		currentOwnedProcesses(
			[ROOT],
			[replacement, CHILD].map((recorded) => descriptor(recorded)),
		),
	).toEqual([]);
});

test.each([
	{ current: { ...CHILD, name: CHILD.cmd, startTime: new Date(EPOCH) }, name: "older" },
	{ current: { name: CHILD.cmd, pid: CHILD.pid, ppid: CHILD.ppid }, name: "missing" },
	{ current: { ...CHILD, name: CHILD.cmd, startTime: new Date(Number.NaN) }, name: "invalid" },
])("$name start time remains an ownership failure", ({ current }) => {
	expect(() => currentOwnedProcesses([CHILD], [current])).toThrow(Error);
});

// --- Private functions ---
function descriptor(recorded: ProcessFingerprint): ProcessDescriptor {
	return { ...recorded, name: recorded.cmd, startTime: new Date(recorded.startTime) };
}
