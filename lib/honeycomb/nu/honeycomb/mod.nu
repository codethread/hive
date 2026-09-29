# Thin Nushell shim for the honeycomb engine.
#
# The engine owns every worktree, setup, session and safety decision. This module
# only runs `honeycomb --interactive`, applies the directory the engine writes to
# HONEYCOMB_CD_FILE, and propagates the engine's exit code. Agents call
# `honeycomb` directly; they must not pass `--interactive`.

# Run the engine in interactive mode and change directory when it hands one back.
def --env wk-interactive [...args: string] {
	let cd_file = (mktemp)
	try {
		with-env { HONEYCOMB_CD_FILE: $cd_file } {
			^honeycomb --interactive ...$args
		}
	} catch {|failure|
		rm --force $cd_file
		error make $failure
	}
	if ($cd_file | path exists) {
		let target = (open --raw $cd_file | str trim)
		if $target != "" {
			cd $target
		}
	}
	rm --force $cd_file
}

# Add or allocate a worktree for a branch and move the current session to it.
export def --env "wk add" [
	branch: string   # branch to create or check out
	base?: string    # base branch for a new branch
	--base-current   # use the branch checked out in the current worktree as the base
	--force          # skip safety refusals
] {
	let args = [add --branch $branch]
	let args = if $base_current { $args | append "--base-current" } else { $args }
	let args = if $base != null { $args | append [--base $base] } else { $args }
	let args = if $force { $args | append "--force" } else { $args }
	wk-interactive ...$args
}

# Remove a worktree, or the current one with --self, and close its sessions.
export def --env "wk remove" [
	branch?: string  # branch whose worktree should be removed
	--self           # remove the worktree containing the current directory
	--force          # skip safety refusals
] {
	let args = [remove]
	let args = if $self { $args | append "--self" } else { $args }
	let args = if $branch != null { $args | append [--branch $branch] } else { $args }
	let args = if $force { $args | append "--force" } else { $args }
	wk-interactive ...$args
}

# Integrate the current worktree and close its sessions when cleanup removes it.
export def --env "wk finish" [] {
	wk-interactive finish
}

# Fuzzy-pick a worktree and switch to its multiplexer session.
export def --env "wk switch" [] {
	wk-interactive -- pick --open
}

# Fuzzy-pick a worktree and change the current shell into it.
export def --env "wk select" [] {
	wk-interactive pick
}

# Print the canonical/root worktree path for the current repository.
export def "wk root" [] {
	^honeycomb root
}

# Print the worktree path for a branch without opening it.
export def "wk path" [
	branch: string  # branch whose worktree path should be printed
] {
	^honeycomb path --branch $branch
}

# List worktrees for the current repository.
export def "wk list" [] {
	^honeycomb list
}

# Re-run configured copy setup for the current worktree.
export def "wk copy" [] {
	^honeycomb copy
}
