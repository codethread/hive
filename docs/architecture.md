# Architecture

Honeycomb is currently the implemented tool: a Git worktree lifecycle engine with a CLI and an optional Nushell/tmux wrapper. Colony (provider-facing CLI) and Ghost (daemon) are placeholders; both currently call a greeting helper in Shared. There is no provider or daemon runtime connecting them yet.

Product packages do not import one another. Shared is the only permitted cross-package dependency; Honeycomb currently operates independently of it.

## Honeycomb's execution boundary

```text
Human / automation / Nushell wrapper
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

The engine owns worktree policy and lifecycle mutations. The Nushell wrapper adds shell navigation, interactive worktree selection and tmux session handling. It invokes the CLI as a subprocess and interprets structured outcomes and exit status through the [command protocol](../lib/honeycomb/src/protocol.ts), rather than importing engine internals.

An add result can hand back a bootstrap script. The caller must run it before using the checkout; the wrapper runs it and coordinates rollback on failure. Tmux state never determines whether a worktree exists or is safe to remove.
