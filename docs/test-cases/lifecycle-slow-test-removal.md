# Authorized lifecycle test removal

ct rejected the final lifecycle timing-allowance inventory and authorized removal of its **65 IDs and 131 runtime cases** in `hv-00pk4.22`. The instruction covered every mapped test, including cases whose latest measurement was at or below 1ms. It superseded earlier advice to retain joined native proofs. Librarian response `hv-ja7h74` records the accepted correction in architecture evidence `hv-e8i94.1.3.2`.

The [removal manifest](./lifecycle-slow-test-removal.json) preserves the **historical** before/after inventory from feature commit `937c48ae486eb503a6927a9a8b26d7b096d5c6a1` to uncommitted removal tree `ecf721a6636e5d83e28776aa175152d287be2ce2`. It records 62 test or parameterized-template declarations across 24 files; four classification IDs share one template. That removal deleted seven whole test files, two dead support modules and 65 timing entries, retaining the original 69 baseline entries and 1/5/1000ms cutoffs without production/API changes. These counts and hashes do not describe the [current-main refresh](#current-main-refresh).

This deliberately removes automated regression protection. Joined native transport, independent tracker exchange, owned-process clearance/recovery and workflow continuity checks in this cohort are no longer present. Historical passing reports remain evidence about their recorded revisions. A green remaining suite does not establish equivalent coverage of the removed behavior. The deletion authorization adds no substitute manual acceptance gate.

## Material coverage lost

The manifest preserves each runtime case name and maps its original declaration. The principal losses are:

| Area | Removed checks |
| --- | --- |
| Busy Bee lifecycle and inspection | Native closure classification, uncertain or refused final closure, offline schema discovery, source-independent lifecycle/diagram inspection, frozen instruction projection and checkpoint reads without effects. |
| Busy Bee completion and settlement | Persistence barriers, native close refusal and identical retry, payload/result validation, retirement races and publication fencing, completed-evidence preservation, reservations, acknowledgment and replacement. |
| Joined native transport | Authored rejection completing successfully after refusal/retry; cancellation preserving completed visits and replacement provenance; failure retaining acknowledgment and supersession through export/import to an independent database without source. These were single-host database-exchange tests with injected clearance, not second-host or live-daemon proof. |
| Colony authority and execution | Clearance history and ownership checks, a real owned process surviving native request closure until exit, admission races, captured claim boundaries, receipt-authority restoration and request reconciliation across exit/finish/native outcomes. |
| Colony workflow consumers | Routing and launch classification, parent/endpoint forwarding, workflow submission, cancellation resumption and its refusal matrix. The historical cohort also covered Nurse batch retention and work-review disposition; main has since retired those consumers. |
| Hive UI and Shared | Visible terminal lifecycle/follow-up combinations, public inspection with unavailable diagram source, successful simulation HTTP dispatch, and malformed tagged native fact rejection. |
| Feature and Land workflows | The feature-delivery stage sequence, Land review dispatch/collection/revisit and post-run source-completion matrices. These chart tests did not perform real checks, reviews, merges or publication. |

The earlier `#test-73`, `#test-82` and `#test-83` removals are outside this cohort. Their scenarios and failed timing history remain in the [Busy Bee coverage record](./busybee.md#lifecycle-and-settlement-transport). The later `#test-300`–`#test-302` replacements are part of this removal.

## Evidence and source recovery

The before revision is `937c48ae486eb503a6927a9a8b26d7b096d5c6a1`, tree `2cdb018388746d8430941fe95cd54910c4e7cb74`. Read an original file with `git show <baseCommit>:<beforePath>` using values from the manifest. That revision retains complete declarations, parameter tables, fixtures, helpers and the original timing justifications. These source pointers preserve history; they are not instructions to restore the rejected tests.

The immutable `final-timing-inventory.json` has SHA-256 `1248fe104ace82c65f03966ad0a8672b3ddb40df69a977d2f7eb012650c71914`. It and the preparatory reports remain in the source task's evidence archive. The repository manifest derives from `removal-before-manifest.json` and `removal-verified-manifest.json`, identifies both artifact hashes, and supplements their mappings from the pinned before/after trees. Its `inventoryScope` identifies that historical comparison; the original mappings and prior failure reports remain unchanged.

Manifest conventions:

- `caseNames` retains every recorded runtime row in order, including duplicate names and literal placeholders in the original report. `caseCount` counts rows, not distinct names.
- `beforePath` and `afterPath` identify file locations; a null after path/hash denotes a deleted file. A removed test has a null `afterDeclaration`, even when its file survives.
- Declaration offsets are zero-based, end-exclusive source-string offsets; line numbers are one-based and inclusive. Declaration SHA-256 hashes cover the exact statement, excluding preceding comments. File hashes cover all bytes.
- Four classification IDs refer to the same `test.each(reasons)` declaration. Their marker locations identify the individual table rows. Count unique declaration ranges to recover 62 removals.
- Each retained declaration has before/after ranges, hashes and registration text. `tokenSha256` preserves the supplied token-equivalence proof; `structuralSha256` independently hashes the Oxc 0.127.0 syntax tree with location and raw-spelling fields omitted. All 59 retained declarations matched structurally in the original removal, with no additional declaration in those affected files.

The support inventory includes deleted `lifecycle-transport-support.ts` and `owned-execution.test-support.ts`, plus the now-unused `writeDefinition` helper and its import-string constant in Busy Bee's `support.ts`. `useNativeFixture`, `captureCli` and `invoke` retain callers. Colony's runtime process API remains present.

Removing historical `#test-311` also left its five-row `scenarios` table, derived `Outcome` type and private `nativeState` branches for pending/unclassified outcomes unused. Those were pruned in tree `ecf721a6`; the helper then accepted only `"succeeded"`, retaining its sole call and successful return statement. The manifest records that narrowing separately from deleted symbols. The current-main refresh removes this remaining work-review file with its retired consumer.

## Current-main refresh

Refresh task `hv-00pk4.23` reapplied the feature and removal onto main `cd49481ae1b464e44aa9ed0b76056ce4ca8eb2ad`. Code-worker response `hv-j187td` freezes the executable candidate at tree `002130c8a9d8267e405646c3bcd569a7861fae6b`, before prose reconciliation. This is an uncommitted candidate, not delivery or acceptance proof.

Main commits `7b2e0273` and `b5152564` retired Nurse, work-review, post-run assessments and inactivity Drone. The refresh preserves those deletions, including the remaining `work-review-lifecycle.test.ts` declaration and its private helper. Ordinary workflow lifecycle, admission, claims, retries and execution settlement remain feature scope.

The refresh retains main's `lib/tooling/slow-tests.json` byte-for-byte: blob `5b4ff46f04ae2d0f1d2b351d5df3b80a169f1ec0`, **622 entries**, 1.5/10/1000ms cutoffs. Main's runner uses strict changed-test cutoffs, multiplies full/contract cutoffs by 1.25 and retains the 5000ms test timeout. Every unapproved timing severity fails its gate. These are incoming main policy, not new allowances.

All 65 historical numeric IDs were reused on main for unrelated allowances. The deletion identity is the manifest's original path, declaration/template and cases, never a global numeric-ID match. For example, historical `#test-110`'s persistence barrier became main `#test-450`, and historical `#test-306`'s feature flow became main `#test-605`. Those rejected declarations remain absent; the unrelated main allowances that reused the historical numbers remain intact.

The worker's bounded token comparison reports the declarations behind all 65 historical entries absent and 58 of the original 59 retained declarations equivalent after ignoring timing markers, comments, whitespace, literal-concatenation boundaries and optional trailing commas. The remaining declaration is the retired work-review check. This is not a new AST or expanded-case census. Main's surviving timing markers change literal hashes and ranges, so the manifest's historical file/declaration hashes are not current-tree equivalence proof.

### Newly orphaned main timing mappings

At the code-freeze tree, these 25 main registry IDs have lost their source markers. The comparison scans tracked TypeScript sources on main and the candidate, excluding documentation and registry text. Surviving renamed declarations retain main markers `423`, `492`, `502`, `550`, `556` and `607`.

| Main source                                          | Newly absent marker numbers (`#test-`) |
| ---------------------------------------------------- | -------------------------------------- |
| `lib/busybee/tests/integration/completion.test.ts`   | 370, 396, 404, 433, 450                |
| `lib/busybee/tests/integration/feature-task.test.ts` | 605                                    |
| `lib/busybee/tests/integration/inspection.test.ts`   | 330, 422                               |
| `lib/busybee/tests/integration/land.test.ts`         | 368, 393, 521, 633                     |
| `lib/colony/src/claims.test.ts`                      | 558, 559, 563                          |
| `lib/colony/src/host-routing.test.ts`                | 361, 400                               |
| `lib/colony/src/producer.test.ts`                    | 412, 429, 545                          |
| `lib/colony/src/request-recovery.test.ts`            | 344, 519                               |
| `lib/colony/src/workflow-submission.test.ts`         | 424                                    |
| `lib/colony/src/workflows.test.ts`                   | 334                                    |
| `lib/hive-ui/server/api.test.ts`                     | 430                                    |

These are separate from the historical 65-ID inventory. Their registry entries remain unchanged under the refresh scope; this list grants no registry cleanup, test restoration or additional deletion authority.

## Remaining coverage

The manifest lists retained tests at the original removal tree; counts are declarations, so parameterized runtime totals can differ. In the refresh, Busy Bee's [native tests](../../lib/busybee/tests/integration/native.test.ts) still cover repository tracker selection, offline schema discovery and executable JSON errors. Retained completion checks cover failed publication, key-reordered original input and human reservations. Retained Feature and Land tests exercise narrower chart branches, while Colony and Hive UI retain selected refusal and pending/unclassified cases. These checks cover their own assertions, not the deleted joined scenarios.

Syntax and inventory comparisons establish the removal's boundaries. Final focused, changed-suite and full-check results belong to the implementation owner's delivery evidence; this historical coverage record does not itself assert a passing quality gate.
