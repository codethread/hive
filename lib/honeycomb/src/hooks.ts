import { EXIT_CODES, HookError } from "./errors.ts";
import type { HookExecutionOptions, HookResult, HookRunner } from "./services.ts";

const LINE_BREAK = /\r?\n/u;

type HookLine = (stream: "stdout" | "stderr", line: string) => void;

interface PumpOptions {
	/** Which child stream is being read. */
	name: "stdout" | "stderr";
	/** Callback receiving each complete line. */
	onLine: HookLine;
	/** Collected lines appended per stream. */
	sink: string[];
	/** Child process stream to decode. */
	stream: ReadableStream<Uint8Array>;
}

interface BashRequest {
	/** Executable and arguments for this hook. */
	command: string[];
	/** Working directory inherited by the hook. */
	cwd: string;
	/** Overrides merged into the invoking process's environment. */
	env: Record<string, string>;
	/** Receives lines while the hook is still running. */
	onLine: HookLine;
}

interface LinePump {
	/** Incomplete line retained across decoded chunks. */
	buffer: string;
}

const noopLine: HookLine = () => {};

const pushChunkLines = (options: PumpOptions, state: LinePump, chunk: string): void => {
	const { name, onLine, sink } = options;
	state.buffer += chunk;
	const lines = state.buffer.split(LINE_BREAK);
	state.buffer = lines.pop() ?? "";
	for (const line of lines) {
		sink.push(line);
		onLine(name, line);
	}
};

const flushPump = (options: PumpOptions, state: LinePump): void => {
	if (state.buffer !== "") {
		options.sink.push(state.buffer);
		options.onLine(options.name, state.buffer);
	}
};

const pumpLines = async (options: PumpOptions): Promise<void> => {
	const decoder = new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>;
	const reader = options.stream.pipeThrough(decoder).getReader();
	const state: LinePump = { buffer: "" };
	while (true) {
		// Reading a child's stream is inherently sequential; each chunk extends the pending line.
		// oxlint-disable-next-line eslint/no-await-in-loop
		const { value, done } = await reader.read();
		if (done) {
			break;
		}
		pushChunkLines(options, state, value);
	}
	flushPump(options, state);
};

const runBash = async (request: BashRequest): Promise<HookResult> => {
	const { command, cwd, env, onLine } = request;
	const proc = Bun.spawn(command, {
		cwd,
		env: { ...process.env, ...env },
		stderr: "pipe",
		stdout: "pipe",
	});
	const stdout: string[] = [];
	const stderr: string[] = [];
	await Promise.all([
		pumpLines({ name: "stdout", onLine, sink: stdout, stream: proc.stdout }),
		pumpLines({ name: "stderr", onLine, sink: stderr, stream: proc.stderr }),
	]);
	const exitCode = await proc.exited;
	return { exitCode, stderr, stdout };
};

const runInlineBash = (
	script: string,
	{ cwd, env, onLine = noopLine }: HookExecutionOptions,
): Promise<HookResult> => runBash({ command: ["bash", "-c", script], cwd, env, onLine });

class LiveHookRunner implements HookRunner {
	runCommand: HookRunner["runCommand"] = (script, cwd, env) => runInlineBash(script, { cwd, env });
	runInline: HookRunner["runInline"] = async (scriptPath, { cwd, env, onLine = noopLine }) => {
		const result = await runBash({ command: ["bash", scriptPath], cwd, env, onLine });
		if (result.exitCode !== EXIT_CODES.SUCCESS) {
			throw new HookError(result.exitCode, cwd);
		}
	};
}

export { LiveHookRunner, runInlineBash };
