import { describe, expect, it } from "bun:test";

import { hello } from "./index.ts";

const greetings = [
	{ expected: "Hello, world!", name: "world" },
	{ expected: "Hello, hive!", name: "hive" },
];

describe("hello", () => {
	it.each(greetings)("greets $name", ({ name, expected }) => {
		expect(hello(name)).toBe(expected);
	});
});
