import { test, expect, setDefaultTimeout } from "bun:test";
setDefaultTimeout(10);
test("file default async", async () => { await Bun.sleep(30); });
test("file default override", async () => { await Bun.sleep(30); }, 100);
