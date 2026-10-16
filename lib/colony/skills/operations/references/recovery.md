# Policy and recovery

## Capacity and execution

Unfinished linked tasks must be ready and available to the request's identity; preserve native claims and human/HITL reservations. Requests execute on their captured submission host.

Limits apply to the colony, kind and launch location, with named kind overrides. Retained starting/running reservations consume capacity, including detached executions across sleep or registration removal. Waiting workflow drivers also consume ordinary quota; the user must increase relevant limits if they prevent workers from starting. A lower limit does not terminate existing workers. Read `colony explain` diagnostics before changing policy.

Use `colony config show` and `colony config history` with the same repository/tracker/state selection to inspect active policy and revisions. Read `colony config update --help` for payload syntax and examples. Before editing formula templates, read [kind and harness configuration](configuration.md) with `colony skills file operations references/configuration.md`.

Updates and resets require an awake colony. Updates wait for the current pass and affect subsequent launches. Captured recipes keep their kind defaults; the active formula controls harness invocation. `config reset`, a fresh wake or daemon recovery wake reloads canonical policy, preserving history. Keep matching runtime, worker and watchdog companion executables beside Colony when deploying an authorized update.

## Recovery evidence

After a tracker or runtime failure, retain the error, request/attempt IDs and confirmed partial effects. Correct the reported cause, then use an authorized `colony wake` against the same repository, database and server state to replay reconciliation. Do not infer ownership from command text or signal arbitrary PIDs: Colony verifies process fingerprints and retained execution authority.

Automatic attempts keep the same request and friendly identity within policy's finite retry budget. For explicit replacement after resolving the cause, follow `bee retry --help`. Closed task results, other identities and human reservations survive cleanup.

For execution completion and blockers, follow `bee finish --help`. Colony validates reports when awake; sleeping defers settlement. Verify native task acceptance separately from process exit.

Read `colony assessments --help` for advisory reports on finished executions; these grant no authority to change application work.
