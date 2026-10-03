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
- Coordinate code landing with other agents and resolve any outstanding tracker conflict before closing completed work.

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

- Retain the canonical root and selected `BEADS_DB` before finishing; finishing may remove the source worktree. The database belongs to the permanent `tracker/state` checkout, not canonical main. Preserve any older private database with unpublished state before cleanup.
- This repository works in worktrees, so land through the worktree workflow rather than merging by hand; run `honeycomb -h` and follow its guidance.
- If the tooling refuses or stops (dirty tree, conflicts, missing remote), resolve that state instead of falling back to a raw merge.
- Verify the canonical `main` afterwards: the expected commits are present, checks are green, and feature cleanup succeeded. Keep the permanent tracker checkout and branch; never finish it or merge it into main.

## 5. Publish tracker state

- Using the retained endpoint, record landing evidence and close only the completed tasks. The configured `br` wrapper receives, reconciles and publishes before and after every successful command. If it reports a tracker conflict, pause until reviewed recovery succeeds.
- Run `bun run beads:sync` from a surviving configured code checkout. It receives compatible tracker changes, reconciles SQLite, commits the shared snapshot and pushes the tracker branch's upstream. Main and feature code are not part of this publication.
- If synchronization reports a record or claim conflict, retain the local and remote evidence and resolve it before further tracker work. For manual recovery from a separate human terminal, pause tracker writers, use the native executable with the retained `--db` to preserve local work with an explicit flush and tracker-only commit before Git integration, then run unforced merge and successful `bun run beads:sync` before ordinary commands resume. Keep unrelated records and yield to an already-published competing claim. Never force sync or push to select ownership.
- Verify canonical main is clean and synchronized, and the tracker branch's accepted snapshot includes completion. Publication may include other agents' ongoing work; it does not close their tasks. A refused flush, commit, reconciliation or push leaves landing incomplete.

## Done means

- `main` contains the work and the checks pass on a clean checkout.
- The accepted `tracker/state` snapshot includes the completed tasks; canonical main is clean and synchronized.
- No temp, stray, generated or untracked leftovers remain.
- The user is told what landed, what was cleaned up, and anything left unresolved.
