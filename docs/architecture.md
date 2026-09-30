# Architecture

Honeycomb is currently the implemented tool: a Git worktree lifecycle engine with a CLI and a thin Nushell shim. Colony (provider-facing CLI) and Ghost (daemon) are placeholders; both currently call a greeting helper in Shared. There is no provider or daemon runtime connecting them yet.

Product packages do not import one another. Shared is the only permitted cross-package dependency; Honeycomb currently operates independently of it.

## Honeycomb's execution boundary

```text
Human / automation / Nushell shim
                |
                v
CLI -> command dispatch -> lifecycle workflows
                               |          |
                               v          v
                         Domain policy   Injected services
                                              |
                                              v
                                      Git / files / hooks
```

The [CLI](../lib/honeycomb/src/cli.ts) composes live dependencies and handles terminal output and process exit. Commands coordinate add, remove, finish and query operations; application helpers handle reusable repository, branch and pool workflows. Domain code holds models and pure policy decisions. Workflows access external state through the [service interfaces](../lib/honeycomb/src/services.ts), allowing tests to replace Git, filesystem, hooks, interaction and time without replacing the lifecycle logic.

## State and safety

There is no application database. Git's registered worktrees, branches and working-tree status provide repository state; filesystem markers record successful pool initialization. Configuration supplies policy, not a second registry of existing worktrees.

The canonical checkout anchors configuration and default-branch decisions and is protected from removal. Regular worktrees are created and removed; pooled worktrees retain their directories and switch between working branches and reserved placeholder branches. Destructive operations check observed Git state before proceeding rather than trusting shell-session state.

## Engine and shell responsibilities

The engine owns worktree policy and lifecycle mutations. The Nushell shim only runs `honeycomb --interactive` with a temporary `HONEYCOMB_CD_FILE` and changes the shell's directory when the engine writes one; it holds no worktree, git, multiplexer, or prompt logic. Agents call the CLI directly and never pass `--interactive`, so they cannot move the user's focus or close sessions.

Configured setup and its rollback run inside the engine, so every caller gets the same ready-or-rolled-back result. Multiplexer state never determines whether a worktree exists or is safe to remove; sessions are an integration that only `--interactive` may touch.

## CLI output contract

Every Hive CLI has two audiences. Humans and TTY usage get readable output: results on stdout, progress and errors on stderr. Machine callers pass `--json` and get exactly one JSON document on stdout, whether the command succeeds or fails; stderr stays silent, so a caller never has to read or interleave two streams.

- The document is an object with a boolean `ok`. Success payloads carry `ok: true` and a `kind`. Failures carry `ok: false`, a `kind`, a machine-readable `reason`, a human `message` and whatever the command knew before failing, such as the target it resolved or the steps that already completed. Callers branch on `ok`, `kind` and `reason`, never on message text.
- Output that would otherwise reach the terminal, such as setup-command lines and warnings, is captured into the document.
- Exit codes keep their meaning in both modes.
- Commands do not format their own failures. They throw typed errors that carry their `kind` and `reason`, attaching context as they unwind, and one handler at the command boundary formats anything thrown for the active mode. An unrecognized throw is normalized into the same shape.

Honeycomb's [`dispatch`](../lib/honeycomb/src/main.ts) is the reference implementation, with its error model in [`errors.ts`](../lib/honeycomb/src/errors.ts).
