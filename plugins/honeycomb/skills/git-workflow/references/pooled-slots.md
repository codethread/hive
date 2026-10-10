# Pooled slots

A **worktree pool** is a fixed set of reusable checkouts. A **pool slot** keeps its directory while different working branches occupy it. A **placeholder branch** marks a slot not holding a working branch. The canonical worktree is separate and protected.

Use the paths returned by Honeycomb, not paths inferred from branch names: a branch can occupy any available slot.

## Inspect and allocate

- `honeycomb status` always returns JSON. `hasPool`, `size` and `slots` describe the configured pool, including missing or uninitialized slots.
- `honeycomb list --json` lists registered worktrees only; it does not materialize missing slots.
- `honeycomb add --branch feature/example --json` prepares missing or uninitialized slots as needed and allocates a checkout. Work from its returned `worktree_path`.
- `honeycomb ensure` explicitly pre-warms or repairs pool initialization; it is not a prerequisite for every `add`.

## Recycle rather than delete

`honeycomb remove` returns a pooled worktree to a placeholder branch without deleting its directory. Read `remove --help` for branch-retention options and safety checks. Configured `finish` cleanup can recycle a slot too.

Let Honeycomb manage slot directories and placeholder branches rather than removing directories or switching those branches manually.

## When the pool is full

A JSON `add` returning `kind: "pool_full"` reports occupied candidates rather than opening a recycle picker. Inspect their state with `status`; a clean checkout is not proof that another task has finished using it.

Proactively recycle a checkout without asking again when its work is complete (for example, merged) and no active task still uses it. If either condition is unclear, confirm before recycling. Then retry `add`. If none can be released, report the capacity blocker rather than forcing reuse or creating an unmanaged extra slot.
