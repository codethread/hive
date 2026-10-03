import { EXIT_CODES, UsageError } from "../errors.ts";
import type { CommandResult } from "../protocol.ts";

const EMPTY_COUNT = 0;

const ZSH_INIT = `# Fuzzy-pick a worktree and change the current shell's directory.
wk() {
	emulate -L zsh
	local cd_file target
	cd_file=$(command mktemp) || return $?
	{
		HONEYCOMB_CD_FILE="$cd_file" command honeycomb --interactive pick "$@" || return $?
		target="$(command cat -- "$cd_file"; printf '.')"
		target=\${target%.}
		if [[ -n "$target" ]]; then
			builtin cd -- "$target" || return $?
		fi
		return 0
	} always {
		command rm -f -- "$cd_file"
	}
}
`;

const NU_INIT = `# Fuzzy-pick a worktree and change the current shell's directory.
export def --env --wrapped wk [...args: string] {
	let cd_file = (^mktemp | str trim)
	try {
		with-env { HONEYCOMB_CD_FILE: $cd_file } {
			^honeycomb --interactive pick ...$args
		}
		let target = (open --raw $cd_file)
		if $target != "" {
			cd $"($target)/"
		}
	} catch {|failure|
		rm --force $cd_file
		error make $failure
	}
	rm --force $cd_file
}
`;

const shellInitScript = (shell: string): string => {
	switch (shell) {
		case "zsh": {
			return ZSH_INIT;
		}
		case "nu": {
			return NU_INIT;
		}
		default: {
			throw new UsageError(`unsupported shell: ${shell}; expected zsh or nu`);
		}
	}
};

/** Emit a picker function for shell configuration without inspecting a repository. */
const shellInitCommand = (args: string[]): CommandResult => {
	const [shell, ...extra] = args;
	if (shell === undefined || extra.length !== EMPTY_COUNT) {
		throw new UsageError("shell-init requires one shell: zsh or nu");
	}
	return { exitCode: EXIT_CODES.SUCCESS, stdout: shellInitScript(shell) };
};

export { shellInitCommand };
