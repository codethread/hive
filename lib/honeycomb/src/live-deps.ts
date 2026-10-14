// oxlint-disable import/max-dependencies -- The composition root assembles the live service adapters.
import type { Deps, PickerItem, PickerOptions, ProgressReporter } from "./services.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Direct terminal IO belongs in the live picker boundary.
import { closeSync, openSync, readSync, writeFileSync } from "node:fs";
import { PickerCancelled } from "./errors.ts";
import { createBundledSkills } from "./bundled-skills.ts";
import { createFileCdDirective } from "./integrations/cd-directive.ts";
import { createLiveConfigService } from "./live-config-service.ts";
import { createLiveGitRunner } from "./git/executor.ts";
import { createLiveHookRunner } from "./hooks.ts";
import { createLiveWorkspaceFiles } from "./setup.ts";
import { fzf } from "./fzf.ts";
import { selectMultiplexer } from "./integrations/tmux.ts";

const ANSWER_BYTES = 1;

/** Assemble live Git, filesystem, hook, picker, and terminal services. */
export function createLiveDeps(): Deps {
	const git = createLiveGitRunner();
	const files = createLiveWorkspaceFiles();
	return {
		skills: createBundledSkills(),
		cdDirective: createFileCdDirective(process.env.HONEYCOMB_CD_FILE),
		clock: { now: Date.now },
		config: createLiveConfigService(files.normalizePath),
		files,
		git,
		hooks: createLiveHookRunner(),
		multiplexer: selectMultiplexer({
			TMUX: process.env.TMUX,
			TMUX_PANE: process.env.TMUX_PANE,
		}),
		picker: { confirm, pick },
		progress: createProgressReporter(),
	};
}

// Private terminal and picker helpers.
function tmuxPopup(options: PickerOptions): string | undefined {
	if (options.interactive) {
		return "center,80%,70%";
	}
	return undefined;
}

async function pick(
	items: PickerItem[],
	header: string,
	options: PickerOptions = {},
): Promise<PickerItem> {
	const [first] = items;
	const byDisplay = new Map(items.map((item) => [item.display, item]));
	const selection = await fzf(
		items.map((item) => item.display),
		{
			delimiter: "\t",
			header,
			preview: first?.preview,
			// Fzf switches below the list when the side preview would be under 80 columns.
			previewWindow: "right,70%,wrap,<80(down,70%,wrap)",
			tmux: tmuxPopup(options),
			withNth: "2..",
		},
	);
	const item = byDisplay.get(selection);
	if (!item) {
		throw new PickerCancelled();
	}
	return item;
}

// Keep synchronous terminal interaction inside an async boundary so IO errors reject the returned promise.
// oxlint-disable-next-line eslint/require-await
async function confirm(prompt: string): Promise<boolean> {
	// oxlint-disable-next-line node/no-sync -- The interactive single-byte prompt owns the terminal until answered.
	const tty = openSync("/dev/tty", "r+");
	try {
		// oxlint-disable-next-line node/no-sync -- Display the prompt before the blocking terminal read.
		writeFileSync(tty, prompt);
		const answer = Buffer.alloc(ANSWER_BYTES);
		// Read one byte at the descriptor's current position, as in the original prompt.
		// oxlint-disable-next-line node/no-sync
		readSync(tty, answer);
		// oxlint-disable-next-line node/no-sync -- Finish the prompt before returning control to the caller.
		writeFileSync(tty, "\n");
		return answer.toString() === "y" || answer.toString() === "Y";
	} finally {
		// oxlint-disable-next-line node/no-sync -- Release the terminal on both success and failure.
		closeSync(tty);
	}
}

function createProgressReporter(): ProgressReporter {
	return {
		banner(line) {
			process.stderr.write(`${line}\n`);
		},
		error(msg) {
			process.stderr.write(`${msg}\n`);
		},
		stream(stream, line) {
			process[stream].write(`${line}\n`);
		},
	};
}
