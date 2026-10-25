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

### Retained Codex comparison (2026-10-25)

The [comparison artifact](codex-comparison-2026-10-25.json) records 61 completed `codex exec` calls: Luna 28, Sol 5 and Astra 28, all with low reasoning effort. They received the same questions and evidence state as JEV, with fixture expectations withheld. Calls used an ephemeral session in an isolated empty directory, without tools, user configuration, plugins, hooks or host skills. Codex still added roughly 9,000 model-specific harness tokens per call. JEV results come from the earlier saved [baseline](baseline.json), not a concurrent rerun.

Label matches were **JEV 28/28, Luna 26/28, Sol 5/5 and Astra 28/28**. Luna missed `mixed-assertions` and `setup-assigns-result`. Label agreement is separate from meeting every expected probability range: JEV met those ranges on 23/28 cases. Sol's coverage is incomplete: its first `independent-formula` attempt timed out after 180 seconds without saved usage; the retry received HTTP 429 with a 281-second backoff and was stopped.

Costs below compare only the **same five completed fixtures** across all four models, not their unequal full-run totals:

| Model                 | Estimated USD for the common five |
| --------------------- | --------------------------------: |
| JEV (`jev-1.14.0`)    |                        0.00028266 |
| Luna (`gpt-6-luna`)   |                         0.0051972 |
| Sol (`gpt-6.1-sol`)   |                         0.0906052 |
| Astra (`gpt-6-astra`) |                           0.55157 |

These are standard API-equivalent estimates from reported token usage, including observed caching and Codex harness overhead, not Codex subscription charges. The artifact retains fixture IDs, pricing sources and rates. Unknown usage from Sol's interrupted attempts and agent evidence-preparation/orchestration costs are excluded.

This small development-fixture comparison supports JEV as a low-cost review aid for supplied evidence, not a universal deletion gate or mandatory agent workflow. LLM probabilities are generated estimates; label matches and range checks establish neither calibration nor generalization to held-out tests.
