# qlock

Ticketed local command locking for agents and shells, implemented in TypeScript on Bun. Commands sharing a lock run one at a time, in arrival order; urgent tickets take the next unreserved turn.

## Install

From a Hive checkout, the default setup installs qlock alongside the other tools:

```nu
mise trust
mise run
qlock --help
```

Or install only qlock:

```nu
bun install
bun run --filter @hive/qlock build
bun run --filter @hive/qlock install:bin
```

The build writes the standalone executable `lib/qlock/dist/qlock`. Installation copies it to `~/.local/bin/qlock`; put that directory on `PATH`. Use `install:bin --directory /path/to/bin` for a separate destination. An existing symlink is replaced without altering its target. Building alone leaves installed commands untouched.

Bun is required for building. The executable runs on the build host's Unix-like platform without a separate Bun installation. Merge queues also require Git and Honeycomb. Bash, `flock` and `shasum` are not runtime dependencies.

## Execute or resume

`exec` owns the whole lifecycle: join the queue, wait for a turn, claim it atomically, and execute the child. `status` inspects the queue without creating a ticket; checking status first is not necessary and does not grant permission to execute.

```nu
qlock exec --lock /tmp/project-check.lock -w 180 -- bun run check
qlock status --lock /tmp/project-check.lock
qlock exec --lock /tmp/project-check.lock -w 180 --urgent "user blocked on verification" -- bun run check
```

Select a queue with `--lock PATH` or `--merge-target BRANCH`, not both. Put the complete child invocation after `--`; everything after it belongs to the child, including `--help`, `--json` and further `--` arguments. Child stdin, stdout, stderr and exit status pass through. Queue progress and errors go to stderr.

Without `--ticket`, `exec` creates a new ticket. A wait timeout retains its place and reports its ID in the diagnostic. Resume by supplying that ID, the same lock and the command again:

```nu
qlock exec --lock /tmp/project-check.lock -w 180 --ticket 42 -- bun run check
```

Ticket IDs belong to one resolved lock. If you change directories, use the same absolute lock path, or the same repository and merge target. Resuming never creates another ticket. A running ticket is refused, and a gone ticket returns exit 3 rather than silently rejoining. To deliberately start again, omit `--ticket`. `--urgent` applies only when joining and cannot be combined with `--ticket`; resuming preserves the ticket's priority.

`-w` is required and takes whole seconds. `-w 0` executes immediately if the ticket is ready; otherwise it returns with the ticket still queued. `-w -1` waits forever and is discouraged for agents. `-E CODE` changes the wait-timeout status to an integer from 1 to 255. A ready ticket expires after 30 seconds without execution, so resume promptly once its turn arrives.

| Exit | Meaning                                                                   |
| ---- | ------------------------------------------------------------------------- |
| 0    | Status succeeded, or child exited successfully                            |
| 1    | Execution or storage failure                                              |
| 2    | Invalid usage                                                             |
| 3    | Ticket gone; omit `--ticket` to join again                                |
| 75   | Wait timed out with the ticket retained, or the ticket is already running |

Execution otherwise returns the child's status. A child can itself return any of the listed codes; qlock's diagnostics distinguish queue failures. A timeout only bounds the wait for admission, not the child's runtime. No command is started later in the background after a timeout: resume with `exec` to run it.

## Machine metadata

`status --json` emits exactly one JSON document to stdout on success or failure, with silent stderr. Help is plain text. Put `--json` before other options so parsing failures also use JSON; a token consumed as an option value is not a flag:

```nu
qlock status --json --lock /tmp/project-check.lock | from json
```

Success has `ok: true`, `kind: "status"`, the resolved `lock`, and the ordered `tickets` array. Tickets carry `id`, `cwd`, `urgent` (a reason or null), and `state`:

- `queued`: waiting for an unreserved turn.
- `ready`: `readyAt` gives the reservation time in epoch milliseconds.
- `running`: `pid` identifies qlock, `command` is the literal argument vector, and `startedAt` is in epoch milliseconds.

Errors have `ok: false`, `kind: "error"`, `reason` and `message`, plus known lock context. Before lock resolution, any parsed `lock`/`mergeTarget` options appear under `target`; a top-level `lock` is always resolved. Branch on `reason`, not message text. Native failures use `execution_failed` or the more specific `repository_lookup_failed` / `queue_busy`. Exit codes keep their meaning in JSON mode.

Only `status` accepts qlock's `--json`; arbitrary child streams cannot form one qlock JSON document. An `exec` wait-timeout diagnostic on stderr includes the retained ticket ID and queue position. Resume with `--ticket ID` before the `--` separator. A child's own `--json` remains untouched.

## Serialize merges

```nu
qlock exec --merge-target main -w 180 -- honeycomb finish --json
qlock exec --merge-target main -w 180 --ticket 42 -- honeycomb finish --json
```

The second command illustrates resuming after a timeout; use the reported ticket ID, not a fixed value. Use the actual destination branch and any arguments the merge command requires. Use `--merge-target` instead of `--lock`. Run from a checkout of the destination repository. `honeycomb root` supplies its canonical path; that path and the full destination ref select one local queue. `main` and `refs/heads/main` share a queue; different repositories or destination branches do not.

The merge lock is `/tmp/agent-merge-<sha256>.lock`, hashing the canonical path and full ref, each followed by a newline. `status` also accepts `--merge-target` instead of `--lock`.

## Storage and process lifetime

Each queue has one private SQLite database under `LOCK.d/queue.sqlite`. Short synchronous transactions serialize queue updates and execution claims; the database is not locked for the duration of a command. Competing state writers wait up to five seconds before reporting `queue_busy`, distinct from a ticket wait timeout. Corrupt state fails visibly instead of resetting the queue. Keep queues on a local filesystem: this is single-machine coordination, not a distributed lock. Do not remove an active queue's database or directory.

There is no daemon. Each invocation advances the queue, dropping expired ready tickets and dead runners. A timeout or waiting process exiting does not cancel a queued ticket. An urgent ticket does not pre-empt ready or running work. All participants must use the same qlock implementation; replacing it requires draining existing runners and queues first.

INT, TERM and HUP sent to qlock forward TERM to its immediate child; the slot is released after that child exits. Commands must remain in the foreground rather than detach their work. The owner is qlock's PID; this is not process-tree supervision. SIGKILL cannot be forwarded: killing qlock that way can leave its child running without the lock. Before stopping a runner, inspect `qlock status --lock PATH` and confirm its owner is no longer working.

## Verify

Tests require Bash, Git and `honeycomb` on `PATH` in addition to Bun.

```nu
bun run --filter @hive/qlock test
```

Pure/injected tests exercise queue policy and CLI contracts; integration tests use real temporary queues and child processes.
