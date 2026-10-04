# @hive/ghost

Owns the hosting daemon, each repository's colony, execution attempts and private runtime state.

- The server owns its socket and state directory; the colony machine owns awake/draining/asleep transitions; dispatch coordinates one pass; the request machine owns claims, retries and settlement. Preserve those distinct lifetimes.
- Supervisors write process artifacts, while the daemon reconciles Beads and persists checkpoints. Execution ownership must be proven before adoption, signalling or claim release.
- Import cross-package contracts only through `@hive/shared`. Public CLI parsing and presentation stay in Colony; native harnesses are invoked through formulas.
- Before changing persistence, authority or lifecycle boundaries, read [architecture](../../docs/architecture.md). Use the [guide's verification matrix](../colony/README.md#verification) to select real boundary tests.
