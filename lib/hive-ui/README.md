# Hive UI

A local, read-only work board for ordinary Beads and Bee requests. Beads use native-status kanban; Open and Completed bees offer Outline and Graph views with shared request selection. Cards lead with native task status, priority and labels. Ordinary cards show native assignment and update time; Bee views add identity and timestamped observations. Select a card for its details and relationships, or select a Bee and use Load ancestry to add historical context and inspect where its requester chain ends. Bee page search matches loaded request IDs, identities, kinds, requesters and linked task IDs; native bead filters apply to the selected request’s linked work.

Bead descriptions, acceptance criteria, design, notes and comments render as Markdown, including read-only task checkboxes. Raw HTML is not rendered.

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

The build writes `lib/hive-ui/dist/hive-ui`; installation copies it to `~/.local/bin`. Use `install:bin --directory /path/to/bin` for another destination. It does not start a service.

`BEADS_DB` supplies the default database when set. `--repo` selects the repository discovery directory. The server binds to `127.0.0.1:4318`; use `--port 0` for a free port. Use `--host 0.0.0.0 --port 4324` to make an explicitly configured preview reachable over the LAN. Run `bun run --cwd lib/hive-ui start --help` for all options. Native `br`, `bv` (Beads Viewer, tested with v0.25.2) and `honeycomb` must be on PATH; workflow previews also require a [Busy Bee installation](../busybee/README.md#install) supporting `busybee system preview` and the selected repository's workflow definitions.

To discover the running daemon's registered repository/database pairs at startup:

```sh
hive-ui --daemon
```

Use `hive-ui --help` to select another daemon state/socket. Discovery reads public daemon status without starting it. An unavailable daemon or empty membership fails startup. Restart the UI to refresh membership; board refresh keeps the startup endpoint list.

Hive's `mise run hive-ui` task builds the UI and enables daemon discovery. Pass server options after `--`, for example `mise run hive-ui -- --port 0`. Use the direct CLI for the explicit endpoint modes below.

For an offline endpoint list, create a JSON file of explicit repository/database pairs:

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

The explicit list requires no daemon registration or discovery. Choose it or `--daemon`; they cannot be combined. The switcher queries only the selected colony. Filters and card selection are remembered per colony for the browser session.

## Reading the board

Status choices combine the seven standard UI statuses with `workflow.statuses` from `policy.yaml` beside each colony's selected database. The server reads policy at startup; restart it after changing the policy. Custom statuses such as `in_review` appear as readable filter and column names and are retained in URLs and saved views. A missing policy uses the standard UI statuses; malformed YAML or status configuration stops startup with an error.

- The board opens on **Beads**. Use the main-header **Beads** and **Bees** tabs to choose what to browse. **Beads** shows ordinary beads, excluding `bee`, `system` and `merge` labels, whether or not they are linked to a Bee request. It reads the current task page and selected details, plus open request attribution when an in-progress bead has an assignee.
- Within **Bees**, **Open** shows open requests and **Completed** shows successful closed requests, newest first, in pages of 50 candidate requests. Switch between **Outline** and **Graph** without fetching again. Graph cards are positioned automatically and cannot be dragged. The graph fits on opening and when its layout bounds change; use zoom and Fit to explore. Select a request to read its linked work, then **Load ancestry** when needed. Use **Older requests** to fetch another page. These navigation choices preserve the active bead filters; choose **Include closed beads** or the **Closed** status when needed.
- The left sidebar starts collapsed. Open it with its panel icon for **Views**, **Status**, **Priority** and label rules; its contents scroll independently of the board. **Columns** and the icon-only **Refresh** stay at the bottom, including when collapsed. On small screens, these actions sit beside **Filters & views**, which opens the filter drawer. Opening or collapsing filters retains the current view and selection without reading data.
- **Status** and **Priority** each allow multiple selections: values within each group match with OR, and the groups combine with text and label rules. Priorities range from P0 (Critical) to P4 (Backlog). With no status selected, **Include closed beads** controls closed visibility. Selecting **Closed** explicitly includes closed beads.
- **AND**, **OR** and **Exclude** map to native `br` label groups. Labels are exact and case-sensitive; commas are literal. Suggestions come from the current page. Enter any exact label, or click/right-click a bead label to choose its filter group. Label buttons support keyboard menus too. Actions add to the chosen group without removing rules from other groups; active chips let you remove individual rules.
- Search in the main header submits native Beads text search. Press **/** to focus it from anywhere outside an editing control, dialog or menu. Task pages contain up to 60 cards. In **Bees**, text, status, priority and label rules include a request only when one linked ordinary task satisfies the complete filter. Matching checks every linked task in the candidate page, including tasks beyond the first task page. With no text/status/priority/label rules, all candidate requests remain visible, including requests with no tasks; **Include closed beads** alone does not narrow requests. Explicitly loaded ancestry appears separately as context. A filtered history page can have no matches and still offer **Older requests**.
- **View** switches between named bead filter sets. Save a new view, update its filters/name, or delete it using **Save view** in the sidebar or mobile drawer. For example, select **Blocked**, add **hitl** under **AND**, and save “Blocked · needs me”. Presets contain bead text, statuses, priorities, closed visibility and label groups. Applying one keeps the current Beads/Bees tab, Open/Completed scope, Outline/Graph and page-local request search. Applying a view or editing bead filters resets both pages and clears selections/ancestry. Views persist in this browser per colony without writing to Beads.
- **Show workflow beads**, beside the header search, defaults off. Turn it on to display workflow runs and generated work, marked with the clickable [workflow preview](#workflow-preview) icon. Agent-created tasks remain visible, including tasks nested under a workflow; hiding workflow beads promotes them past hidden ancestors for board presentation. Outlines and the inspector retain the complete native relationships.
- The board groups complete native parent-child families and uses loaded dotted-ID ancestors only for beads without explicit native parents, even when intermediate IDs are missing. Explicit native parents take precedence when an ID suggests a different ancestor. For example, `hv-ezgh1.9.1` shares a lane with `hv-ezgh1`. Dotted grouping affects board presentation only; it does not change tracker relationships or native outlines. Layout adapts automatically. A family with at most one unclosed bead uses ordinary cards. Families with multiple unclosed beads, at most three unclosed descendants, and one shared active status use a full-size root with compact children and tree rails. Larger families or families spanning statuses use horizontal swimlanes, with each card in its native status. Closed and tombstone beads do not contribute to the unclosed count. Board filters and pagination still determine which cards appear; layout thresholds use the complete family.
- Inline nested cards in family rails start collapsed. Each parent's **subcards** toggle shows the number of matching descendants on the current board page and expands or collapses its branch.
- Family lanes start collapsed to one card per populated status column. The heading shows how many matching cards on the current page are hidden; click it to expand or collapse the lane. Lane and subcard toggles retain their state through **Refresh** and bead inspection while the family remains on the board.
- On the Beads board, select **Columns** to open column settings, then use the left/right buttons to reorder visible status columns with a pointer or keyboard. The same order applies to every swimlane and ordinary column. **Reset to default** restores the original order. Preferences survive refresh in this browser per colony; filtering out a status retains its saved position, and newly encountered statuses are appended. Close settings with **Close** or **Escape**.
- Each swimlane header has a **descendant outline** icon for its parent bead; the inspector header has the same action for the selected bead. It opens a dedicated outline for that bead and all nested descendants, with an **Include closed** toggle. This page ignores board filters while retaining them for **Back to board**. Its URL uses `?view=beads&outline=<bead-id>` and supports direct links.
- **Refresh** reads the current view and selected detail on demand, alongside [automatic refresh](#refresh-and-hierarchy).
- The bead inspector opens over the board, expanding to full width on small screens. Its right-hand branch explorer shows the native family. It is omitted, along with the **Bead / Outline** tabs, for standalone beads; parents and sub-beads retain it. Select a bead to update the same modal, or fold a branch to reduce detail. At 760px and below, **Bead** and **Outline** tabs switch between full-height panes. Selecting a bead in the branch explorer opens its **Bead** tab; switching tabs preserves the tree’s scroll position and folded branches. Use **Close** or **Escape** to return, and **Refresh** to update it. Selection remains in the URL, including when following a related bead or using browser history.
- **Include closed** is shared between the inspector’s branch explorer and the dedicated bead outline, independently of the Kanban filters. It defaults off for each browser session. Closed-only branches are hidden; the selected bead and closed ancestors of visible beads remain as context. Toggling uses the loaded family without another data read.
- **Dependencies · outgoing** lists links from the selected bead; **Dependents · incoming** lists links to it. For native `blocks` edges, outgoing means **Depends on** and incoming means **Blocks**. Parent-child links appear in the branch explorer; merge references appear as icons. The remaining links retain their native types and show the first 50 summaries per direction with the full count.
- Requester attribution is recorded; [inferred parent links](../../docs/design/hive-ui.md#bee-outline-and-graph) automatically join visible request cards when the name matches exactly one request across the selected tracker's history, including closed requests. A name unique only on the current page is insufficient. **Load ancestry** adds historical context and reports missing, ambiguous, cyclic or depth-limited chains; that explicit chain takes precedence over automatic links. **Requester provenance** and assignment icons also open ancestry. These reads do not discover every descendant.

Linked tasks show a merge icon that opens the provider request. A warning icon opens a malformed merge bead for inspection; merge beads stay off the task board.

The UI accepts up to 100 open requests per colony, 50 completed requests per history page and eight provenance steps. Exceeding the request limit produces a visible error instead of a silently incomplete board. Native request membership requires a bounded batch detail read; completed request history is queried only in the Completed bees view or for expanded provenance.

## Refresh and hierarchy

Visible views refresh automatically, but not all data refreshes together: main-board task fields, Bee inventory and selected details update more often than family context, descendant outlines, merge icons and Bee assignment annotations. Read the [freshness guide](./FRESHNESS.md) for the per-surface schedule, independent-change examples, manual/browser reload guarantees and export-lag limits. An open workflow preview follows its own [checkpoint polling cadence](#workflow-preview).

The **Refresh** icon rotates gently while workspace data loads, even with reduced motion enabled. Previous snapshots remain visible during refresh; read failures appear as dismissible toasts without shifting the board. Cards and selected details load before their deferred icons, so slow or failed icon reads leave primary data usable.

Task queries apply native filters and request summary fields. Descriptions, acceptance criteria and comments reach the browser only for selected beads. Native Beads owns those task fields; BV supplies exported family topology. Refresh requests new reads but cannot update the export. The design reference explains [hierarchy source checks](../../docs/design/hive-ui.md#hierarchy-source), [workflow identity reuse](../../docs/design/hive-ui.md#workflow-provenance) and [deferred merge discovery](../../docs/design/hive-ui.md#merge-request-references).

### Assignment evidence

Small agent icons beside an assignee appear on cards, outlines and in the inspector. Each icon opens an exact matched Bee request with its captured kind, harness and model, outcome, and timestamped observations. Hover for the kind and request ID; click or use the keyboard to inspect it. Multiple matches have separate icons. A request may have finished since the card was read. Assignment evidence updates on the [background schedule](./FRESHNESS.md#what-refreshes-when) or on-demand **Refresh**, separately from fast native assignee updates; browse **Bees → Completed** for successful request history.

Without a [matching request](../../docs/design/hive-ui.md#attribution-and-uncertainty), the native assignee remains visible without a Bee icon or activity badge. **Activity unknown** means a matched pending request has no recorded stdout time. A familiar name, task ancestry or an older request alone cannot establish a current Bee assignment.

A **Bee assignment and merge details** [failure toast](#refresh-and-hierarchy) concerns missing or older metadata. Retained observations keep their original timestamps; worker activity comes from the output observations below.

Orange outlines and 🐝 indicate recorded Bee output within the last two minutes. Pending requests with ten or more minutes since recorded output turn red as a prompt to investigate; missing output evidence stays neutral. An unresolved failed request also has a red outline. Activity indicators appear on Bee graph/list entries and task cards with a matching request. Output ages advance locally between data reads. These are observations, not live process-health checks. Open **ⓘ About this graph** for the line legend, activity windows and navigation controls.

## Workflow preview

Click the workflow icon on a run or generated stage/group to open its owning run in a modal. The action is available on the board, outlines and bead details, including completed workflow records. Manual descendants have no workflow icon. The preview opens in **Saved** mode. The diagram and instruction panel render locally in Hive. Neither Saved nor Simulate advances the actual run.

The **Native outcome** banner reads the run's native closure independently of the diagram: pending, succeeded, failed, cancelled or unclassified for an old unmarked closure. It shows the terminal reason and warns when derived outcome query labels are stale. A missing or incompatible definition does not prevent this read; malformed native facts surface as an error. The **Saved** chart badge remains checkpoint state, not completion authority. See [native workflow outcomes](../busybee/SPEC.md#native-workflow-outcomes).

While the preview is open in a visible browser tab, it reads native outcome and checks the saved checkpoint every five seconds. Checks pause when the tab is hidden or the preview closes, and resume immediately on return. Updates preserve your selection, viewport, zoom and instruction-panel layout. A failed refresh keeps the last successful diagram with an error and retries through polling. Opening the preview or choosing **Refresh** also reloads the current definition; automatic checks alone do not detect definition-only changes.

Select a node, click an edge to inspect its target, or use **Inspect step** in the instruction panel header. Open retained child workflows from their invoking cards and return through the shared workflow/scope breadcrumbs. **Child workflows** lists retained children without a matching invoking card. Child links show saved actor status. If a saved update removes the selected actor, Saved shows the root actor with a notice. During simulation, choose **Saved** before navigating to another workflow.

Nested states appear as scope boxes. Use **↗ Focus** to inspect a scope and the breadcrumbs to return. Collapse or expand individual scopes; **Collapse all** and **Expand all** act within the displayed view and keep its outermost scopes open. Focus preserves the selected instructions and other scopes' collapse choices. **Show selected step** returns to the workflow root and expands the selected card's ancestor path. Scope controls remain available during simulation. The [design catalogue](../../docs/design/hive-ui.md#component-catalogue) explains scope summaries and omitted transitions.

Switch between **Vertical** and **Horizontal** layouts. **Zoom** offers **Step** to focus the selection, **Full workflow** to fit the chart, and **Choices** to fit the selection and its directly connected incoming and outgoing neighbors.

Blue borders mark **Current** workflow position; green marks **Direct target**. Orange identifies Bee dispatch independently; the [design catalogue](../../docs/design/hive-ui.md#component-catalogue) defines the Bee status indicators. Guard labels describe conditions; Saved mode does not evaluate them. Incoming edges are purple and dashed, outgoing edges green and solid, and inactive edges neutral and dotted. Hover a card to highlight its related edges. Resize the instruction panel by dragging its divider or using the keyboard on the focused divider; **Hide instructions** collapses it to a rail and **Show instructions** restores its size. On narrow screens, the panes stack vertically.

The panel labels **Published task instructions** with their bead ID: these are frozen briefs from active visits. **Instruction preview · saved actor context** shows other states rendered using the current definition and that actor's saved context. Simulate preserves untouched published briefs and labels new text **Instruction preview · simulated context**. New simulated visits keep the brief rendered after automatic transitions settle; other states use current simulated context. Previews describe neither historical briefs nor future context. States without task instructions or whose previews cannot render show that explicitly.

Choose **Simulate** in the canvas toolbar for a temporary walkthrough from the selected actor's saved state. Select an **Outcome**, edit **Event data**, then **Apply event** to evaluate it. **Use example** fills an editable draft from the payload schema; examples may need changes to satisfy guards or author constraints and do not verify real work. **Back** removes the last event; **Reset** clears events from the current starting point.

Simulation keeps its starting snapshot and actor selection while saved updates arrive, even if that actor disappears from the latest checkpoint. A notice identifies a changed checkpoint or diagram source. Choose **Saved** to discard the walkthrough and view the latest saved state; a subsequent **Simulate** starts from that snapshot.

For the root actor, **From beginning** accepts explicit initial JSON even when simulation from saved state is unsupported. **Start from beginning** submits it to Busy Bee for validation; the original creation input is not retained. Until a simulation succeeds and supplies the input schema, **Use example** and **Payload schema** are unavailable for initial input.

Invalid payloads, blocked outcomes and unsupported execution dependencies show an error while retaining the last successful simulation. Busy Bee rejects further replay after the starting checkpoint or definition changes. Use **Refresh** to load any definition change, then **Saved** and **Simulate** to start again. Busy Bee's [simulation contract](../busybee/SPEC.md#simulation) defines supported behavior and the trusted-code boundary.

The titlebar's **Saved** badge shows the latest successfully read checkpoint state, including during simulation. Open ⓘ (**Saved state & diagram source**) for checkpoint and source information. The chart uses the definition available in the selected repository; an amber ⓘ marks compatible source changes, labelled **Source differs** on wider screens. An unavailable or incompatible definition shows an error; an existing diagram remains visible as the last saved state. The checkpoint timestamp includes bookkeeping updates, so it does not identify when the workflow entered its state. Busy Bee's [preview contract](../busybee/SPEC.md#saved-state-preview) defines source matching and saved instruction provenance.

## Component workshop

From the checkout root:

```sh
mise run hive-ui:storybook
```

Storybook listens on all interfaces by default. Open <http://127.0.0.1:6006> locally, or `http://<machine-LAN-IP>:6006` from another device on the same network. Use `mise run hive-ui:storybook -- --host 127.0.0.1` for localhost only, or `mise run hive-ui:storybook -- --port 6007` to choose another port. It requires workspace dependencies (`bun install`) and Node.js 20.19+ or 22.12+ for the Vite builder; no Beads database, `br` or running Colony is needed.

Start with **Bees → Bee graph → Inferred Inventory** for automatic links between loaded requests, **Inferred Ancestry** for an explicitly loaded chain, or **Workspace → Work board → Bee Graph** for the complete interface. Click requests, pan, zoom and use Fit; the full workspace also lets you inspect linked beads and load ancestry. The toolbar switches between Moss and Paper. The workshop uses fixed example records and resets saved views and column preferences between stories in its own browser origin.

**Workspace → Work board** includes **Beads**, **Bees**, **Bee Graph**, **Bead inspector with workflows** and **Paper** examples. **Bead inspector with workflows** opens the normal inspector over the board; use its workflow icon to preview or simulate a captured Land run with fictional context. Focused component examples live under **Beads**:

- **Bead board → Single Workflow**, **Multiple Workflows**, **Nested Workflows** and **Workflow Families** compare family shapes with generated workflow beads visible on load. They cover single-run rails, multiple runs including an unfinished older attempt, and nested supporting work beneath a broader scope.
- **Bead inspector → With Workflows** opens the production inspector dialog without a board background, using the captured Land preview. **With Family** and **Standalone** cover details with and without a branch explorer.
- **Branch explorer → With Workflows** isolates the foldable native family tree, including nested runs and supporting work.
- **Bead outline → With Workflows** shows the dedicated descendant view for one scope.

For assignment evidence, **Beads → Bead card** includes **Assigned Agent**, **Pending Without Output** and **Multiple Assigned Bees**. **Beads → Bead inspector → Assignment Details Unavailable** shows a failed enrichment read alongside usable bead details.

**Beads → Workflow preview → Active run** is the overall workflow preview example: it opens the production modal through the workflow-icon action with a captured checkpoint and illustrative task instructions. Focused cases live in the separate **Workflow preview** section:

- **Canvas** contains **Canvas and instructions**, the **Examples** selector, **Parallel states** for nested scopes and **Hierarchy stress** for a larger chart. All use the shared production canvas.
- **Cards → Step states** compares workflow position and interaction states. **Scope States** adds current, inactive, direct-target and current Bee scopes with collapse controls. **Bee status** compares Pending with no observed output, Active with recent output, Quiet, Investigate, Unknown and the native Succeeded, Failed and Cancelled request outcomes. The [design catalogue](../../docs/design/hive-ui.md#component-catalogue) defines the independent workflow-position and Bee indicators.
- **Edges → Edge states** isolates the connection styles.
- **Simulation → Simulation** exercises the production Simulate controls and leaves the walkthrough at Review. **Initial input after saved failure** exercises **From beginning**: empty input is rejected, then explicit valid JSON starts at Triage. **Nested Bees Unsupported** shows root replay rejecting child coordination; **Nested Bee Child Simulation** replays an isolated child without advancing its parent.
- **Nested actors → Nested Actors**, **Nested Bees Starting** and **Nested Bees Handoff** show branches at different stages, published requests and the final driver summary. They use captures from the [nested-bees example](../busybee/examples/nested-bees/workflow.ts) with memory Beads and mocked Bee dispatch; no workers were launched. The nested simulation cases use the same captures.
- **Refresh → Saved progress during simulation** polls a changed checkpoint without resetting the walkthrough. **Retired actor during simulation** retains a child simulation until **Saved** selects the root actor. **Refresh recovery** exercises a failed manual refresh followed by a successful refresh to a changed checkpoint, preserving the selected step, viewport, zoom and instruction-panel size.
- **Inspection → Completed run** opens a captured completed checkpoint; **Unavailable** shows a failed preview read.

The saved Land simulation and **Bead inspector with workflows** mock preview and simulation requests using the Land machine with fictional context; the running app delegates simulation to Busy Bee.

Open **Workflow preview → Canvas → Examples** and use the **workflow** select in Storybook's Controls panel to choose **Land**, **Parallel**, **Groceries**, **Change review** or **Linear**. These local walkthroughs use fictional input; Change review stops when progression requires actor coordination or unsupported effects.

Use **Parallel states** and **Nested actors** to explore the production [scope and child-workflow navigation](#workflow-preview).

For a larger example, open **Hierarchy stress** and choose **Mixed progress**, **API finished** or **Handoff** from **Snapshot**. Its 50 states use fictional snapshots in the production diagram.

Open **Workflow preview → Canvas → Canvas and instructions** to explore the current [Land definition](../../.workflows/land/workflow.ts), starting at **Check** with fictional context. This isolated workshop shares the production [canvas and panel controls](#workflow-preview).

Workshop instructions render from Land's author callbacks using the example context. **Route** explains automatic branches; **Done** displays the run brief, including the caller's responsibilities after a real run finishes.

Within **Canvas and instructions**, choose **Simulate** to try Land's outcome commands, go **Back one event**, reset to Check or **Start from beginning** at Triage. Buttons name each command's direct destination; automatic routing then settles on the next task and appears in the simulated path. The simulated path wraps and scrolls as needed. Outcomes whose guard does not match the target are disabled. **Step** zoom follows the resulting active step; **Full workflow** keeps the chart fitted. Expand **Sample values** to choose a PR or worktree, edit its request and target, and supply fictional outcome evidence. **Apply & reset** validates the inputs and restarts at Check. Simulated outcomes carry this evidence and, where required, a fictional review receipt into subsequent instructions. This canvas workshop never reads a live workflow or performs checks or integration.

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
