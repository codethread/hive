import { test, expect } from "bun:test";

test("sync busy 30ms", () => {
 const start = performance.now();
 while (performance.now() - start < 30) {}
 expect(true).toBe(true);
});
test("async sleep 30ms", async () => {
 await Bun.sleep(30);
 expect(true).toBe(true);
});
test("explicit override 100ms", async () => {
 await Bun.sleep(30);
 expect(true).toBe(true);
}, 100);
