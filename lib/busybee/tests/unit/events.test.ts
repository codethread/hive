import { expect, test } from "bun:test";
import { createMachine } from "xstate";
import { declaresEvent } from "../../src/definition.ts";

test.each([
	{ descriptor: "order.next", event: "order.next", declared: true },
	{ descriptor: "*", event: "order.next", declared: true },
	{ descriptor: "order.*", event: "order.next", declared: true },
	{ descriptor: "order.*", event: "order", declared: true },
	{ descriptor: "order.*", event: "orders.next", declared: false },
])("event $event matches descriptor $descriptor: $declared", ({ descriptor, event, declared }) => {
	const machine = createMachine({
		id: "events",
		initial: "work",
		states: { work: { on: { [descriptor]: {} } } },
	});
	expect(declaresEvent(machine.getStateNodeById("events.work"), event)).toBe(declared);
});

test("ancestor event declarations are visible without evaluating guards", () => {
	let evaluated = false;
	const machine = createMachine({
		id: "events",
		initial: "work",
		on: {
			NEXT: {
				guard: () => {
					evaluated = true;
					return false;
				},
			},
		},
		states: { work: {} },
	});
	const node = machine.getStateNodeById("events.work");
	expect(declaresEvent(node, "NEXT")).toBe(true);
	expect(declaresEvent(node, "REMOVED")).toBe(false);
	expect(evaluated).toBe(false);
});
