# @hive/honeycomb

Git worktree lifecycle engine, CLI, and Nushell shim.

- Keep HONEYCOMB self-contained. Import no other Hive package except `@hive/shared` through its package specifier.
- Keep structured JSON output stable; clients branch on `kind` values. Make payload changes additive.
- Keep the TypeScript engine authoritative. Put behaviour in the engine, not the Nushell shim; `nu/honeycomb/mod.nu` only aliases engine commands, passes `--interactive` for focus-changing calls, and applies the `HONEYCOMB_CD_FILE` handoff.
- Only touch the user's multiplexer or shell directory when `--interactive` is set, so agents never move the user's focus.
- Preserve the canonical worktree safety rules in [`devflow/specs/git-worktrees.md`](./devflow/specs/git-worktrees.md).
- Keep orchestration in `src/commands/` and `src/application/`, pure models in `src/domain/`, and Git/filesystem/process/multiplexer IO behind injected services.
