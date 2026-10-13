# Hive UI

A local, read-only work board for ordinary Beads and Bee requests. Beads use native-status kanban; Open and Completed bees offer Outline and Graph views with shared request selection. Cards lead with native task status, priority and labels. Ordinary cards show native assignment and update time; Bee views add identity and timestamped observations. Select a card for its description, Markdown acceptance criteria (including read-only task checkboxes), relationships and comments, or select a Bee and use Load ancestry to add inferred provenance and historical context. Bee page search matches loaded request IDs, identities, kinds, requesters and linked task IDs; native bead filters apply to the selected request’s linked work.

From the repository root, install workspace dependencies with `bun install`, then run:

```bash
bun run --cwd lib/hive-ui start --beads-db /absolute/path/to/.beads/beads.db
```

To run a standalone server with embedded browser assets, compile and install it separately:

```sh
bun run --filter @hive/hive-ui build
bun run --filter @hive/hive-ui install:bin
hive-ui --beads-db /absolute/path/to/.beads/beads.db
```

The build writes `lib/hive-ui/dist/hive-ui`; installation copies it to `~/.local/bin`. Use `install:bin --directory /path/to/bin` for another destination. It needs native `br` and `honeycomb` at runtime, and does not start a service.

`BEADS_DB` supplies the default database when set. `--repo` selects the repository discovery directory. The server binds to `127.0.0.1:4318`; use `--port 0` for a free port. Use `--host 0.0.0.0 --port 4324` to make an explicitly configured preview reachable over the LAN. Run `bun run --cwd lib/hive-ui start --help` for all options. Native `br` and `honeycomb` must be on PATH.

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
bun run --cwd lib/hive-ui start --colonies /absolute/path/to/colonies.json
```

The switcher queries only the selected colony. Filters and card selection are remembered per colony for the browser session. No daemon registration or discovery is required.

## Reading the board

Status choices combine all eight native defaults with `workflow.statuses` from `policy.yaml` beside each colony's selected database. The server reads policy at startup; restart it after changing the policy. Custom statuses such as `in_review` appear as readable filter and column names and are retained in URLs and saved views. A missing policy uses native defaults; malformed YAML or status configuration stops startup with an error.

- Use the main-header **Beads** and **Bees** tabs to choose what to browse. **Beads** shows ordinary beads, excluding both `bee` and `system` labels, whether or not they are linked to a Bee request. It reads the current task page and selected details, plus open request attribution when an in-progress bead has an assignee.
- Within **Bees**, **Open** shows open requests and **Completed** shows successful closed requests, newest first, in pages of 50 candidate requests. Switch between **Outline** and **Graph** without fetching again. Graph cards are positioned automatically and cannot be dragged; use zoom and Fit to explore. Select a request to read its linked work, then **Load ancestry** when needed. Use **Older requests** to fetch another page. These navigation choices preserve the active bead filters; choose **Include closed beads** or the **Closed** status when needed.
- The left sidebar holds **Views**, **Status**, **Priority** and label rules. Collapse it with its panel icon; its contents scroll independently of the board. On small screens, **Filters & views** opens the same controls in a drawer. Opening or collapsing filters retains the current view and selection without reading data.
- **Status** and **Priority** each allow multiple selections: values within each group match with OR, and the groups combine with text and label rules. Priorities range from P0 (Critical) to P4 (Backlog). With no status selected, deferred tasks remain included and **Include closed beads** controls closed visibility. Selecting **Closed** explicitly includes closed beads.
- **AND**, **OR** and **Exclude** map to native `br` label groups. Labels are exact and case-sensitive; commas are literal. Suggestions come from the current page. Enter any exact label, or click/right-click a bead label to choose its filter group. Label buttons support keyboard menus too. Actions add to the chosen group without removing rules from other groups; active chips let you remove individual rules.
- Search in the main header submits native Beads text search. Press **/** to focus it from anywhere outside an editing control, dialog or menu. Task pages contain up to 60 cards. In **Bees**, text, status, priority and label rules include a request only when one linked ordinary task satisfies the complete filter. Matching checks every linked task in the candidate page, including tasks beyond the first task page. With no text/status/priority/label rules, all candidate requests remain visible, including requests with no tasks; **Include closed beads** alone does not narrow requests. Explicitly loaded ancestry appears separately as context. A filtered history page can have no matches and still offer **Older requests**.
- **View** switches between named bead filter sets. Save a new view, update its filters/name, or delete it using **Save view** in the sidebar or mobile drawer. For example, select **Blocked**, add **hitl** under **AND**, and save “Blocked · needs me”. Presets contain bead text, statuses, priorities, closed visibility and label groups. Applying one keeps the current Beads/Bees tab, Open/Completed scope, Outline/Graph and page-local request search. Applying a view or editing bead filters resets both pages and clears selections/ancestry. Views persist in this browser per colony without writing to Beads.
- The board groups complete native parent-child families and joins them through loaded dotted-ID ancestors, even when intermediate IDs or native parent links are missing. For example, `hv-ezgh1.9.1` shares a lane with `hv-ezgh1`. Dotted grouping affects board presentation only; it does not change tracker relationships or native outlines. Layout adapts automatically. A family with at most one unclosed bead uses ordinary cards. Families with multiple unclosed beads, at most three unclosed descendants, and one shared active status use a full-size root with compact children and tree rails. Larger families or families spanning statuses use horizontal swimlanes, with each card in its native status. Closed and tombstone beads do not contribute to the unclosed count. Board filters and pagination still determine which cards appear; layout thresholds use the complete family.
- Click a swimlane heading to collapse it to one card per status column. The heading shows how many matching cards are hidden; click it again to expand. Lanes start expanded and retain their collapsed state while refreshing the board or inspecting a bead.
- Select **Columns** beside **Refresh** to open column settings, then use the left/right buttons to reorder visible status columns with a pointer or keyboard. The same order applies to every swimlane and ordinary column. **Reset to default** restores the original order. Preferences survive refresh in this browser per colony; filtering out a status retains its saved position, and newly encountered statuses are appended. Close settings with **Close** or **Escape**.
- Each swimlane header has a **descendant outline** icon for its parent bead; the inspector header has the same action for the selected bead. It opens a dedicated outline for that bead and all nested descendants, with an **Include closed** toggle. This page ignores board filters while retaining them for **Back to board**. Its URL uses `?view=beads&outline=<bead-id>` and supports direct links.
- **Refresh** reads the current board and selected detail again. Snapshots are cached briefly and do not poll. A failed refresh retains the previous data with an error.
- The bead inspector opens over the board, expanding to full width on small screens. The right-hand outline shows the native family. It is omitted, along with the **Bead / Outline** tabs, for standalone beads; parents and sub-beads retain it. Select a bead to update the same modal, or fold a branch to reduce detail. At 760px and below, **Bead** and **Outline** tabs switch between full-height panes. Selecting an outline bead opens its **Bead** tab; switching tabs preserves the outline’s scroll position and folded branches. Use **Close** or **Escape** to return, and **Refresh** to update it. Selection remains in the URL, including when following a related bead or using browser history.
- **Include closed** is shared between the inspector outline and full-page outline, independently of the Kanban filters. It defaults off for each browser session. Closed-only branches are hidden; the selected bead and closed ancestors of visible beads remain as context. Toggling uses the loaded family without another data read.
- **Dependencies · outgoing** lists links from the selected bead; **Dependents · incoming** lists links to it. For native `blocks` edges, outgoing means **Depends on** and incoming means **Blocks**. Parent-child links appear in the branch explorer. The dependency lists retain all other native types and link to the other bead, showing the first 50 summaries per direction with the full count.
- A small agent icon beside the assignee marks an in-progress bead whose native assignee matches an open Bee request linked to it. The icon appears on cards and in the inspector; hover for the Bee kind and request ID. It reflects recorded assignment, not a live process check. A task link alone does not earn the indicator. Refresh the board or detail to update it.
- Bee observations retain their original timestamps. They describe recorded state, not current process health. Related work does not imply a task claim; the inspector shows the native assignee separately.
- Requester attribution is recorded; parent bees are inferred by matching friendly names. Missing, ambiguous and cyclic matches remain explicit. Provenance loads only when expanded.

Cards load first; complete family summaries load independently with a **Loading hierarchy…** indicator. Bead descriptions, acceptance criteria and comments load only when a bead is selected. Opening an outline loads that subtree; Bee history and ancestry retain their explicit navigation controls. A failed hierarchy read leaves the cards usable and shows an error rather than presenting an incomplete tree as complete. Refreshing a changed family marks overlapping browser snapshots **out of date** until revisited or refreshed; older responses cannot restore superseded family links.

Family reads follow only native `parent-child` edges. Summary batches contain at most 100 IDs and relationship reads run with at most four concurrent native commands. Native edge counts skip queries only when every edge is already known; they never infer family membership. Exact-ID reads retain linked tombstones and other records omitted by native list. No depth or descendant limit truncates the tree. Complete family snapshots are reused for ten seconds across the board, outline and inspector; manual refresh reads again. Reads observe native state across several commands, not an atomic tracker snapshot.

The UI accepts up to 100 open requests per colony, 50 completed requests per history page and eight provenance steps. Exceeding the request limit produces a visible error instead of a silently incomplete board. Native request membership requires a bounded batch detail read; completed request history is queried only in the Completed bees view or for expanded provenance.

## Component workshop

From the checkout root:

```sh
mise run hive-ui:storybook
```

Storybook listens on all interfaces by default. Open <http://127.0.0.1:6006> locally, or `http://<machine-LAN-IP>:6006` from another device on the same network. Use `mise run hive-ui:storybook -- --host 127.0.0.1` for localhost only, or `mise run hive-ui:storybook -- --port 6007` to choose another port. It requires workspace dependencies (`bun install`) and Node.js 20.19+ or 22.12+ for the Vite builder; no Beads database, `br` or running Colony is needed.

