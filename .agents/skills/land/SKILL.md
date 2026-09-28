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

- This repository works in worktrees, so land through the worktree workflow rather than merging by hand; run `wktree -h` and follow its guidance.
- If the tooling refuses or stops (dirty tree, conflicts, missing remote), resolve that state instead of falling back to a raw merge.
- Verify the canonical `main` afterwards: the expected commits are present, checks are green, and no worktree or branch is left stale.

## Done means

- `main` contains the work and the checks pass on a clean checkout.
- No temp, stray, generated or untracked leftovers remain.
- The user is told what landed, what was cleaned up, and anything left unresolved.
