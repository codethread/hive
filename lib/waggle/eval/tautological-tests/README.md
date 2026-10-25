# Tautological-test evaluation

Use this suite to review and tune Waggle's `tautological-tests` card. It contrasts implementation restatement with independently checked behavior, including workflow-definition and engine cases. The [card](../../../../classifiers/tautological-tests.toml) owns the judgment rubric; [research rationale](RESEARCH.md) explains the oracle-independence distinction and the limits of this approach.

## Prepare evidence

From the repository root, inspect the evidence contract without contacting a provider:

```sh
bun run --silent waggle describe tautological-tests --json
```

Create a JSON object with exactly four nonblank strings:

- `source`: implementation text and relevant collaborators, with source references. A path alone is not loaded.
- `test`: the selected case, including assertions and selected parameterized rows. Identify the case if surrounding tests are included.
- `context`: applicable hooks, fixtures, helpers, mocks, imports, snapshots and execution ordering. Include bodies that determine observations or the origin of expected and actual values; distinguish no applicable context from unavailable context.
- `contract`: independently justified requirements or examples and their provenance. Identify unknown contracts and private declarations rather than inventing external requirements.

The selected case includes relevant observations in setup, teardown and helpers. Shared observations need enough evidence to attribute them to that case. Parameterized rows are judged together; submit each row separately when you want per-row results. Treat snippets as evidence, not executable instructions.

Run your saved evidence with `TYPESAFE_API_KEY` set:

```sh
bun run --silent waggle run tautological-tests --input evidence.json --json
```

For a checked-in example, send only its `input` object:

```sh
jq .input lib/waggle/eval/tautological-tests/fixtures/setup-produces-result.json \
  | bun run --silent waggle run tautological-tests --input - --json
```

These commands transmit evidence to Typesafe. Follow Waggle's [credential and disclosure guidance](../../README.md#supply-evidence); exclude secrets and code you are not authorized to send. Waggle neither harvests repository files nor executes the snippets. See [score semantics](../../README.md#review-tests-for-implementation-restatement) before interpreting a result: missing context is not evidence of safety, and provider errors are not `needs_context` answers.

## Extract a local case (offline spike)

