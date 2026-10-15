# Hive UI

Hive UI replaces the generated Python/HTML prototype with a small React application in `lib/hive-ui`. It reads real Beads data: ordinary tasks use native-status columns, while Bee requests use Outline and Graph provenance views. Both share an inspector, exact native label filters, Moss and Paper themes, and one selected colony at a time.

The UI does not claim work, edit labels, close beads, retry requests, start a daemon, or introduce a second tracker. The original `pi/active-bees-work-board-poc` branch remains a visual reference, not a code dependency.

## Component catalogue

The nested [Hive UI glossary](../../lib/hive-ui/GLOSSARY.md) owns the canonical presentation names. Story titles use those exact names under Bees, Beads, Workspace and Foundations. This table maps them to the production components; change the glossary, table and story metadata together when renaming a surface. `bun run --cwd lib/hive-ui storybook:check` verifies this mapping and is included in the package typecheck gate.

| Canonical name | Story title | Key components |
| --- | --- | --- |
| Bee graph | `Bees/Bee graph` | `BeeGraph` |
| Bee workspace | `Bees/Bee workspace` | `BeeWorkspace` |
| Workflow preview | `Beads/Workflow preview` | `BeadCard`, `WorkflowIndicator`, `WorkflowDiagram` |
| Bead card | `Beads/Bead card` | `BeadCard` |
| Bead board | `Beads/Bead board` | `BeadBoard` |
| Bead outline | `Beads/Bead outline` | `BeadOutline`, `OutlineClosedToggle` |
| Branch explorer | `Beads/Branch explorer` | `BranchExplorer` |
| Bead inspector | `Beads/Bead inspector` | `Inspector` |
| Work board | `Workspace/Work board` | `Shell`, `WorkPage` |
| Filter workspace | `Workspace/Filter workspace` | `FilterWorkspace` |
| Filter controls | `Workspace/Filter controls` | `StatusFilters`, `PriorityFilters`, `LabelFilters`, `ActiveFilters`, `FilterableLabel` |
| Board navigation | `Workspace/Board navigation` | `BoardTabs`, `BeeHistory` |
| Board search | `Workspace/Board search` | `HeaderSearch`, `BeeSearch` |
| Column settings | `Workspace/Column settings` | `ColumnSettings` |
| Tabs | `Foundations/Tabs` | `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` |
| Markdown content | `Foundations/Markdown content` | `MarkdownContent` |
| Resource notice | `Foundations/Resource notice` | `ResourceNotice` |
| Bead metadata | `Foundations/Bead metadata` | `Label`, `BeeAssignment` |

Storybook lives in the same package, with configuration in `lib/hive-ui/.storybook` and stories/fixtures in `lib/hive-ui/src/stories`. Its React/Vite builder processes the production stylesheet through Tailwind 4. This is a development workshop; the product still uses Bun's server and asset build. Package typechecking includes the workshop configuration and stories.

Stories render the production components using a memory router, production stores and MSW fixture responses. The workshop never starts the native API or reads a tracker. Navigation, selection, filter changes, refresh and ancestry actions use deterministic responses; timestamps describe fixed observations. Stores, saved views and column preferences reset between stories in the workshop's browser origin. Full-page stories compose the real shell, including the responsive sidebar/drawer and inspector.

Bee graph stories show recorded requesters, inferred ancestry, historical context, all request outcomes, empty results and long identities. Selection updates a visible selected-request readout and records a selection action. The Bee workspace and Work board stories exercise selection, linked work and ancestry end to end. All stories share a Moss/Paper toolbar; Paper also has explicit visual examples. Autodocs, controls, actions and accessibility inspection are available from Storybook's panels.

