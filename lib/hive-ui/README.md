# Hive UI

A local, read-only work board for ordinary Beads and Bee requests. Beads use native-status kanban; Open and Completed bees offer Outline and Graph views with shared request selection. Cards lead with native task status, priority and labels. Ordinary cards show native assignment and update time; Bee views add identity and timestamped observations. Select a card for its description, Markdown acceptance criteria (including read-only task checkboxes), relationships and comments, or select a Bee and use Load ancestry to add inferred provenance and historical context. Bee page search matches loaded request IDs, identities, kinds, requesters and linked task IDs; native bead filters apply to the selected request’s linked work.

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
- **Open bees** shows open requests. **Completed bees** shows successful closed requests, newest first, in pages of 50 requests. Switch between **Outline** and **Graph** without fetching again. Graph cards are positioned automatically and cannot be dragged; use zoom and Fit to explore. Select a request to read its linked work, then **Load ancestry** when needed. Use **Older requests** to fetch another page. Switching to Completed bees includes closed tasks automatically.
- Open **Filters** for search, closed-bead visibility and label groups in the left drawer. **All of**, **Any of** and **Exclude** map to native `br` label groups. Labels are exact and case-sensitive; commas are literal. Suggestions come from the current page. Enter any exact label manually.
- Search submits native Beads text search. Deferred tasks are included. Closed tasks are hidden until **Include closed beads** is checked. Task pages contain up to 60 cards.
- **Saved view** switches between named filter sets. Inside **Filters**, save a new view, update its filters or name, or delete it. Views are stored in this browser per colony and survive reloads. Applying one resets task/history pages and bead selection; it never writes to Beads.
- **Refresh** reads the current board and selected detail again. Snapshots are cached briefly and do not poll. A failed refresh retains the previous data with an error.
- The bead inspector opens over the board, expanding to full width on small screens. Use **Close** or **Escape** to return, and **Refresh detail** to update it. Selection remains in the URL, including when following a related bead or using browser history.
- **Dependencies · outgoing** lists links from the selected bead; **Dependents · incoming** lists links to it. For native `blocks` edges, outgoing means **Depends on** and incoming means **Blocks**. For `parent-child`, they mean **Parent** and **Child**. Every relationship retains its native type and links to the other bead. The inspector shows the first 50 summaries per direction with the full count; it does not traverse the graph.
- Bee observations retain their original timestamps. They describe recorded state, not current process health. Related work does not imply a task claim; the inspector shows the native assignee separately.
- Requester attribution is recorded; parent bees are inferred by matching friendly names. Missing, ambiguous and cyclic matches remain explicit. Provenance loads only when expanded.

The MVP accepts up to 100 open requests per colony, 50 completed requests per history page and eight provenance steps. Exceeding the request limit produces a visible error instead of a silently incomplete board. Native request membership requires a bounded batch detail read; completed request history is queried only in the Completed bees view or for expanded provenance.

## Development and diagnostics

`bun run ui:dev` restarts the Bun server when source changes. Reload the browser after edits; React hot replacement is disabled because the current Bun/TanStack Router combination fails during route initialization with it enabled. Bun serves HTML/TSX and Tailwind directly, without a separate build command.

Every data call logs a JSON sample: browser calls in developer tools, HTTP and native calls on server stderr. Use `--log-file /absolute/path/to/ui.jsonl` to write server diagnostics to a file (appended across runs). For machine startup, run Bun directly from `lib/hive-ui`: `bun ./server/index.ts --beads-db /absolute/path/to/beads.db --json --log-file /absolute/path/to/ui.jsonl`. Stdout contains one startup result with the URL and log path; stderr remains silent. Samples include a shared request ID, duration, outcome/status and payload bytes. Native samples include the query arguments; recipes, prompts and response bodies are omitted. These logs make eager reads and slow queries visible without adding telemetry infrastructure.

The architecture and Millstrand exploration are in [the design document](../../docs/design/hive-ui.md).
