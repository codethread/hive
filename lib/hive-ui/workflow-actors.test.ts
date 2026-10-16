import { expect, test } from "bun:test";
import type { WorkflowPreview } from "./contracts.ts";
import { createWorkflowPublisher } from "./src/workflow-actors.ts";

const root = actor([]);
const parent = actor(["parent"]);
const child = actor(["parent", "child"]);
const sibling = actor(["sibling"]);
const LAST = -1;
const stable = fixture();
stable.publish([root, parent]);

test("the root has no parent and unchanged actors receive snapshots without re-registration", () => {
	const { publish, registrations, snapshots, selected } = stable;
	publish([root, parent]);
	expect(registrations.map(({ id, options }) => [id, options?.parent])).toEqual([
		["actor-0", undefined],
		["actor-1", "actor-0"],
	]);
	expect(snapshots).toEqual(["actor-0", "actor-1"]);
	expect(selected).toEqual(["actor-0"]);
});

test("a nested child exit preserves the surviving same-machine sibling's identity and parent", () => {
	const { publish, registrations, snapshots, stopped } = fixture();
	publish([root, parent, child, sibling]);
	publish([root, parent, sibling]);
	expect(stopped).toEqual(["actor-2"]);
	expect(snapshots).toEqual(["actor-0", "actor-1", "actor-3"]);
	expect(registrations.at(LAST)).toEqual({
		id: "actor-3",
		options: { machine: sibling.machine, snapshot: sibling.snapshot, parent: "actor-0" },
	});
});

test("a returning path receives a fresh SDK identity instead of reviving a stopped registration", () => {
	const { publish, registrations, stopped } = fixture();
	publish([root, parent]);
	publish([root]);
	publish([root, parent]);
	expect(stopped).toEqual(["actor-1"]);
	expect(registrations.at(LAST)?.id).toBe("actor-2");
});

test("a replaced root machine gets a fresh selection and its children acquire the new parent", () => {
	const { publish, registrations, stopped, selected } = fixture();
	publish([root, parent]);
	publish([{ ...root, machine: { id: "changed" } }, parent]);
	expect(stopped).toEqual(["actor-0", "actor-1"]);
	expect(selected).toEqual(["actor-0", "actor-2"]);
	expect(registrations.at(LAST)?.options?.parent).toBe("actor-2");
});

function actor(path: string[]): WorkflowPreview["actors"][number] {
	return {
		id: path.join("/"),
		path,
		machine: { id: "same" },
		snapshot: { value: "active", status: "active" },
	};
}

function fixture() {
	const registrations: {
		id: string;
		options: Parameters<Parameters<typeof createWorkflowPublisher>[0]["actor"]>[1];
	}[] = [];
	const snapshots: string[] = [];
	const stopped: string[] = [];
	const selected: string[] = [];
	const publish = createWorkflowPublisher(
		{
			actor: (id, options) => {
				registrations.push({ id, options });
			},
			snapshot: (id) => {
				snapshots.push(id);
			},
			stop: (id) => {
				stopped.push(id);
			},
		},
		(id) => {
			selected.push(id);
		},
	);
	return { publish, registrations, snapshots, stopped, selected };
}
