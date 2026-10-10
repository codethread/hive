---
name: git-workflow
description: Use when creating, locating or cleaning up Git worktrees.
---

Use Honeycomb instead of raw `git worktree` commands. Consult help when needed: `honeycomb -h` for command discovery, or `honeycomb <command> --help` for syntax and effects.

- Reuse the task's existing worktree; create one when needed.
- Prefer `--json` where supported; use structured results rather than parsing messages.
- Run noninteractively: use `list`/`path` for discovery, without `--interactive`.
- Use `honeycomb config explain --json` when you need to inspect effective repository policy.

Read [Pooled slots](references/pooled-slots.md) only for pool allocation, recycling or repair, or when `add` returns `pool_full`.
