#!/usr/bin/env bun
import { executeWorker, launchReceiptSchema } from "../src/launch.ts";
import { awaitExecutionPermission } from "../src/processes.ts";
import { version } from "../package.json";
import { z } from "zod";

const USER_ARGUMENTS_START = 2;
const VERSION_ARGUMENT_COUNT = 3;
const SUCCESS = 0;
if (Bun.argv.length === VERSION_ARGUMENT_COUNT && Bun.argv[USER_ARGUMENTS_START] === "--version") {
	console.log(version);
	process.exit(SUCCESS);
}
const [receiptFile, state] = z
	.tuple([z.string(), z.string()])
	.parse(Bun.argv.slice(USER_ARGUMENTS_START));
const receipt = launchReceiptSchema.parse(await Bun.file(receiptFile).json());
await awaitExecutionPermission(receipt);
await executeWorker(receipt, state);
