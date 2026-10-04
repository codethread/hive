# @hive/colony

Owns the public Bee and Colony CLIs, offline request services, daemon client and output formatting.

- Keep command parsing and presentation in the CLI boundary. `producer.ts` captures requests; `requests.ts` reads and closes native spawn beads without requiring configuration or daemon availability.
- Use Shared's spawn-request model and protocol contracts. Reach Ghost through its command entry or Unix socket; product packages never import one another.
- Keep request facts from Beads distinct from historical Colony observations and daemon checkpoints. Preserve explicit repository, tracker and server selection.
- Before changing these boundaries, read [architecture](../../docs/architecture.md); public behavior and smoke commands are in the [guide](README.md).
