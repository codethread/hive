# Authorized lifecycle test removal

ct rejected the final lifecycle timing-allowance inventory: **65 historical IDs / 131 runtime cases**, including measurements at or below 1ms. Closed task `hv-00pk4.15` records that rejection; removal scope `hv-00pk4.22` and Librarian response `hv-ja7h74` in evidence thread `hv-e8i94.1.3.2` retain the accepted correction. The narrowed delivery `hv-00pk4.27` preserves it.

The [historical manifest](./lifecycle-slow-test-removal.json) is unchanged from the preserved lifecycle-refresh candidate. Its comparison is feature commit `937c48ae486eb503a6927a9a8b26d7b096d5c6a1` (tree `2cdb018388746d8430941fe95cd54910c4e7cb74`) to uncommitted removal tree `ecf721a6636e5d83e28776aa175152d287be2ce2`. It records 62 declarations across 24 files; four classification IDs share one template. That historical removal deleted seven whole test files, two dead support modules and 65 timing entries, retaining 69 baseline entries and the then-current 1/5/1000ms cutoffs. These are historical counts, not the current-main policy or deletion totals below.

This deliberately removes automated regression protection. A green remaining suite does not establish equivalent coverage. Historical passing reports apply only to their recorded revisions; the rejection adds no substitute manual acceptance campaign or permission to restore the scenarios under new names.

## Material coverage lost

The manifest retains every original runtime row and declaration mapping, including checks for features excluded from the narrowed implementation:

| Area | Removed checks |
| --- | --- |
| Busy Bee lifecycle and inspection | Native closure classification, uncertain/refused final closure, offline schemas, source-independent inspection, frozen instructions and effect-free checkpoint reads. |
| Busy Bee completion and settlement | Persistence barriers, native close refusal/retry, payload validation, retirement races/fencing, completed-evidence preservation and reservations. Historical workflow acknowledgment/replacement checks are also removed; those features are outside current scope. |
| Joined native transport | Authored rejection completing successfully after retry; cancellation preserving completed visits; failure and replacement provenance surviving independent tracker export/import. These were single-host database-exchange checks with injected clearance, not second-host or live-daemon proof. |
| Colony authority and execution | Clearance history and ownership, an owned process surviving request closure, admission races, claim boundaries, receipt restoration and reconciliation across exit/finish/native outcomes. |
| Colony workflow consumers | Routing, launch classification, parent/endpoint forwarding, workflow submission and cancellation resumption. Historical Nurse and work-review checks remain absent with their retired consumers. |
| Hive UI and Shared | Terminal lifecycle presentation, inspection with unavailable diagram source, simulation HTTP dispatch and malformed tagged-fact rejection. |
| Feature and Land workflows | Feature-delivery sequence, review dispatch/collection/revisit and post-run source-completion matrices. These chart checks performed no real checks, reviews, merges or publication. |

The earlier timing-heavy cohort in the [Busy Bee coverage record](./busybee.md) is separate. Source pointers in either record retain evidence; they do not override the later rejection where declarations overlap.

## Historical evidence conventions

Use `git show <baseCommit>:<beforePath>` with the manifest's values to inspect complete declarations, parameter tables, fixtures, helpers and timing justifications. Source recovery is not authorization to restore tests.

- `caseNames` retains every reported runtime row in order, including duplicate names and literal placeholders. `caseCount` counts rows, not distinct names.
- Declaration offsets are zero-based and end-exclusive; lines are one-based and inclusive. SHA-256 hashes cover the exact statement, excluding preceding comments; file hashes cover all bytes. Null after paths/hashes denote deleted files, and removed declarations have null `afterDeclaration`.
- Four IDs map to the same `test.each(reasons)` declaration; unique ranges recover the 62-declaration count.
- All 59 retained declarations matched structurally in the original removal. `tokenSha256` preserves its token comparison; `structuralSha256` hashes the Oxc 0.127.0 syntax tree without location/raw-spelling fields. These are not current-tree equivalence proofs.
- The manifest preserves the final timing packet SHA-256 `1248fe104ace82c65f03966ad0a8672b3ddb40df69a977d2f7eb012650c71914`, both preparatory artifact hashes, deleted support modules/symbols and the historical work-review helper narrowing.

## Current-main refresh

### Original narrowed comparison (main 88e0ff8)

The earlier `hv-00pk4.23` refresh onto `cd49481ae1b464e44aa9ed0b76056ce4ca8eb2ad` remains historical evidence in its preserved worktree. Its broader feature surface and comparison are not the narrowed candidate's contract.

