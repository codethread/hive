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

The [capture fixture](../../tests/integration/nested-bees-fixture.ts) runs the authored workflow through start, result recording, native task closure, collection and inspection. It uses memory Beads and mocked Bee dispatch to produce four request records; it launches no workers and writes no real tracker records. The [tests](../../tests/integration/nested-bees.test.ts) check hierarchy, dispatch, closure and unchanged records after inspection and simulation.

Saved instruction metadata identifies the original published request; see the [dispatch provenance contract](../../SPEC.md#saved-state-preview) for retry and preview semantics. The root simulation rejects child coordination. A retained child can be simulated independently, but its completion leaves the parent unchanged; see [simulation limits](../../SPEC.md#simulation).

## Regenerate captures

From the checkout root:

```sh
bun -e 'import { captureNestedBees } from "./lib/busybee/tests/integration/nested-bees-fixture.ts"; const { captured } = await captureNestedBees(); await Bun.write("./lib/hive-ui/src/stories/workflow-nested-bees.json", JSON.stringify(captured, null, 2) + "\n");'
```

This regenerates the serialized responses consumed by the stories. Run the focused check afterward:

```sh
bun test ./lib/busybee/tests/integration/nested-bees.test.ts
```

The example uses empty input and `next` outcomes with empty payloads. For an actual run, use `busybee start --help` and the [execution guide](../../README.md#run-a-workflow); starting it submits real requests to the configured Bee kinds.
