import { describe, expect, it } from "vitest";

import { main } from "./index.ts";

describe("main", () => {
	it("greets colony", () => {
		expect(main()).toBe("Hello, colony!");
	});
});
