# Execution and recovery

## Retry and partial submission

Resolve the cause before following `bee retry --help`. It covers replacement eligibility, current defaults and retention of the existing workflow. Use the replacement's returned request ID for its answer; `bee result --help` explains response lineage.

If submission partially fails, retain confirmed IDs and inspect native incoming request links before repeating it. `bee attach-workflow --help` covers confirmed orphan runs; attachment is not an atomic uniqueness guarantee. A label-publication error may follow successful creation, so inspect any `replacementIds` before resubmitting. For a failure requiring no further work, follow `bee ack --help`.

## Cancel execution

Follow `bee stop --help` for request cancellation. For sleeping colonies, daemon stops or detached workers, read `colony skills get operations` before cleanup; it covers runtime lifetime and verification through the selected server.

## Complete an assigned execution

Keep the supplied identity, tracker and working directory. The injected assignment and active run/stage briefs own claim limits, reservations, result recording and completion steps. Follow them with `busybee --help`; drivers collect saved closed-stage results, including interrupted deliveries, while Busy Bee advances and closes the run.

Before delivering an answer or blocker, read `bee response --help` and follow its publication, verification and correction instructions for the assigned run or stage. Drivers read worker answers with `bee result` and file one synthesis against the run. Workflow outcome notes and progress comments remain separate from that complete response.

Read `bee finish --help` before reporting success or a blocker. Its acknowledgment is durable report submission; Colony validates and settles it when awake. Publishing a response does not complete native work or settle the execution.