The [original narrowed identity remap](./workflow-outcomes-removal.json) compares main `88e0ff856341ef2bbe152230435c35e73c2b422f` with narrowed implementation tree `0673dbc6872835a2ed8193a8fb3bb6967d1e5f31`, frozen by worker response `hv-c9fx0h` before the original prose pass. This comparison remains historical evidence; the later refresh is recorded below. It records:

- **29 surviving current-main declarations removed**, corresponding to 29 historical IDs / 59 historical runtime cases.
- **36 historical IDs / 33 declarations already absent** on that main base.
- No exact-normalized removed declaration remaining in the worker's comparison. The remap retains current declaration source/ranges/hashes, original registrations, case counts and explicit wording/table mappings. Exact base-source verification corrected supplied ranges for historical `#test-103`, `#test-304` and `#test-305`; each `rangeCorrection` retains the supplied values, with declaration text/hashes unchanged. It is an identity audit, not an expanded current-runtime case census or equivalent-coverage proof.
- In that comparison, the now-empty `lib/colony/src/request-recovery.test.ts` removed in full, with dead supporting code removed alongside the mapped declarations.

Main reused the historical numeric IDs for unrelated allowances. Identity follows the original path, declaration/template and cases, never a global numeric-marker match. Historical `#test-110` became main `#test-450`; historical `#test-306` became main `#test-605`. The manifest and remap preserve both identities.

Main's `lib/tooling/slow-tests.json` remains byte-for-byte unchanged: blob `5b4ff46f04ae2d0f1d2b351d5df3b80a169f1ec0`, **622 entries**. Policy remains strict changed-test cutoffs of 1.5/10/1000ms, a 1.25 full/contract buffer and a 5000ms timeout. Removed source markers do not authorize registry cleanup or new allowances. Nurse, work-review, post-run assessments and inactivity Drone stay retired; newer startup/recovery, human-assignment and `busybee-workflow` classification behavior stays intact.

### Historical refresh on main 981e1b9

Worker response `hv-onow7a` records the refresh onto main `981e1b900ff57e3b41696bc1e768040fe71b66c7`, frozen as uncommitted code tree `e30f3e3b9d7b849af121f622b37eb362deff0dc8` before this evidence update. Its predecessor was the original combined implementation/prose tree `5f2cd1a5e4d23dc4c8476f26f4d8775198cbd4ad`. The remap's appended `refreshComparisons` entry retains this separate comparison, exact declaration ranges/hashes and proof SHA-256 `823163e605f425ecb1d34a21d43496e52befaa567e82592e3ae904ed530c0bd5`; the original base, mappings, range corrections and whole-file-deletion receipt remain unchanged.

At that snapshot, `lib/colony/src/request-recovery.test.ts` retained **four new main declarations / seven runtime cases**: unordered shared native batching, incomplete-batch refusal, native cancellation before a claim, and four-way native authority drift (host, identity, assignment and tasks). Three declarations are byte-identical to main. The batching declaration adds the actual admission gate to its dispatch fixture; every assertion is unchanged. Only the exact historical `#test-100` / `#test-104` declarations (main markers `#test-519` / `#test-344`) and their exclusively dead fixture support are removed from this file. The earlier whole-file deletion is not the refreshed candidate's state.

The immutable manifest still records **65 IDs / 131 cases / 62 declarations**, SHA-256 `cc471b03bca23718d60ef436e2f357f663a3b04e4e17da80745c913489ebe64e`. Exact marker/whitespace-normalized checks found no surviving original or remapped rejected declarations. The bounded eight-file refresh also preserves main's observations implementation/tests and Shared spawn-request tests; registry and timing-policy blobs remain unchanged. This is declaration-identity and refresh-delta evidence, not semantic replacement-coverage proof. The refresh introduces no new public command/help/contract behavior.

The refresh worker reports 111 passing affected tests plus 42 passing Busy Bee tests, four package typechecks and focused lint/format checks. Those results apply to the recorded code tree, not the final combined candidate or its normal changed/full gates.

### Initial comparison on main 5f8727d4

ct's subsequent instruction, “Delete any slow tests that fail timings,” authorizes the additional removals in `hv-00pk4.27.11`, including otherwise unrelated cases. It supersedes the earlier restriction on unrelated deletions: these measured cases were deleted, not optimized or replaced. This is a separate authorization from the historical 65-ID / 131-case rejection.

The implementation was refreshed onto main `5f8727d418a00f6b31eea8f7ef968d13e91b89d5`. The prior combined tree `067915bb9b7bc56e915f70899ea2d84399e5af56` remains preserved; the post-refresh, pre-deletion tree is `96e2b3c9ed87ecdb590f96dfd88391043d3dd42b`. The remap's appended `currentMainEvidence` records the post-deletion comparison tree, source hashes, removed source and **12 distinct cases across 11 files, supported by 16 timing-failure receipts**. It preserves the original 88e0ff8 and 981e1b9 comparisons rather than relabelling them as current.

