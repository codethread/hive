import { test, beforeEach } from "bun:test";
beforeEach(async () => { await Bun.sleep(30); }, 100);
test("hook 30 body 30 separate", async () => { await Bun.sleep(30); });
