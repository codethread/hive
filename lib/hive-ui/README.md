# Hive UI

A local, read-only work board for Beads linked to open Bee requests. Cards lead with native task status, priority and labels; bee identity and timestamped observations sit underneath. Select a card for its description and comments, then expand requester provenance to load inferred ancestry.

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

- **All of**, **Any of** and **Exclude** map to native `br` label groups. Labels are exact and case-sensitive; commas are literal. Suggestions come from the current page. Enter any exact label manually.
- Search submits native Beads text search. Deferred linked tasks are included. Closed linked tasks are hidden until **Closed beads** is checked. Task pages contain up to 60 cards.
- **Refresh** reads the current board and selected detail again. Snapshots are cached briefly and do not poll. A failed refresh retains the previous data with an error.
- Bee observations retain their original timestamps. They describe recorded state, not current process health. Related work does not imply a task claim; the inspector shows the native assignee separately.
- Requester attribution is recorded; parent bees are inferred by matching friendly names. Missing, ambiguous and cyclic matches remain explicit. Provenance loads only when expanded.

The MVP accepts up to 100 open requests per colony and eight provenance steps. Exceeding the request limit produces a visible error instead of a silently incomplete board. Native request membership requires a bounded batch detail read; closed request history is queried only for expanded provenance.

## Development and diagnostics

`bun run ui:dev` restarts the Bun server when source changes. Reload the browser after edits; React hot replacement is disabled because the current Bun/TanStack Router combination fails during route initialization with it enabled. Bun serves HTML/TSX and Tailwind directly, without a separate build command.

Every data call logs a JSON sample: browser calls in developer tools, HTTP and native calls on server stderr. Use `--log-file /absolute/path/to/ui.jsonl` to write server diagnostics to a file (appended across runs). For machine startup, run Bun directly from `lib/hive-ui`: `bun ./server/index.ts --beads-db /absolute/path/to/beads.db --json --log-file /absolute/path/to/ui.jsonl`. Stdout contains one startup result with the URL and log path; stderr remains silent. Samples include a shared request ID, duration, outcome/status and payload bytes. Native samples include the query arguments; recipes, prompts and response bodies are omitted. These logs make eager reads and slow queries visible without adding telemetry infrastructure.

The architecture and Millstrand exploration are in [the design document](../../docs/design/hive-ui.md).
