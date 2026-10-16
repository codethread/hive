# Execution and recovery

## Retry and partial submission

Resolve the cause before following `bee retry --help`; retain the replacement request ID for its answer.

If submission partially fails, inspect confirmed IDs, reported replacements and incoming request links before repeating it. `bee attach-workflow --help` covers confirmed orphan runs; attachment is not an atomic uniqueness guarantee. For a failure requiring no further work, follow `bee ack --help`.

## Cancel execution

Follow `bee stop --help`. Before cleaning up detached workers or sleeping colonies, read `colony skills get operations` for runtime lifetime and process verification.

## Complete an assigned execution

Keep the supplied identity, tracker and working directory. Follow the injected assignment and run/stage briefs for claims, reservations and workflow completion. For workflow navigation beyond those briefs, read `busybee skills get workflow-execution`.

Read `bee response --help` before delivering the assigned answer or blocker, then `bee finish --help` before reporting completion. Those commands own publication, correction and settlement instructions.
