# Parked Colony test cases

These record removed executable checks as historical restoration scenarios. Confirm current supported behavior before restoring a case; remaining tests may already cover it. Original file timeouts are not approval for replacement tests.

Historical delivery wording below describes those removed checks, not today's response routing. The current [response protocol](../agents/responses.md) separates authored responses from comments and execution reports. Executable response coverage lives in [response-store.test.ts](../../lib/colony/src/response-store.test.ts), [responses.integration.test.ts](../../lib/colony/src/responses.integration.test.ts), [bee-cli.integration.test.ts](../../lib/colony/src/bee-cli.integration.test.ts) and [launch.test.ts](../../lib/colony/src/launch.test.ts).

Each section maps its scenarios to the original test titles; table-driven source titles retain their placeholders and expanded case counts. Variants inside a single original test remain part of that one case.

Unless a section names another revision, restoration pointers refer to Git revision `61e736f8e1f4bfad9b7338e140d33938d0426f71`, under `lib/colony/src/`. Restore files with `git show REV:PATH`. For that revision, reconciliation sources are removal ledger `hv-luv2v` comment 4466 and Colony scout `hv-hu8eo.1` comment 4404; follow-up work is `hv-luv2v`.

The `61e736f8` fixtures used disposable repositories, real Beads databases, private state and OS processes. Workers were generated scripts, not model-provider sessions. Ranking invoked real BV; publication races used forwarding br wrappers. The PID-lifetime case fabricated historical fingerprints rather than forcing OS PID reuse. Watchdog delivery used a fixture socket server and fake notifier. The retained `lib/colony/scripts/native-smoke.ts` is a separate opt-in authenticated harness check; the other history smoke case also remains executable.

## In-memory dispatch and reconciliation

This later removal belongs to CPU work `hv-1jsulm.3`. Restore `lib/colony/src/colony-dispatch.test.ts` from Git revision `4d9797917f4101aaf26d173da0947adfe9722cec`: 193 lines, SHA-256 `03580ee6eb6e0ccb215255d954ab6d79fa918d6ce2d2582e5eec53235b7dbab1`.

