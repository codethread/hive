---
name: command-queues
description: Use qlock to serialize local commands or merges, inspect a queue, and resume a retained ticket after a wait timeout.
---

Take the command, queue policy and authorization from the application repository or the user. qlock coordinates commands on one machine; these instructions supply execution mechanics.

## Select the queue

```text
Local command needs serialization
  |
  +-- destination-branch merge --> --merge-target BRANCH
  |
  +-- other shared resource ----> --lock ABSOLUTE_PATH
```

Use one selector. For a command queue, use the same absolute lock path as the other participants, on a local filesystem, and preserve active queue storage. Different resolved paths create independent queues. For a merge queue, read [merge queues](references/merge-queues.md) with `qlock skills file command-queues references/merge-queues.md` before executing.

## Execute in the foreground

Read `qlock exec --help` for options. Run the repository's intended command after `--`, with a bounded queue wait. For example, if the project uses this check command and queue:

```sh
qlock exec --lock /tmp/my-project-check.lock -w 60 -- bin/check
```

`exec` joins, waits, claims admission atomically and runs the child. The wait bounds admission, not the child's runtime. Keep the child in the foreground for the entire protected operation: detached work outlives the lock. Child streams and exit status pass through; queue diagnostics go to stderr.

## Resume after a wait timeout

A queue timeout returns exit 75 by default and reports a retained ticket ID. The command has not started and will not start later in the background. Resume promptly using the reported ID, the same resolved queue and the intended command:

```sh
# Example only: replace 42 with the ticket ID from the diagnostic.
qlock exec --lock /tmp/my-project-check.lock -w 60 --ticket 42 -- bin/check
```

Resuming preserves the place in the queue; omitting `--ticket` creates a new ticket. If another wait times out, keep resuming the same ticket. Once ready, an unclaimed ticket expires after 30 seconds. Exit 3 means the ticket is gone: deliberately join again without `--ticket` if the work is still required. An already-running ticket is refused; inspect it rather than duplicating its work.

A child can return the same exit code as a queue failure. Use the qlock diagnostic to distinguish a wait timeout from a failed command before retrying.

## Inspect without admitting work

```sh
qlock status --json --lock /tmp/my-project-check.lock
```

`status` reports ordered tickets as queued, ready or running. It does not join the queue or claim admission; even a `free` response is only an observation. Use `exec` for admission. See `qlock status --help` for options.

Completion means the foreground child exited successfully, not that a ticket was created or became ready.
