# Colony event listener spike

This checkout provides a Bun TypeScript proof of concept: a real daemon event stream, typed handlers, and two independently started listeners. Existing post-run assessment automation remains active. These are local workspace exports, not a registry release or a general automation host.

## Run the complete demo

From the Hive checkout, with dependencies installed and Bun, Git, `br` and `honeycomb` on `PATH`:

```sh
bun run lib/colony/scripts/events-demo.ts
```

The demo creates two disposable Git/Beads repositories, starts a private source daemon and two separate named listener processes, and runs two deterministic Bun workers. It makes no model calls. Both listeners consume settlements from both colonies. It waits for both checkpoints, prints the retained evidence directory, then stops the listeners and daemon. Inspect `settlement-log.log`, `assessment-intake.cursor.json` and `intake/*.json` under that directory. The fixture repositories and evidence remain for inspection.

## Discover and run one listener

Discovery reads `.hive/listeners/<name>/listener.toml` in the **selected checkout**, without executing listener code. Running a name imports its entry's named `createListener` export. Listener definitions are trusted executable code.

```sh
bun run lib/colony/bin/listener-spike.ts list --repo "$PWD"
bun run lib/colony/bin/listener-spike.ts run assessment-intake \
  --repo "$PWD" --config /absolute/path/intake.json
```

The selected checkout controls listener code; `colonies` in the configuration selects event sources. The listener connects to an already running daemon and does not start or wake it. Use this checkout's source CLI to start the spike daemon; an older installed daemon does not provide this endpoint:

```sh
bun run lib/colony/bin/colony.ts add --repo /absolute/repository \
  --beads-db /absolute/tracker/beads.db \
  --state /absolute/daemon-state --socket /absolute/colony.sock
```

Example `/absolute/path/intake.json`:

```json
{
	"socket": "/absolute/colony.sock",
	"state": "/absolute/daemon-state",
	"colonies": [{ "root": "/absolute/repository", "beadsDb": "/absolute/tracker/beads.db" }],
	"start": { "kind": "retained" },
	"checkpointFile": "/absolute/listener-state/intake.cursor.json",
	"outputDirectory": "/absolute/listener-state/intake"
}
```

Use canonical absolute repository paths and the exact registered tracker paths. Add another registered `{ "root", "beadsDb" }` pair to observe multiple colonies on that same daemon; omit it to observe only one. Empty selections are invalid. Separate daemons require separate listener runs and checkpoints. Stop a foreground listener with Ctrl-C; rerun the same command to resume after its saved cursor.

The included `settlement-log` listener prints request outcomes. `assessment-intake` saves one JSON evidence artifact per event, records available/missing stdout coverage and file sizes, and never launches a bee or changes tasks. Give each listener its own checkpoint. The intake uses only public event fields and referenced stdout metadata, without opening Colony's database or raw credential-bearing receipts.

## Author a typed listener

Create `.hive/listeners/my-listener/listener.toml`:

```toml
description = "Describe this consumer's effect."
run = "./listener.ts"
```

Its `listener.ts` exports a factory:

```ts
import { ColonyListener } from "@hive/shared/colony-events/client";
import type { ColonyListenerOptions } from "@hive/shared/colony-events/client";

export function createListener(options: ColonyListenerOptions): ColonyListener {
	return new ColonyListener(options).on("request.settled", async (event) => {
		// event is inferred from the event name; await every effect here.
		await Bun.write(
			`/absolute/output/${event.cursor.logId}-${event.cursor.sequence}.json`,
			JSON.stringify(event),
		);
	});
}
```

The runner supplies connection options and a file checkpoint, plus a second context argument with `outputDirectory` if the factory needs it. Outside the runner, instantiate the class with your own async `checkpoint.load` and `checkpoint.save`, register handlers, then call `await listener.run(signal)`. Register all handlers before running, and run one stream per instance. `subscribeColonyEvents` exposes the lower-level async generator, including checkpoint messages; its caller owns effect ordering and checkpoint persistence.

