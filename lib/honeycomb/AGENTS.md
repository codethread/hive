# @hive/honeycomb

Git worktree lifecycle engine, CLI, and shell picker integrations.

- Keep HONEYCOMB self-contained. Import no other Hive package except `@hive/shared` through its package specifier.
- Keep structured JSON output stable; clients branch on `kind` values. Make payload changes additive.
- Keep the TypeScript engine authoritative. Generated shell integrations only invoke `honeycomb --interactive pick` and apply the `HONEYCOMB_CD_FILE` handoff; put worktree and multiplexer behaviour in the engine.
- Only touch the user's multiplexer or shell directory when `--interactive` is set, so agents never move the user's focus.
- Preserve the canonical worktree safety rules in [`devflow/specs/git-worktrees.md`](./devflow/specs/git-worktrees.md).
- Keep orchestration in `src/commands/` and `src/application/`, pure models in `src/domain/`, and Git/filesystem/process/multiplexer IO behind injected services.
