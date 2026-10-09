# Hive UI MVP

Hive UI replaces the generated Python/HTML prototype with a small React application in `lib/hive-ui`. It reads real Beads data: ordinary tasks use native-status columns, while Bee requests use Outline and Graph provenance views. Both share an inspector, exact native label filters, Moss and Paper themes, and one selected colony at a time.

This is an MVP for refinement. It does not claim work, edit labels, close beads, retry requests, start a daemon, or introduce a second tracker. The original `pi/active-bees-work-board-poc` branch remains a visual reference, not a code dependency.

## What the Millstrand exploration found

Three Luna explorations are recorded on `hv-active-bees-work-board-x68q.2`, `.3`, and `.4`. Their source was the local `millstrand-ui` checkout on 2026-10-08.

| Pattern | Source in Millstrand UI | Hive adaptation |
| --- | --- | --- |
| Small React/TypeScript components; URL-owned navigation | `src/main.tsx`, `src/lib/navigation.ts`, `src/components/issue-surface.tsx` | TanStack Router validates colony, filters and selected bead; components render store selectors. |
| Narrow state subscriptions | `src/store.ts`, `src/review-comment-store.ts`, `src/hooks/use-cards.ts` | Vanilla Zustand stores own snapshots and actions outside React; readers select a resource key rather than the whole store. |
| Boundary parsing | `src/lib/dashboard-search.ts`, `server/parse.ts` | Zod validates configuration, URL search, native output and HTTP responses at their respective entry points. |
| Summary versus demand-driven detail | `server/workspace-database.ts`, `src/lib/api/cards.ts`, `src/components/issue-detail.tsx` | Board DTOs omit descriptions/comments. Selected bead and requester ancestry have separate endpoints. |
| Explicit fetch ownership | `src/components/workspace-resource-polls.tsx`, `src/hooks/use-graph.ts` | Route loaders and user actions own requests; renderers do not start effects or background queries. Manual refresh for the MVP. |
| Data-call diagnostics | `shared/perf.ts`, `server/perf.ts`, `server/strand.ts`, `src/lib/api/transport.ts`, `docs/read-performance.md` | Structured client, HTTP and native-call samples share a request ID, durations and outcomes. No prompt or body logging. |
| Semantic styling and web checks | `src/index.css`, `.oxlintrc.json`, `package.json` | Tailwind 4, Moss/Paper tokens, semantic HTML, React/hooks/accessibility lint rules and strict TypeScript. |
| Automatically arranged graph cards | `src/components/graph-canvas.tsx`, `src/lib/graph.ts` | React Flow renders HTML cards and arrows; Dagre places fixed nodes left to right. |

The current reference app differs from the user's recalled data flow: it uses TanStack Query for remote snapshots, Router for URL state and Zustand for interaction state/drafts. It has no route loaders, and its generic client transport casts most responses rather than parsing them with Zod. Hive deliberately follows the requested **route → Zustand → component** flow. It has one snapshot owner, without a parallel Query cache or loader-data copy. Introducing Query later should replace that ownership, not mirror it.

## Package and runtime

`hive-ui` is an independent product package. It imports only `@hive/shared` across package boundaries, reusing native Beads I/O, repository resolution and spawn decoding. It does not import Colony, inspect its private SQLite schema or call `colony list`: that command currently refreshes persisted attempt state. The earlier librarian consultation `.1` established these read-only constraints; its proposed Colony-hosted UI was superseded by the user's explicit package direction.

Startup selects one `--repo`/`--beads-db` pair, or an explicit JSON list of named endpoints through `--colonies`. Each endpoint keeps its canonical root and selected absolute database together. A stable endpoint ID keys routes and per-colony views. The switcher lists configured endpoints without querying all their trackers. Automatic discovery and temporary daemon registrations are outside this MVP.

The foreground Bun server serves the React app and GET API on the same loopback address. Bun's HTML bundler and official Tailwind plugin avoid another server/build pipeline; TypeScript still runs directly and `tsc --noEmit` remains the gate. See [Bun HTML serving](https://bun.com/docs/bundler/html-static).

The [usage guide](../../lib/hive-ui/README.md) covers startup and endpoint configuration. Development restarts the server and uses browser reloads; React hot replacement is disabled after observing a Bun/TanStack Router initialization failure.

## Data flow and query demand

1. Router validates navigation and starts a store load action for the selected view.
2. The action coalesces identical in-flight reads, parses the response, and updates the keyed Zustand resource. Route loader results do not carry a second snapshot.
3. Components select only the current resource and presentation preferences. Form submission and selection navigate; refresh and provenance actions call stores.
4. A failed refresh keeps the previous snapshot with a visible failure. A successful empty response is distinct from unavailable data. Source observation timestamps remain unchanged when the browser fetches again.

Main-header **Beads** and **Bees** tabs select the URL-owned browsing section; **View** means the applied bead filters. Beads directly queries task records excluding both `bee` and `system`, without discovering requests; tasks need no request link to appear. Internally its inventory is explicitly `not_requested`, rather than claiming that no requests exist or inventing an inventory read time. Board responses carry task summaries only; they do not duplicate inventory or Bee attribution. The inspector reads only the selected task and hides request attribution in this section.

