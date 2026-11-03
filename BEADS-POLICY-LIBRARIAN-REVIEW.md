# Final Librarian review: Beads policy and breaking migration proposal

**Verdict: changes needed — one medium-severity completeness finding.** The proposal otherwise conforms to the supplied workshop intent and the broad Architect recommendation. This is review of a proposed breaking architecture, not implementation approval or adoption. No critical/high-severity defect or additional architectural decision was identified in the examined material.

Producing run **hv-zem720**, review visit **hv-ztg5c0**, request **hv-tqf6ip**; reviewer **harlequin-glorious-hawk**. Existing architectural evidence thread: **hv-hiykqo**, local-only/unpublished.

## Reviewed artifacts and revisions

Waited for Bookworm request **hv-sk1x4i** to settle **succeeded** (`completed`, closed 2026-10-24T21:09:04.403204Z), then read its complete authored response **hv-wkw2sb** and both final files in full. The broad Architect request **hv-0ednz1** likewise reports **succeeded**, with response **hv-puh37j**. Authored delivery was not treated as execution success while either request remained pending.

| Reviewed source | Pin |
| --- | --- |
| Canonical Hive source/guidance | `020d38baddd4c82aefd70da9a7158b1c8ea55dcb`; canonical working tree clean |
| Workshop execution checkout | `186da413144705420e3da42f66d19680d111bb77`; not used as current-runtime authority |
| `/Users/ct/dev/projects/hive/.worktrees/codex--beads-policy-workshop/BEADS-POLICY-PROPOSAL.md:1` | 67,930 bytes; SHA-256 `409b483546247ee08c78bca5dc9069a83fd7d749a3302ba06fe13c71ba92bd9c` |
| `/tmp/beads-policy-proposal-body.html:1` | 76,354 bytes; SHA-256 `d8c968becfcee6a24d012751970759b84929d1f8cdc78e26223cb131bb27e1d0` |

Both artifact hashes and canonical HEAD were rechecked unchanged at **2026-10-24T21:12:00Z**, after the full review. Bookworm's delivery cited the earlier HTML hash `aab2b3ee3a687832754cd9923d7bd91fa8a1c1c989b72750db6326ead8e2f76c`; this review covers the actual current HTML above, not that earlier version. The current HTML's substantive text equals the Markdown after removing Markdown markup, the document title, disclosure labels and insignificant whitespace. I found no substantive Markdown/HTML divergence or unfinished placeholder.

## Severity-ranked actionable finding

### P2 — Preserve effective governing context explicitly before reparenting or removing containers

**Locations:** `/Users/ct/dev/projects/hive/.worktrees/codex--beads-policy-workshop/BEADS-POLICY-PROPOSAL.md:297`, `:307`, `:331`; matching `/tmp/beads-policy-proposal-body.html:264`, `:272`, `:289`.

**Observed gap:** retirement permits removal of structural run/group containers and reparenting of retained useful work. The manifest and reconstruction checks preserve scope, outcomes, parent/link mappings and selected native fields, but never inventory or verify **governing `agent_context` and applicable ancestor instructions**. General knowledge coverage is not an explicit effective-instruction check. A structural container can contain a restriction even when it has no unique delivered work. Copying its historical outcome into notes does not ensure that restriction continues to govern a retained unfinished child.

**Governing rule:** `/Users/ct/dev/projects/hive/docs/beads-meta.md:104`–`:108` defines `agent_context` as consuming-agent instructions. When inherited emission is enabled, native show supplies the root ancestor (preferring the topmost epic) and immediate parent, not every intermediate ancestor. Other relevant ancestor instructions must be read explicitly; ordinary prose is not automatically inherited. Reparenting can therefore change both lost and newly inherited instructions without changing the child's own fields. The supplied review brief also explicitly requires preserved inherited context when containers are removed. Hive currently leaves inherited emission disabled; that does not remove manually read ancestor instructions or make stored context disposable.

**Required repair, owned by Bookworm:** add a concrete preservation gate to the retirement/reconstruction contract and implementation acceptance, in both presentations:

- Inventory applicable governing context and source attribution before each approved parent/container removal, including native `agent_context` and relevant ancestor prose constraints.
- Map still-applicable instructions to a surviving governing home, or retain the container. Check the resulting ancestor chain as well as the retained fields; do not merely archive an instruction that must still govern unfinished work.
- Record the before/after context mapping in the manifest and verify it after reconstruction. An unresolved conflict, authority change or unexplained loss blocks that removal and goes to its proper decision-maker.
- Include a focused acceptance scenario with a retained unfinished child whose removed parent carries a governing restriction; verify the resulting root/parent emission where enabled and the manual ancestor-read path.

