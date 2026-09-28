import { describe, expect, it } from "vitest";

import { main } from "./index.ts";

describe("main", () => {
	it("greets ghost", () => {
		expect(main()).toBe("Hello, ghost!");
	});
});
