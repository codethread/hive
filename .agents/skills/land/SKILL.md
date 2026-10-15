---
name: land
description: Finish and land agreed work when the user explicitly says "land it", including unfinished implementation or an existing PR.
---

# Land

Start only for an explicit user request to land the agreed scope. Discussing, editing or test-driving the workflow does not authorize landing.

Use the repository's [Land workflow](../../../.workflows/land/workflow.ts). Inspect its input schema and prepare `/tmp/land-input.json` with the requested scope:

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
