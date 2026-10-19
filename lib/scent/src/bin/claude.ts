// eslint-disable-next-line import/no-nodejs-modules -- Compose hook environment-file I/O at the entry point.
import { appendFile } from "node:fs/promises";
import { claudeIdentityHook } from "../claude.ts";

const input: unknown = JSON.parse(await Bun.stdin.text());
console.log(JSON.stringify(await claudeIdentityHook(input, process.env, appendFile)));
