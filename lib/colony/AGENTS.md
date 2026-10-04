# @hive/colony

Owns the Bee request interface and Colony CLI, daemon, repository colonies, execution attempts and private runtime state.

Before changing or inspecting request state, retry resolution or query labels, read the [spawn state and native query contract](../../docs/agents/spawn-requests.md). Keep its finite combinations, publication recovery and native presets aligned with the shared model.

- Keep command parsing and presentation in the CLI boundary. `producer.ts` captures requests; `requests.ts` reads and closes native spawn beads without requiring configuration or daemon availability.
- The server owns its socket and state directory; the colony machine owns awake/draining/asleep transitions; dispatch coordinates one pass; the request machine owns claims, retries and settlement. Preserve those distinct lifetimes.
- The CLI starts `bin/runtime.ts` as a separate process and controls the daemon over its Unix socket. Detached supervisors use `bin/worker.ts` and survive sleeping colonies and daemon exits.
- Supervisors write process artifacts, while the daemon reconciles Beads and persists checkpoints. Execution ownership must be proven before adoption, signalling or claim release.
- Use Shared's spawn-request model and protocol contracts through `@hive/shared`; native harnesses are invoked through formulas.
- Keep request facts from Beads distinct from historical Colony observations and daemon checkpoints. Preserve explicit repository, tracker and server selection.
- Before changing persistence, authority or lifecycle boundaries, read [architecture](../../docs/architecture.md); public behavior and real boundary tests are in the [guide](README.md#verification).
