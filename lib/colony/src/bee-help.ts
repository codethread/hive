const MUTATION_SCOPE_HELP = `Mutation scope in descriptions (prose guidance, not enforced permissions):
  read-only: inspect and report; leave examined work unchanged.
  non-destructive: create/update beads for exploration/history; curate scoped docs.
  mutating: change implementation within the assignment.
Each scope permits its role's required reporting/completion writes.
Markers grant no extra authority; role and assignment limits still apply.`;

export const HELP = {
	system: `
Busy Bee calls dispatch-stage; Colony injects authority for assess and report.
For ordinary delegation use bee spawn; assigned workers complete with bee finish.
`,
	response: `
Delivery: file the complete answer or blocker, verify the returned ID with
bee response get, then cite it with concise progress/verification in task comments.
Workflow notes hold only Busy Bee's original {choice,data} outcome.
Publication does not complete work or advance a workflow; follow bee finish --help.

The target is the driver's run or the dispatched worker's stage, supplied by the
execution assignment. Drivers synthesize worker responses into one run answer;
read worker deliveries with bee result. Direct conversations answer the user.

Use bee response COMMAND --help for operations; --schema exposes JSON contracts.
`,
	responsePublish: `
Publish with --body-file FILE, then verify the returned ID with bee response get.
Managed publication uses HIVE_SPAWN_ID and requires its captured run/stage as TASK.
Use --standalone for an independent task artifact; it excludes --request.
Preserve supplied BD_ACTOR/BEADS_DB. Publication preserves task state and claims,
including human/HITL reservations; completed targets permit interrupted delivery.

Responses are immutable closed docs with nonblocking provenance links. On resume,
inspect bee result REQUEST first. Identical body, author and correction intent
reuse the ID. A correction must --supersedes every current head in the same
task/request scope. Concurrent heads remain ambiguous until corrected. Inspect
known effects in an uncertain publication receipt before retrying.

Examples:
  bee response publish TASK --body-file answer.md --json
  bee response publish TASK --body-file corrected.md --supersedes RESPONSE --json
`,
	responseGet: `
An exact response ID retrieves its immutable body, even after correction.
--task resolves current heads; add --request to select one request lineage.
Task-only lookup can be ambiguous across requests or standalone deliveries.
For a submitted bee's answer and outcome, use bee result REQUEST.
`,
	responseSearch: `
Search returns bounded metadata, including closed responses; use get for bodies.
Comments/notes sources return candidates: native matching can include titles and
descriptions. Each source has its own offset; follow hasMore/nextOffset.
`,
	responseHistory: `
Historical evidence retains its original provenance; it is not a filed response.
Comment history bounds output but fetches ALL task comments (see nativeRead).
localCommentId is local only; cite taskId plus author/createdAt/text across clones.
Notes returns one full snapshot at offset 0; snapshotUpdatedAt is revision time,
and authorship is unknown. Workflow notes contain machine outcomes.
`,
	result: `
Use request.id from submission. Returns its driver's run or dispatched stage
response.body with native request.outcome and closure facts. Availability alone
does not imply success; a failed request may deliver a useful blocker report.

Automatic attempts/recovery keep the ID. Explicit bee retry returns a replacement;
old IDs retain historical answers. Find replacements through bee status OLD --json
(resolution.replacementIds); this command does not follow them.

Missing, ambiguous or malformed delivery fails explicitly. Inspect bee status and
reported IDs: wait while pending, report incomplete delivery after settlement,
or have the producer correct conflicting heads. Task closure is not an answer.
Use bee response --schema for output and failure contracts.
`,
	ack: `
Accept a closed unresolved failure when no follow-up remains. Outcome, tasks and
execution evidence stay unchanged. --actor/BD_ACTOR and --reason are required.
Repeats preserve the first acknowledgment and repair interrupted query labels;
superseded requests retain their replacement resolution. Use retry before ack
when replacement work is intended. No configuration or daemon is needed.
`,
	finish: `
Use the injected execution context and assigned working directory. Complete and
verify acceptance, deliver the answer (bee response --help), close satisfied work,
and perform required cleanup/caller completion steps before bee finish success.

If blocked, complete possible work, leave unfinished tasks open with next actions,
then bee finish blocked --reason "TASK: blocker and required next action".
Blocked ends automatic retries; the caller may retry after resolving the blocker.
Colony validates submission before settling execution.
`,
	kinds: `
Choose by description. --verbose expands configuration; --schema returns output
contracts without configuration access (combine for the full-detail schema).
--as previews caller visibility; --all or an explicit kind bypasses that filter.
Visibility guides discovery, not spawn authority. To configure kinds, read:
  colony skills file operations references/configuration.md

${MUTATION_SCOPE_HELP}
`,
	overview: `
Agent delegation:
  1. Choose a role with bee kinds; read bee spawn --help for workflow input.
  2. bee spawn KIND --parent WORK_ID --input-file FILE --cwd WORKTREE --actor ACTOR --json
  3. Retain request.id for bee status REQUEST --json and bee result REQUEST --json.
     Read bee result --help before consuming the answer.

Use workflow input for assignment, context and acceptance. For advice/review,
examined task IDs are context; the specialist owns its report work.
Normally keep kind prompt defaults. Colony owns dispatch and run claims.

Users may open an interactive harness with bee run; agents use bee spawn.
--repo selects configuration, --cwd execution, --beads-db/BEADS_DB the tracker.
--actor/BD_ACTOR supplies attribution. --json emits one success/error document;
inspect ok, kind and reason. Use bee COMMAND --help for details.
`,
	report: `
Only for a Colony-launched inactivity drone with injected review context.
Report active or inactive for the supplied target. Colony owns cleanup and retry
decisions. Ordinary task completion uses bee finish instead.
`,
	retry: `
Replace a failed unresolved request after fixing its blocker. To deliberately
resume a cancelled request, add --resume-cancelled. Before resuming, verify that its
old execution has stopped. colony inspect --help locates retained runtime evidence;
neither native closure nor a stale observation proves that a process stopped.

Acknowledged failures and requests with an existing replacement remain ineligible.
Only unfinished work is included. Human/HITL reservations and conflicting open
requests still prevent submission; other identities' task claims stay unchanged.
The replacement retains the same workflow run/stage, gets a fresh identity and
binds to the submitting host. Current kind defaults and explicit overrides supply
the recipe; old overrides are not carried forward.
--kind changes the role; prompt overrides follow bee spawn --help.

The original cancellation, closure time and identity remain history. bee status
OLD --json exposes resolution.replacementIds; cancellation stays resolved and
outside failure attention. Inspect confirmed IDs after partial publication;
repeating a superseded request repairs query labels and refuses a duplicate.
Retain the replacement request.id; see bee result --help for response lineage.
`,
	run: `
User-only interactive harness; requires terminal stdin/stdout. Agents use spawn.
Inherits cwd/environment and supplies a fresh identity, without tasks or Colony.
--json is unsupported. Kind/formula defaults and overrides apply to this session;
prompt overrides replace defaults, while Bee retains its common delivery guidance.

Example: bee run librarian --prompt "Discuss the request lifecycle"
`,
	spawn: `
Create a workflow run beneath nonclosed ordinary --parent work and submit its
Colony driver. Parent ownership/claims stay unchanged. Requests wait while asleep.

The kind selects its workflow (default do-work); override with --workflow or --source.
Install do-work with busybee init. Its JSON input requires title, request and
acceptance (an array). For other workflows, discover the schema:
  busybee --repo CHECKOUT input-schema NAME --json

--repo selects canonical kind configuration; --cwd selects the workflow checkout
and execution directory (default canonical root). Input/source paths resolve from
submission cwd. --prompt and --system-prompt replace their kind defaults; empty
strings clear them. Keep assignments in workflow input. Model/effort/harness
options override execution defaults; human ownership comes from configuration.

Retain request.id for status/result (see bee result --help) and workflow.runId for
busybee show. Submission is separate from execution and workflow completion.

Partial failures retain confirmed IDs and publication uncertainty. Inspect incoming
request links before recovery. Attach a confirmed orphan with bee attach-workflow
KIND RUN; read bee retry --help for a closed driver or bee status for an open one.
Waiting drivers consume quota; the user must raise limits if they starve workers.
`,
	status: `
Read request facts and the latest recorded observation, which can be stale.
The response summary identifies missing, available or ambiguous delivery.
Read bee result --help to retrieve the answer and interpret its outcome.

If execution has not started:
  colony explain <spawn-id> --repo <repository> --beads-db <database> --json
  If Colony is unavailable or asleep, wake the selected repository:
  colony wake --repo <repository> --beads-db <database>
  For a non-default server, supply the same --state and --socket to both commands.
  Follow diagnostics for blockers or failures; do not submit duplicate requests.
`,
	stop: `
Close a request using your actor. An awake Colony stops its owned execution and
releases unfinished claims. Closure alone does not prove the process has stopped.
Stopping an already-closed request preserves its outcome and history.
`,
};