Bees shows requests in an Outline or Graph, defaulting to Outline. Its separate Open/Completed control selects native open spawn requests or successful closed requests newest first, 50 candidates at a time with explicit history pagination. Section and history changes preserve bead filters and reset both pagers, request/bead selection and expanded ancestry. Closed task visibility stays part of the bead filter. Scope and history page key raw inventory and detail snapshots so attribution cannot leak between scopes. Entering Bees loads the selected inventory and, when bead rules are active, matches its task membership. Selecting a request loads its filtered linked task summaries, bounded to 60 per page. Separate page-local search matches request IDs, identities, kinds, requesters and linked task IDs. Open bees includes waiting and retrying requests; it does not mean their processes are alive. Related task links are requested work, not proof of a current claim. The native task assignee is shown separately in the inspector.

| Read | Demand and bound |
| --- | --- |
| Configured colonies | Startup/navigation; no tracker read. |
| Request inventory | Bee views only, selected colony and history page; Open fails visibly above 100 requests. Completed uses native closed + `bee-outcome:succeeded`, sorted by updated time descending, 50 plus one lookahead. Ten-second cache per endpoint/view/history page. |
| Task-filtered requests | Text/status/priority/label rules activate native matching over the candidate inventory's deduplicated task IDs. Sequential chunks contain at most 100 IDs, with offset zero and limit equal to chunk size. Total work scales with membership in this candidate page; it never scans later history pages. The browser receives matching requests plus the original candidate count and lookahead, not hydrated task content. |
| Task board | Native list/search and filter groups; 60 cards per page, one lookahead row for Next. Beads reads tasks directly. Bees loads the selected request's task summaries, restricts the query to that request’s task IDs and skips board reads when membership is empty. Historical context selection may require one exact request show. |
| Bead detail | One selected ID; includes its description, native acceptance criteria, comments and up to 50 relationship summaries per direction with full counts. Native `show` already supplies outgoing dependencies and incoming dependents; no related detail reads or graph traversal. Beads performs no request inventory read; Bee views reuse their scoped inventory. |
| Provenance | Explicit request or bead-inspector action; requester-assignee query includes closed history, at most three ambiguity candidates and eight ancestry steps. |

Native `br list` does not supply related task edges, so each requested inventory page requires one batched `br show` to discover membership and recorded observations. This is a bounded cost on the selected colony, not a full-history hydration. Native results contain more fields than the browser needs; the server projects away recipes/prompts and board descriptions/comments. Measure before adding a new native projection API.

All reads use Shared's native `br` boundary with auto-import/export disabled. Repeated label groups go straight to `--label`, `--label-any`, and `--exclude-label`; labels are case-sensitive and commas remain literal. `system` and `bee` are always excluded from task results. The label picker contains labels on the loaded page; exact labels can also be entered manually. It never presents whole-tracker label counts as board counts.

Acceptance criteria render through `react-markdown` with `remark-gfm`, preserving native source text while displaying semantic lists and disabled task checkboxes. The renderer is mounted on demand when selected detail has criteria; raw HTML remains escaped and the default safe URL transform is retained. This adds no data reads or changes to route/store ownership.

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

A route/event action initializes the graph module through a small Zustand resource; a load failure leaves Outline available. Viewport interaction belongs to React Flow, not the domain stores. Selection is shared through Router; cards, the request selector and Outline support keyboard selection. Refresh preserves the viewport, with an explicit Fit control after initial layout. Development’s Bun HTML bundler currently serves a combined JavaScript bundle; deferred graph initialization does not promise a separate network chunk.

Graph/Outline and page-local request search are excluded from data loader dependencies. They do not refresh native snapshots. The server exposes inventory separately from the task board: entering Bees with active bead rules reads native matching candidates but sends no task summaries, descriptions or comments to the browser until selection. All reads retain the existing correlated client/HTTP/native logs.

## Attribution and uncertainty

Native `created_by` is recorded requester attribution. A matching friendly identity is only an inferred parent; ambiguity, unmatched names, cycles and the traversal limit are visible. No request contract or historical record is rewritten.

Ordinary-bead footers show native assignment and update time without inferring Bee associations. Bee summaries display native outcome and closure time separately from the last recorded observation and its original timestamp. There is no invented process-health state, status inference from silence, or new timestamp attached to old evidence. Snapshots show read times and manual-refresh status. No automatic process probing or runtime repair occurs.

## Diagnostics and quality

Every browser data call, server API request and native invocation emits a structured sample, including failures. Request IDs connect layers; timing, outcome and payload size reveal waste. Human-mode server logs go to stderr; machine startup requires an explicit log file and keeps stderr silent. Browser logs are visible in developer tools. The MVP has no telemetry service, log viewer or rotating storage subsystem.

Oxlint provides React, hooks and JSX accessibility rules as built-in plugins; separate ESLint plugins are unnecessary. Web-specific rule configuration and `oxlint-tsgolint` type-aware checks are scoped to the UI. See [Oxlint plugins](https://oxc.rs/docs/guide/usage/linter/plugins).

Per user direction, this stage adds no automated tests. Verification uses the full format/lint/typecheck gate and browser checks against real and throwaway endpoints: both themes, narrow layout, native filters, navigation, refresh failure retention, colony switching, provenance and request-count/timing evidence. The PR should retain the measured limitations and leave visual refinement and landing separate.
