import { test, expect } from "bun:test";
test.each([1, 2, 3, 4])("passing case %i", (value) => {
 expect(value).toBeGreaterThan(0);
});
test("one timeout", async () => {
 await Bun.sleep(50);
});
