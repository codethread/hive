import { test, expect } from "bun:test";
test.each([1, 2, 3])("row %i under budget", async (row) => {
 await Bun.sleep(15);
 expect(row).toBeGreaterThan(0);
}, 30);
test.each([2, 50, 2])("mixed row %i", async (duration) => {
 await Bun.sleep(duration);
}, 20);