The suite exercised the real Colony actor and dispatch with a simulated clock, in-memory tracker and map-backed request checkpoints. Replacing fixture writes with the existing `Store` map seam, warming actor bootstrap, and trying default and priority-adjusted diagnostic runs still left cases at 1.5–3.6ms in strict changed-test runs against the 1.5ms cutoff. The whole coherent suite was removed under repository timing policy, without changing thresholds, allowances or timeouts; the [timing guide](../../lib/tooling/README.md#test-timing-report-and-landing-gate) explains the gate.

A standalone diagnostic of the remediated suite passed seven cases and 22 assertions in 74ms outside CI. At removal, the CPU work had also run 19 clock/failure cases, request-authority/readiness/publication checks and ten real native-lifecycle diagnostics. These are distinct evidence: the in-memory suite did not prove actual native-process launch, and its standalone pass is not a retained CI gate or proof of the CPU goal.

Restoration mapping (original title lines):

| Source under `lib/colony/src/` | Original cases | Original title |
| --- | --: | --- |
| `colony-dispatch.test.ts:89` | 2 | new submission uses fresh native readiness after hint delivered=$delivered |
| `colony-dispatch.test.ts:116` | 2 | interrupted native closure labels repair after hint delivered=$delivered without a retained request |
| `colony-dispatch.test.ts:137` | 3 | a native %s edit after a waiting pass is checked at the next full reconciliation |

```gherkin
Scenario Outline: Read fresh submission readiness when reconciliation becomes due
  Given a new spawn request whose task has an unresolved prerequisite
  And hint delivery is <delivered>
  When the scan deadline has not arrived
  Then no request checkpoint exists
  When the scan deadline arrives
  Then a waiting checkpoint exists and the task remains unassigned
  When the native request is closed as cancelled and reconciliation runs
  Then the checkpoint outcome and native label record cancellation
  Examples:
    | delivered |
    | true      |
    | false     |

Scenario Outline: Repair interrupted closure labels without a retained request
  Given a spawn request closed as completed before any request checkpoint exists
  And hint delivery is <delivered>
  When reconciliation becomes due
  Then native labels include succeeded and exclude pending
  And no request checkpoint is retained
  Examples:
    | delivered |
    | true      |
    | false     |

Scenario Outline: Reject changed native facts after a waiting pass
  Given a waiting request whose native <field> changes
  When a hint is delivered and the next full reconciliation runs
  Then the Colony actor fails while the checkpoint remains waiting
  And the original task remains unassigned
  Examples:
    | field    |
    | host     |
    | identity |
    | tasks    |
```

## Offline submission

Restoration mapping (original title lines):

| Source under `lib/colony/src/` | Original cases | Original title |
| --- | --: | --- |
| `producer.smoke.test.ts:16` | 1 | offline producer snapshots canonical defaults across linked worktrees and refuses duplicates |
| `producer.smoke.test.ts:300` | 1 | offline producer refuses reserved work and admits blocked and closed tasks |

Restoration detail: the submission case also checks the exact recipe keys: `cwd`, `effort`, `harness`, `host`, `kind`, `model`, `prompt`, `system_prompt`.

```gherkin
Scenario: Initialize and discover kinds from the canonical repository
  Given a canonical repository and a linked worktree with invalid local configuration
  When Colony is initialized through the worktree
  Then configuration is created in the canonical repository and repeat initialization fails
  And kind discovery uses canonical visibility rules and hides the self-denied worker

Scenario: Capture folder defaults and explicit prompt overrides
  Given a kind whose name differs from its folder name and has role and direction files
  When requests are submitted with defaults, a role override, or two empty prompt overrides
  Then each recipe preserves the selected model and exact role and direction text
  And a role override keeps the default direction while empty overrides clear both prompts

Scenario: Submit work without claiming it
  Given two unclaimed tasks and explicit execution-directory, harness, model, effort and prompt choices
  When an actor submits one offline spawn request for both tasks
  Then the open request records that requester, owner ct and a generated friendly identity
  And it has system, bee, agent:worker, pending-outcome and unresolved-resolution labels
  And its related links identify both tasks, whose claims remain unchanged
  And the host is local, the directory is canonicalized and literal prompt text is preserved
  And duplicate submission fails using either full or abbreviated task IDs

Scenario: Launch a captured recipe and retry with fresh defaults
  Given a submitted request and subsequently changed canonical model defaults
  When a scripted worker launches the request
  Then its literal arguments use the captured model, effort, role and direction
  And its directory and selected tracker match the request without changing the stored recipe
  And its brief names both tasks and requires reading acceptance, commenting, closing satisfied work and reporting success or blocked
  And the generated brief contains no beads:sync instruction
  When the exhausted request is retried with new role and direction overrides
  Then the replacement captures the changed model and both overrides

Scenario: Admit blocked or partly completed work
  Given human-reserved work, dependency-blocked work and changed model defaults
  When offline requests are submitted
  Then a missing kind and human-reserved work are refused
  And blocked work is admitted with the fresh model and null canonical-directory selection
  And a request combining closed and open tasks is open with a generated friendly identity
```

## Kind discovery

Restoration mapping (original title lines):

| Source under `lib/colony/src/` | Original cases | Original title |
| --- | --: | --- |
| `kinds.smoke.test.ts:43` | 1 | kind CLI resolves caller precedence, detail and strict configuration without a tracker or daemon |

```gherkin
Scenario: Select kinds without a tracker or daemon
  Given worker, helper and hidden internal kinds with caller selection rules
  When kinds are listed using the environment caller or an explicit helper caller
  Then the environment worker sees the helper and the explicit helper sees the internal kind
  And human output includes the selected kind's name and description
  When all kinds or verbose detail for the internal kind are requested
  Then the all-kinds list includes worker, helper and internal without prompts
  And verbose detail includes the internal prompt
  And the summary schema exposes only name and description while the verbose schema permits prompt text

Scenario Outline: Reject invalid kind configuration
  Given kind configuration with <fault>
  When kinds are listed as JSON
  Then the command fails
  Examples:
    | fault                             |
    | a missing description             |
    | a blank description               |
    | both allow and deny selectors     |
    | a selector naming an unknown kind |

Scenario: Keep configuration errors machine-readable
  Given a kind selector naming an unknown kind
  When kinds are listed as JSON
  Then exit status is 1 and stderr is empty
  And stdout is an error document with ok false and reason operation_failed
```

## Manual launch

Restoration mapping (original title lines):

| Source under `lib/colony/src/` | Original cases | Original title |
| --- | --: | --- |
| `launch.smoke.test.ts:17` | 1 | manual request launches a real worker with isolated endpoint and strict formulas |

```gherkin
Scenario: Launch against the selected tracker
  Given a request with a literal model value and an external working directory
  When Colony launches its scripted worker with an explicit tracker and private state
  Then the worker receives headless arguments, the literal model and related-task instructions
  And its actor and friendly identity equal the request assignee and its kind is worker
  And its directory and tracker match the request and its native task update is visible
  And one attempt receipt records exit code zero
  And launch help exposes tracker selection

Scenario Outline: Refuse an ineligible manual launch
  Given a previously launched request now has <condition>
  When another launch is requested
  Then it fails with one JSON error and empty stderr
  And no worker output or additional attempt is created
  Examples:
    | condition                 |
    | a foreign host            |
    | no host binding           |
    | a task assigned to ct     |
    | a task labelled hitl      |
    | an unsatisfied dependency |

Scenario: Validate formulas and request identity
  Given formulas with malformed syntax or an unknown variable, and a request with bee:wrong instead of bee
  When their shared parsers are called
  Then each invalid input is rejected

Scenario: Retain worker failure evidence
  Given a worker that exits with code 7
  When it is launched
  Then the command fails and its attempt receipt retains code 7
  When the request is closed and launched again
  Then launch is refused
```

## Offline acknowledgment

Restoration mapping (original title lines):

| Source under `lib/colony/src/` | Original cases | Original title |
| --- | --: | --- |
| `ack.smoke.test.ts:26` | 1 | ack resolves native failure attention offline with explicit and environment actors, preserving work and history |

```gherkin
Scenario: Acknowledge failure in the selected tracker
  Given an unresolved exhausted request, existing observations and an unchanged alternate tracker copy
  When it is acknowledged offline with an explicit actor and reason
  Then the request stays failed but becomes resolved with current labels and no attention
  And exactly one acknowledgment comment records that actor, reason and matching timestamp
  And compact output omits the recipe and tasks
  And closure, assignee, recipe, links, prior comments, linked task and alternate tracker are preserved
  And it leaves the native attention query and default list but remains in full history and exact status
  And human status displays the actor and reason without creating configuration or daemon state

Scenario: Preserve acknowledgment provenance on repeat commands
  Given an acknowledged failure
  When another actor repeats acknowledgment with a different reason and then stops the request
  Then the original acknowledgment and native record are unchanged
  And retry is refused
  When a blocked failure is acknowledged without an explicit actor
  Then JSON and human output identify the environment actor

Scenario: Prefer supersession over acknowledgment
  Given an acknowledged failure that later gains a replacement
  When acknowledgment and human status are requested
  Then resolution names the replacement and preserves the earlier acknowledgment
  Given a claim_failed request already superseded without acknowledgment
  When it is acknowledged
  Then current resolution remains superseded with no acknowledgment or new comment

Scenario Outline: Refuse invalid acknowledgment
  Given <input>
  When acknowledgment is requested
  Then it fails
  Examples:
    | input                            |
    | a completed request              |
    | an ordinary task                 |
    | no explicit or environment actor |
    | a blank explicit actor           |
    | a blank reason                   |

Scenario: Keep refused acknowledgment read-only
  Given a completed request and an ordinary task
  When each is submitted for acknowledgment
  Then their native records are unchanged
  And the completed-request error is structured JSON
```

## Request query scope

Restoration mapping (original title lines):

| Source under `lib/colony/src/` | Original cases | Original title |
| --- | --: | --- |
| `request-query.smoke.test.ts:26` | 1 | Bee queries only unresolved list candidates and task-related admission candidates, retaining history and exact inspection |

```gherkin
Scenario: Fetch only unresolved list candidates
  Given pending, failed, completed, acknowledged and acknowledgment-with-unpublished-labels requests
  When Bee lists current requests through a traced native tracker
  Then it returns only the pending and unresolved failed requests
  And one list query filters unresolved labels and readiness uses brief output
  And exact reads cover only those two requests, the unpublished acknowledgment and their active task
  When full history and exact unpublished-acknowledgment status are requested
  Then history includes all five requests without an unresolved filter
  And exact status shows acknowledged resolution, pending publication and the linked task

Scenario: Avoid readiness reads for an empty current list
  Given only an acknowledged request with unpublished labels remains a list candidate
  When Bee lists current requests
  Then it returns none using only one list and one exact request read
  When that publication is repaired and listing is repeated
  Then it returns none using only one list query

Scenario: Limit duplicate admission checks to related candidates
  Given fresh work linked to a completed request, an ordinary related bead and an unrelated request through a blocks edge
  When a new spawn is submitted
  Then it is admitted after an exact read of only the task
  And the candidate list is restricted to the old request and ordinary related bead
  And a second submission for the same work is refused
```

## Bee inspection and cancellation

Restoration mapping (original title lines):

| Source under `lib/colony/src/` | Original cases | Original title |
| --- | --: | --- |
| `bee-inspection.smoke.test.ts:21` | 1 | Bee inspects and closes only its selected tracker offline and distinguishes asleep observations from later cancellation |

```gherkin
Scenario: Inspect and close a request offline
  Given a blocked request, a selected tracker, an alternate copy and removed configuration
  When Bee inspects and lists the request
  Then it shows open pending unresolved work, its identity and blocked readiness with current labels
  And activity and observations are absent, with human output describing execution as unknown
  When Bee stops it
  Then it is closed as cancelled and resolved with a valid closure time and no fabricated observation
  And it leaves the current list but remains in full history
  And the alternate copy stays open, ordinary-task stop is refused and no daemon state or socket is created

Scenario: Cancel awake work using observed output
  Given an awake worker that has written stdout
  When its request is inspected and stopped
  Then activity identifies its first attempt and the stdout source modification time
  And the worker stops and a timestamped cancellation observation accompanies the closed request

Scenario: Preserve stale evidence while asleep and reconcile on wake
  Given a running worker whose colony goes asleep
  When it writes more stdout and its request is stopped
  Then the request closes while the worker and its in-progress claim remain live
  And its last observation and activity remain unchanged
  And human status displays their timestamps, warns that observations may be stale and says silence does not establish idle, stalled or dead execution
  When the colony wakes
  Then the worker stops, its claim is released and cancellation plus the newer stdout source time are published
  And native comments include the observation timestamp without private log contents or request notes
  And the alternate request remains open
```

## Colony inspection and explanation

Restoration mapping (original title lines):

| Source under `lib/colony/src/` | Original cases | Original title |
| --- | --: | --- |
| `inspection.smoke.test.ts:21` | 1 | inspection preserves checkpoints and receipt history across sleep and removal on two explicit servers |

```gherkin
Scenario: Explain tracker problems without starting a daemon
  Given work with an open dependency and a human claim
  When the request is explained
  Then diagnostics identify claim and native-readiness problems and expose the open dependency
  When those problems are cleared and explanation is repeated offline
  Then tracker evidence is available and runtime reports daemon_unavailable
  And no private state is created and the native request is unchanged

Scenario: Inspect waiting work on explicit servers
  Given two independent private servers and zero capacity on the selected server
  When a queued request is inspected and explained
  Then it has its identity and task links, waiting state and zero attempts
  And the colony is durable and awake with zero capacity and a capacity diagnostic
  And the servers have distinct identities and the selected socket and state are reported
  And private prompt contents are absent

Scenario: Explain live, stopped and unverifiable execution without mutation
  Given a launched worker whose colony is asleep
  When explanation is requested before and after the worker exits
  Then process evidence changes from live to stopped with colony_asleep and attempt_process diagnostics respectively
  And runtime freshness is checkpoint_age_unknown and stored request and attempt rows are unchanged
  When the ownership token is replaced with an invalid token
  Then process evidence is unavailable and attempt rows remain unchanged

Scenario: Retain completion and removal history
  Given a worker launched under an updated policy and later reconciled on wake
  When completion is inspected
  Then one completed attempt retains its request, identity, directory, receipt and policy revision
  And history identifies the revision actor and limits source
  And stdout contents, stderr existence and receipt identity are verifiable
  And human output includes the attempt and stdout path while JSON omits private prompts and argv
  When the colony is slept and removed
  Then asleep intent is visible before removal, membership becomes absent and explanation reports unregistered
  And requests, attempts and policy history remain available

Scenario: Keep explicit servers independent
  Given two running private servers
  When foreground serve is attempted against the second server's occupied endpoint
  Then it returns a JSON error with empty stderr
  When the first server is stopped
  Then explanation retains succeeded/resolved tracker facts with unavailable runtime
  And inspect fails as daemon_unavailable with empty stderr and the first socket is absent
  And the second server keeps its identity and PID and default state remains absent
```

## Native label publication

Restoration mapping (original title lines):

| Source under `lib/colony/src/` | Original cases | Original title |
| --- | --: | --- |
| `request-labels.smoke.test.ts:20` | 1 | native publication failures preserve provenance and recover through repeat commands and reopened runtime checkpoints |
| `request-labels.smoke.test.ts:397` | 5 | native label publication $name |

```gherkin
Scenario: Repair acknowledgment publication without changing provenance
  Given acknowledgment is stored but its native label write fails
  When status is inspected
  Then it reports resolved failure, pending labels and no attention while native labels remain unresolved
  When acknowledgment is repeated after the fault clears
  Then resolved labels are published using the original acknowledgment
  And comments, closure reason and closure time are unchanged through another reconciliation

Scenario: Keep one replacement through retry publication failures
  Given an unresolved failure with an unrelated area label
  When replacement creation fails
  Then no replacement exists and the original labels stay unresolved
  When creation succeeds but label publication fails
  Then the pending-publication error names exactly one replacement after one write
  And inspection reports resolved failure without attention while the replacement is pending and unresolved
  When retry is repeated before and after the fault clears
  Then no further replacement is created and retry remains refused
  And the original labels become resolved with its area label preserved
  And repeated stop preserves the original while stopping the replacement publishes cancelled/resolved labels

Scenario: Recover publication through reopened runtime checkpoints
  Given replacement publication failed and the replacement was closed before wake
  When the fault clears and a fresh dispatch pass runs
  Then the original becomes resolved and the replacement becomes cancelled/resolved
  Given a replacement exists but reading publication facts failed
  When a fresh pass runs after recovery
  Then the pending-publication error's single replacement is retained and the original becomes resolved

Scenario: Finish interrupted completion and cancellation publication
  Given completed work whose request closes before its label write fails
  When private state is reopened
  Then the request is settling with completed outcome and old pending labels
  When publication recovers
  Then labels become succeeded/resolved, state becomes terminal and a later pass leaves the bead unchanged
  Given stop failed to publish cancellation labels
  When stop is repeated after recovery
  Then cancelled/resolved labels are published with no replacement

Scenario Outline: Leave nonlocal requests untouched
  Given a request bound to <host>
  When dispatch examines queued, retained-settling and closed versions of that request
  Then native requests and existing task claims are unchanged and no new local checkpoint is adopted
  And inspection preserves the host selection and recipe
  Examples:
    | host         |
    | another host |
    | no host      |

Scenario: Do not repair foreign history through a local replacement
  Given a local request supersedes a closed foreign request
  When dispatch runs
  Then the foreign predecessor is unchanged and the local checkpoint records the local host

Scenario: Refuse publication after replacement facts drift
  Given a rival creates a superseding request during a stop publication
  When the first write conflicts
  Then a pending-publication error names the replacement and stops after one write
  And native failure labels stay unresolved
  When stop is repeated with fresh facts
  Then the original becomes resolved

Scenario Outline: Resolve bounded native publication races
  Given retry creates one replacement and a competing writer <edit>
  When native label publication runs
  Then it makes <writes> writes and yields <result>
  And exactly one replacement and the <area> label remain
  And multi-write cases preserve the intervening note and never apply the third edit
  Examples:
    | edit                                     | writes | result                                               | area     |
    | publishes identical labels               | 1      | spawn_created and failed/resolved labels             | area:old |
    | replaces area:old and appends a note     | 2      | spawn_created and failed/resolved labels             | area:new |
    | appends a note then publishes the labels | 2      | spawn_created and failed/resolved labels             | area:old |
    | changes notes on every attempted write   | 2      | request_labels_pending and pending/unresolved labels | area:old |
    | removes the request identity             | 1      | request_labels_pending and pending/unresolved labels | area:old |

Scenario: Dispatch successful publication-race replacements
  Given any of the three successful native publication race variants
  When dispatch runs with zero capacity
  Then the single replacement has a waiting checkpoint
```

## Waiting request authority

Restoration mapping (original title lines):

| Source under `lib/colony/src/` | Original cases | Original title |
| --- | --: | --- |
| `authority.smoke.test.ts:22` | 1 | waiting request checkpoints pin their tracker, identity and related tasks before any launch |

```gherkin
Scenario: Pin the tracker before launch
  Given zero dispatch capacity and a persisted waiting request with no attempts
  When its colony is removed and add or wake selects an alternate tracker
  Then both operations are rejected

Scenario Outline: Refuse native authority drift
  Given a waiting request with <change>
  When its original tracker is awakened
  Then the colony fails without launching an attempt
  And original and newly linked tasks stay open and unassigned
  Examples:
    | change                        |
    | a different friendly identity |
    | an additional related task    |
```

## Ranking

Restoration mapping (original title lines):

| Source under `lib/colony/src/` | Original cases | Original title |
| --- | --: | --- |
| `ranking.smoke.test.ts:20` | 1 | BV reads the complete selected database, including closed nodes and unflushed dependencies |
| `ranking.smoke.test.ts:66` | 1 | BV reads pending-sync operational state without changing source records or artifacts |
| `ranking.smoke.test.ts:99` | 4 | BV fails visibly for %s source despite a valid JSONL export |

```gherkin
Scenario: Rank the complete selected database
  Given 202 tasks including a closed node, plus a database-only task with an unflushed dependency
  And stale JSONL, competing endpoint environment values and an insights map limit of one
  When BV ranks the selected tracker
  Then every database task has a score and the depended-on task outranks the closed node
  And asking for a missing task fails
  And tracker data and artifact hashes remain unchanged

Scenario: Read pending-sync state without repairing it
  Given a tracker with a pending-sync receipt
  When BV ranks its task
  Then its score is positive and all metadata and artifact hashes remain unchanged

Scenario Outline: Fail visibly despite valid exported data
  Given a valid JSONL export and selected database storage that is <fault>
  When BV ranks a task
  Then ranking fails
  Examples:
    | fault                   |
    | missing                 |
    | corrupt                 |
    | holding an invalid row  |
    | unreadable dependencies |
```

## Scheduling

Restoration mapping (original title lines):

| Source under `lib/colony/src/` | Original cases | Original title |
| --- | --: | --- |
| `scheduler.smoke.test.ts:23` | 1 | real scheduler ranks ready related tasks and applies non-preemptive colony, kind and launch-bucket limits |

```gherkin
Scenario: Admit ready work by priority
  Given one occupied slot, ready P0 and P1 requests and a request mixing blocked, ready and closed tasks
  When capacity is released
  Then P0 starts before P1 and the mixed request waits until its dependency closes
  And already completed work closes without launching and BV is never called in these admissions

Scenario: Enforce colony, kind and worktree limits
  Given colony capacity 3, kind capacity 2 and worktree capacity 2
  When two workers occupy worktree A and a reviewer occupies directory B
  Then another worker at B and another reviewer at A wait
  And status exposes those limits and bv-pagerank policy
  And workers keep their requested directories while receipts identify their containing worktree buckets
  When colony capacity is reduced to one
  Then all three live workers survive and waiting work stays queued until occupancy falls below one
  And the queued worker then reviewer run, with one BV call for their contention and none while capacity is full

Scenario Outline: Rank only genuine contention
  Given equally prioritized older and newer requests where the newer task has a dependent
  And <policy> ranking with <constraint>
  When dispatch runs
  Then <admission>
  And BV is called <calls> times and both requests eventually run after releases
  Examples:
    | policy      | constraint                      | admission                    | calls |
    | bv-pagerank | both requests fit               | both start                   | 0     |
    | bv-pagerank | colony capacity is one          | newer starts and older waits | 1     |
    | bv-pagerank | shared kind capacity is one     | newer starts and older waits | 1     |
    | bv-pagerank | shared worktree capacity is one | newer starts and older waits | 1     |
    | fifo        | colony capacity is one          | older starts and newer waits | 0     |

Scenario: Preserve admitted urgent work when ranking fails
  Given one urgent request and two lower-priority requests competing for the remaining slot
  When BV fails during their ranking
  Then the colony fails after one BV call and neither lower-priority request starts
  And the already admitted urgent worker stays alive
```

## Retries and claim ownership

Restoration mapping (original title lines):

| Source under `lib/colony/src/` | Original cases | Original title |
| --- | --: | --- |
| `retry.smoke.test.ts:27` | 1 | real retry budget preserves identity and claim ownership across exhaustion, completion and partial claim races |

```gherkin
Scenario: Exhaust a bounded retry budget
  Given a worker exits successfully without completing its task
  When its four allowed attempts run
  Then attempts have distinct IDs, ordered numbers and one friendly identity
  And each attempt claims and releases exactly that task after execution stops
  And pending/unresolved labels remain until exhaustion
  And the task ends open and unassigned, with four retained attempts and no fifth launch

Scenario: Retry exhaustion as a fresh local request
  Given an exhausted predecessor whose host is now foreign
  When it is retried
  Then the replacement binds to the local host and receives its own full four-attempt budget
  And the predecessor stays failed but resolved by supersession with current labels and no attention
  And the current list contains the unresolved exhausted replacement

Scenario: Stop retries after actual completion
  Given a worker closes its task on its first attempt
  When reconciliation completes
  Then the request is completed, the task is closed and no second attempt exists

Scenario: Release only claims acquired before a race
  Given a two-task request has claimed its first task
  When a competitor claims the second before the request can claim it
  Then the request ends claim_failed without launching
  And only its first claim is released while competitor and unrelated sentinel claims survive
  And history records waiting-to-terminal settlement, first-task claim and release, and no second-task claim
  And the native precondition or validation error is retained
  And exhausted, replacement, completed and claim_failed checkpoints are terminal with empty claim sets

Scenario: Preserve an actionable native sync failure
  Given native tracker claim fails with SYNC_CONFLICT
  When Colony dispatches the request
  Then the colony fails with the native error, repository, tracker, host and next-action diagnostics
  And the request stays open without a closure reason or launch
  And one failed history event retains waiting-to-claiming state, the pending task and no completed effects
  When the daemon is stopped and br is unavailable
  Then JSON events reproduce that history and human events identify the error and task without recreating the socket
```

## Daemon endpoints

Restoration mapping (original title lines):

| Source under `lib/colony/src/` | Original cases | Original title |
| --- | --: | --- |
| `daemon.smoke.test.ts:22` | 1 | private lazy daemon routes colliding task IDs to independent repositories and leaves workers alive on stop |
| `daemon.smoke.test.ts:283` | 1 | foreground daemon exposes status and stops through its explicit public endpoint |

```gherkin
Scenario: Route colliding task IDs through one private daemon
  Given two repositories with colliding task IDs and separate selected trackers
  When each colony wakes on the same private endpoint
  Then one daemon serves both with distinct attempt IDs
  And workers receive their repository directory, tracker, actor, friendly identity and kind
  And each native task records its own worker identity
  And repeated wake preserves status and default state stays empty

Scenario: Reject incomplete endpoint selection and invalid wake
  Given a custom socket without explicit state
  When daemon status is requested as JSON
  Then it fails with an explicit-state error and empty stderr
  Given invalid canonical configuration
  When wake is attempted and its lazily started daemon is cleaned up
  Then wake fails and the private socket is absent

Scenario: Let detached workers finish after daemon stop
  Given two private-daemon workers still awaiting release
  When the daemon stops and the workers are released
  Then both finish under their original identities and supervisors record exit
  And later daemon status fails with structured JSON and empty stderr

Scenario: Serve and stop a foreground daemon
  Given a foreground daemon on an explicit state directory and socket
  When status is requested
  Then it reports an empty colony list, server identity, PID and the selected endpoint
  And the foreground child is alive
  When stop is requested
  Then it reports stopped, the child exits zero and stderr is empty
```

## Daemon ownership

Restoration mapping (original title lines):

| Source under `lib/colony/src/` | Original cases | Original title |
| --- | --: | --- |
| `server-ownership.smoke.test.ts:26` | 1 | daemon ownership excludes shared state, recovers known stale sockets, and preserves unknown endpoints |

```gherkin
Scenario: Exclude conflicting endpoint owners
  Given a foreground daemon owns one state directory and socket
  When stop or wake selects that socket with the wrong state directory
  Then it is rejected and the original daemon and asleep membership remain unchanged
  When foreground serve or add selects the same state with another socket
  Then it is rejected and the original daemon retains its PID and single registration

Scenario: Recover only known stale sockets
  Given a known daemon is killed and leaves its socket
  When add restarts that endpoint
  Then a new daemon PID serves the retained single registration
  Given an unknown stale socket or an ordinary file at another endpoint
  When add attempts to use it
  Then add fails and its inode is preserved, including the ordinary file's contents

Scenario: Reuse the winner of concurrent startup
  Given two concurrent add commands for one fresh endpoint
  When startup completes
  Then at least one succeeds and the winner has one registration
  And another add reuses the winner's PID
```

## Registry lifecycle

Restoration mapping (original title lines):

| Source under `lib/colony/src/` | Original cases | Original title |
| --- | --: | --- |
| `lifecycle.smoke.test.ts:22` | 1 | public registry lifecycle suspends dispatch, refreshes formulas, and restores only durable membership |

```gherkin
Scenario: Register asleep and preserve existing awake intent
  Given a newly added durable colony and queued work
  When another awake colony dispatches work
  Then the new colony stays asleep with no attempts or worker launch
  When the new colony is awakened and added again
  Then it stays durable and awake and temporary wake is refused

Scenario: Suspend dispatch without stopping existing workers
  Given an active worker whose durable colony goes asleep
  When new work and already completed work are submitted
  Then the live worker and its attempt remain and neither new launch nor completed-request closure occurs
  When the canonical formula changes and the colony wakes
  Then the pending worker uses the refreshed formula

Scenario: Retain attempts across removal and re-registration
  Given two retained attempts and a live worker
  When the colony is removed, added and awakened again
  Then removal returns both attempts, registration disappears and the worker survives
  And re-registration and wake retain the same attempts

Scenario: Promote or discard temporary membership
  Given a temporary awake colony
  When it sleeps
  Then its registration disappears
  When it is temporarily awakened again and added durably
  Then it becomes durable without losing awake intent

Scenario: Restore only durable membership on restart
  Given durable asleep and awake colonies and a temporary awake colony
  When the daemon stops and starts again
  Then durable intent and retained attempts return while temporary membership is absent
  And the detached worker remains alive
```

## Configuration revisions

Restoration mapping (original title lines):

| Source under `lib/colony/src/` | Original cases | Original title |
| --- | --: | --- |
| `config.smoke.test.ts:24` | 1 | public config updates preserve captured recipes and immutable actual revisions while reset and wake restore canonical policy |

```gherkin
Scenario: Show and attribute runtime policy updates
  Given canonical fifo policy with zero capacity and one scripted formula
  When configuration is shown and a formula is updated with an explicit actor
  Then active output exposes the formula name and limits
  And history records the explicit formula actor
  When limits are updated without an explicit actor
  Then history records the environment actor

Scenario Outline: Refuse invalid updates without changing history
  Given a proposed update containing <fault>
  When it is applied
  Then the command fails and active configuration and history are unchanged
  Examples:
    | fault                                    |
    | malformed template syntax                |
    | an unknown template variable             |
    | an unknown variable inside a conditional |
    | a recipe model update                    |

Scenario: Join captured recipes to actual immutable launch policy
  Given a captured request model and a later formula override
  When capacity is enabled and the worker completes
  Then the captured recipe and native description stay unchanged
  And the receipt records the captured model, actual executable and rendered arguments
  And its revision joins the retained formula, limits and environment-actor metadata
  And public update and history output omit the private marker and history omits argv

Scenario: Restore canonical policy on reset and wake
  Given an active formula override
  When configuration is reset with an explicit reset actor
  Then canonical zero capacity returns under a new revision with reset provenance
  And a subsequent launch uses the canonical formula and captured model
  When another override is followed by sleep and wake
  Then asleep configuration has no active policy and wake restores canonical policy under another revision
  And later launch uses the canonical formula, prior history is retained and public output omits the private marker
```

## Crash recovery

Restoration mapping (original title lines):

| Source under `lib/colony/src/` | Original cases | Original title |
| --- | --: | --- |
| `recovery.smoke.test.ts:22` | 1 | private daemon recovery adopts live work, retries dead work and reconciles only awake registered requests |

```gherkin
Scenario: Adopt live work after a daemon crash
  Given a live worker with no stdout activity and durable awake membership
  When the daemon crashes, the worker writes output and the daemon recovers
  Then the same attempt and live worker are adopted without a new attempt
  And activity records that attempt's source output time
  And durable awake membership returns while temporary membership disappears
  And an unrelated sentinel process survives

Scenario: Delay sleeping cancellation through recovery
  Given a durable colony sleeps while its worker is alive and its request is then closed
  When other colonies run and the daemon crashes and recovers
  Then asleep intent, the worker and its in-progress claim remain
  When the colony wakes
  Then the cancelled worker stops and its task claim is released

Scenario: Replace dead work without inheriting activity
  Given a worker writes output and is killed while the daemon is down
  When the daemon recovers
  Then a distinct second attempt starts with the same identity and null stdout activity
  And both attempts remain in history and native comments retain the old output time
  When its request is cancelled while awake
  Then the replacement stops and its claim is released

Scenario: Reconcile removed work only after re-registration and wake
  Given a removed colony retains a live attempt and its request is closed
  When other colonies run and it is added again
  Then the worker remains live and the colony is registered asleep
  When it wakes
  Then the worker stops and its claim is released
  And cancellation cleanup records the launch token and owned PID for each stopped worker
  And the unrelated sentinel PID is excluded and its process and task assignment survive
```

## Process ownership

The separate-group cleanup cases below describe the historical implementation. Current [managed cleanup](../../lib/colony/README.md#completion-and-retries) covers the supervisor's process group.

Restoration mapping (original title lines):

| Source under `lib/colony/src/` | Original cases | Original title |
| --- | --: | --- |
| `processes.smoke.test.ts:37` | 1 | owned separate-group descendants stop while unrelated sentinel survives |
| `processes.smoke.test.ts:97` | 1 | child handle proves short-lived harness exit |
| `processes.smoke.test.ts:121` | 1 | stopping an actively observed harness confirms exit without poisoning ownership |
| `processes.smoke.test.ts:159` | 1 | owned harness title changes preserve cleanup and reject a changed start time |
| `processes.smoke.test.ts:213` | 1 | cleanup retains a new owned lifetime while unrelated reused PIDs survive |
| `processes.smoke.test.ts:276` | 3 | supervisor handoff %s preserves launch permission and stopped evidence |

```gherkin
Scenario: Stop separate-group descendants without touching a sentinel
  Given an owned harness with a detached descendant and an unrelated sentinel
  When stop uses the wrong token
  Then it fails and execution stays live
  When the harness exits but its descendant remains
  Then execution still reads live
  When stop uses the correct token
  Then execution reads stopped and the sentinel survives

Scenario: Prove a short-lived harness exited
  Given an owned child immediately exits zero
  When its handle completes
  Then the result is code zero and execution reads stopped

Scenario: Stop an actively observed harness
  Given an owned harness is running
  When it is stopped and completion is awaited
  Then execution reads stopped without an ownership error

Scenario: Follow a title change without accepting another lifetime
  Given an owned Node harness changes its process title
  When its recorded process is observed
  Then it remains live but a changed start time is rejected
  When execution is stopped
  Then completion has no error, execution reads stopped and the sentinel survives

Scenario: Retain the current owned lifetime despite historical PID evidence
  Given real owned and sentinel processes with fabricated older start-time records
  And separate cleanup evidence identifies the owned process's current lifetime
  When execution is observed and stopped
  Then it changes from live to stopped and the current owned child exits
  And cleanup retains the current fingerprint while the sentinel survives

Scenario Outline: Honor supervisor launch permission
  Given a supervisor is waiting and no harness has launched
  When the handoff is <action>
  Then <launch>
  And final execution evidence is stopped
  Examples:
    | action     | launch                                                                          |
    | authorized | the callback identifies the supervisor PID and the harness launches before stop |
    | cancelled  | stop prevents launch and later resume never authorizes it                       |
    | dead       | a killed supervisor is stopped and later resume never authorizes launch         |
```

## Stdout observations

Restoration mapping (original title lines):

| Source under `lib/colony/src/` | Original cases | Original title |
| --- | --: | --- |
| `observations.smoke.test.ts:18` | 1 | stdout evidence ignores empty logs and stderr, coalesces writes and survives publisher restart |

```gherkin
Scenario: Distinguish stdout source time from publication time
  Given a missing or empty stdout log and stderr-only output
  When activity is read and published
  Then stdout activity is null and repeated publication leaves one initial comment
  When actual stdout is written with a known source modification time
  Then activity records that exact source time and a separately formatted recorded timestamp

Scenario: Coalesce activity across publisher restart
  Given an initial null observation followed by published stdout
  When more stdout arrives within the coalescing interval and a fresh publisher process runs
  Then the published activity stays unchanged with two comments total
  When final activity is flushed twice
  Then the latest source time is published once, leaving three comments total

Scenario: Reset activity for another attempt
  Given the old attempt still has stdout
  When a new attempt without output publishes activity
  Then the new attempt ID and number replace the old ones and last output time is null

Scenario Outline: Refuse nonlocal observation writes
  Given the request is bound to <host>
  When stdout activity or a general observation is published
  Then both fail and the native request remains unchanged
  Examples:
    | host         |
    | another host |
    | no host      |
```

## History retention

Restoration mapping (original title lines):

| Source under `lib/colony/src/` | Original cases | Original title |
| --- | --: | --- |
| `history.smoke.test.ts:113` | 1 | history bounds retention and leaves a crashed operation explicitly unfinished |

```gherkin
Scenario: Bound completed operation history
  Given more than 1000 completed operations in private history
  When history is read
  Then only the newest 1000 completed operations remain in order
  When reconciliation makes no change
  Then history is unchanged

Scenario: Preserve a crashed operation as unfinished
  Given an operation records an attempt reservation and begins supervisor startup
  When its process exits abruptly before finishing the operation
  Then history retains the confirmed reservation and current startup step as unfinished
  And failure and finish time remain null and failure-only filtering excludes it
```

## Worker completion reports

Restoration mapping (original title lines):

| Source under `lib/colony/src/` | Original cases | Original title |
| --- | --: | --- |
| `self-report.smoke.test.ts:22` | 1 | self-report preserves partial blocked work across recovery and validates attempt-scoped success |

```gherkin
Scenario: Validate attempt-scoped reports
  Given a worker has closed one task and recorded another as blocked
  When blocked reports omit a reason or supply a blank reason, or success uses a wrong token
  Then they are refused
  When the authorized worker reports blocked with a reason twice
  Then both submissions succeed and a conflicting success report is refused

Scenario: Recover partial blocked work without automatic retry
  Given the worker's blocked report is durable before worker exit and daemon crash
  When the daemon recovers
  Then closed and blocked task states are preserved and the unfinished claim is released
  And the request closes blocked as failed/unresolved needing attention
  And its observation names the reason, unfinished task and attempt
  And further sleep/wake cycles retain only one attempt

Scenario: Retry only unfinished work with a fresh recipe
  Given a blocked request and changed canonical model defaults
  When it is retried
  Then the replacement captures the new model, links only unfinished work and supersedes the original
  And the predecessor retains its evidence but becomes resolved without attention

Scenario: Keep completion authority with the current live worker
  Given the replacement's task is closed while its worker is still alive
  When reconciliation runs
  Then the worker stays live and the request remains executing
  When an earlier attempt's report is forged into the current attempt directory
  Then the colony fails without stopping the current worker or changing its executing state
  When the forged report is removed and the current worker reports success
  Then the worker stops and the request becomes succeeded/resolved

Scenario: Exhaust success reports that leave work unfinished
  Given a worker reports success while its task remains open
  When a second attempt starts and the old success report is repeated
  Then the second attempt remains current and alive
  When it also reports success without completing the task
  Then the request exhausts after two attempts, needs attention and leaves the task open
```

## Watchdog notifications

Restoration mapping (original title lines):

| Source under `lib/colony/src/` | Original cases | Original title |
| --- | --: | --- |
| `watchdog.smoke.test.ts:21` | 1 | watchdog delivers through cc-notify, deduplicates after restart, and atomically replaces its checkpoint |

```gherkin
Scenario: Deduplicate a failure episode across watchdog restart
  Given a fixture status server reports a failed colony and a fake notifier records delivery
  When the watchdog observes failure, restarts into the same failure and later observes recovery
  Then it sends exactly one failure and one recovery notification with title Colony health
  And bodies identify the repository, tracker, selected state and socket plus failure detail or recovered asleep state
  And all three requests are status-only requests selecting the same state, with empty watchdog stderr

Scenario: Replace the watchdog checkpoint atomically
  Given the failure checkpoint remains open while recovery is observed
  When the checkpoint is replaced
  Then the old handle still reads failure and the current file reads recovery under a new inode
  And the checkpoint directory contains only the one expected JSON file
```

## System-owned workflow consumer coverage

This current-source inventory is separate from the historical process scenarios above and the [rejected lifecycle cohort](./lifecycle-slow-test-removal.md). It records coverage of Busy Bee's [format-2 outcome contract](../../lib/busybee/SPEC.md#native-workflow-outcomes), not suite execution or restoration evidence.

| Current source | Contract exercised |
| --- | --- |
| [workflow-anchor.test.ts](../../lib/colony/src/workflow-anchor.test.ts) | A confirmed stage retains its own outcome beneath a cancelled run; a pending stage cannot borrow its parent's result. Requested, reopened, reclosed, changed-reason and unauthorized closures cannot become success or executable work. |
| [workflow-anchor.test.ts](../../lib/colony/src/workflow-anchor.test.ts) | Lock, settlement and managed-provenance admission checks; final launch rechecks; clearance rejects missing fences, incomplete generated inventory and changed checkpoint revisions. |
| [Shared workflow-control tests](../../lib/shared/src/workflow-control.test.ts) | Definition-free system/native joins, requested intent remaining nonterminal, old-looking JSON prose not becoming authority, and explicit unsupported-format errors. |
| [Hive UI API tests](../../lib/hive-ui/server/api.test.ts) | Outcome-only reads independent of failed structural preview, separate system/native freshness and unsupported-format adoption diagnostics. |

These use injected tracker/control/runtime observations rather than live worker launches or daemon cutover. Producer-side native gates, preserved notes, settlement retries and requested-success preservation are mapped in [Busy Bee's current inventory](./busybee.md#system-owned-completion-coverage). Retain actual validation results and remaining native/process evidence in the implementation delivery.
