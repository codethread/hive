---
name: land
description: Deliver authorized implementation through Land, including unfinished work or an existing PR. Respect explicit PR-only, review-only and scoped contribution assignments.
---

# Land

Use the repository's [Land workflow](../../../.workflows/land/workflow.ts) for authorized implementation delivery. Explicit PR-only/review-only scope, reports and scoped contributions retain their assigned completion instructions. Discussing or test-driving the workflow does not authorize landing.

Inspect its input schema and prepare `/tmp/land-input.json` with the requested scope:

```sh
busybee input-schema land --json
```

Start a named run beneath existing ordinary work, replacing `WORK_ID` with its bead ID:

```sh
busybee run land --parent WORK_ID --owner ct --input-file /tmp/land-input.json --json
```

Use the returned `id` as `RUN` below. For an existing run, resume its ID. Read the run brief, including its caller completion instructions, and follow the active stages and discovered outcome schemas:

```sh
br show RUN --json
busybee show RUN --json
busybee discover RUN --json
```
