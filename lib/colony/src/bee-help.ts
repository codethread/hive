const MUTATION_SCOPE_HELP = `Mutation scope in descriptions (prose guidance, not enforced permissions):
  read-only: inspect and report; leave examined work unchanged.
  non-destructive: create/update beads for exploration/history; curate scoped docs.
  mutating: change implementation within the assignment.
Each scope permits its role's required reporting/completion writes.
Markers grant no extra authority; role and assignment limits still apply.`;

export const HELP = {
	response: `
Publish complete authored Markdown against a producing task. In managed execution,
HIVE_SPAWN_ID supplies the request; its captured driver run or dispatched stage
must equal TASK. Use --standalone for an independent task-scoped artifact.
--request and --standalone are mutually exclusive. --actor or BD_ACTOR supplies
authorship; body-file metadata cannot replace it. Publication preserves task state
and human/HITL/foreign claims, and permits completed targets for interrupted delivery.

Records are immutable closed docs with nonblocking provenance links. A repeat
reuses its identity. Corrections require repeated --supersedes for every current
head. An uncertain publication returns known effects; inspect before retrying.

Examples:
  bee response publish TASK --body-file answer.md --json
  bee response publish TASK --standalone --body-file correction.md --supersedes RESPONSE --json
  bee response get RESPONSE --json
  bee response get --task TASK --request REQUEST --json
  bee response search QUERY --source responses --limit 20 --offset 0 --json
  bee response history TASK --source comments --limit 20 --offset 0 --json
  bee response --schema

Search defaults to response-record matches, including closed records and excluding
system. It returns metadata, never bodies. Comments search returns candidates:
native matches may come from titles/descriptions/comments, not verified reports.
Notes search returns notes candidates. Each source has independent pagination.
Follow hasMore/nextOffset; get explicitly expands the complete response.

Comment history bounds returned entries but fetches ALL comments for that task;
coverage and nativeRead disclose this cost. Numeric localCommentId is local only:
cite taskId plus original author/createdAt/text for portable provenance. Notes is
one full snapshot (--offset 0); snapshotUpdatedAt is revision time, author and
authoredAt remain unknown. Workflow notes contain machine {choice,data}, not an
authored response. Historical sources never become new response authority.
`,
	result: `
Resolve only this request's captured driver run or dispatched stage and exact
request lineage. Returns the full authored response/provenance plus native
status, closure and outcome facts. Does not include recipe, prompts, task briefs,
comments, logs or a ready-list scan. Old request IDs stay historical after retry.
Use request.id returned by spawn or explicit retry. Automatic attempts and Colony
recovery keep that ID; explicit retry returns a replacement ID. If only the old
ID is known, inspect bee status OLD --json for resolution.replacementIds and
select the intended replacement. This command does not follow replacements.
Missing/ambiguous/malformed responses fail explicitly; there is no legacy fallback.
A response can document blocked work: availability does not imply success.
Pending requests can publish before settlement; check bee status REQUEST --json.
After settlement, missing delivery remains an error, including on success.
Use bee response --schema for JSON contracts, including failures.
`,
	ack: `
Accept a terminal failure that no longer needs attention. The failed outcome,
execution evidence and linked tasks stay unchanged. This uses only the selected
Beads tracker; configuration and a running Colony are not required.

--actor overrides BD_ACTOR; one must supply a nonempty identity. --reason records
why the failure is accepted. Native Beads records the actor and acknowledgment
time. Repeating ack preserves the original acknowledgment and repairs its query
labels if publication was interrupted. Superseded requests already have a
resolution; use bee status to inspect their replacement provenance.

Example:
  bee ack <spawn-id> --actor <identity> --reason "Work completed separately" --json
`,
	finish: `
For the bee executing linked tasks, using the injected execution context.
Preserve BEADS_DB and BD_ACTOR; use the supplied assignment and working directory.
Read all linked acceptance criteria, record the deliverable, verify it, close
completed tasks, and perform cleanup and any explicit repository publication checkpoint.
Advisory bees change only their report tasks, not the work they examine.

Then report:
  bee finish success
  bee finish blocked --reason "<unfinished task, blocker and required next action>"

Success requires all linked work complete. A blocked report ends automatic
retries; leave clear next steps on unfinished tasks. The caller can use bee retry
after resolving the blocker. Colony validates the report and settles execution.
`,
	kinds: `
Start here before choosing a bee. Names and descriptions are shown by default.
Use --as to preview a caller's view, --all to inspect every kind, and --verbose
to include full configuration. An explicit kind name inspects that kind directly.
--schema returns a JSON response schema without reading configuration; combine
it with --verbose for the full-detail schema. Both include the failure shape.

${MUTATION_SCOPE_HELP}

Kinds load from canonical .hive/bees.toml and .hive/bees/*/bee.toml. Optional sibling
system_prompt.md and prompt.md files supply role/protocol and execution direction
respectively. Central definitions win duplicates. Warnings go to stderr for people
or the warnings array in JSON output.

Visibility guides selection only: it never restricts spawning. Caller allow
lists override hidden; deny lists subtract from non-hidden kinds. #self means
the caller's kind. Without caller context, all non-hidden kinds are visible.

Examples:
  bee kinds
  bee kinds --as librarian
  bee kinds reviewer --verbose
  bee kinds --all --json
  bee kinds --schema --json | jq '.schema'
  bee kinds --json | jq -r '.kinds[] | "\\(.name): \\(.description)"'
`,
	list: `
Lists submitted requests, not available kinds (use bee kinds for those).
Defaults to open requests and unresolved failures. --all includes resolved history.
This reads recorded facts, not live process or daemon health. Inspect a selected
request with bee status <spawn-id>; its help includes execution diagnostics.
`,
	overview: `
Interactive use:
  Users: bee run <kind> opens a harness in the current terminal. Requires a TTY.
  Agents must not invoke bee run; use bee spawn for delegation.

Agent workflow:
  Use Bee for subagent work: implementation, advice and review use the same flow.
  1. Run bee kinds to discover whom to delegate to and why.
  2. Write workflow input with the assignment, context and acceptance criteria.
  3. Submit: bee spawn <kind> --parent <work-id> --input-file <file> --cwd <directory> --actor <identity> --json
  4. Inspect: bee status <spawn-id> --json
     Inspect workflow.runId with busybee show and br show.
  5. Read the authored answer: bee result <spawn-id> --json
     Use request.id from submission; check request.outcome alongside response.body.
     Automatic retries keep the ID. Explicit bee retry returns a new request.id;
     use that replacement ID for status/result. Old IDs retain historical answers.
  Normally omit --system-prompt and --prompt: the kind supplies its protocol and
  workflow stages define the work. Colony supplies the workflow driver protocol.

Delegation:
  Colony owns dispatch and run claims. For advice/review, put examined task IDs
  in workflow input as context. The workflow work stage owns the report; examined
  tasks are not assigned to the reviewer. Implementation and landing remain separate.

${MUTATION_SCOPE_HELP}

Selection and output:
  --beads-db or BEADS_DB selects the tracker; --actor or BD_ACTOR attributes you.
  --repo selects repository discovery; --cwd only selects the bee's working directory.
  --json returns one object on stdout, including failures. Inspect ok, kind and
  reason. Use bee <command> --help for examples and the relevant next steps.
`,
	report: `
Only for a Colony-launched inactivity drone with injected review context.
Report active or inactive for the supplied target. Colony owns cleanup and retry
decisions. Ordinary task completion uses bee finish instead.
`,
	retry: `
Create a replacement for a failed unresolved request after its blocker is fixed.
Only unfinished work is included. The captured driver/stage role and same workflow
run are retained; changing kind workflow defaults creates no new run. Uses current
execution defaults and explicit
overrides, with a new identity; the original retains its history. --kind selects
another kind. Normally omit --system-prompt and --prompt; their independent
replacement semantics match bee spawn --help. Old recipe overrides are not
carried forward. This does not reopen or resume the previous execution.

Save the returned request.id for bee status NEW --json and bee result NEW --json.
The replacement has its own response lineage; bee result OLD retains the old
answer. Automatic retries within a request keep the same result lookup ID.

Example:
  bee retry <spawn-id> --actor <identity> --json
`,
	run: `
For user-invoked, headed interaction. Agents must not invoke this command.
Requires a TTY on stdin and stdout. Inherits the shell's directory and environment,
sets a fresh bee identity, and opens the kind's native interactive harness.
No task beads, spawn request or Colony daemon are involved. --json is unsupported.

Uses canonical kind defaults and [formulas.<harness>], omitting headless arguments.
Overrides apply only to this session; --prompt and --system-prompt replace their
respective defaults.
Bee appends its common response protocol to the selected system role, including
an empty --system-prompt override. Direct conversations answer the user directly.

Examples:
  bee run librarian
  bee run librarian --effort high --prompt "Discuss the request lifecycle"
`,
	spawn: `
Create one Busy Bee workflow assignment and publish a driver request for it.
Run bee kinds to choose a kind and its default workflow (normally do-work).
Install the standard catalogue entry with busybee init in a new repository.
Require --parent ID for existing nonclosed ordinary work in the selected tracker.
Busy Bee validates containment and leaves that work's claim and owner unchanged.
Provide --input-file JSON; do-work requires title, request and acceptance (array
of verification criteria). Named workflows supply their own initial schema:
  busybee --repo <execution-checkout> input-schema <name> --json
Choose --workflow NAME or --source PATH to override the kind's workflow.
A missing selected definition fails visibly.

Examples:
  bee spawn worker --parent <work-id> --input-file work.json --cwd <worktree> --actor <identity> --json
  bee spawn worker --parent <work-id> --workflow land --input-file land.json --cwd <worktree> --actor <identity> --json

--repo selects canonical kind configuration; --cwd selects the checkout supplying
the workflow catalogue and execution. Omitted --cwd uses the canonical root.
Source/input paths resolve relative to the submitting command's directory.
The human owner comes from configuration; actor/tracker match Bee options.
Initial submission returns request.id/identity and workflow.parentId/runId/status. Busy Bee owns
workflow progression and run closure. Submission is separate from execution.
Retain request.id for bee status REQUEST --json, then bee result REQUEST --json
to read the complete authored answer and native outcome. A response can describe
blocked work; check the outcome before accepting the answer. After explicit
bee retry, use its returned replacement request.id for status and result.

Partial failures retain parent and confirmed run/checkpoint/stage request IDs and driver publication
uncertainty. Inspect native incoming request links before any recovery. Attach
after confirmed absent driver publication, without creating a second run:
  bee attach-workflow KIND RUN --cwd <worktree> --actor <identity> --json
An unsuccessful driver uses bee retry; an open driver uses bee status.
Bee-dispatched visits use dispatch-stage internally, without selecting a workflow.
Waiting drivers keep consuming normal quota. If workers cannot start because
drivers exhaust capacity, the user must increase the relevant Colony limits.

--system-prompt and --prompt independently replace their captured kind defaults;
an empty string clears the field. Keep the actual assignment in workflow input.
--model, --effort and --harness change execution attributes.
Requests can be created while Colony is unavailable/asleep and wait for wake.
Use bee status REQUEST for the driver and busybee show RUN for the workflow.
`,
	status: `
Read request facts and the latest recorded observation, which can be stale.
The compact response summary identifies missing, available or ambiguous delivery.
Use bee result <spawn-id> for its complete authored response; availability is
independent of execution success. Read task beads separately for verification.

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
