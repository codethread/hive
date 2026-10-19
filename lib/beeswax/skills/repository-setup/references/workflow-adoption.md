# Adopt workflow tool changes

Use this procedure for an explicitly scoped Busy Bee/Bee/Colony cutover or incompatible-run replacement. It composes public operations; installing tools or reading this guide grants no authority to stop work, deploy, reset runs or publish tracker state. Reuse existing authorization and obtain confirmation only for uncovered effects.

```text
Inventory and coordinate owners
  -> clear old execution/writers on owning hosts
  -> install coherent controls and refresh services
  -> compatible named run? -- yes --> continue saved outcomes
                           -- no ---> retire supported scope; replace deliberately
  -> verify evidence and caller tails before reopening admission
```

## Inventory and bound the change

Retain canonical control checkout, selected `BEADS_DB`, actor, workflow name/version, native parent, run/visit/request IDs, assignees, accountable humans and owning hosts. `busybee list` lists definitions, not runs. For this authorized maintenance inventory, use `br list --help` to page through exact `system` + `busybee-checkpoint` records, including closed records, then inspect their native related run links with `br show`. Do not infer runs from titles or parse actor snapshots. Cross-check known runs, parent children and request associations; a missing checkpoint is a diagnostic, not proof of no work.

Read each run and its descendants with native `br show`/comments. Inspect request host, outcome and replacements with `bee status REQUEST --json`, and read delivered answers with `bee result REQUEST`. Native request queries use exact `system` + `bee` labels; include closed history and inspect records without outcome filters when publication may lag. Keep system access within this maintenance scope.

Record actual completed or uncertain effects: commits, integration, cleanup, installs, service changes, saved original outcomes and caller tails. Identify manual/nested work, ct/HITL reservations and other identities separately. Agree the bounded run/request list, treatment of unfinished work, controls to install, service refreshes and resumption owners. Preserve claims unless their owner or the authorized owning tool releases them. Coordinate every writer, including standalone agents and synchronized clones; tracker synchronization and tracker alerts are not deployment locks.

## Clear execution and writers

On each owning host, use `colony explain REQUEST --json` with the retained repository, tracker and state/socket selection for all retained attempts and fresh process evidence. `bee status` is tracker-only; a closed request or stop intent does not prove process exit.

Where cancellation is authorized, follow `bee stop --help` for each selected driver and stage request while its owning Colony is awake. Verify reconciliation and exit before cleanup. Stopping the driver leaves independent stage workers alone. Coordinate standalone/manual writers separately; do not signal processes from foreign-host or stale observations.

After required reconciliation, follow `colony sleep --help` to pause admission for each affected repository. Sleep, removal and daemon stop leave detached workers alive; they are not clearance. Keep owners from submitting new requests or issuing Busy Bee mutations during the cutover, including on other clones. Record unavailable histories, unknown hosts/processes or reservation conflicts and the next owning-host action; do not force closure or erase evidence.

## Adopt coherent controls

Use the application's authorized installation procedure to install Busy Bee, Bee, Colony and all Colony companions together, plus affected consumers such as Hive UI and Beeswax. Verify versions, artifact provenance and `PATH`; read each changed tool's `changelog` for required adoption actions. Keep canonical control roots and definition dependencies usable through active runs.

Follow `colony daemon restart --help` for the retained state/socket, and verify the distinct ready daemon and recovered registrations. Refresh other affected running services deliberately. Preserve paused admission until verification finishes: old Colony must not call removed commands, and old Busy Bee writers must not touch new settlement intents. A service refresh deferral must name its owner and keep incompatible admission closed. `beeswax update` refreshes a project contract, not binaries or running services.

## Continue or replace

### Compatible named format-1 runs

Keep the existing run. Read `busybee inspect RUN --json` for native disposition and publication fences, then `inspect RUN --work --json` for explicit work availability. A retained active actor in a terminal run is history, not admission. Diagnose unavailable expansions before continuing.

Follow `busybee preflight --help` against the candidate catalogue and selected tracker. Compatible named definitions preserve checkpoint format 1, state/actor routes, context, frozen commands and original `{choice,data}` meaning. Preflight leaves future paths unproved; retain isolated continuation evidence for affected states before deploying a breaking change. Explicit-file runs still enforce their saved entry-file hash.

Published briefs remain frozen. Apply this command mapping without rewriting visits or restoring aliases:

