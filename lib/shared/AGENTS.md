# @hive/shared

Owns contracts with actual consumers across product packages: recipes, formulas, spawn-request representation, repository endpoints, daemon messages and common Beads I/O.

The [spawn state and native query contract](../../docs/agents/spawn-requests.md) is the authoritative reference for outcome/resolution labels, valid combinations and native provenance. Read it before changing the request model.

- Keep one domain meaning in one place. Submission, offline inspection and execution share the spawn-request decoder rather than interpreting labels or relationship links independently.
- Keep scheduler decisions, persistence and presentation in Colony, and worktree lifecycle policy in Honeycomb. Shared imports no product package; consumers import it through `@hive/shared`.
- Add shared behavior only when its consumers need the same contract. Read [architecture](../../docs/architecture.md) before moving a responsibility across a package seam.
