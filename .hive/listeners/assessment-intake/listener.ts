// eslint-disable-next-line import/no-nodejs-modules -- This consumer owns local intake artifacts and reads only the event's referenced evidence.
import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { ColonyListener } from "@hive/shared/colony-events/client";
import type { ColonyListenerOptions } from "@hive/shared/colony-events/client";

// eslint-disable-next-line import/no-nodejs-modules -- Name consumer-owned intake artifacts.
import { join } from "node:path";

interface IntakeContext {
	/** Explicit destination for this listener's evidence artifacts. */
	outputDirectory: string;
}

export function createListener(
	options: ColonyListenerOptions,
	context: IntakeContext,
): ColonyListener {
	return new ColonyListener(options).on("request.settled", async (event) => {
		const attempts = await Promise.all(
			event.request.attempts.map(async (attempt) => {
				const stdout = attempt.stdoutPath;
				try {
					const evidence = await stat(stdout);
					return { ...attempt, stdout, coverage: "available", bytes: evidence.size };
				} catch (error) {
					if (error instanceof Error && "code" in error && error.code === "ENOENT") {
						return { ...attempt, stdout, coverage: "missing" };
					}
					throw error;
				}
			}),
		);
		await mkdir(context.outputDirectory, { recursive: true });
		const destination = join(
			context.outputDirectory,
			`${event.cursor.logId}-${event.cursor.sequence}.json`,
		);
		const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
		await writeFile(
			temporary,
			JSON.stringify({ event, observedAt: new Date().toISOString(), attempts }),
		);
		await rename(temporary, destination);
	});
}
