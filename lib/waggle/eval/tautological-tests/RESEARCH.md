# Tautological-test classifier: research rationale

Research reviewed on 2026-10-25 for contributors evaluating the classifier and its fixtures. The target is tests that merely restate implementation, especially workflow-definition constants—not workflow-engine behavior tests as a category.

## Retrieved findings

| Source | What it establishes | Relevance and limit |
| --- | --- | --- |
| [TestSmellDetector](https://github.com/TestSmells/TestSmellDetector) and its [Redundant Assertion example](https://testsmells.org/pages/testsmellexamples.html#RedundantAssertion) | A Java/JUnit smell detector reports boolean findings or counts. The example compares the literal `true` with itself. | Useful obvious-positive cases, but not a drop-in context-aware Waggle scorer. |
| [Trail of Bits property-test review guidance](https://github.com/trailofbits/skills/blob/main/plugins/property-based-testing/skills/property-based-testing/references/reviewing.md) | Separates tautology, vacuity and reimplementation. Repeated calls can test determinism when the function is not obviously pure. | Similar-looking assertions need different judgments; comparison syntax alone is insufficient. |
| [Barr et al., _The Oracle Problem in Software Testing: A Survey_](https://discovery.ucl.ac.uk/id/eprint/1471263/) | Distinguishes desired correctness from observed behavior; surveys specifications, contracts and metamorphic testing as oracle sources. | Supports examining where expectations come from, not just whether code ran. |
| [Stryker mutation-testing documentation](https://stryker-mutator.io/docs/) | Mutates production code and runs tests to determine which mutants they detect. | Measures sensitivity to implementation changes, a different question from oracle independence. |

These sources supply examples and distinctions, not validation of this classifier's accuracy. In particular, the requested scope is broader than strict logical tautology: copied constants or calculations can fail when implementation changes, yet still offer only a restatement of it. Vacuity is a separate problem, not a synonym.

## Design inference and reuse decision

Reuse Waggle's existing choice runner with a repository-owned semantic card; add no parser or mutation-testing dependency. The surveyed approaches informed the criteria, but this research did not identify a drop-in scorer for the requested context-sensitive judgment. That is a bounded search result, not a claim that no such tool exists.

Our inference: mutation score alone cannot establish independent behavioral value. A test copying a workflow's local constant can kill a mutant that changes that constant without explaining why the original value was correct. Conversely, a literal expected value or a formula can encode an independent protocol or domain contract. Similarity is evidence to investigate, not sufficient proof of redundancy.

## Evaluation implications

The fixture suite should contrast:

- **Restatement:** literal self-comparison, expected values derived from the implementation, copied calculations and workflow-definition shape checks.
- **Independent behavior:** engine guards and transitions, boundary validation, contract-backed constants/examples, metamorphic properties and meaningful repeated-call determinism.
- **Context-sensitive cases:** mock echoes versus collaboration checks; setup that assigns an expected result versus setup that invokes production behavior; assertions in teardown or helpers; parameterized cases and mixed meaningful/redundant assertions.
- **Missing evidence:** unavailable helpers, setup or contract provenance should prompt more context rather than a confident adverse judgment.

Running a definition through an interpreter does not by itself establish independent value; what the assertions constrain matters. Equally, testing engine behavior using a definition is not inherently restatement.

## Probability and calibration

Expected probability ranges are reviewer-authored tuning targets, not observed results, confidence intervals or empirical accuracy claims. Record actual runs separately, inspect disagreements and evaluate held-out examples before claiming calibration; fitting these fixtures alone would not establish generalization.

Waggle already returns per-choice probabilities and a separate provider `confidence` statistic; neither is a demonstrated correctness rate. See the [output contract](../../README.md#output-and-failures) and [response validation](../../src/classifiers.ts). Keep the signal advisory: it supports test review, not automatic deletion or a judgment of the entire suite.