Runtime schemas and inferred types are exported from `@hive/shared/colony-events`, including `colonyEventSchema`, `colonyEventSubscriptionSchema` and `ColonyEventCursor`. The client subpath uses Bun's Unix-socket fetch and the maintained [eventsource-parser](https://github.com/rexxars/eventsource-parser) streaming parser. Node and browser consumption are not proven by this spike.

## Delivery and scope

- `request.settled` is the only event. It contains the repository/tracker pair, final request outcome, task IDs, friendly identity and attempt evidence paths. It is not a worker-exit event or proof of task acceptance. Native Beads remains task authority.
- Settlement and event insertion share one SQLite transaction. Notifications happen after commit. Restart preserves the journal identity and sequence; replacing state invalidates old cursors. Settlement publication does not backfill requests that settled before this implementation.
- `POST /events` sends a parsed subscription and the `x-colony-state` header to the selected Unix socket, then receives SSE. Streams stay outside the serialized control-command queue. Daemon stop closes them.
- `live` starts at the current tail; `retained` starts before the oldest retained event; `after` resumes strictly after a cursor. A saved checkpoint overrides the configured first-run start. An initial checkpoint establishes subscription readiness. Later checkpoints can advance over filtered-out events.
- Handlers run serially and are awaited. Progress advances only after all matching effects succeed. Handler or checkpoint failure stops the consumer; restart replays unprocessed work. Effects can repeat if interrupted between an effect and checkpoint save, so consumers need idempotent effects. This is not exactly-once delivery.
- Keep one process per checkpoint. Reuse a checkpoint only with unchanged event selection, handlers and effect destination. The example rejects changed source paths, daemon selection or colony selection; it does not fingerprint handler code or output settings. Choose a fresh checkpoint deliberately when changing them.
- Retention covers the most recent 10,000 sequence positions globally on the daemon. Readers pull at most 64 matching records per page and wait on commit notifications when caught up; no growing per-reader event history is queued. This bounds page counts, not individual payload bytes. Throughput and memory have not been benchmarked.
- Expired, future and wrong-journal cursors fail explicitly (`cursor_expired`, `future_cursor`, `wrong_log`). A slow reader can expire while connected. It must choose recovery explicitly; there is no silent jump to the tail. The SDK caps incomplete SSE messages at 1,048,576 characters.
- Startup, restart, retry and reconnection policy belong to the caller. There is no installed service, automatic reconnect loop or daemon-hosted listener registry. A local file checkpoint uses atomic replacement, without promising power-loss durability or concurrent-writer coordination.

## Findings before assessment extraction

The spike proves external intake can react to completed requests and retain replayable evidence without private database access. It does not establish a complete assessment evidence contract: attempt paths may be missing, stdout metadata is not a transcript, and a final request outcome says nothing about which attempts launched successfully. Recipe provenance, launch coverage, transcript availability and redaction still need explicit supported data contracts.

A real extraction also needs externally owned assessment configuration, queue/state, deduplication of billable effects, retry policy, artifacts and a nurse read interface. Decide how that consumer recovers after retention expiry, how it is started and supervised, and how it avoids overlap with current assessment automation. Those responsibilities remain outside Colony in the proposed direction; this spike leaves the existing implementation in place for that later decision. The settlement event catalogue is intentionally narrow and does not imply a wider lifecycle catalogue is settled.

## Verification

```sh
bun test lib/colony/src/events.smoke.test.ts lib/colony/src/daemon.smoke.test.ts
bun run check
bun run test
```

Focused coverage checks real Unix streaming, exact repository/tracker filtering, replay after reopen, awaited effects and restart after handler failure, consumer evidence, transaction rollback and duplicate settlement, retention expiry, and foreground daemon shutdown with an open subscription. The separate demo exercises named listener processes against actual request settlement in two disposable colonies.
