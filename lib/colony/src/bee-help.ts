export const HELP = {
	finish: `
For the bee executing linked tasks, using the injected execution context.
Preserve BEADS_DB and BD_ACTOR; use the supplied assignment and working directory.
Read all linked acceptance criteria, record the deliverable, verify it, close
completed tasks, and perform repository-required synchronization and cleanup.
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

Kinds load from canonical .hive/bees.toml and .hive/bees/*/bee.toml with sibling
prompt.md files. Central definitions win duplicates. Warnings go to stderr for
people or the warnings array in JSON output.

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
Agent workflow:
  Use Bee for subagent work: implementation, advice and review use the same flow.
  1. Run bee kinds to discover whom to delegate to and why.
  2. Define the task beads with the question/work, context and required deliverable.
  3. Submit: bee spawn <kind> <task-id>... --cwd <directory> --actor <identity> --json
  4. Inspect: bee status <spawn-id> --json
     Read the delivered report and evidence on the linked tasks with br show.

Delegation:
  Submit unclaimed work; Colony owns dispatch and task claims. For advice/review,
  create a dedicated report task and put examined task IDs in its context, not
  among the tasks to claim. A report is complete when findings are recorded,
  including a negative verdict. Implementation and landing remain separate work.

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
Only unfinished tasks are included. Uses current kind defaults and explicit
overrides, with a new identity; the original retains its history. --kind selects
another kind. --prompt replaces that kind's instructions. This does not reopen
or resume the previous execution.

Example:
  bee retry <spawn-id> --actor <identity> --json
`,
	spawn: `
Submit task beads to the selected kind using canonical .hive configuration defaults.
Put the task-specific question and required result on the task bead. --prompt
REPLACES the kind's instructions; it does not append to them. Other overrides
affect only this request. Use an existing suitable checkout for --cwd, following
the repository's worktree policy.

Examples:
  bee spawn reviewer <report-task-id> --cwd <worktree> --actor <identity> --json
  bee spawn worker <task-id> --model <model> --effort high --actor <identity>

Creation confirms submission, not execution. Requests can be created while
Colony is unavailable/asleep and wait until it is awake. Blocked tasks wait for
their dependencies. Use bee status <spawn-id>; see bee status --help if waiting.
`,
	status: `
Read request facts and the latest recorded observation, which can be stale.
Read the linked task beads with br show <task-id> --json for reports and evidence.

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