Start with **Bees → Bee graph → Inferred Ancestry** for the graph canvas, or **Workspace → Work board → Bee Graph** for the complete interface. Click requests, pan, zoom and use Fit; the full workspace also lets you inspect linked beads and load ancestry. The toolbar switches between Moss and Paper. The workshop uses fixed example records and resets saved views and column preferences between stories in its own browser origin.

The catalogue also covers boards, cards, inspector and outlines, filters, saved views, navigation, column settings, tabs, Markdown and resource notices. Autodocs and the Controls, Actions and Accessibility panels sit beside the examples. Resize the preview to explore the mobile filter drawer and inspector panes.

```sh
mise run hive-ui:storybook:build
```

The static build is written to `lib/hive-ui/dist/storybook`. Serve that directory over HTTP, rather than opening `index.html` directly. MSW uses a service worker on localhost/HTTPS and browser request interception on plain LAN HTTP. The package also exposes `bun run --cwd lib/hive-ui storybook`, `storybook:build` and `storybook:check`.

Canonical names live in the nested [UI glossary](./GLOSSARY.md), with component/story mappings in the [design catalogue](../../docs/design/hive-ui.md#component-catalogue). The package typecheck gate checks that all story titles, glossary names and mapped component exports stay in sync.

## Development and diagnostics

`bun run --cwd lib/hive-ui dev` restarts the Bun server when source changes. Reload the browser after edits; React hot replacement is disabled because the current Bun/TanStack Router combination fails during route initialization with it enabled. Development serves HTML/TSX and Tailwind directly. The standalone build embeds those assets, with Tailwind processed at build time.

Every data call logs a JSON sample: browser calls in developer tools, HTTP and native calls on server stderr. Use `--log-file /absolute/path/to/ui.jsonl` to write server diagnostics to a file (appended across runs). For machine startup, run Bun directly from `lib/hive-ui`: `bun ./server/index.ts --beads-db /absolute/path/to/beads.db --json --log-file /absolute/path/to/ui.jsonl`. Stdout contains one startup result with the URL and log path; stderr remains silent. Samples include a shared request ID, duration, outcome/status and payload bytes. Native samples include the query arguments; recipes, prompts and response bodies are omitted. These logs make eager reads and slow queries visible without adding telemetry infrastructure.

The architecture and Millstrand exploration are in [the design document](../../docs/design/hive-ui.md).
