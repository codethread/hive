# Nested bees

[This workflow](./workflow.ts) runs API and interface child machines in parallel. Each child publishes an implementation visit for the `worker` Bee kind, then a verification visit for `reviewer`. After both children finish, the driver summarizes their results.

The native work hierarchy is:

```text
Run
├── Build both branches
│   ├── API branch
│   │   ├── Implement API
│   │   └── Verify API
│   └── Interface branch
│       ├── Implement interface
│       └── Verify interface
└── Summarize both branches
```

Implementation and verification are sequential sibling visits within each branch. XState actors coordinate those visits; a separate Bee request delegates each visit's execution. Grouping beads have no worker outcome. Busy Bee closes the groups and run after accepted outcomes.

## Inspect the example

The [Storybook examples](../../../hive-ui/src/stories/workflow-nested-bees.tsx) render the production `WorkflowDiagram` using captured public inspection and simulation responses. They show both branches at implementation, API at verification while interface remains at implementation, and the driver summary after both branches finish.

The [capture helper](../../tests/integration/nested-bees-fixture.ts) runs this workflow with memory Beads and mocked Bee dispatch. It launches no workers and writes no real tracker records.

The [engine tests](../../tests/integration/nested-bees.test.ts) cover dispatch, hierarchy, closure and read-only inspection/simulation using isolated local definitions, rather than validating this example or comparing saved story responses.

Saved instruction metadata identifies the original published request; see the [dispatch provenance contract](../../SPEC.md#saved-state-preview) for retry and preview semantics. The root simulation rejects child coordination. A retained child can be simulated independently, but its completion leaves the parent unchanged; see [simulation limits](../../SPEC.md#simulation).

## Regenerate captures

The no-argument `captureNestedBees()` loads the shipped workflow and reads its actual source, then runs simulation followed by completion, producing four mocked request records. From the checkout root:

```sh
bun -e 'import { captureNestedBees } from "./lib/busybee/tests/integration/nested-bees-fixture.ts"; const { captured } = await captureNestedBees(); await Bun.write("./lib/hive-ui/src/stories/workflow-nested-bees.json", JSON.stringify(captured, null, 2) + "\n");'
```

The example uses empty input and `next` outcomes with empty payloads. For an actual run, use `busybee start --help` and the [execution guide](../../README.md#run-a-workflow); starting it submits real requests to the configured Bee kinds.