This repairs a specific omission under existing guidance; it does not require a new policy to preserve legacy execution behavior. No actual context loss in the live tracker is asserted. Return the repaired files and new hashes for a focused final review before treating the proposal as countersigned.

## Other reviewed areas: aligned

- **Intent and record meaning:** ordinary WHAT/native AC/durable notes, unused design/prerequisites, optional diary and selective conversation capture match the supplied latest agreement. Auto/manual creation provenance stays distinct from system/artifact classification and dispatch. The work-versus-artifact gate qualification is explicitly a recommendation, not silently claimed accepted policy.
- **Current versus proposed capability:** current required-field/reason gates lack class selectors; entry routes do not exempt later closures; born-closed creation needs separate coherent validation. No invented installable YAML is presented. Native close CAS exists, while Hive's consumed close interface does not expose it. These claims match the supplied probes, installed help and inspected adapter.
- **Completion and failure meaning:** the removal of direct `next`/`choice` and public save-only completion, joined native-close/system evidence, and unfinished native work after unsuccessful settlement are deliberate broad-Architect choices. The proposal does not mislabel them as unchanged current contracts. It preserves original versus transformed input, honest cancellation, successful prior stages, closure uncertainty, ownership and non-distributed limits.
- **Ownership and dependency direction:** native Beads owns work/storage semantics; Shared owns consumed contracts; Busy Bee owns progression/evidence; Colony owns scheduling/process/attempt safety; Beeswax owns coordinated transport. UI/BV remain readers. No product-import inversion, duplicated scheduler authority or new general transaction platform is proposed. Governing package boundaries remain those in `/Users/ct/dev/projects/hive/docs/architecture.md:3` and the involved package agent guidance/import rules.
- **Responses and compaction:** complete bodies, all relevant heads/corrections and required anchors are protected until independent semantic coverage verifies retained meaning. Exact reads distinguish originals from compacted/unavailable detail. Unknown work, reservations, specialist evidence and merge references default to retention. Exact manifests, changed-source/reference invalidation and the cascade prohibition are explicit.
- **Generation cutover and rollback:** the proposal calls for real native/import/transport/runtime admission, upgraded publishers and revoked old access—not an advisory label. It separates same-generation tombstones from physical reconstruction, quarantines stale/offline salvage, preserves the permanent tracker path and blocks switching back after activation. The pre-mutation backup is distinguished from modified preparation state.
- **Read/search/performance:** topology versus body hydration, SQLite versus JSONL authority, before/after freshness, width/byte continuation and notes-search discoverability are explicit. Prior small/disposable measurements are not presented as target throughput, guaranteed speedups or deletion eligibility; the 73% bucket remains a volume measurement.

## Evidence window, guidance and verification limits

Read the current run/visit and ancestor descriptions through hv-2ezek8; the supplied workshop notes and corrections; complete responses **hv-puh37j**, **hv-j43n80**, **hv-shvp84**, **hv-iy8u3v**, **hv-07n1lr**; Bookworm's **hv-wkw2sb**; and the existing **hv-hiykqo** description/notes and relevant links. Examined native-policy/latest-write evidence and selected raw policy, storage, graph/hydration/freshness receipts. No broad historical search or recurrence claim; older unrelated evidence and every original measurement transcript were not re-audited.

Governing references included canonical specialist, architecture, domain/glossary, semantic-review, response/spawn, field/evidence/label, tracker-integration and involved package guidance. No ADR directory exists at the canonical checkout. Current implementation facts were checked against the Beads service, response-store and relevant documented workflow seams; native policy/close source was inspected selectively. Installed `br close --help` confirms `--if-unchanged`; native source HEAD is `b77ae7094e9fde7cba304ba00d306ec483c6bdd2`. A version string alone is not binary/source equivalence.

No implementation candidate or tracked application diff exists in this review scope. No experiments were rerun, full quality suite executed, browser/template rendering checked, classifier verdict substituted for review, or fleet cutover validated. Large-ledger CAS cost, reconstruction guarantees, archive access/disposal and end-to-end stale-host rejection remain explicit implementation/rehearsal obligations, not additional defects in this proposal. The parent owns final rendering.

I changed no examined artifact, application/config file, ancestor or other agent's work; delegated nothing; performed no tracker synchronization, commit, push or production deletion. Only this report's lifecycle/delivery and authorized evidence follow-up are being recorded locally. Completing this review run does not approve the proposal, complete the workshop or authorize implementation/destructive adoption. ct retains those decisions.
