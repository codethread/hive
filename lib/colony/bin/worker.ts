#!/usr/bin/env bun
import { executeWorker, launchReceiptSchema } from "../src/launch.ts";
import { awaitExecutionPermission } from "../src/processes.ts";
import { z } from "zod";

const USER_ARGUMENTS_START = 2;
const [receiptFile, state] = z
	.tuple([z.string(), z.string()])
	.parse(Bun.argv.slice(USER_ARGUMENTS_START));
const receipt = launchReceiptSchema.parse(await Bun.file(receiptFile).json());
await awaitExecutionPermission(receipt);
await executeWorker(receipt, state);
