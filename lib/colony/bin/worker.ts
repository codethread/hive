#!/usr/bin/env bun
import { executeWorker, launchReceiptSchema } from "../src/launch.ts";
import { assessmentContextSchema } from "../src/postrun.ts";
import { awaitExecutionPermission } from "../src/processes.ts";
import { droneContextSchema } from "../src/drone.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Read optional attempt-local drone context.
import { join } from "node:path";
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
const file = Bun.file(join(receipt.directory, "drone.json"));
if (await file.exists()) {
	const drone = droneContextSchema.parse(await file.json());
	await awaitExecutionPermission(receipt, drone.deadline);
	await executeWorker(receipt, state, {
		deadline: drone.deadline,
		environment: {
			HIVE_DRONE_REVIEW_ID: drone.reviewId,
			HIVE_DRONE_TARGET_ATTEMPT_ID: drone.targetAttemptId,
		},
	});
} else if (await Bun.file(join(receipt.directory, "assessment.json")).exists()) {
	const assessment = assessmentContextSchema.parse(
		await Bun.file(join(receipt.directory, "assessment.json")).json(),
	);
	await awaitExecutionPermission(receipt, assessment.deadline);
	await executeWorker(receipt, state, {
		deadline: assessment.deadline,
		environment: { HIVE_ASSESSMENT_ID: assessment.id },
	});
} else {
	await awaitExecutionPermission(receipt);
	await executeWorker(receipt, state);
}
