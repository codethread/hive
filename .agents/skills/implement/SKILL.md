---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
---

Implement the work described by the user in the spec or tickets.

Use /tdd where possible, at pre-agreed seams.

Run typechecking and focused per-file tests regularly; run changed tests at subtask completion.

Once done, get `bun run check` passing for the complete change, then use /code-review to review the work.

Commit your work to the current branch.
