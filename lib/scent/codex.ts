import { codexIdentityHook } from "./src/codex.ts";

const input: unknown = JSON.parse(await Bun.stdin.text());
console.log(JSON.stringify(codexIdentityHook(input, process.env)));
