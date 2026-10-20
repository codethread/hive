# Agent response delivery

Keep authored answers, task progress and machine outcomes separate:

| Content | Home |
| --- | --- |
| Complete answer or blocker report | Immutable response linked to its producing run/stage |
| Progress, verification and response IDs | Task comments |
| Workflow outcome | Stage notes: Busy Bee's original `{choice,data}` outcome |
| Specialist decisions and curation history | [Filed evidence](../beads-meta.md#filed-specialist-evidence), citing responses where useful |

## Retrieve a bee's answer

Start with `bee --help` for delegation and `bee result --help` for request IDs, retries and delivery failures. Publication, corrections and historical reads are documented in `bee response --help` and its subcommands; JSON contracts are available through `bee response --schema`.

## Runtime guidance

Bee appends its [delivery protocol](../../lib/colony/src/response-protocol.ts) to the selected kind role. The execution assignment supplies the response target through [Shared](../../lib/shared/src/response-protocol.ts): the driver's run or the dispatched worker's stage. Direct conversations answer the user.

Filing a response neither completes work nor grants authority over examined tasks or specialist evidence labels.
