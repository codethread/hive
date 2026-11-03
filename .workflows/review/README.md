# Scoped review

Submit a file, current edits, one commit or a Git range for parallel specialist review. Routing is deterministic; there is no planner agent. Each matched concern gets its own Beads task and Bee request. The run finishes with separate Standards and Spec reports, even when reviewers find issues.

From the Hive checkout or worktree being reviewed. These examples use the caller's `BD_ACTOR`; outside Colony, set it to your own harness actor. Colony bees retain their injected identity.

```nu
bun run --silent review --help

# Preview the resolved scope and selected briefs without creating work.
bun run --silent review --worktree --dry-run --json

# Current staged, unstaged and nonignored untracked edits.
bun run --silent review --worktree --owner ct --json

# Only the change introduced by this commit, not all previous commits.
bun run --silent review --commit HEAD --owner ct --json

# Endpoint comparison, or an explicit merge-base comparison for a PR branch.
bun run --silent review --range 'main..HEAD' --owner ct --json
bun run --silent review --range 'main...HEAD' --owner ct --json

# Whole current files, even when unchanged; quote globs.
bun run --silent review --files 'docs/*.md' --owner ct --json

# Restrict a Git scope and add an independent specification review.
bun run --silent review --worktree --paths 'lib/busybee/**' --spec request.txt --owner ct --json
```

Choose exactly one scope selector. `--files` and `--paths` use repository-relative Bun globs, not Git pathspecs. File selection includes tracked and nonignored untracked files, excluding deleted files. Git scopes include deletions and both paths of a rename. An empty scope fails before workflow creation. Commit mode handles root commits; merge commits require an explicit range. Range endpoints must both be supplied; three-dot ranges require one merge base.

`--repo` selects the execution worktree; `--db` independently overrides the native Beads endpoint. `--actor` overrides `BD_ACTOR`. Starting requires an owner and actor; previews require neither, no tracker and no provider credentials. Actual execution requires `bee` on PATH and an awake Colony configured for the kinds selected by matched concerns. The default index uses `reviewer`; `librarian` is needed when architecture review is selected.

## Collect the report

Submission returns a run `id`, its active tasks and requests. Continue other work, then collect:

```nu
bun run --silent busybee collect RUN_ID --json
bun run --silent busybee show RUN_ID --json
```

`collect` processes currently closed automatic tasks and advances the chart; it does not wait for open tasks. `show` only reads saved workflow state. Repeat collection when more reviewers finish. The report is available as `output` when `status` is `done`:

- `scope`: the selected files and resolved Git revisions, where applicable.
- `coverage`: selected concerns and assigned files; unmatched files remain explicit.
- `standards` and `spec`: independent reports with findings, reviewer evidence and unavailable verification. The verdict is `clear`, `findings` or `incomplete`; missing specification input is `not_requested`, not a pass.

A completed run is not approval to land. An unmatched file or missing verification prevents a clear Standards verdict. Rule violations and suggestions stay distinguishable. Reviewers do not fix files, create repair tasks or rerun the whole review automatically. The caller decides what to fix and what to submit next.

If a task remains unfinished, inspect its bead and returned request ID with `br show` and `bee status`. Failed requests do not turn into clean reports; the caller resolves them through the ordinary Bee interface. There is no background collector or wait loop in this workflow.

## Ownership and limits

The caller owns concurrent edits. Reviewers use the selected checkout and Git scope; there is no snapshot, scope lock, isolated review checkout, drift detection or invalidation. Working on a file while it is under review is the caller's responsibility.

Selection currently covers documentation, TypeScript structure, test quality, test timing, CLI/configuration contracts and architecture. All matching concerns run, with paths grouped per concern rather than one bee per file. Globs are explicit routing policy, not proof that every semantic impact has been covered. Supply the intended specification when reviewing requirements.

The submission helper performs Git/file I/O before starting the pure chart. The chart fans out, joins and reports; Busy Bee and Colony retain their existing progression and execution responsibilities. The temporary prepared-input file is removed after startup. Inspection and collection require an unchanged workflow definition, even after completion. Save the completed JSON report before editing this workflow folder, as required by Busy Bee's existing definition fingerprint contract.

## Verification

The native integration tests use disposable Git repositories and Beads databases with scripted Bee responses; no provider calls are made:

```nu
bun run test ./lib/busybee/tests/integration/review.test.ts ./lib/busybee/tests/integration/output.test.ts
```

They exercise scope selection, preview without tracker writes, partial collection, parallel completion, separate report axes, incomplete coverage and restored final output. A real Bee run separately verifies the configured harness and provider path.
