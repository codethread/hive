import { BeeswaxError } from "./errors.ts";
import type { WorkspaceIO } from "./services.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Local receipts follow the permanent Git common directory.
import { join } from "node:path";
import { version } from "../package.json";
import { z } from "zod";

const FORMAT = 1;
const REVISION = 2;
const mergeReceiptSchema = z.strictObject({
	format: z.literal(FORMAT),
	beeswaxVersion: z.string(),
	generator: z.literal("merge-driver"),
	revision: z.union([z.literal(FORMAT), z.literal(REVISION)]),
	config: z.strictObject({
		"merge.hive-beads.name": z.literal("Hive Beads JSONL merge driver"),
		"merge.hive-beads.driver": z
			.string()
			.regex(/^'(?:[^']|'\\'')*' (?:system )?git merge "%O" "%A" "%B"$/u),
		"merge.hive-beads.recursive": z.literal("hive-beads"),
	}),
	attribute: z.literal(".beads/issues.jsonl text eol=lf merge=hive-beads"),
});
export type MergeReceipt = z.infer<typeof mergeReceiptSchema>;

export async function readMergeReceipt(
	common: string,
	io: WorkspaceIO,
): Promise<MergeReceipt | undefined> {
	const path = join(common, "beeswax/merge-driver.local.json");
	if (!(await io.exists(path))) {
		return undefined;
	}
	const content = await io.read(path);
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
	generated: Pick<MergeReceipt, "config" | "attribute">,
	io: WorkspaceIO,
): Promise<void> {
	const receipt: MergeReceipt = {
		format: FORMAT,
		generator: "merge-driver",
		revision: REVISION,
		beeswaxVersion: version,
		...generated,
	};
	const path = join(common, "beeswax/merge-driver.local.json");
	const contents = `${JSON.stringify(receipt, undefined, "\t")}\n`;
	if ((await io.read(path)) !== contents) {
		await io.write(path, contents);
	}
}
