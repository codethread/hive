# Policy and recovery

## Capacity and execution

All unfinished linked tasks must be ready and available to the request's identity. Native task claims and human/HITL reservations remain authoritative. Requests execute on their captured submission host. A pending request may be waiting, executing, settling or retrying; an old running observation is not a live process check.

Limits apply to the colony, kind and launch location, with named kind overrides. Retained starting/running reservations consume capacity, including detached executions across sleep or registration removal. Waiting workflow drivers also consume ordinary quota; the user must increase relevant limits if they prevent workers from starting. A lower limit does not terminate existing workers. Read `colony explain` diagnostics before changing policy.

Use `colony config show` and `colony config history` with the same repository/tracker/state selection to inspect active policy and revisions. `config update --actor ACTOR --file CHANGE.json` accepts one named formula or a complete limits object. Read its help; a limits payload has this form (choose values deliberately):

```json
{ "kind": "limits", "limits": { "colony": 4, "kind": 2, "kinds": {}, "worktree": 2 } }
```

Updates and resets require an awake colony and do not start a daemon. Updates wait for the current pass, preserve captured recipes and affect subsequent launches. `config reset`, a fresh wake or daemon recovery wake reloads canonical configuration; transient overrides do not replace repository policy. History survives resets. Keep the runtime, worker and watchdog companion executables beside the matching installed Colony executable when deploying an authorized update.

## Recovery evidence

After a tracker or runtime failure, retain the error, request/attempt IDs and confirmed partial effects. Correct the reported cause, then use an authorized `colony wake` against the same repository, database and server state to replay reconciliation. Do not infer ownership from command text or signal arbitrary PIDs: Colony verifies process fingerprints and retained execution authority.

Automatic attempts keep the same request and friendly identity within policy's finite retry budget. For explicit replacement after resolving the cause, follow `bee retry --help`. Closed task results, other identities and human reservations survive cleanup.

Native task state establishes work completion. A successful process exit alone does not. A submitted `bee finish` report is accepted only after Colony validates it; sleeping defers settlement. Request closure also does not prove a detached worker stopped. Use source/freshness information from `colony explain` and retain uncertainty when ownership or liveness cannot be verified.

Private `colony assessments` reports are advisory evidence about finished executions, not acceptance or authorization to alter application work. Use `--request` for detail and `--source` only when supporting context is needed.