| Old procedure | Current operation |
| --- | --- |
| `show RUN` and `discover RUN` | `inspect RUN --work --json`; require `work.kind: available`, then read `work.data` |
| `preview RUN` | `inspect RUN --diagram --json`; require available structure-mode `diagram.data` |
| `system preview RUN` | `inspect RUN --diagram --instructions --json`; require available instructions-mode `diagram.data` |
| `collect RUN` | `advance RUN --json` |
| `next RUN TASK` or `choice RUN TASK CHOICE` | Save the same original outcome through `complete RUN TASK CHOICE`, then `advance RUN`; `next` is an outcome name |
| `prepare-driver RUN` or `system prepare-driver RUN` | `advance RUN --prepare-driver`; admission preparation only |

`system schema --json` now matches `inspect --schema --json`: the full `workflow_lifecycle` success envelope, published as `workflow_lifecycle_schema`. Consumers of the former inner instruction schema must read the optional diagram expansion; checkpoint and simulation schema selectors remain unchanged.

Bee automation helpers are `bee system dispatch-stage`, `bee system assess` and `bee system report`; use these spellings when following frozen procedures that name the former top-level commands. Their assignment and injected-authority requirements remain unchanged. New dispatched prompts receive one assignment-derived response target at launch. Standalone native briefs retain their delivery pointer; old captured prompts and frozen briefs remain unchanged, including harmless duplicate pointers.

`complete`/`record-result` keep their original outcome contract. For an already-closed visit, inspect its saved evidence and follow `complete --help`; do not invent missing results or use its save-only primitive on closed work. Advance returns IDs/status; reinspection supplies the next briefs. Diagram/work expansions have their own checkpoint samples. Use the diagram sample for simulation baselines.

Continue with the same canonical root, tracker and authorization. Preserve task cleanup/report/DONE ordering and its separately authorized source closure. For Land crossing local-update, retain original results through publish/report/final advancement and the caller's post-done tail. Preflight success alone proves neither path, and this guide claims no rehearsal has passed.

### Incompatible scope

If the same named workflow exists, a fresh run may cover the same already-authorized remaining scope. A missing name requires the caller's workflow choice. Retain the predecessor and all completed/uncertain effects; prepare current input through `input-schema` and current triage so completed integration/install/cleanup is verified rather than replayed.

Use `busybee settle --help` for supported unsuccessful retirement and follow-up. It reads the exact generated format-1 inventory without author code and supplies that inventory, including completed anchors, to `colony system execution-clearance` under its checkpoint lock. Do not fabricate `--anchors` from only active visits. Every settlement operation requires a running registered owning-host daemon and verified exit for all retained attempts. Manual launches, missing history, foreign/unbound hosts, reservations, unfinished manual/nested scope and native closure refusals remain explicit blockers.

Busy Bee currently invokes Colony with its environment-selected default state/socket; it has no settlement `--state`/`--socket` override. Ensure that selection reaches the daemon retaining the relevant history. An unrelated empty daemon cannot establish clearance. If the required history is only in another custom endpoint, retain the diagnostic and seek supported endpoint selection rather than copying state or bypassing clearance.

While admission stays paused, use `run` or `bee spawn` with current input to create the agreed replacement beneath the original native parent. Retain returned IDs and inspect partial effects before retrying. `settle OLD supersede --replacement NEW --reason TEXT` cancels a pending predecessor or preserves its existing failed/cancelled outcome. `cancel`/`fail` also accept an existing replacement; `ack` accepts an exact failed closure without making it successful. Starting a replacement alone retires nothing. Busy Bee preserves prior completed results and leaves parent acceptance with its caller.

On uncertain publication, retain confirmed effects, checkpoint ownership and settlement intent. Follow the diagnostic and explicit recovery authority; never auto-unlock, replay or force-close. Unknown checkpoint formats/inventories are not a supported reset path.

## Verify and resume

Read back native lifecycle/resolution, parentage and original outcomes, plus request and process evidence. Keep old and replacement run/request histories distinct. Confirm owners, binaries, catalogue compatibility and services before the coordinated `colony wake`; use normal same-run driver recovery for compatible runs. `bee attach-workflow` is only for a confirmed orphan, and `bee retry` requires an eligible failed request—neither silently repairs a cancelled driver.

Deliver the exact run/request IDs, effects, remaining work and verification limits. Busy Bee alone closes runs; authorized callers separately satisfy source/parent acceptance and repository publication policy.
