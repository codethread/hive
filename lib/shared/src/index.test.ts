import { describe, expect, it } from "vitest";

import { hello } from "./index.ts";

const greetings = [
	{ expected: "Hello, world!", name: "world" },
	{ expected: "Hello, hive!", name: "hive" },
] as const;

describe("hello", () => {
	it.each(greetings)("greets $name", ({ name, expected }) => {
		expect(hello(name)).toBe(expected);
	});
});
