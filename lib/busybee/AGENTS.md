# Busy Bee

Read [SPEC](./SPEC.md) before changing projection, completion, checkpoint ownership or definition loading. For workflow definitions, follow the [authoring guide](../../docs/busybee-workflows.md). Keep user operations in [README](./README.md) and concrete command/response examples in [POV](./POV.md).

## Implementation seams

Keep process execution and native JSON parsing in injected [native services](./src/native.ts), frontier projection in [runtime.ts](./src/runtime.ts), and dynamic XState typing in [definition.ts](./src/definition.ts).

`beforeWrite` marks publication immediately before a native mutation. Lock acquisition and release use the original services outside that tracking scope.

## Verification

The integration tests are discovered by the normal full suite and selected by Bun's import graph for changed-code runs. From the checkout root:

```sh
bun run test:changed
bun run test ./lib/busybee/tests/integration/native.test.ts
bun run test
```

Use [the native fixture](./tests/integration/support.ts) for disposable repositories and databases; it removes them after each test. Exercise `runCli` in process for command scenarios, retaining the executable test for child-process output. Import tested examples and repository definitions directly alongside dynamic file loading so their changes select the dependent tests. The executable's guarded import provides the same dependency for its subprocess case.

The fixture selects live SQLite storage with automatic JSONL export/import disabled: it has no published tracker endpoint. Retain the native test of default tracker configuration when changing the adapter.

Coordinate native races with promise barriers at the I/O boundary. Inject `Services.now` and `Services.sleep` for deadline behavior. Keep the postwrite failed-owner case when changing checkpoint ownership: it proves uncertain effects remain quarantined. Check land branching paths and briefs through the actual chart; use native storage for continuation after disposable checkout removal. Scripted Bee results launch no model, and land tests perform no real landing.

Use a real Bun executable on `PATH` for child processes; a version-manager shim may reject disposable repositories before the CLI runs. Test local-bin installation with `BUN_INSTALL` set to an isolated temporary prefix.
