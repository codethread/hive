// eslint-disable-next-line import/no-nodejs-modules -- Local receipts follow the permanent Git common directory.
import { dirname, join } from "node:path";
import { BeeswaxError } from "./errors.ts";
import type { WorkspaceIO } from "./services.ts";
import { version } from "../package.json";
import { z } from "zod";

const FORMAT = 1;
const mergeReceiptSchema = z.strictObject({
	format: z.literal(FORMAT),
	beeswaxVersion: z.string(),
	generator: z.literal("merge-driver"),
	revision: z.literal(FORMAT),
	config: z.record(z.string(), z.string()),
	attribute: z.string(),
});
export type MergeReceipt = z.infer<typeof mergeReceiptSchema>;

export async function readMergeReceipt(
	common: string,
	io: WorkspaceIO,
): Promise<MergeReceipt | undefined> {
	const path = join(dirname(common), ".hive/beeswax/meta/merge-driver.local.json");
	const content = await io.read(path);
	if (content === "") {
		return undefined;
	}
	try {
		return mergeReceiptSchema.parse(JSON.parse(content));
	} catch {
		throw new BeeswaxError(
			"migration_required",
			`Can't establish the merge-driver upgrade path from ${path}. Ask an agent to run "beeswax migrate setup".`,
			{ context: { receipt: path, nextCommand: "beeswax migrate setup", requiresUser: true } },
		);
	}
}

export async function writeMergeReceipt(
	common: string,
	generated: { config: Record<string, string>; attribute: string },
	io: WorkspaceIO,
): Promise<void> {
	const receipt: MergeReceipt = {
		format: FORMAT,
		generator: "merge-driver",
		revision: FORMAT,
		beeswaxVersion: version,
		...generated,
	};
	const excludes = join(common, "info/exclude");
	const current = await io.read(excludes);
	const entry = "/.hive/beeswax/meta/*.local.json";
	if (!current.split("\n").includes(entry)) {
		await io.write(excludes, `${current.trimEnd()}\n${entry}\n`);
	}
	await io.write(
		join(dirname(common), ".hive/beeswax/meta/merge-driver.local.json"),
		`${JSON.stringify(receipt, undefined, "\t")}\n`,
	);
}
