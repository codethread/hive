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

Bun is required for building. The executable runs on the build host's Unix-like platform without a separate Bun installation. Process-group supervision requires Unix `ps`; merge queues also require Git and Honeycomb. Bash, `flock` and `shasum` are not runtime dependencies.

## Execute or resume

`exec` owns the whole lifecycle: join the queue, wait for a turn, claim it atomically, and execute the child. `status` inspects the queue without creating a ticket; checking status first is not necessary and does not grant permission to execute.

```nu
qlock exec --lock /tmp/project-check.lock -w 180 -- bun run check
qlock status --lock /tmp/project-check.lock
qlock exec --lock /tmp/project-check.lock -w 180 --urgent "user blocked on verification" -- bun run check
```

Select a queue with `--lock PATH` or `--merge-target BRANCH`, not both. Put the complete child invocation after `--`; everything after it belongs to the child, including `--help`, `--json` and further `--` arguments. Child stdin, stdout and stderr pass through; see [process lifetime](#storage-and-process-lifetime) for terminal limitations. Queue progress and errors go to stderr.

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
| 2    | Invalid usage or runtime configuration                                    |
| 3    | Ticket gone; omit `--ticket` to join again                                |
| 75   | Wait timed out with the ticket retained, or the ticket is already running |
| 124  | Runtime timeout terminated the owned process group                        |

Execution otherwise returns the child's status. A child can itself return any of the listed codes; qlock's diagnostics distinguish its own failures. `-w` bounds only the wait for admission, not command runtime; `-E` changes only the wait-timeout status. No command starts later in the background after a wait timeout: resume with `exec` to run it.

## Runtime timeout

Set a global runtime limit in `${XDG_CONFIG_HOME:-~/.config}/hive/qlock.toml`:

```toml
timeout = "4m"
```

`timeout` is the only setting. It accepts duration strings such as `5s`, `2m` or `4m`, parsed by `ms`, that resolve to whole milliseconds from 1 through 2147483647. A missing file or setting means unlimited runtime; four minutes is an example, not a default. There is no project configuration or CLI override.

`exec` reads the file before joining or resuming a queue. Unreadable or malformed configuration, unknown settings and invalid durations fail before admission. Help, `status`, `skills` and `changelog` do not read this configuration.

The timer starts when the command is spawned, excluding queue wait. At expiry, qlock immediately sends SIGKILL to the owned process group: the child and descendants still in that group. There is no advance warning or TERM grace period. qlock keeps the ticket until the child and all live group members have exited, then reports a runtime-timeout diagnostic on stderr and exits 124. This ends the ticket; it is not a resumable wait timeout. See [process lifetime](#storage-and-process-lifetime) for supervision limits.

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

`status` and `skills` accept qlock's `--json`; arbitrary child streams cannot form one qlock JSON document. An `exec` wait-timeout diagnostic on stderr includes the retained ticket ID and queue position. Resume with `--ticket ID` before the `--` separator. A child's own `--json` remains untouched.

## Bundled instructions

Read version-matched guidance directly from the executable. Application commands, queue policy and merge authorization remain project-owned.

```sh
qlock skills --help
qlock skills
qlock skills get command-queues
```

These commands work offline outside a repository without Git, Honeycomb, a tracker or configuration. The standalone build embeds all content; command help explains discovery and resource reads.

With `--json`, discovery returns `ok: true`, `kind: "skills_list"` and `skills`; reads return `ok: true`, `kind: "skills_get"`, `name`, `path` and `content`. Errors use the envelope described above and exit 2 for unknown names, resources or invalid usage. Text errors go to stderr.

## Serialize merges

```nu
qlock exec --merge-target main -w 180 -- honeycomb finish --json
qlock exec --merge-target main -w 180 --ticket 42 -- honeycomb finish --json
```

The second command illustrates resuming after a queue wait timeout; use the reported ticket ID, not a fixed value. Use the actual destination branch and any arguments the merge command requires. Use `--merge-target` instead of `--lock`. Run from a checkout of the destination repository. `honeycomb root` supplies its canonical path; that path and the full destination ref select one local queue. `main` and `refs/heads/main` share a queue; different repositories or destination branches do not.

The merge lock is `/tmp/agent-merge-<sha256>.lock`, hashing the canonical path and full ref, each followed by a newline. `status` also accepts `--merge-target` instead of `--lock`.

## Storage and process lifetime

Each queue has one private SQLite database under `LOCK.d/queue.sqlite`. Short synchronous transactions serialize queue updates and execution claims; the database is not locked for the duration of a command. Competing state writers wait up to five seconds before reporting `queue_busy`, distinct from a ticket wait timeout. Corrupt state fails visibly instead of resetting the queue. Keep queues on a local filesystem: this is single-machine coordination, not a distributed lock. Do not remove an active queue's database or directory.

There is no daemon. Each invocation advances the queue, dropping expired ready tickets and dead runners. A wait timeout or waiting process exiting does not cancel a queued ticket. An urgent ticket does not pre-empt ready or running work. All participants must use the same qlock implementation; replacing it requires draining existing runners and queues first.

qlock starts the command in a new Unix session and process group, with inherited streams, and remains its foreground supervisor. Ordinary pipe/file input and basic terminal reads work, but the child has no controlling terminal: applications that reopen `/dev/tty` and shell job control are not supported transparently. This separate session does not mean qlock runs the command in the background.

INT, TERM and HUP sent to qlock forward TERM to the entire owned group. The slot remains held until the direct child and all live group members exit, even if descendants outlive the child. Any configured runtime deadline remains active throughout that wait, including after an interrupt; without one, the wait can be unlimited. If group cleanup cannot be verified, qlock reports the failure, attempts SIGKILL and stays alive holding the slot until cleanup is verified, then reports the original error.

Keep protected work in the owned group. Descendants that create another group/session or change signal permissions can escape supervision; this is not security containment. The queue owner is qlock's PID. SIGKILL sent to qlock cannot be forwarded, and killing or crashing qlock can leave work running while later invocations prune its ticket. Inspect `qlock status --lock PATH` before stopping a runner; a dead owner alone does not prove its work has stopped.

## Verify

Tests require Bash, Git and `honeycomb` on `PATH` in addition to Bun.

```nu
bun run --filter @hive/qlock test
```

Pure/injected tests exercise queue policy and CLI contracts; integration tests use real temporary queues and child processes.
