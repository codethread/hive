# Merge queues

Run from a checkout of the destination repository, with Git and Honeycomb on `PATH`. Lock the destination branch, not the source branch. qlock uses `honeycomb root` to resolve its canonical path; that path plus the full destination branch ref selects one local queue across its worktrees.

`main` and `refs/heads/main` resolve to the same queue. Different repositories or destination branches do not. Use `--merge-target` in place of `--lock` for execution, resumption and status, keeping the same repository and target.

The selector chooses only the queue. Configure the child merge command to target that same branch, following the application's prerequisites, review and publication requirements.

Keep final refresh/revalidation, merge, required push and confirmation inside one lock. Queue a script for multi-step or queued merges; wait for completion, not just auto-merge registration.

These examples use `main` as the destination:

```sh
# Local worktree integration with squash policy
qlock exec --merge-target main -w 180 -- honeycomb finish --json --title "feat: add search"

# Immediate GitHub PR merge (no server-side merge queue)
qlock exec --merge-target main -w 180 -- gh pr merge 123 --squash
```
