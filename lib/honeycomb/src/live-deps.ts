import type { Deps, PickerOptions, PickerService, ProgressReporter } from "./services.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Direct terminal IO belongs in the live picker boundary.
import { closeSync, openSync, readSync, writeFileSync } from "node:fs";
import { FileCdDirective } from "./integrations/cd-directive.ts";
import { LiveGitRunner } from "./git/executor.ts";
import { LiveHookRunner } from "./hooks.ts";
import { LiveWorkspaceFiles } from "./setup.ts";
import { PickerCancelled } from "./errors.ts";
import { createLiveConfigService } from "./live-config-service.ts";
import { fzf } from "./fzf.ts";
import { selectMultiplexer } from "./integrations/tmux.ts";

const ANSWER_BYTES = 1;

const tmuxPopup = (options: PickerOptions): string | undefined => {
	if (options.interactive) {
		return "center,80%,70%";
	}
	return undefined;
};

const pick: PickerService["pick"] = async (items, header, options = {}) => {
	const [first] = items;
	const byDisplay = new Map(items.map((item) => [item.display, item]));
	const selection = await fzf(
		items.map((item) => item.display),
		{
			delimiter: "\t",
			header,
			preview: first?.preview,
			previewWindow: "down,70%,wrap",
			tmux: tmuxPopup(options),
			withNth: "2..",
		},
	);
	const item = byDisplay.get(selection);
	if (!item) {
		throw new PickerCancelled();
	}
	return item;
};

// oxlint-disable-next-line eslint/require-await -- Keep synchronous terminal interaction inside an async boundary so IO errors reject the returned promise.
const confirm = async (prompt: string): Promise<boolean> => {
	// oxlint-disable-next-line node/no-sync -- The interactive single-byte prompt owns the terminal until answered.
	const tty = openSync("/dev/tty", "r+");
	try {
		// oxlint-disable-next-line node/no-sync -- Display the prompt before the blocking terminal read.
		writeFileSync(tty, prompt);
		const answer = Buffer.alloc(ANSWER_BYTES);
		// oxlint-disable-next-line node/no-sync -- Read one byte at the descriptor's current position, as in the original prompt.
		readSync(tty, answer);
		// oxlint-disable-next-line node/no-sync -- Finish the prompt before returning control to the caller.
		writeFileSync(tty, "\n");
		return answer.toString() === "y" || answer.toString() === "Y";
	} finally {
		// oxlint-disable-next-line node/no-sync -- Release the terminal on both success and failure.
		closeSync(tty);
	}
};

const createProgressReporter = (): ProgressReporter => ({
	banner: (line) => {
		process.stderr.write(`${line}\n`);
	},
	error: (msg) => {
		process.stderr.write(`${msg}\n`);
	},
	stream: (stream, line) => {
		process[stream].write(`${line}\n`);
	},
});

export const createLiveDeps = (): Deps => {
	const git = new LiveGitRunner();
	const files = new LiveWorkspaceFiles(git);
	return {
		cdDirective: new FileCdDirective(process.env.HONEYCOMB_CD_FILE),
		clock: { now: () => Date.now() },
		config: createLiveConfigService(files.normalizePath),
		files,
		git,
		hooks: new LiveHookRunner(),
		multiplexer: selectMultiplexer({
			TMUX: process.env.TMUX,
			TMUX_PANE: process.env.TMUX_PANE,
		}),
		picker: { confirm, pick },
		progress: createProgressReporter(),
	};
};
