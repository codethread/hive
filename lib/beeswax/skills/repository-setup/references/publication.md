# Tracker publication

Inspect the selected endpoint with `beeswax beads env --json` before exchanging tracker state.

`beeswax beads sync` explicitly reconciles local SQLite and JSONL, commits the snapshot, receives compatible changes and publishes the tracker branch under the local publication lock. Ordinary Beads mutations and local worker handoffs remain local.

Publish at an authorized remote exchange checkpoint or after integration and final task/workflow updates. A code pull alone does not refresh the tracker. Conflicting claims, JSONL conflicts and synchronization failures require inspection and a clear handoff; preserve history and avoid forced publication.

The dedicated tracker worktree is permanent. Keep it outside ordinary feature cleanup. Record completion and verification before publishing, from a surviving checkout using the selected endpoint.
