# Authorized lifecycle test removal

ct rejected the final lifecycle timing-allowance inventory and authorized removal of its **65 IDs and 131 runtime cases** in `hv-00pk4.22`. The instruction covered every mapped test, including cases whose latest measurement was at or below 1ms. It superseded earlier advice to retain joined native proofs. Librarian response `hv-ja7h74` records the accepted correction in architecture evidence `hv-e8i94.1.3.2`.

The [removal manifest](./lifecycle-slow-test-removal.json) is the exact before/after inventory. It records 62 test or parameterized-template declarations across 24 files; four classification IDs share one template. Seven whole test files and two newly dead support modules were deleted. The corresponding 65 timing entries were removed, leaving the 69 baseline entries and the timing cutoffs unchanged. Production behavior and APIs are unchanged.

This deliberately removes automated regression protection. Joined native transport, independent tracker exchange, owned-process clearance/recovery and workflow continuity checks in this cohort are no longer present. Historical passing reports remain evidence about their recorded revisions. A green remaining suite does not establish equivalent coverage of the removed behavior. The deletion authorization adds no substitute manual acceptance gate.

## Material coverage lost

The manifest preserves each runtime case name and maps its original declaration. The principal losses are:

| Area | Removed checks |
| --- | --- |
| Busy Bee lifecycle and inspection | Native closure classification, uncertain or refused final closure, offline schema discovery, source-independent lifecycle/diagram inspection, frozen instruction projection and checkpoint reads without effects. |
| Busy Bee completion and settlement | Persistence barriers, native close refusal and identical retry, payload/result validation, retirement races and publication fencing, completed-evidence preservation, reservations, acknowledgment and replacement. |
| Joined native transport | Authored rejection completing successfully after refusal/retry; cancellation preserving completed visits and replacement provenance; failure retaining acknowledgment and supersession through export/import to an independent database without source. These were single-host database-exchange tests with injected clearance, not second-host or live-daemon proof. |
| Colony authority and execution | Clearance history and ownership checks, a real owned process surviving native request closure until exit, admission races, captured claim boundaries, receipt-authority restoration and request reconciliation across exit/finish/native outcomes. |
| Colony workflow consumers | Routing and launch classification, parent/endpoint forwarding, workflow submission, cancellation resumption and its refusal matrix, Nurse batch retention and work-review disposition handling. |
| Hive UI and Shared | Visible terminal lifecycle/follow-up combinations, public inspection with unavailable diagram source, successful simulation HTTP dispatch, and malformed tagged native fact rejection. |
| Feature and Land workflows | The feature-delivery stage sequence, Land review dispatch/collection/revisit and post-run source-completion matrices. These chart tests did not perform real checks, reviews, merges or publication. |

The earlier `#test-73`, `#test-82` and `#test-83` removals are outside this cohort. Their scenarios and failed timing history remain in the [Busy Bee coverage record](./busybee.md#lifecycle-and-settlement-transport). The later `#test-300`–`#test-302` replacements are part of this removal.

## Evidence and source recovery

The before revision is `937c48ae486eb503a6927a9a8b26d7b096d5c6a1`, tree `2cdb018388746d8430941fe95cd54910c4e7cb74`. Read an original file with `git show <baseCommit>:<beforePath>` using values from the manifest. That revision retains complete declarations, parameter tables, fixtures, helpers and the original timing justifications. These source pointers preserve history; they are not instructions to restore the rejected tests.

The immutable `final-timing-inventory.json` has SHA-256 `1248fe104ace82c65f03966ad0a8672b3ddb40df69a977d2f7eb012650c71914`. It and the preparatory reports remain in the source task's evidence archive. The repository manifest derives from `removal-before-manifest.json` and `removal-verified-manifest.json`, identifies both artifact hashes, and supplements their mappings from the pinned source and current files. Original artifacts and prior failure reports remain unchanged.

Manifest conventions:

- `caseNames` retains every recorded runtime row in order, including duplicate names and literal placeholders in the original report. `caseCount` counts rows, not distinct names.
- `beforePath` and `afterPath` identify file locations; a null after path/hash denotes a deleted file. A removed test has a null `afterDeclaration`, even when its file survives.
- Declaration offsets are zero-based, end-exclusive source-string offsets; line numbers are one-based and inclusive. Declaration SHA-256 hashes cover the exact statement, excluding preceding comments. File hashes cover all bytes.
- Four classification IDs refer to the same `test.each(reasons)` declaration. Their marker locations identify the individual table rows. Count unique declaration ranges to recover 62 removals.
- Each retained declaration has before/after ranges, hashes and registration text. `tokenSha256` preserves the supplied token-equivalence proof; `structuralSha256` independently hashes the Oxc 0.127.0 syntax tree with location and raw-spelling fields omitted. All 59 retained declarations match structurally, with no additional declaration in the affected files.

The support inventory includes deleted `lifecycle-transport-support.ts` and `owned-execution.test-support.ts`, plus the now-unused `writeDefinition` helper and its import-string constant in Busy Bee's `support.ts`. `useNativeFixture`, `captureCli` and `invoke` retain callers. Colony's runtime process API remains present.

Removing `#test-311` also left its five-row `scenarios` table, derived `Outcome` type and private `nativeState` branches for pending/unclassified outcomes unused. Those were pruned. The helper now accepts only `"succeeded"`; its sole retained call and successful return statement are unchanged. The manifest records this narrowing separately from deleted symbols and preserves the retained test's declaration and token hashes.

## Remaining coverage

The manifest lists retained tests per affected file; these counts are declarations, so parameterized runtime totals can differ. Busy Bee's [native tests](../../lib/busybee/tests/integration/native.test.ts) still cover repository tracker selection, offline schema discovery and executable JSON errors. Retained completion checks cover failed publication, key-reordered original input and human reservations. Retained Feature and Land tests exercise narrower chart branches, while Colony and Hive UI retain selected refusal and pending/unclassified cases. These checks cover their own assertions, not the deleted joined scenarios.

Syntax and inventory comparisons establish the removal's boundaries. Final focused, changed-suite and full-check results belong to the implementation owner's delivery evidence; this historical coverage record does not itself assert a passing quality gate.