Launch and static-build commands are in the [usage guide](../../lib/hive-ui/README.md#component-workshop).

## What the Millstrand exploration found

Three Luna explorations are recorded on `hv-active-bees-work-board-x68q.2`, `.3`, and `.4`. Their source was the local `millstrand-ui` checkout on 2026-10-08.

| Pattern | Source in Millstrand UI | Hive adaptation |
| --- | --- | --- |
| Small React/TypeScript components; URL-owned navigation | `src/main.tsx`, `src/lib/navigation.ts`, `src/components/issue-surface.tsx` | TanStack Router validates colony, filters and selected bead; components render store selectors. |
| Narrow state subscriptions | `src/store.ts`, `src/review-comment-store.ts`, `src/hooks/use-cards.ts` | Vanilla Zustand stores own snapshots and actions outside React; readers select a resource key rather than the whole store. |
| Boundary parsing | `src/lib/dashboard-search.ts`, `server/parse.ts` | Zod validates configuration, URL search, native output and HTTP responses at their respective entry points. |
| Summary versus demand-driven detail | `server/workspace-database.ts`, `src/lib/api/cards.ts`, `src/components/issue-detail.tsx` | Board DTOs omit descriptions/comments. Selected bead and requester ancestry have separate endpoints. |
| Explicit fetch ownership | `src/components/workspace-resource-polls.tsx`, `src/hooks/use-graph.ts` | Route loaders and user actions own requests; renderers do not start effects or background queries. Manual refresh. |
| Data-call diagnostics | `shared/perf.ts`, `server/perf.ts`, `server/strand.ts`, `src/lib/api/transport.ts`, `docs/read-performance.md` | Structured client, HTTP and native-call samples share a request ID, durations and outcomes. No prompt or body logging. |
| Semantic styling and web checks | `src/index.css`, `.oxlintrc.json`, `package.json` | Tailwind 4, Moss/Paper tokens, semantic HTML, React/hooks/accessibility lint rules and strict TypeScript. |
| Automatically arranged graph cards | `src/components/graph-canvas.tsx`, `src/lib/graph.ts` | React Flow renders HTML cards and arrows; Dagre places fixed nodes left to right. |

The current reference app differs from the user's recalled data flow: it uses TanStack Query for remote snapshots, Router for URL state and Zustand for interaction state/drafts. It has no route loaders, and its generic client transport casts most responses rather than parsing them with Zod. Hive deliberately follows the requested **route → Zustand → component** flow. It has one snapshot owner, without a parallel Query cache or loader-data copy. Introducing Query later should replace that ownership, not mirror it.

## Package and runtime

`hive-ui` is an independent product package. It imports `@hive/beads` for injected tracker I/O and `@hive/shared` for repository resolution, spawn decoding and the workflow preview wire schema. The UI does not import Colony, inspect its private SQLite schema or call `colony list`: that command currently refreshes persisted attempt state. The earlier librarian consultation `.1` established these read-only constraints; its proposed Colony-hosted UI was superseded by the user's explicit package direction.

Startup selects one `--repo`/`--beads-db` pair, or an explicit JSON list of named endpoints through `--colonies`. Each endpoint keeps its canonical root and selected absolute database together. A stable endpoint ID keys routes and per-colony views. The switcher lists configured endpoints without querying all their trackers. Automatic discovery and temporary daemon registrations are outside this MVP.

The foreground Bun server serves the React app and GET API on the same loopback address. Bun's HTML bundler and official Tailwind plugin avoid another server/build pipeline; TypeScript still runs directly and `tsc --noEmit` remains the gate. See [Bun HTML serving](https://bun.com/docs/bundler/html-static).

The [usage guide](../../lib/hive-ui/README.md) covers startup and endpoint configuration. Development restarts the server and uses browser reloads; React hot replacement is disabled after observing a Bun/TanStack Router initialization failure.

## Data flow and query demand

1. Router validates navigation and starts a store load action for the selected view.
2. The action coalesces identical in-flight reads, parses the response, and updates the keyed Zustand resource. Route loader results do not carry a second snapshot.
3. Components select only the current resource and presentation preferences. Form submission and selection navigate; refresh and provenance actions call stores.
4. A failed refresh keeps the previous snapshot with a visible failure. A successful empty response is distinct from unavailable data. Source observation timestamps remain unchanged when the browser fetches again.

Main-header **Beads** and **Bees** tabs select the URL-owned browsing section; **View** means the applied bead filters. Beads directly queries task records excluding `bee`, `system` and `merge`; tasks need no request link to appear. Internally its inventory is explicitly `not_requested`, rather than claiming that no requests exist or inventing an inventory read time. Board responses carry task summaries and compact Bee assignment references, without duplicating the request inventory. When the visible task page or selected detail contains an assigned in-progress task, the server reads the bounded open inventory for assignment matching. The inspector hides the full requested-work context in this section.

Bees shows requests in an Outline or Graph, defaulting to Outline. Its separate Open/Completed control selects native open spawn requests or successful closed requests newest first, 50 candidates at a time with explicit history pagination. Section and history changes preserve bead filters and reset both pagers, request/bead selection and expanded ancestry. Closed task visibility stays part of the bead filter. Scope and history page key raw inventory and detail snapshots so attribution cannot leak between scopes. Entering Bees loads the selected inventory and, when bead rules are active, matches its task membership. Selecting a request loads its filtered linked task summaries, bounded to 60 per page. Separate page-local search matches request IDs, identities, kinds, requesters and linked task IDs. Open bees includes waiting and retrying requests; it does not mean their processes are alive. Related task links are requested work, not proof of a current claim. The native task assignee is shown separately in the inspector.

| Read | Demand and bound |
| --- | --- |
| Configured colonies | Startup/navigation; no tracker read. |
| Request inventory | Bee views, or assignment attribution for an assigned in-progress task on the visible Beads page/detail; selected colony and history page; Open fails visibly above 100 requests. Completed uses native closed + `bee-outcome:succeeded`, sorted by updated time descending, 50 plus one lookahead. Ten-second cache per endpoint/view/history page. |
| Task-filtered requests | Text/status/priority/label rules activate native matching over the candidate inventory's deduplicated task IDs. Sequential chunks contain at most 100 IDs, with offset zero and limit equal to chunk size. Total work scales with membership in this candidate page; it never scans later history pages. The browser receives matching requests plus the original candidate count and lookahead, not hydrated task content. |
| Task board | Native list/search and filter groups; 60 cards per page, one lookahead row for Next. Beads reads tasks directly. Bees loads the selected request's task summaries, restricts the query to that request’s task IDs and skips board reads when membership is empty. Historical context selection may require one exact request show. |
| Bead detail | One selected ID; includes its description, native acceptance criteria, comments and up to 50 relationship summaries per direction with full counts. Native `show` already supplies outgoing dependencies and incoming dependents. Selected detail loads first; only ordinary tasks then request the separate hierarchy resource. Merge reference selection and Refresh read detail without requesting a task family. Bee views reuse their scoped inventory for requested-work context. Assignment badges use the open inventory in every view, including Completed, only when the selected task is assigned and in progress. |
| Native bead hierarchy | Complete families for the visible Beads page or selected inspector; explicit descendant subtree for an outline. Traversal uses typed parent-child edge reads and scoped row batches. Merge enrichment then batch-hydrates every member with any relationship, including members linked only by parent-child edges; this covers the complete family/subtree, not just visible cards. Native comments are discarded from hierarchy DTOs. The [UI guide](../../lib/hive-ui/README.md#reading-the-board) documents caching, loading states and membership. |
| Workflow provenance | Board, family, outline and preview reads query exact `system` + `busybee-checkpoint` labels with closed records included. One native list reads all retained workflow system descriptions, without a page bound or cache; it maps Busy Bee's public `id` and `created[].bead` identities to their owning run. |
| Workflow preview | Modal open or explicit Refresh only; board projection loads no diagrams. See [preview loading](#workflow-preview). |
| Provenance | Explicit request or bead-inspector action; requester-assignee query includes closed history, at most three ambiguity candidates and eight ancestry steps. |

Native `br list` does not supply related task edges, so each requested inventory page requires one batched `br show` to discover membership and recorded observations. This is a bounded cost on the selected colony, not a full-history hydration. Native results contain more fields than the browser needs; the server projects away recipes/prompts and board descriptions/comments. Measure before adding a new native projection API.

Workflow provenance is a separate producer-owned read contract. The index includes run, visit and grouping identities from retained workflow system JSON, including closed history; it does not interpret actor snapshots. `isWorkflowGenerated` describes broad creation provenance, independently of whether a record is actionable workflow auto work. Agent-created nested tasks remain unmarked. The header's **Show workflow beads** control defaults off and hides generated records after native task pagination, so a visible page can contain fewer than 60 cards. Manual tasks are promoted past hidden ancestors for board presentation; inspector and outline retain the complete native hierarchy. Toggling visibility performs no new native reads.

Direct tracker reads use the injected `@hive/beads` service, composed with the native adapter in production and auto-import/export disabled. Repeated label groups go straight to `--label`, `--label-any`, and `--exclude-label`; labels are case-sensitive and commas remain literal. `system`, `bee` and `merge` are always excluded from task results. The label picker contains labels on the loaded page; exact labels can also be entered manually. It never presents whole-tracker label counts as board counts.

Acceptance criteria render through `react-markdown` with `remark-gfm`, preserving native source text while displaying semantic lists and disabled task checkboxes. The renderer is mounted on demand when selected detail has criteria; raw HTML remains escaped and the default safe URL transform is retained. This adds no data reads or changes to route/store ownership.

Board presentation groups complete native parent-child components, then bridges dot-delimited ID ancestry among loaded records without explicit native parents, skipping absent intermediate IDs. Explicit native parents take precedence over a conflicting dotted-ID ancestor. This explicit user-approved rule keeps families such as `hv-ezgh1` and `hv-ezgh1.9.1` together even when their connecting tracker edge is `related`. Private board adjacency supplies ordering and depth; returned summaries retain their native `parentIds`. Native family hydration, cache aliases and inspector/full-page outlines remain parent-child only. Grouping performs no extra reads and does not discover entirely unloaded dotted relatives. Filters and pagination choose visible cards after grouping; native statuses still choose columns.

## Workflow preview

Cards, family headings, outlines and inspector details share `WorkflowIndicator`. Its Zustand load action requests the selected colony/bead; the server resolves the owning run through the identity index, independently of native ancestry or board grouping.

An injected process adapter calls Busy Bee and parses the Shared wire schema. [Architecture](../architecture.md#package-responsibilities-and-seams) owns the endpoint and producer boundary; the [preview contract](../../lib/busybee/SPEC.md#saved-state-preview) defines the payload.

The modal replaces the diagram with loading or failure content during each read, so an old chart cannot appear current after refresh fails. `WorkflowDiagram` registers the returned root and retained child snapshots as manual Inspector actors, replacing actor paths with generic IDs while preserving parent relationships. The iframe uses `readOnly: true` and `bidirectional: false`; no live workflow actor is connected. The [preview guide](../../lib/hive-ui/README.md#workflow-preview) owns hosted-service, payload and source-provenance disclosures.

## Merge request references

The [merge bead contract](../beads-meta.md#merge-beads) owns its payload, lifecycle and task relationships.

Hide merge beads from task browsing: they are reference records, not work cards. Linked task cards and the bead inspector expose a clickable merge icon that opens the provider URL. Resolve links in either direction and include closed merge beads so merged and abandoned requests remain discoverable from their tasks. Cards, inspector metadata and branch explorer rows share the same provider links. Tooltips and accessible names include the recorded title, resolution and branch; this is recorded reference data, not live provider status. Malformed JSON, invalid fields or inconsistent status/resolution produce a warning icon linking to the raw merge bead in the inspector, without failing the linked task view. Explicit inspection remains available for correcting those records.

Merge labels are excluded from native task queries before pagination and from native family traversal. Relationship lists in task details omit merge records already represented by the icons. For a board page, visible task summaries with relationships are hydrated in batches of 100. Family and outline projections apply the same hydration to every related member of the complete family/subtree, including closed nodes and parent-child-only members. These batch shows discover `relates-to` links in both directions; selected detail reuses its existing show and then requests a family only for ordinary tasks. Candidate endpoints are read in batches of 100 exact IDs with the `merge` label and closed records included. This avoids a repository-wide merge inventory; native show hydration still includes task comments, which the board projection discards. Hive UI reads these references; it does not maintain their lifecycle or provide a notice board.

## Filters and saved views

The sidebar is the sole filter layout, containing views/status/priority/labels. The viewport-height shell keeps the main header visible while the board and sidebar scroll independently. The sidebar's collapse preference lives in the presentation store; on narrow screens the same controls open in a modal drawer. Collapse and drawer state never change filters, selection or native data reads. Native dialogs retain focus containment and Escape behavior.

One bead search lives in the main header across both sections. Its `/` keyboard listener focuses and selects the input only outside editing controls, dialogs and menus; focus alone never loads data. Submission changes the URL-owned native predicate. Page-local Bee search stays beside the Bee presentation controls.

The URL remains authoritative for active filters. One UI-owned `beadFilterSchema` contains text, statuses, priorities, closed visibility and label groups; presets and native query inputs derive from it. Priorities 0–4 pass to repeated native `--priority` arguments, matching any selected priority and intersecting with the other groups. Selected bead statuses pass to repeated native `--status` arguments, matching any selected status and intersecting with priority, text and label groups. Explicit Closed also sends `--all`; with no selected statuses, the closed-visibility option applies. Board columns follow selected statuses. Native bead-filter edits and preset application reset both pagers and clear request/bead selection and ancestry, preserving browsing section, history scope, presentation and page-local request search.

A Bee matches an active text/status/priority/label predicate when at least one linked ordinary task satisfies every native filter group. Different tasks cannot collectively satisfy an AND group. Include-closed alone is a modifier, not a narrowing predicate: without text/status/priority/label rules, requests with no tasks remain visible and no task matching runs. Empty membership never becomes an unrestricted query. Raw request inventory remains privately cached for board membership and detail attribution; the public filtered projection and browser resource key include the bead predicate. The original inventory `readAt` remains its source time, not the time of a later task match. Completed pages retain candidate counts and raw lookahead even with zero matches; there is no global filtered count or page refill scan.

Bead-label actions use [Radix Dropdown Menu](https://www.radix-ui.com/primitives/docs/components/dropdown-menu) for ordinary clicks and [Context Menu](https://www.radix-ui.com/primitives/docs/components/context-menu) for secondary clicks. Radix manages keyboard navigation, focus and dismissal. Menus render beside their triggers so they inherit theme tokens and remain inside the inspector’s native dialog top layer. AND/OR/exclude actions append to the corresponding exact-label group without silently rewriting the others. All active rules remain visible as removable chips, including in the drawer design.

A separate vanilla Zustand store owns named bead-filter presets, persisted in browser local storage and partitioned by configured colony ID. Navigation and presentation are never saved; applying a preset merges only its bead predicate into current navigation. Saving, updating/renaming and deleting are explicit local actions. The storage boundary validates with Zod; writes publish success only after storage succeeds, and malformed storage or write failures remain visible without overwriting unreadable data. Saved views do not synchronize between browsers. Opening the mobile drawer, collapsing the sidebar and managing saved views perform no data reads.

## Bee outline and graph

The Astra POC exploration is retained in `hv-active-bees-work-board-x68q.10`. Both renderers consume the same task-filtered request inventory plus one explicitly requested ancestry chain. Request selection is URL-owned and distinct from bead selection. Nonmatching requests appear only as explicitly loaded ancestry context, which does not inflate match counts. Native filter edits clear that context. The outline walks inferred links with a visited set so rootless cycles cannot disappear; termination messages preserve ambiguity, cycles, missing requester and depth limits.

Only the existing tracker-wide ancestry query can establish an inferred edge. A unique name in the current page is insufficient. Solid graph arrows show recorded requester-string attribution; dashed arrows show the explicitly queried name matches, which still are not recorded parent IDs. No complete descendant discovery or cross-colony traversal occurs.

The graph uses [React Flow](https://reactflow.dev/learn) and [Dagre](https://github.com/dagrejs/dagre), following Millstrand’s HTML cards and automatic left-to-right layout. The original POC used Cytoscape with Dagre; its compact spacing, clear arrowheads and selected-request emphasis guide the presentation. Nodes are fixed: there is no dragging, connection editing or layout persistence. When explicitly loaded ancestry supplies an inferred parent edge, it replaces that child’s raw requester box; the recorded requester remains visible in the summary.

A route/event action initializes the graph module through a small Zustand resource; a load failure leaves Outline available. Viewport interaction belongs to React Flow, not the domain stores. Selection is shared through Router; cards, the request selector and Outline support keyboard selection. Refresh preserves the viewport, with an explicit Fit control after initial layout. Development’s Bun HTML bundler currently serves a combined JavaScript bundle; lazy graph initialization does not promise a separate network chunk.

Graph/Outline and page-local request search are excluded from data loader dependencies. They do not refresh native snapshots. The server exposes inventory separately from the task board: entering Bees with active bead rules reads native matching candidates but sends no task summaries, descriptions or comments to the browser until selection. All reads retain the existing correlated client/HTTP/native logs.

## Attribution and uncertainty

Native `created_by` is recorded requester attribution. A matching friendly identity is only an inferred parent; ambiguity, unmatched names, cycles and the traversal limit are visible. No request contract or historical record is rewritten.

Ordinary-bead footers show native assignment and update time. A shared agent icon sits inline beside the assignee, without a pill or visible text label; its accessible name remains “Bee assigned”. It requires native `in_progress` status, a matching request identity and a related task link on a pending open request. Its compact card projection contains every matching request ID and kind, without choosing one when identities collide. Requested work alone, completed requests and ordinary harness/human assignments do not establish a Bee assignment. Open-inventory reads for assignment attribution use the existing 100-request bound and ten-second cache; explicit board/detail refresh carries its start time through the route-owned reads, and only inventory lookups started since that time can satisfy it. Requests within the same refresh reuse that result even when they finish sequentially; concurrent reads share the in-flight lookup. A newer refresh waits for an older in-flight lookup to settle before starting its own; response completion time cannot make an older lookup satisfy the newer refresh. Empty pages and pages with no assigned in-progress tasks require no assignment lookup. This intentionally extends the earlier ordinary-board no-request-read design in response to the requested assignment indicator. Bee summaries display native outcome and closure time separately from the last recorded observation and its original timestamp. There is no invented process-health state, status inference from silence, or new timestamp attached to old evidence. Snapshots show read times and manual-refresh status. No automatic process probing or runtime repair occurs.

## Diagnostics and quality

Every browser data call, server API request and native invocation emits a structured sample, including failures. Request IDs connect layers; timing, outcome and payload size reveal waste. Human-mode server logs go to stderr; machine startup requires an explicit log file and keeps stderr silent. Browser logs are visible in developer tools. The UI has no telemetry service, log viewer or rotating storage subsystem.

Oxlint provides React, hooks and JSX accessibility rules as built-in plugins; separate ESLint plugins are unnecessary. Web-specific rule configuration and `oxlint-tsgolint` type-aware checks are scoped to the UI. See [Oxlint plugins](https://oxc.rs/docs/guide/usage/linter/plugins).

Production verification combines focused hierarchy/projection tests, native-versus-memory Beads conformance, the repository check, standalone build, and browser checks for desktop/narrow layouts, navigation, refresh failures and native-call timings. The original prototype had no automated tests; the production handover adds behavior coverage.
