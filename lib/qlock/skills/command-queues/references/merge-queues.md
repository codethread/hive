# Merge queues

Run from a checkout of the destination repository, with Git and Honeycomb on `PATH`. qlock uses `honeycomb root` to resolve its canonical path; that path plus the full destination branch ref selects one local queue across its worktrees.

Use the application's actual destination and merge command. For a repository whose approved merge command is `bin/merge`:

```sh
qlock exec --merge-target main -w 60 -- bin/merge
```

`main` and `refs/heads/main` resolve to the same queue. Different repositories or destination branches do not. Use `--merge-target` in place of `--lock` for execution, resumption and status, keeping the same repository and target.

The selector chooses only the queue. Configure the child merge command to target that same branch, following the application's prerequisites, review and publication requirements.
