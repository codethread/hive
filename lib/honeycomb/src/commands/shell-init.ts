import { UsageError } from "../errors.ts";
import type { CommandResult } from "../protocol.ts";

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

/** Emit a picker function for shell configuration without inspecting a repository. */
export const shellInitCommand = (args: string[]): CommandResult => {
	if (args.length !== 1) throw new UsageError("shell-init requires one shell: zsh or nu");
	switch (args[0]) {
		case "zsh":
			return { stdout: ZSH_INIT, exitCode: 0 };
		case "nu":
			return { stdout: NU_INIT, exitCode: 0 };
		default:
			throw new UsageError(`unsupported shell: ${args[0]}; expected zsh or nu`);
	}
};
