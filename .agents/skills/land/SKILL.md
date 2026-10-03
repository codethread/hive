---
name: land
description: land the plan
---

# Land

Land completed work: tidy it up, prove it, and merge it to `main`. Run this only when the user explicitly asks to land ("land the plan", "land this", "land it"); never land on your own initiative.

## Preconditions

- The user explicitly asked to land.
- The plan's work is complete and committed.
- Any librarian/reviewer consultations the plan required are done.
- Coordinate with other agents so only one landing and tracker publication runs in this repository at a time; feature work can continue concurrently.

## 1. Tidy up

- Delete scratch and temp files: fixtures, throwaway scripts, debug logs, commented-out experiments, `*.tmp`.
- Revert edits made only for testing or demonstration.
- Inspect `git status` and the diff for files that should not be tracked: editor/OS junk, secrets or local config, build output, generated artifacts, large binaries, absolute local paths.
- Confirm `.gitignore` covers anything the work generates; extend it when needed.
- Remove dead code and unused imports left behind; keep the diff scoped to the plan.
- Keep documentation truthful: AGENTS.md, docs/, skills and package AGENTS.md must match reality.

## 2. Prove it

- Run the repository's checks (see AGENTS.md) and fix everything they report.
- Read the complete diff once as an external reviewer would; use the `reviewer` subagent for a standards pass when warranted.
- Review the commit list for noise, half-finished messages or fixups.

## 3. Commit what remains

- Commit leftovers as coherent conventional commits. Never bypass hooks.

## 4. Merge to main

- Resolve and retain the canonical root with `honeycomb root` before finishing; finishing may remove the source worktree. Select its `.beads/beads.db` through `BEADS_DB`. For worktrees created under the old policy, preserve any private database and reconcile unpublished state before cleanup.
- Bring accepted remote main into canonical main, then inspect `br sync --status --json` before ordinary tracker commands. If `jsonl_newer` is true, run unforced `br sync --merge` and resolve any conflicts against the accepted reservations. Merge exports JSONL too; commit and push any resulting tracker changes before Honeycomb needs a clean, synchronized main.
- This repository works in worktrees, so land through the worktree workflow rather than merging by hand; run `honeycomb -h` and follow its guidance.
- If the tooling refuses or stops (dirty tree, conflicts, missing remote), resolve that state instead of falling back to a raw merge.
- Verify the canonical `main` afterwards: the expected commits are present, checks are green, and no worktree or branch is left stale.

## 5. Publish tracker state

- From the retained canonical root, inspect `br sync --status --json` again because finishing may have received newer remote JSONL. If `jsonl_newer` is true, reconcile with unforced `br sync --merge` before further tracker commands. Then record landing evidence and close only the completed tasks in the shared database.
- Run `br sync --flush-only`. This publishes the whole database snapshot, including other agents' ongoing work, and may dirty `.beads/issues.jsonl`. Do not force an export or replace it with a worktree's older snapshot.
- Stage only `.beads/issues.jsonl` and inspect the staged diff. If it changed, create a conventional commit describing the tracker publication, then push canonical `main`. Honeycomb may already have pushed the feature integration; this is a separate tracker commit and push.
- Verify canonical main has no staged, unstaged, or untracked changes and `HEAD` equals `origin/main`. A refused flush, commit, or push leaves landing incomplete; resolve it before releasing the landing coordination.
- After a rejected push, inspect the accepted remote reservations before reconciliation and retry. Keep unrelated changes, yield to an already-published competing claim, and stop for reviewed conflict resolution when needed; timestamp priority is not an ownership decision.

## Done means

- `main` contains the work and the checks pass on a clean checkout.
- The shared tracker snapshot includes the completed tasks and is committed and pushed with canonical main clean and synchronized.
- No temp, stray, generated or untracked leftovers remain.
- The user is told what landed, what was cleaned up, and anything left unresolved.
