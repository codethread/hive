import { closeSync, openSync, readSync, writeFileSync } from "node:fs";
import { PickerCancelled } from "./errors.ts";
import { fzf } from "./fzf.ts";
import { LiveGitRunner } from "./git/executor.ts";
import { LiveHookRunner } from "./hooks.ts";
import { FileCdDirective } from "./integrations/cd-directive.ts";
import { selectMultiplexer } from "./integrations/tmux.ts";
import { createLiveConfigService } from "./live-config-service.ts";
import type {
	Deps,
	PickerItem,
	PickerOptions,
	PickerService,
	ProgressReporter,
} from "./services.ts";
import { LiveWorkspaceFiles } from "./setup.ts";

export const createLiveDeps = (): Deps => {
	const git = new LiveGitRunner();
	const files = new LiveWorkspaceFiles(git);
	return {
		git,
		config: createLiveConfigService(files.normalizePath),
		files,
		clock: { now: () => Date.now() },
		hooks: new LiveHookRunner(),
		picker: new LivePickerService(),
		multiplexer: selectMultiplexer({
			TMUX: process.env.TMUX,
			TMUX_PANE: process.env.TMUX_PANE,
		}),
		cdDirective: new FileCdDirective(process.env.HONEYCOMB_CD_FILE),
		progress: new ConsoleProgressReporter(),
	};
};

class LivePickerService implements PickerService {
	async pick(
		items: PickerItem[],
		header: string,
		options: PickerOptions = {},
	): Promise<PickerItem> {
		const byDisplay = new Map(items.map((item) => [item.display, item]));
		const selection = await fzf(
			items.map((item) => item.display),
			{
				header,
				preview: items[0]?.preview,
				previewWindow: "down,70%,wrap",
				delimiter: "\t",
				withNth: "2..",
				tmux: options.interactive ? "center,80%,70%" : undefined,
			},
		);
		const item = byDisplay.get(selection);
		if (!item) throw new PickerCancelled();
		return item;
	}

	async confirm(prompt: string): Promise<boolean> {
		const tty = openSync("/dev/tty", "r+");
		try {
			writeFileSync(tty, prompt);
			const answer = Buffer.alloc(1);
			readSync(tty, answer, 0, 1, null);
			writeFileSync(tty, "\n");
			return answer.toString() === "y" || answer.toString() === "Y";
		} finally {
			closeSync(tty);
		}
	}
}

class ConsoleProgressReporter implements ProgressReporter {
	banner(line: string): void {
		process.stderr.write(`${line}\n`);
	}

	stream(stream: "stdout" | "stderr", line: string): void {
		const target = stream === "stdout" ? process.stdout : process.stderr;
		target.write(`${line}\n`);
	}

	error(msg: string): void {
		process.stderr.write(`${msg}\n`);
	}
}
