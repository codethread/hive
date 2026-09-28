import { describe, expect, it } from "bun:test";

import { main } from "./index.ts";

describe("main", () => {
	it("greets colony", () => {
		expect(main()).toBe("Hello, colony!");
	});
});
