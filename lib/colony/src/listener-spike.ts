import { colonyEventCursorSchema, colonyEventSubscriptionSchema } from "@hive/shared/colony-events";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve definitions in the selected checkout, independently of event scope.
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Explicit listener discovery and atomic consumer checkpoints are filesystem boundaries.
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { ColonyListener } from "@hive/shared/colony-events/client";
import type { ColonyListenerOptions } from "@hive/shared/colony-events/client";
// eslint-disable-next-line import/no-nodejs-modules -- Load trusted TypeScript only when a named listener is explicitly run.
import { pathToFileURL } from "node:url";
import { z } from "zod";

const FIRST = 0;
const NONEMPTY = 1;
const nameSchema = z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u);
const manifestSchema = z.strictObject({
	description: z.string().min(NONEMPTY),
	run: z.string().min(NONEMPTY),
});
const checkpointSchema = z.strictObject({ scope: z.string(), cursor: colonyEventCursorSchema });
export const listenerSpikeConfigSchema = z.strictObject({
	/** Selected daemon socket and private state directory. */
	socket: z.string().min(NONEMPTY),
	state: z.string().min(NONEMPTY),
	/** Explicit event source selection, unrelated to the checkout containing listener code. */
	colonies: colonyEventSubscriptionSchema.shape.colonies,
	/** First-run position; saved progress takes precedence. */
	start: colonyEventSubscriptionSchema.shape.start,
	/** One persistent checkpoint per listener/selection and one running process per checkpoint. */
	checkpointFile: z.string().min(NONEMPTY),
	/** Local output owned by the example consumer. */
	outputDirectory: z.string().min(NONEMPTY),
});

export interface ListenerExampleContext {
	/** Caller-selected consumer output, outside the definition folder. */
	outputDirectory: string;
}
type ListenerFactory = (
	options: ColonyListenerOptions,
	context: ListenerExampleContext,
) => ColonyListener;

/** Discover descriptions without executing author code, like Busy Bee's catalogue. */
export async function listListenerSpikes(repo: string) {
	const directory = join(resolve(repo), ".hive", "listeners");
	const entries = await readdir(directory, { withFileTypes: true });
	return Promise.all(
		entries
			.filter((entry) => entry.isDirectory())
			.map(async ({ name }) => {
				const definition = await readDefinition(repo, name);
				return { name, description: definition.description, source: definition.source };
			}),
	);
}

/** Independent foreground host: no daemon-side imports, discovery or startup of listener modules. */
// eslint-disable-next-line max-params -- The explicit author checkout, definition name, connection config and cancellation have distinct roles.
export async function runListenerSpike(
	repo: string,
	name: string,
	input: unknown,
	signal: AbortSignal,
): Promise<void> {
	const config = listenerSpikeConfigSchema.parse(input);
	const definition = await readDefinition(repo, name);
	const module = z
		.object({ createListener: z.custom<ListenerFactory>((value) => typeof value === "function") })
		.parse(await import(pathToFileURL(definition.source).href));
	const scope = JSON.stringify({
		source: definition.source,
		socket: config.socket,
		state: config.state,
		colonies: config.colonies.map((colony) => JSON.stringify(colony)).toSorted(),
	});
	const listener = z.instanceof(ColonyListener).parse(
		module.createListener(
			{
				socket: config.socket,
				state: config.state,
				colonies: config.colonies,
				start: config.start,
				checkpoint: fileCheckpoint(config.checkpointFile, scope),
			},
			{ outputDirectory: config.outputDirectory },
		),
	);
	await listener.run(signal);
}

/** Atomic file replacement provides the small spike's consumer-owned progress boundary. */
export function fileCheckpoint(path: string, scope: string): ColonyListenerOptions["checkpoint"] {
	return {
		async load() {
			let text = "";
			try {
				text = await readFile(path, "utf8");
			} catch (error) {
				if (error instanceof Error && "code" in error && error.code === "ENOENT") {
					return;
				}
				throw error;
			}
			const saved = checkpointSchema.parse(JSON.parse(text));
			if (saved.scope !== scope) {
				throw new Error("Listener checkpoint belongs to a different definition or event selection");
			}
			return saved.cursor;
		},
		async save(cursor) {
			await mkdir(dirname(path), { recursive: true });
			const temporary = `${path}.${crypto.randomUUID()}.tmp`;
			await writeFile(temporary, JSON.stringify({ scope, cursor }));
			await rename(temporary, path);
		},
	};
}

// --- Private functions ---
async function readDefinition(repo: string, name: string) {
	const directory = join(resolve(repo), ".hive", "listeners", nameSchema.parse(name));
	const content = await readFile(join(directory, "listener.toml"), "utf8");
	const manifest = manifestSchema.parse(Bun.TOML.parse(content));
	const source = resolve(directory, manifest.run);
	if (isAbsolute(manifest.run) || relative(directory, source).split(sep)[FIRST] === "..") {
		throw new Error("Listener entry must stay inside its definition folder");
	}
	return { source, description: manifest.description };
}
