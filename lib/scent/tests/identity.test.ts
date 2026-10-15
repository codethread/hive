import { expect, test } from "bun:test";
import { resolveIdentity } from "../src/identity.ts";

test("native identity is deterministic across resolution, new and resume", () => {
	const initial = resolveIdentity("native-session-a");
	expect(initial.name).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/u);
	expect(resolveIdentity("native-session-a")).toEqual(initial);
	expect(resolveIdentity("native-session-b").name).not.toBe(initial.name);
	expect(resolveIdentity("native-session-a")).toEqual(initial);
});

test("supplied Bee identity survives different native session bindings", () => {
	for (const session of ["startup", "new", "resume"]) {
		expect(resolveIdentity(session, "brown-cold-dove")).toEqual({
			session,
			name: "brown-cold-dove",
		});
	}
});
