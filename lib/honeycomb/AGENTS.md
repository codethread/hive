# @hive/honeycomb

Git worktree lifecycle engine, CLI, and Nushell wrapper.

- Keep HONEYCOMB self-contained. Import no other Hive package except `@hive/shared` through its package specifier.
- Keep structured JSON output stable; clients branch on `kind` values.
- Keep the TypeScript engine authoritative. The Nushell wrapper consumes its commands and output.
- Preserve the canonical worktree safety rules in [`devflow/specs/git-worktrees.md`](./devflow/specs/git-worktrees.md).
- Keep orchestration in `src/commands/` and `src/application/`, pure models in `src/domain/`, and Git/filesystem/process IO behind injected services.
