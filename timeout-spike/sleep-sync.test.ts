import { test } from "bun:test";
test("native blocking sleep", () => { Bun.sleepSync(30); });
