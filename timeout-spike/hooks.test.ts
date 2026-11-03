import { test, beforeEach, afterEach } from "bun:test";
beforeEach(async () => { await Bun.sleep(30); });
afterEach(async () => { await Bun.sleep(30); });
test("fast body slow hooks", () => {});
