import { CommandError } from "@hive/beads";
import type { RepositoryEndpoint } from "@hive/shared";
import { repositoryEndpointSchema } from "@hive/shared";
import { z } from "zod";

const registrationSchema = z.object({ repository: repositoryEndpointSchema });
const statusSchema = z.compile(
	z.object({
		ok: z.literal(true),
		kind: z.literal("status"),
		colonies: z.array(registrationSchema),
	}),
);
const errorSchema = z.object({ ok: z.literal(false), message: z.string() });

interface DaemonSelection {
	/** Explicit daemon state; omission uses Colony's user-level selection. */
	state?: string | undefined;
	/** Explicit socket, validated by Colony against the selected state. */
	socket?: string | undefined;
}

/** Read the selected daemon's startup endpoint allowlist through its public command. */
export async function discoverColonies(
	selection: DaemonSelection,
	execute: (argv: string[]) => Promise<string>,
): Promise<RepositoryEndpoint[]> {
	const argv = ["colony", "daemon", "status", "--json"];
	if (selection.state !== undefined) {
		argv.push("--state", selection.state);
	}
	if (selection.socket !== undefined) {
		argv.push("--socket", selection.socket);
	}
	const status = await readStatus(argv, execute);
	if (status.colonies.length === 0) {
		throw new Error(
			"The selected daemon has no registered colonies. Use colony add --help to register one " +
				"with the same state/socket, or choose --colonies for an offline endpoint list.",
		);
	}
	return status.colonies.map(({ repository }) => repository);
}

// --- Private functions ---
async function readStatus(argv: string[], execute: (args: string[]) => Promise<string>) {
	let output = "";
	try {
		output = await execute(argv);
	} catch (error) {
		if (error instanceof CommandError && error.stdout.trim() !== "") {
			throw new Error(errorSchema.parse(JSON.parse(error.stdout)).message, { cause: error });
		}
		throw error;
	}
	return statusSchema.parse(JSON.parse(output));
}
