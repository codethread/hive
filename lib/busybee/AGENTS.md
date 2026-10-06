# Busy Bee

Read [SPEC](./SPEC.md) before changing task visits, completion, checkpoint ownership or definition loading. [README](./README.md) is user documentation; [POV](./POV.md) records concrete agent inputs and outputs.

## Implementation seams

The runtime accepts injected [native services](./src/native.ts). Keep process execution and native JSON parsing there; pure frontier projection stays in `runtime.ts`, and dynamic XState typing stays in `definition.ts`. The `beforeWrite` hook marks the publication ownership boundary immediately before native mutations; checkpoint acquisition/release use the original services outside that tracking scope.

## Focused verification

Run the probes affected by a change from the checkout root:

```sh
bun test lib/busybee/tests/integration/validation.test.ts
bun lib/busybee/tests/native-probe.ts
bun lib/busybee/tests/catalogue-probe.ts
bun lib/busybee/tests/visit-probe.ts
bun lib/busybee/tests/navigation-probe.ts
bun lib/busybee/tests/failure-probe.ts
bun lib/busybee/tests/land-probe.ts
```

Native probes create disposable repositories and databases, retaining paths and traces. `native-probe` checks concurrency, closure, identity, database selection and Bee collection; its scripted workers launch no model, and its intentionally failed checkpoint remains quarantined. Catalogue and land probes delete disposable feature checkouts to prove continuation from surviving copies. Visit/navigation probes cover task reuse and closed-parent preflight. The failure probe checks JSON-only actor failures and released prewrite ownership; retain the native probe's postwrite failed-owner case when changing this boundary.

Use a real Bun executable on `PATH` when running subprocess probes; a version-manager shim may reject disposable repositories before the CLI runs. Verify local-bin installation with `BUN_INSTALL` pointing to an isolated temporary prefix.
