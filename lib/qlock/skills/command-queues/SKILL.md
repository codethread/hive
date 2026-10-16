---
name: command-queues
description: Serialize local commands or merges with qlock, inspect queues and resume timed-out waits.
---

Take the command, queue policy and authorization from the application repository or the user. qlock coordinates commands on one machine.

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

Read `qlock exec --help` for execution and resumption syntax. Use a bounded queue wait; it bounds admission, not the child's runtime. Keep the child in the foreground for the entire protected operation: detached work outlives the lock.

## Resume after a wait timeout

On a reported queue timeout, resume promptly with the ticket, same resolved queue and intended command; the child has not started. Keep that ticket across repeated waits. If qlock reports it gone, deliberately rejoin if work remains. Inspect an already-running ticket before attempting more work. `qlock exec --help` owns exit codes, diagnostics and ticket-expiry details.

## Inspect without admitting work

Use `qlock status --help` to inspect the selected queue. Even a `free` response is only an observation; `exec` claims admission.

Completion means the foreground child exited successfully, not that a ticket was created or became ready.
