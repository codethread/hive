# Hive UI MVP

Hive UI replaces the generated Python/HTML prototype with a small React application in `lib/hive-ui`. It reads real Beads data and keeps the settled bead-first design: native status columns, quiet bee attribution, an inspector, exact native label filters, Moss and Paper themes, and one selected colony at a time.

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

The URL-owned **View** selects ordinary **Beads**, **Open bees** or **Completed bees**. Beads directly queries task records excluding both `bee` and `system`, without discovering requests; tasks need no request link to appear. Its inventory is explicitly `not_requested`, rather than claiming that no requests exist or inventing an inventory read time. The inspector reads only the selected task and hides request attribution in this view.

The Bee views populate the board from linked task IDs. Open bees uses native open spawn requests; Completed bees queries successful closed requests newest first, 50 at a time with explicit history pagination, and includes closed tasks. View and history page key inventory and detail snapshots so attribution cannot leak between scopes. Changing views resets both pagers and selection. Open bees includes waiting and retrying requests; it does not mean their processes are alive. Related task links are requested work, not proof of a current claim. The native task assignee is shown separately in the inspector.

| Read | Demand and bound |
| --- | --- |
| Configured colonies | Startup/navigation; no tracker read. |
| Request inventory | Bee views only, selected colony and history page; Open fails visibly above 100 requests. Completed uses native closed + `bee-outcome:succeeded`, sorted by updated time descending, 50 plus one lookahead. Ten-second cache per endpoint/view/history page. |
| Task board | Native list/search and filter groups; 60 cards per page, one lookahead row for Next. Beads reads tasks directly. Bee views additionally restrict to the selected request page’s task IDs and skip task reads when membership is empty. |
| Bead detail | One selected ID; includes its description, native acceptance criteria, comments and up to 50 relationship summaries per direction with full counts. Native `show` already supplies outgoing dependencies and incoming dependents; no related detail reads or graph traversal. Beads performs no request inventory read; Bee views reuse their scoped inventory. |
| Provenance | Explicit inspector action; requester-assignee query includes closed history, at most three ambiguity candidates and eight ancestry steps. |

Native `br list` does not supply related task edges, so each requested inventory page requires one batched `br show` to discover membership and recorded observations. This is a bounded cost on the selected colony, not a full-history hydration. Native results contain more fields than the browser needs; the server projects away recipes/prompts and board descriptions/comments. Measure before adding a new native projection API.

All reads use Shared's native `br` boundary with auto-import/export disabled. Repeated label groups go straight to `--label`, `--label-any`, and `--exclude-label`; labels are case-sensitive and commas remain literal. `system` and `bee` are always excluded from task results. The label picker contains labels on the loaded page, clearly labelled as such; exact labels can also be entered manually. It never presents whole-tracker label counts as board counts.

## Filters and saved views

A compact board toolbar keeps View, Filters and a named-view selector visible. Search, closed-bead visibility and all/any/exclude labels live in a left modal drawer, leaving the board its full width. Both drawers use native modal dialogs for focus containment and Escape, with no new component-library dependency. Opening the filter drawer and managing saved views perform no data reads.

The URL remains authoritative for active filters. A separate vanilla Zustand store owns named presets, persisted in browser local storage and partitioned by configured colony ID. Each preset contains only view, query, closed and label groups; applying it navigates with both pagers reset and no selected bead. Saving, updating/renaming and deleting are explicit local actions. The storage boundary validates with Zod; writes publish success only after storage succeeds, and malformed storage or write failures remain visible without overwriting unreadable data. Saved views do not synchronize between browsers.

## Attribution and uncertainty

Native `created_by` is recorded requester attribution. A matching friendly identity is only an inferred parent; ambiguity, unmatched names, cycles and the traversal limit are visible. No request contract or historical record is rewritten.

Ordinary-bead footers show native assignment and update time without inferring Bee associations. Pending bee footers display the last recorded observation; its original timestamp remains in the tooltip and inspector. Completed footers show native outcome and closure time, while the inspector retains the historical observation separately. There is no invented process-health state, status inference from silence, or new timestamp attached to old evidence. Snapshots show read times and manual-refresh status. No automatic process probing or runtime repair occurs.

## Diagnostics and quality

Every browser data call, server API request and native invocation emits a structured sample, including failures. Request IDs connect layers; timing, outcome and payload size reveal waste. Human-mode server logs go to stderr; machine startup requires an explicit log file and keeps stderr silent. Browser logs are visible in developer tools. The MVP has no telemetry service, log viewer or rotating storage subsystem.

Oxlint provides React, hooks and JSX accessibility rules as built-in plugins; separate ESLint plugins are unnecessary. Web-specific rule configuration and `oxlint-tsgolint` type-aware checks are scoped to the UI. See [Oxlint plugins](https://oxc.rs/docs/guide/usage/linter/plugins).

Per user direction, this stage adds no automated tests. Verification uses the full format/lint/typecheck gate and browser checks against real and throwaway endpoints: both themes, narrow layout, native filters, navigation, refresh failure retention, colony switching, provenance and request-count/timing evidence. The PR should retain the measured limitations and leave visual refinement and landing separate.