| Area | Additional coverage lost |
| --- | --- |
| Busy Bee: six cases | Missing-manifest and missing-file restoration errors; structural preview without instruction rendering; pending-replacement collection and terminal failure; native closure read-before-write/idempotence; managed-exposure stamping before request effects. The sole managed-exposure test file is removed in full. |
| Colony: two cases | Refusal of missing/malformed captured workflow authority in checkpoint decoding; one shared native detail batch per reconciliation pass, including unordered results and preserved checkpoints. |
| Hive UI: four cases | Non-overlapping refresh after settled reads; refusal to open an ancestor workflow through an ordinary child; visible discovery failure on a wrong response kind; simulation endpoint selection and replay as one JSON argument. |

`lib/colony/src/request-recovery.test.ts` retains **three declarations / six runtime cases**: incomplete-batch refusal, native cancellation before a claim, and four native-authority drift rows (host, identity, assignment and tasks). The shared-batch case retained in the 981e1b9 snapshot is now removed. Unfailed table rows remain, and no replacement cases were added. The immutable historical manifest, timing registry, thresholds, defaults and timeouts remain unchanged.

The receipts identify earlier normal-gate timing failures, not passing checks on this comparison tree. Source ranges in the new evidence are one-based and end-exclusive in each immediate pre-removal file; successive row removals can therefore use different file hashes. The retained source and receipt hashes permit verification without treating machine-local receipt paths as portable repository links.

### Current comparison after two further timing removals

The next `currentMainEvidence` entry records code tree `aa312eb24b4883c0f3569d858a5e290c265515fd` on the same main base, before this prose correction. The earlier 12-case comparison and embedded first batch remain unchanged. The cumulative additional removal is now **14 distinct cases across 12 files, supported by 18 timing-failure receipts**: six Busy Bee, three Colony and five Hive UI cases.

The changed-test gate on prior combined tree `05370b5685962c20e334361a87cef4dd1c02f447` failed two more timings. Under the same deletion instruction, the caller removed:

- Hive UI's remaining simulation-adapter case (**3.562ms**): preserving the CLI failure as the error's cause and rejecting malformed success. `lib/hive-ui/server/workflow.test.ts` is now deleted in full; its endpoint/replay case was removed in the first batch.
- Colony's diagnostic-read row with **zero unrelated historical requests (2.446ms)**. Only that row was removed. The 1000-request row, both fixtures and the remaining inspection tests are retained.

The full normal `bun run check` passed on the **prior** combined tree: 1786 passing tests, no failures and 6124 assertions, with formatting, lint, typechecks and timing green. That does not waive the changed-test failure or verify this newer content. After the two deletions, the focused inspection run passed 13 tests with no failures and 38 assertions. The new combined normal gates remain pending with the caller; these records add no replacements, allowances or manual acceptance campaign.

## Remaining coverage and verification limits

Retained tests establish only their own assertions. The new outcome-label projection test remains; the managed-exposure test does not. Neither the remaining suite nor these deletion records establish equivalent coverage for either removed cohort. Native multi-host, transport, retirement-race and UI campaigns have not been recreated as tests or manual gates.

The original implementation handoff reported focused assertions, typechecks, lint and formatting passing, but its changed-test gate failed timing limits. Neither that historical result nor the refresh-focused passes establish final combined-candidate verification or release approval. Complete checks, independent reviews, source acceptance, landing and release remain with their respective owners.

## Frozen candidate and timing waiver — 2026-10-21

This final snapshot supersedes the earlier sections' **current-coverage** claims, not their historical evidence. On base `5f8727d418a00f6b31eea8f7ef968d13e91b89d5`, pre-prose tree `76b5bab09fae7d49fc17c313d10db8cbfa01fb5d` contains **220 additional distinct runtime-case removals / 225 timing receipts / 63 paths**. These are separate from the rejected 65-ID / 131-case cohort. The remap's appended `finalCandidateEvidence` preserves the full cumulative inventory, source snapshots, runtime-count audit and current file hashes; older 88e0ff8, 981e1b9 and 5f comparisons remain unchanged.