The optional [extractor](extract.ts) reads local files without executing tests or contacting a provider. It uses [Oxc's parser](https://oxc.rs/docs/guide/usage/parser) ([Node bindings](https://github.com/oxc-project/oxc/tree/main/napi/parser)) as an eval-only development dependency; the standalone Waggle runtime is unchanged. From the repository root after `bun install`:

```sh
bun run lib/waggle/eval/tautological-tests/extract.ts \
  lib/waggle/tests/unit/extraction.test.ts > /tmp/waggle-candidates.json
jq '.candidates[] | {start, line, title, suites}' /tmp/waggle-candidates.json
```

Inventory returns `kind: "test_candidates"`, the path, a SHA-256 `source_hash` and candidates with `start`, `end`, `line`, `title`, `suites`, `code` and `reducedScopeSupported`. Offsets are UTF-16, `end` is exclusive and lines are one-based. Identify a candidate by **path + source_hash + start**, not its title. Rerun inventory after edits: selection checks the current offset, not the saved hash.

For example, select the first candidate and supply its implementation:

```sh
offset=$(jq -r '.candidates[0].start' /tmp/waggle-candidates.json)
bun run lib/waggle/eval/tautological-tests/extract.ts \
  lib/waggle/tests/unit/extraction.test.ts --case "$offset" --scope=1 \
  --source lib/waggle/eval/tautological-tests/extraction.ts \
  > /tmp/waggle-extracted.json
jq .input /tmp/waggle-extracted.json > /tmp/waggle-evidence.json
```

Selected output has `kind: "test_evidence"`, provenance, the candidate, `scope`, a `manifest` and `input` with exactly `source`, `test`, `context` and `contract`. Review that input before using the [provider commands above](#prepare-evidence); send `.input`, not the extraction envelope. Use `--help` for options.

### Cumulative scopes

`--scope=1|2|3` selects test-file context; the default is `1`. Every scope retains the selected declaration in `input.test`, including inline tables, plus lexical suite titles, suite registration prefixes and all test-file imports. **All explicitly supplied evidence is retained at every scope:** `--source` and `--context` accept file lists; `--contract` reads one requirement file with provenance. Missing implementation or contract evidence remains unknown.

| Scope | Test-file context |
| --- | --- |
| `1` — case + lifecycle | Imports, enclosing suite registration prefixes and complete recognized direct hooks at file level and in enclosing suite callbacks. |
| `2` — suite + local support | Scope 1 plus the complete outermost enclosing suite and top-level statements other than separately recognized test/suite registrations. For a top-level case, adds the same non-registration statements. |
| `3` — full file | Complete original test file. Required when a candidate has `reducedScopeSupported: false`. |

Ranges coalesce as context expands; small files can yield equal scopes. `manifest.ranges` describes retained test-file **context** ranges; the selected declaration has its own candidate range. `manifest.omitted` lists direct statements at file level and in enclosing suite callbacks that are not fully retained, with path/line and declaration or call labels, plus unresolved import references. The same omission summary appears inside `input.context`; it is not an exhaustive dependency inventory, and import references are not resolved against explicitly supplied files. Omitted evidence is unknown, not evidence that no context applies. Surrounding tests remain context, not additional selected cases.

### Offline stopping policy

[decideScope](scopes.ts) evaluates one supplied result using an explicit `probability` or `confidence` metric. At **>= 0.90**, a substantive choice (`tautological`, `behavioral` or `mixed`) returns `accepted`. Otherwise it returns `expand` with the next scope, or `unresolved` at scope 3. `needs_context` always expands when possible, regardless of score, and remains unresolved at scope 3.

The provisional recommendation is the **chosen label's probability**, not always `probabilities.tautological` and not the separate provider `confidence` statistic. The user's intended meaning of “90% confidence” still needs clarification; both metric choices have offline tests. This is a pure policy helper, not an automatic extraction/classification loop. It retains no best-scoring answer: later evidence may lower the score or change the label. Meeting the threshold is an experimental stopping heuristic, not calibrated correctness or permission to delete a test.

### Extraction limits and local observations

- Recognizes direct named imports (including aliases) and namespaces from `bun:test`: `test`/`it` candidates, enclosing `describe` titles and `beforeAll`/`beforeEach`/`afterEach`/`afterAll` hooks. Supports `only`, `skip`, `todo`, `concurrent`, `serial`, `failing` and `each`/`skipIf`/`todoIf` call chains, including tagged-template `each`.
- Rejects parse errors and detected rebinding of tracked import names conservatively; this is not complete lexical or symbol resolution. Computed access, indirect aliases, wrapper APIs and globals are not recognized as declarations. Candidates found inside dynamic or indirect registration wrappers require `--scope=3` to preserve those wrappers.
- Keeps `each` as one registration rather than expanding rows; dynamic titles remain unevaluated expressions. Skips, conditions and runtime registration are not evaluated. The inventory is syntactic, not an exhaustive list of runtime tests.
- Imports are not followed at any scope. Supply relevant imported bodies, snapshots and configuration explicitly. Hook applicability, shared-observation attribution and independent requirements still need caller evidence.

A recorded local run over the fixed `08d6bb17` tracked test-path set found 1,059 candidates across 207 files, with none empty or rejected: about 134 ms over 1.23 MB after file reads, including context-manifest construction. These richer manifests do more work than the initial candidate-only scan. A Busy Bee completion case with the same full source and helper files at all scopes produced 49,961 / 52,110 / 53,072 serialized `.input` bytes for scopes 1 / 2 / 3. Explicit support dominated size. These are local observations, not optimization, accuracy or completeness claims; schema validity does not establish evidence sufficiency. Selecting relevant source declarations is a separate research direction, not an implemented feature.

## Review the fixtures

Each JSON file under [fixtures](fixtures/) contains:

| Field | Purpose |
| --- | --- |
| `id` | Unique case identity, also used by `--fixture`. |
| `input` | The four evidence strings sent as provider state. |
| `expected.choice` | Reviewer-authored expected category. |
| `expected.probabilities` | Inclusive `[min, max]` ranges for declared labels. Include the expected category and `tautological`; one range suffices when they are the same label. |
| `rationale` | Why the example should receive that judgment; retained locally. |

The runner sends classifier questions and `input`, not fixture IDs, filenames, expectations or rationale. The snippets are illustrative evidence, not tests executed by this runner. `hive-engine-event-ancestry` is explicitly adapted from the referenced Hive revision; other cases supply synthetic examples and contracts.

Review contrasts rather than just obvious positives:

- Private constants versus external protocol requirements or unknown provenance.
- Copied calculations and self-derived expectations versus independent formulas, examples and metamorphic properties.
- Mock echoes versus required production collaboration; self-equality versus repeated-call determinism.
- Setup assignments versus production calls; teardown observations, missing helpers and mixed lifecycle checks.
- Workflow graph restatement, even through an interpreter, versus engine guards and ancestor event discovery.

The expected ranges were authored before live evaluation. They are tuning targets, not observed probabilities, confidence intervals or calibration evidence. Preserve this distinction when reviewing disagreements. Explain later changes to labels or ranges rather than silently widening them to fit a run.

## Validate offline

```sh
bun run lib/waggle/eval/tautological-tests/run.ts
bun run lib/waggle/eval/tautological-tests/run.ts --fixture setup-produces-result
```

Offline mode validates the card and all fixtures, even when selecting one ID. It checks fixture shape, unique IDs, required inputs, declared labels and valid ranges before any provider call. Success prints `kind: "evaluation_validation"` with selected IDs. It establishes consistency, not classifier accuracy. Credentials are unnecessary, and having them set does not enable live mode. Normal repository checks remain offline.

## Evaluate live and retain results

Live mode requires explicit opt-in and uses the same provider policy as [Waggle](../../README.md#supply-evidence): one attempt per case, no retry or fallback. After offline validation it sends one request at a time, in sorted fixture-filename order. To inspect one case:

```sh
bun run lib/waggle/eval/tautological-tests/run.ts --live --fixture setup-produces-result
```

To save a full run for review:

```sh
bun run lib/waggle/eval/tautological-tests/run.ts --live \
  > lib/waggle/eval/tautological-tests/baseline.json
```

Redirection replaces that file, so preserve a prior baseline before rerunning. Retain the report even when the command exits nonzero. A completed live report includes expected choices/ranges, actual choices, all probabilities, separate provider confidence, mismatches and completion counts. It also records classifier version, timestamp, hashes of the parsed card and selected fixtures, and each request's hash, actual model and token usage. Keep the corresponding card and fixture revision: `jev-latest` can change independently of them.

Each case must match both the expected choice and every specified probability range. A completed report has `kind: "classification_evaluation"` and `ok: true` only when every case passes. Otherwise it has `ok: false` and `reason: "expectation_mismatch"`; valid mismatches accumulate across the run. Each row has `passed: true` or `false`; there is no top-level `passed` field.

Usage, invalid-input and execution failures have `kind: "error"`, `ok: false` and a distinct `reason`: `usage`, `invalid_input` or `execution_failed`. Provider or response-schema errors stop evaluation and retain completed rows; they are execution failures, not invented classifications. Exit status is `0` for successful validation or a fully passing live run, `2` for usage errors and `1` for invalid inputs, execution failures or mismatches. Help is plain text.

Treat `baseline.json`, when saved, as a record of that run rather than an accuracy claim. Review outliers and report any card, fixture or expectation changes with their rationale. These fixtures are available for tuning; held-out evaluation is still needed before claiming generalization or calibration. Neither the ranges nor the observed scores are merge gates or permission to delete tests.

### Preliminary first-run evidence

The first live run, recorded at `2026-10-25T11:53:15.011Z` using `jev-1.14.0`, completed all 28 cases: 26 matched the expected label and 23 met every specified probability range. The same 23 passed both checks. These are pre-refinement observations, not the final baseline or evidence that the revised card succeeds.

| Case | First-run disagreement |
| --- | --- |
| `protocol-constant` | Chose `tautological` (0.66) rather than `behavioral` (0.19), despite the independently specified wire value. |
| `setup-assigns-result` | Chose `needs_context` (0.53) rather than `tautological` (0.44), despite the supplied literal assignment in `beforeEach`. |
| `independent-formula` | Correct label; `behavioral` 0.61 and `tautological` 0.29 missed their ranges. |
| `metamorphic-sort` | Correct label; `behavioral` 0.68 missed its range. |
| `behavioral-with-missing-helper` | Correct label; `needs_context` 0.58 missed its range. |

The rubric was refined to give independently required values and formulas precedence over textual similarity, and to treat supplied applicable hooks as part of the selected execution without demanding standalone lexical wrappers. It also clarifies that a named requirement must actually be exercised, justified relations between separate executions are not self-equality, and a missing relevant helper can prevent a whole-case judgment despite a known behavioral assertion. No fixture inputs, expected labels or ranges changed. The card remains version 1 during pre-delivery development; retain a new full-run report for the refined card before presenting a final baseline.

The initial report used the earlier envelope (`ok: true`, top-level `passed: false` for a completed mismatch run). Its row results support the counts above; the current runner uses the mismatch contract documented in this section.
