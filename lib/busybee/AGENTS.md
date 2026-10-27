# Busy Bee

Read [SPEC](./SPEC.md) before changing projection, completion, native outcomes, settlement, checkpoint ownership or definition loading. For workflow definitions, follow the [authoring guide](../../docs/busybee-workflows.md). Keep user operations in [README](./README.md) and concrete command/response examples in [POV](./POV.md).

## Implementation seams

Keep process execution and endpoint selection in injected [services](./src/native.ts), frontier projection in [runtime.ts](./src/runtime.ts), and dynamic XState typing in [definition.ts](./src/definition.ts). `Services.beads` injects named typed `@hive/beads` operations; `createServices` composes the native implementation. Busy Bee parses checkpoint and captured workflow documents.

`beforeWrite` marks publication immediately before a native mutation. Lock acquisition and release use the original services outside that tracking scope.

## Verification

The integration tests are discovered by the normal full suite and selected by Bun's import graph for changed-code runs. From the checkout root:

```sh
bun test ./lib/busybee/tests/integration/native.test.ts
bun run test:changed
bun run check
```

Test engine contracts with minimal local definitions and memory Beads; concrete workflow definitions and shipped examples are outside test scope. Use [repository fixtures](./tests/integration/support.ts) for real authoring and Git discovery; they inject memory Beads and remove files after each test. Exercise `runCli` in process for command scenarios, retaining the executable test for child-process output. The executable's guarded import provides the dependency for its subprocess case.

The native discovery fixture selects live SQLite storage with automatic JSONL export/import disabled: it has no published tracker endpoint. Retained native checks cover repository tracker selection, schema discovery without a database and executable JSON errors; the memory failure check covers initial actor failure before task creation.

Coordinate native races with promise barriers at the I/O boundary. Inject `Services.now` and `Services.sleep` for deadline behavior. Default tracker configuration, postwrite failed-owner quarantine and native continuation after checkout removal are parked checks in the [coverage record](../../docs/test-cases/busybee.md). Consult its historical scenarios when changing those boundaries; the later [rejected lifecycle cohort](../../docs/test-cases/lifecycle-slow-test-removal.md) remains removed, not a restoration backlog. Scripted Bee results launch no model.

Use a real Bun executable on `PATH` for child processes; a version-manager shim may reject disposable repositories before the CLI runs. Test local-bin installation with `BUN_INSTALL` set to an isolated temporary prefix.