| Package | Cases | Additional coverage lost includes |
| --- | --: | --- |
| Colony | 94 | Request authority, reconciliation, running publication, daemon recovery, process refusal and response inspection. |
| Busy Bee | 40 | Restoration, completion/collection, publication failures, simulation and Land navigation. |
| Hive UI | 32 | Polling, annotation freshness, graph/hierarchy reads, discovery and simulation transport. |
| Beeswax | 23 | Tracker bootstrap, alert publication/clearance, onboarding and hook behavior. |
| Shared | 19 | Conflict recognition, managed-exposure proof and outcome-index rows. |
| Waggle | 5 | Catalogue discovery, provider results and evidence validation. |
| Honeycomb | 4 | Offline defaults and local configuration inheritance/setup. |
| Tooling | 2 | Strict timing-boundary classification and invalid allowance configuration. |
| Beads | 1 | Effect-free tracker sync-status inspection. |

`request-recovery.test.ts` is now absent. The outcome-index terminal table retains only **cancelled**, not succeeded/failed; other retained rows cover pending/unclassified indexing and one mismatched-id exposure rejection. Driver response targeting and collection remain asserted, but the cancellation-to-result case does not. Land's test file retains only invalid-input rejection before publication, not saved-state/navigation checks. Generated-table predicates retain unremoved siblings; the remap records the checked final selections. None of this is equivalent coverage or substitute manual acceptance. No public feature semantics changed during these deletion loops; registry and runtime timing-policy bytes remain unchanged.

**Historical discrepancy:** gate48 ran 1601 ordinary cases rather than the expected 1602 because the preceding missing-row extraction accidentally also deleted the unmeasured “a new seed awaiting export does not hide families already in the stale graph” case. That declaration was restored byte-for-byte from tree `f8412312c5102ecc94d4741c4eb44829f35ad5ca` before subsequent runs and remains present. The inventory retains the extraction correction and prior-manifest hash; gate48's receipt candidate differs from its corrected pre-removal tree. Later counts again match the 1798-case baseline minus measured removals, including 1596 after 202 and 1578 after 220. Counts are not coverage-equivalence proof.

The 220 source mappings and 225 receipt rows were checked against actual snapshot/blob/snippet hashes, ranges, offsets, receipt lines and durations. Machine-local provenance remains explicit in the JSON; 617 supplied manifest, source and gate files also match root's local archive at `/Users/ct/.local/state/hive/recovery/workflow-outcomes-20261020-01a15aba/landing-waiver-20261021/`. This is local retention, not remote publication.

**Verification limit:** normal full-only check58 passed on that pre-prose tree: 1578 ordinary tests and two native contract tests, zero failures, with unchanged before/after tree and patch. It is historical evidence, not a final combined changed/full approval. Earlier prose reports `hv-jmbbsc` and `hv-enlhe3` likewise do not approve this candidate.

**Latest authorization:** on 2026-10-21, ct instructed, “just land it, ignore test timeouts.” This supersedes the earlier timing-green/deletion-loop instructions. The 220 removals stay frozen; root `amaranth-sound-haddock` owns final ordinary checks and an explicit **timing-only waiver**, not a waiver of assertion, type, lint or formatting failures. This report makes no further executable edits or full-suite runs. Final reviews, source acceptance, landing and release remain with their owners.

## Integration comparison on main 98d74de6 — 2026-10-21

Main advanced from `5f8727d418a00f6b31eea8f7ef968d13e91b89d5` to `98d74de68f87b42bd834f6de6db08465056cd033` during review. The remap's appended `main98IntegrationComparison` records the bounded comparison, preserved prior candidate `2a8e639407f255afde50a6a8d3281e21a5dd0c51`, recovery references and review provenance. Earlier counts and coverage descriptions remain historical, including the gate48 correction; they are not a census of this combined candidate.

The production integration checks the native anchor and settles unsuccessful outcomes before either deferred-cohort return or ordinary running publication. Incoming cohort/receipt/local-recheck/fallback/history behavior is retained; `observations.ts` and `colony.ts` match main98. The three unchanged incoming publication/batch test files passed 54 tests / 262 expectations in `/tmp/workflow-outcomes-main98-new-tests.log`. This is focused evidence, not combined acceptance or CPU measurement. Source4 is integrated, not uncommitted work.

Prior `final-gates-1` logs in the local `landing-waiver-20261021` archive record passing formatting/lint/types and 1578+2 tests on the 5f candidate. Changed/full exits were 1 for timing-only failures: waived under ct's latest instruction, **not green**. Those checks and the prior Reviewer/Architect approvals do not approve the new combination. Worker `hv-fg7fbi` / `hv-00pk4.27.17` owns four test-conflict resolutions; this prose pass does not certify them. Root owns final combined conflict-resolution/case-preservation verification, fresh checks and targeted review after both reports, without another timing-reroll/deletion loop. No final tree/count, replacement-coverage, CPU or service-health claim is made. Coordinated matching-version adoption, enclosing Release and main5f's missing top-level changelog record remain separate.
