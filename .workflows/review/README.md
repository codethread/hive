# Domain review

Run bounded, read-only reviews of code, tests, documentation and specification through the repository's `review` workflow. Selected audits run in parallel using the configured Reviewer kind; the caller then synthesizes their reports. This standalone workflow does not change Land or feature-task delivery.

## Submit a review

Run from a Hive source checkout with Bun and Busy Bee available. Starting audits also requires [Bee and an awake Colony](../../lib/busybee/README.md#bee-dispatched-tasks). Save a request such as `review-request.json`:

```json
{
	"scope": { "kind": "worktree", "base": "main" },
	"evidence": {
		"sourceTask": "TASK_ID",
		"content": "Current worktree diff against main; identify the candidate or content receipt here",
		"checks": [],
		"architecture": []
	},
	"purpose": { "kind": "advisory" }
}
```

Replace the task and content evidence with your review's provenance. `checks` holds supplied check receipts; `architecture` holds applicable accepted decisions. Empty arrays make no claim that checks or architectural review passed.

Preview the resolved input and domain coverage without creating tasks:

```sh
bun .workflows/review/submit.ts \
  --input-file review-request.json \
  --repo CATALOGUE --target CHECKOUT \
  --parent TASK_ID --owner HUMAN --dry-run
```

Remove `--dry-run` to start the run beneath existing work. `--repo` selects the workflow catalogue; `--target` selects the checkout to inspect and may name a subdirectory, which resolves to that checkout's Git root. Both default to the current directory. Submission uses `BD_ACTOR` unless `--actor ID` is supplied and preserves database selection unless `--db PATH` overrides it. Read `bun .workflows/review/submit.ts --help` for options.

Submission returns JSON with the run ID and active task/request references; it does not wait for reviews. Keep that ID to resume the same run.

## Choose the scope

Paths and glob patterns are relative to the target checkout's Git root, even when `--target` names a subdirectory. `patterns` is optional except for `files`; an omitted or empty filter in a diff scope selects its entire delta. Empty selections fail.

| `scope` | Meaning |
| --- | --- |
| `{ "kind": "files", "patterns": ["docs/**/*.md"] }` | Whole current matching files, including unchanged lines and nonignored untracked files. |
| `{ "kind": "worktree", "base": "main" }` | Combined staged/unstaged changes against the selected base, plus nonignored untracked files. Advisory reviews default to `HEAD`; final gates require an explicit base. |
| `{ "kind": "commit", "ref": "HEAD" }` | Only that commit's delta. Merge commits require an explicit range. |
| `{ "kind": "range", "base": "main", "head": "HEAD", "mergeBase": true }` | Endpoint diff from the endpoints' merge base to the selected head. Omit `mergeBase` or set it to `false` for a direct endpoint comparison. |

Refs resolve once. Deletions and both sides of renames participate in routing. Commit/range reviews read surrounding content at the selected revision; files/worktree reviews inspect the current checkout. Choose a final-gate worktree base that includes the complete candidate, not just its uncommitted edits.

The caller owns concurrent edits and the accuracy of supplied content evidence. This workflow neither isolates the checkout nor detects changes after submission.

## Advisory and final-gate evidence

`purpose.kind` is `advisory` or `final-gate`. Advisory reviews may omit `purpose.spec`; the report then marks Spec `not_requested`.

Final gates require:

- `purpose.spec`: `{ "request": "…", "acceptance": "…", "corrections": [] }`, carrying the originating request, acceptance criteria and any corrections as content or exact references.
- `purpose.bookworm` and `purpose.librarian`: prior approved gate receipts, each with `role` (`bookworm` or `librarian` respectively), `run`, `stage`, `response`, `verdict` (`approved`), `base` and `content`. Include `request` for a managed report; omit it for an independently authored report rather than inventing an ID.

The caller verifies these gates once against native role/request/stage/response provenance and the intended base/content. A report heading or model name does not establish its author's role. Domain workers consume that receipt rather than repeating gate discovery. The helper validates input shape, not the truth or freshness of the receipts.

For callers that already have resolved input, `busybee input-schema review --json` exposes the workflow schema. It differs from the helper's request: supply an absolute `target` and resolved `scope` with `changes`, not `patterns`. Submit it with `busybee run review --parent TASK_ID --owner HUMAN --input-file PREPARED.json --json` from the catalogue, or select it with `--repo CATALOGUE`.

## Coverage and results

The fixed routing in [review.ts](./review.ts) selects:

- **Code:** executable source, scripts, configuration and build/dependency manifests.
- **Tests:** the same routed paths, so production-only edits still receive a coverage audit. Reviewers inspect nearby tests and supplied timing evidence.
- **Docs:** prose files, including guides, skills and agent instructions. This is a correctness audit; Bookworm remains responsible for prose writing and editing, including prose embedded in code.
- **Spec:** the entire selected scope when specification evidence is supplied, independently of Standards.

Unmatched paths remain explicit and make coverage incomplete. Omitted domains create no audit tasks. Filename routing does not automatically identify embedded prose.

Follow the active briefs using `busybee show RUN --json` and `busybee discover RUN --json`; `show --instructions` expands saved instructions. Workers deliver native responses and close their own audit stages. The caller collects closed results with `busybee collect RUN --json`, reads worker answers through `bee result`, and performs the driver-handled synthesis after all selected audits complete. Bee help owns [response delivery](../../docs/agents/responses.md).

The synthesis identifies coverage, exact scope/content and worker request/stage/response IDs, with separate **Standards** and **Spec** sections. Required repairs, suggestions and unverified areas remain distinct. Native outcomes retain a verdict (`clear`, `findings` or `incomplete`) and response ID; the full report lives in the response, not a run-view output field.

A run can finish with findings or incomplete coverage: completion is not approval. Pending or failed workers do not satisfy the join. Overall approval belongs to the caller and requires complete applicable coverage, no outstanding required findings, and—for final gates—Spec and the prior Bookworm/Librarian obligations. Repairs belong to the implementation owner, outside this read-only workflow.
