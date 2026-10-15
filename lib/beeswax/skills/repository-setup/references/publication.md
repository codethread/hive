# Tracker publication

Inspect the selected endpoint with `beeswax beads env --json`. `beeswax beads sync` receives and publishes its snapshot; ordinary Beads mutations and local worker handoffs stay local.

Publish at an authorized remote exchange checkpoint or after integration and final task/workflow updates. A code pull alone does not refresh the tracker.

Stop on conflicting claims, JSONL conflicts or synchronization failure; inspect and resolve the handoff while preserving history. Never force publication.

Keep the permanent tracker worktree outside feature cleanup. Publish completion and verification from a surviving checkout.
