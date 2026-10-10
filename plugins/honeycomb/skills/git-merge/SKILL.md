---
name: git-merge
description: Use when merging branches or pull requests, including Honeycomb integration.
---

# Merge queues

Queue every merge from the destination repository, locking the destination branch—not the source branch (`main` in these examples):

```nu
# Local worktree integration with squash policy
qlock exec --merge-target main -w 180 -- honeycomb finish --json --title "feat: add search"

# Immediate GitHub PR merge (no server-side merge queue)
qlock exec --merge-target main -w 180 -- gh pr merge 123 --squash
```

Keep final refresh/revalidation, merge, required push and confirmation inside one lock. Queue a script for multi-step or deferred merges; wait for completion, not just auto-merge registration.
