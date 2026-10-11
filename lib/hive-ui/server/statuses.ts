import { DEFAULT_BEAD_STATUSES, beadStatusSchema } from "../contracts.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Policy belongs beside the explicitly selected database.
import { dirname, join } from "node:path";
import { z } from "zod";

const policySchema = z.object({
	workflow: z.object({ statuses: z.array(beadStatusSchema).default([]) }).default({ statuses: [] }),
});

/** Read only the status vocabulary; native br owns workflow enforcement. */
export async function readStatuses(beadsDb: string): Promise<string[]> {
	const file = Bun.file(join(dirname(beadsDb), "policy.yaml"));
	if (!(await file.exists())) {
		return [...DEFAULT_BEAD_STATUSES];
	}
	const policy = policySchema.parse(Bun.YAML.parse(await file.text()));
	return [
		...new Set([
			...DEFAULT_BEAD_STATUSES,
			...policy.workflow.statuses.map((status) => status.toLowerCase()),
		]),
	];
}
