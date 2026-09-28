import { describe, expect, it } from "bun:test";

import { main } from "./index.ts";

describe("main", () => {
	it("greets ghost", () => {
		expect(main()).toBe("Hello, ghost!");
	});
});
