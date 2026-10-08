# Hive UI

A local, read-only work board for ordinary Beads and work linked to Bee requests. Cards lead with native task status, priority and labels. Ordinary cards show native assignment and update time; Bee views add identity and timestamped observations. Select a card for its description and comments, or expand a Bee’s requester provenance to load inferred ancestry.

From the repository root, install workspace dependencies with `bun install`, then run:

```bash
bun run ui --beads-db /absolute/path/to/.beads/beads.db
```

`BEADS_DB` supplies the default database when set. `--repo` selects the repository discovery directory. The server binds to `127.0.0.1:4318`; use `--port 0` for a free port. Run `bun run ui --help` for all options. Native `br` and `honeycomb` must be on PATH.

For multiple colonies, create a JSON file of explicit repository/database pairs:

```json
[
	{
		"name": "Hive",
		"root": "/absolute/path/to/hive",
		"beadsDb": "/absolute/path/to/tracker/.beads/beads.db"
	}
]
```

```bash
bun run ui --colonies /absolute/path/to/colonies.json
```

The switcher queries only the selected colony. Filters and card selection are remembered per colony for the browser session. No daemon registration or discovery is required.

## Reading the board

- **View → Beads** shows ordinary beads, excluding both `bee` and `system` labels, whether or not they are linked to a Bee request. It reads only the current task page and selected details.
- **Open bees** shows work linked to open requests. **Completed bees** shows work linked to successful closed requests, newest first, in pages of 50 requests. Use **Older requests** to fetch another page; task filters apply within the selected request page. Switching to Completed bees includes closed tasks automatically.
- **All of**, **Any of** and **Exclude** map to native `br` label groups. Labels are exact and case-sensitive; commas are literal. Suggestions come from the current page. Enter any exact label manually.
- Search submits native Beads text search. Deferred tasks are included. Closed tasks are hidden until **Closed beads** is checked. Task pages contain up to 60 cards.
- **Refresh** reads the current board and selected detail again. Snapshots are cached briefly and do not poll. A failed refresh retains the previous data with an error.
- Bee observations retain their original timestamps. They describe recorded state, not current process health. Related work does not imply a task claim; the inspector shows the native assignee separately.
- Requester attribution is recorded; parent bees are inferred by matching friendly names. Missing, ambiguous and cyclic matches remain explicit. Provenance loads only when expanded.

The MVP accepts up to 100 open requests per colony, 50 completed requests per history page and eight provenance steps. Exceeding the request limit produces a visible error instead of a silently incomplete board. Native request membership requires a bounded batch detail read; completed request history is queried only in the Completed bees view or for expanded provenance.

## Development and diagnostics

`bun run ui:dev` restarts the Bun server when source changes. Reload the browser after edits; React hot replacement is disabled because the current Bun/TanStack Router combination fails during route initialization with it enabled. Bun serves HTML/TSX and Tailwind directly, without a separate build command.

Every data call logs a JSON sample: browser calls in developer tools, HTTP and native calls on server stderr. Use `--log-file /absolute/path/to/ui.jsonl` to write server diagnostics to a file (appended across runs). For machine startup, run Bun directly from `lib/hive-ui`: `bun ./server/index.ts --beads-db /absolute/path/to/beads.db --json --log-file /absolute/path/to/ui.jsonl`. Stdout contains one startup result with the URL and log path; stderr remains silent. Samples include a shared request ID, duration, outcome/status and payload bytes. Native samples include the query arguments; recipes, prompts and response bodies are omitted. These logs make eager reads and slow queries visible without adding telemetry infrastructure.

The architecture and Millstrand exploration are in [the design document](../../docs/design/hive-ui.md).
