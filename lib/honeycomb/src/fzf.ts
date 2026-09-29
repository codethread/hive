// Single-selection fuzzy finder over lines using fzf, which draws its UI on /dev/tty itself
import { HoneycombError, PickerCancelled } from "./errors.ts";

interface Options {
	header?: string;
	preview?: string | undefined;
	previewWindow?: string;
	delimiter?: string;
	withNth?: string;
	/** Popup placement inside tmux; fzf ignores it outside tmux and runs inline. */
	tmux?: string | undefined;
}

/** fzf exits 1 when nothing matched and 130 when interrupted (Esc or Ctrl-C). */
const CANCEL_EXIT_CODES = new Set([1, 130]);

export const fzf = async (lines: string[], opts: Options = {}): Promise<string> => {
	const flags = Object.entries(opts).flatMap(([option, value]) =>
		value === undefined
			? []
			: [`--${option.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)}`, value],
	);

	const proc = Bun.spawn(["fzf", ...flags], {
		stdio: ["pipe", "pipe", "inherit"],
	});

	proc.stdin.write(lines.join("\n"));
	proc.stdin.end();

	const [output, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
	if (CANCEL_EXIT_CODES.has(exitCode)) throw new PickerCancelled();
	if (exitCode !== 0) throw new HoneycombError(`fzf failed (exit ${exitCode})`);
	return output.trim();
};
