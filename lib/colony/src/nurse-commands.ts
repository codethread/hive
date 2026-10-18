import { colonyEntry, entryCommand } from "./executables.ts";
import type { NurseCommands } from "./nurse.ts";
import { nurseAcceptance } from "./nurse-brief.ts";
import { z } from "zod";

const submissionSchema = z.object({
	ok: z.literal(true),
	request: z.object({ id: z.string() }),
	workflow: z.object({ runId: z.string() }),
});
const runSchema = z.object({ ok: z.literal(true), status: z.string() });
export interface NurseProcess {
	/** Invoke public Bee/Busy Bee commands in the selected repository. */
	execute: (argv: string[], cwd: string) => Promise<string>;
	/** Save the workflow input in private state and return its path. */
	writeInput: (token: string, input: string) => Promise<string>;
}

export function nurseCommands(process: NurseProcess): NurseCommands {
	const submit = async (argv: string[], repo: string) => {
		const output = await process.execute(
			[...entryCommand(colonyEntry("bee")), "--json", ...argv],
			repo,
		);
		const parsed = submissionSchema.parse(JSON.parse(output), { jitless: true });
		return { runId: parsed.workflow.runId, requestId: parsed.request.id };
	};
	const endpoint = (repository: { root: string; beadsDb: string }) => [
		"--repo",
		repository.root,
		"--cwd",
		repository.root,
		"--beads-db",
		repository.beadsDb,
		"--actor",
		"sys-colony",
		"--model",
		"gpt-6.1-sol",
		"--effort",
		"high",
	];
	return {
		start: async ({ parent, kind, token, request, repository }) => {
			const file = await process.writeInput(
				token,
				JSON.stringify({ title: `Nurse audit ${token}`, request, acceptance: nurseAcceptance }),
			);
			return submit(
				[
					"spawn",
					kind,
					...endpoint(repository),
					"--parent",
					parent,
					"--input-file",
					file,
					"--workflow",
					"do-work",
				],
				repository.root,
			);
		},
		attach: ({ runId, kind, repository }) =>
			submit(["attach-workflow", kind, runId, ...endpoint(repository)], repository.root),
		show: async (runId, repository) =>
			runSchema.parse(
				JSON.parse(
					await process.execute(
						[
							"busybee",
							"show",
							runId,
							"--repo",
							repository.root,
							"--db",
							repository.beadsDb,
							"--json",
						],
						repository.root,
					),
				),
			),
	};
}
