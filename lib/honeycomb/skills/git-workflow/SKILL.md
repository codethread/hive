---
name: git-workflow
description: Manage Git worktrees with Honeycomb, including pooled slot allocation and cleanup.
---

Use the application's Honeycomb policy to manage worktrees. Read `honeycomb -h` for command discovery and focused command help before mutations.

- Reuse the task's existing worktree; create one when needed.
- Prefer `--json` where supported; use structured results rather than parsing messages.
- Run noninteractively: use `list`/`path` for discovery, without `--interactive`.
- Use `honeycomb config explain --json` when you need to inspect effective repository policy.

Read [Pooled slots](references/pooled-slots.md) only for pool allocation, recycling or repair, or when `add` returns `pool_full`. Retrieve that reference with `honeycomb skills file git-workflow references/pooled-slots.md`.
