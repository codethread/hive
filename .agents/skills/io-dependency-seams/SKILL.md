---
name: io-dependency-seams
description: Use when implementing or refactoring an I/O boundary in code.
---

# I/O dependency seams

## Inject I/O

Always pass I/O dependencies into application functions as injected functions or services, directly or through an existing context. Compose live adapters at application entry points. Refactor consumers that create their own I/O dependencies or access them through globals.

## Keep the domain honest

Keep the interface honest about the dependency. Use Git operations when a generic `vcs` facade would still leak Git concepts; typed injection does not imply interchangeability. When a coherent domain abstraction could usefully hide or translate dependency details, consider a facade and make those semantics explicit.

## Choose the relevant guidance

Before adding another usage, find existing calls and helpers. At roughly three distinct consumer paths or operations, assess shared ownership. Count usages, not loop iterations; retain a local seam when extraction adds no useful consolidation.

```text
I/O boundary -> matching I/O guide -> local seam
                                      |
                         Shared ownership or test adapter needed?
                           +-- no --> keep local
                           +-- yes --> migration guide
```

- **Subprocesses or CLIs:** follow the [CLI guide](references/cli.md).
- **Network calls:** follow the [network guide](references/network.md).
- **Shared module extraction or migration to a shared test adapter:** follow the [migration guide](references/migrate.md) alongside the relevant I/O guide.

For other I/O, apply the injection rule and use the migration guide when relevant.
