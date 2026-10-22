# Hive UI freshness

Hive UI is a read-only view of the selected tracker, not one atomic snapshot. Main-board task fields and selected details refresh more often than family context and icons. **Refresh** requests new reads; it cannot make an out-of-date tracker export current.

## What refreshes when

While the tab is visible, the work board waits **five seconds after the previous automatic load finishes** before starting another. A slow load stretches the interval; this is not a five-second freshness guarantee. Hiding the tab pauses new cycles but lets an active read finish. Returning starts a cycle when the refresh actor is idle.

Each cycle reads the fast resources below. Background work becomes due **60 seconds after the previous background pass started**, checked on the next cycle. The page and selected inspector have separate background deadlines: changing bead selection does not postpone the page's background pass. Results arrive after their reads complete: roughly 60 seconds plus the wait for the next cycle plus read time, not a hard 60-second maximum. Hidden tabs, slow reads and failures can extend the delay.

| Surface or data | Automatic refresh | What can lag |
| --- | --- | --- |
| Main-board task cards, including linked tasks for a selected Bee | Every cycle: native title, status, priority, labels, assignee, owner and update time | Family grouping and icons have separate reads below. Filters and pagination still limit the task page. |
| Bee workspace, Open/Completed inventory, automatic inferred parent links and recorded output observations | Every cycle for the selected request page | These are recorded observations, not process-health checks. Completed pages contain successful requests only; [parent matching](../../docs/design/hive-ui.md#bee-outline-and-graph) checks uniqueness across request history. |
| Selected bead inspector | Every cycle: description, acceptance criteria, design, notes, comments and direct incoming/outgoing relationship summaries | Parent-child links live in the slower branch explorer; merge references live in slower icons. Relationship lists show up to 50 items per direction with full counts. |
| Explicitly loaded Bee ancestry in the current URL | Every cycle once selected | No automatic discovery of all descendants or other history pages. The inspector's separate **Requester provenance** disclosure reads on opening, rather than joining this polling selection. |
| Bead family membership, layout context and branch explorer | Background pass | Both exported parent-child links and native summaries loaded only for family context can lag. A main-board card can be newer than its family context. |
| Dedicated bead outline and all its descendant rows | Background pass | The whole outline, including row fields, waits for this pass. Selecting a row opens an inspector whose selected detail uses the fast cycle. |
| Merge icons and Bee assignment icons/activity on task cards, outlines and inspector | Background pass | A linked merge record or request can change without the task changing. Bee workspace activity can therefore be newer than task-card activity. |
| Open workflow preview | Separate five-second native-outcome/checkpoint polling while visible | Definition-only edits require the preview's **Refresh** or reopening it. See [workflow preview](./README.md#workflow-preview). |

“Background” means less frequent work within the same load cycle, not polling while the tab is hidden. Cards and selected details publish before their deferred icons; the next automatic cycle waits for the whole load, including due background work, to finish.

When a fast poll changes which cards match the same board query, the board retains its last family snapshot until the next successful background read. Existing family context keeps its original observation time and stale-source flag. Newly visible cards still appear, but cards outside that snapshot wait for a hierarchy read to gain native family context. Retained board snapshots are scoped by colony, filters and page, not shared indiscriminately across navigation.

Annotations apply only when their recorded task revision matches the displayed task's `updated_at`. After a fast task update, merge or Bee assignment icons may disappear until the next background pass instead of being attached to a different revision. Output ages can advance locally without a new observation being read.

## Refresh, navigation and browser reload

- **Workspace Refresh** requests the current view, selected detail and selected ancestry, including family/outline and annotation reads that would otherwise wait for the background interval.
- **Refresh bead details** in the inspector requests that bead, its family and their annotations. It does not refresh the board or a dedicated outline behind the inspector. A selected merge reference has no ordinary-task family read.
- **Data navigation**—changing filters, page, colony, selected bead/request or opening an outline—loads the affected resources with background work enabled. Selecting a bead does not reload the unchanged board behind it. Presentation-only actions such as Bee Graph/Outline, page-local Bee search, folding branches and changing columns do not fetch data.
- **Browser reload** discards client snapshots and the client schedule, then loads the current URL with background work enabled. Initial workspace reads send a nonzero current-time cutoff, so an older server time-cache entry cannot satisfy them merely because its ten-second lifetime has not expired.

A refresh cutoff permits reads started at or after that cutoff to be shared within the load. It does not mean every overlapping consumer runs a separate native command. Server/browser caches preserve source observation times; they do not make all panels an atomic snapshot. Successful Refresh or reload means the relevant sources were read, not that those sources were already up to date.

Server startup configuration is separate: restart the UI server to reload daemon membership or status policy. Browser reload does not rediscover those settings.

## Native tasks versus exported families

**Native Beads (`br`) remains task authority.** Cards and selected details read the selected database. **BV supplies family topology only**, from the JSONL export selected by native Beads, including a configured custom export path. The UI does not use BV to replace native task fields or status.

Families follow exported `parent-child` links among ordinary tasks without a depth or descendant limit. Exported closed records and templates remain eligible; tombstones, their incident links and nonexportable records are absent. Board-only dotted-ID grouping is a presentation rule described in [Reading the board](./README.md#reading-the-board), not an added native relationship.

The two sources can disagree temporarily:

- When the export is known to lag, a valid exported family remains usable even if its membership is older than the native card fields.
- A newly created bead absent from that stale export can appear on the main board and in the inspector without invented family links. Its outline waits for export coverage.
- An unreadable export, a missing bead in an export judged current, or a member deleted during native hydration fails the hierarchy read. A previous hierarchy remains available when one exists; primary cards and detail are independent.

The UI checks source freshness around hierarchy loading, but those checks do not provide an atomic graph-and-row snapshot. The stale-source flag is retained in the hierarchy data; there is currently no dedicated visible warning for a successfully read stale export. Lack of an error toast is not proof of current family membership. [Hierarchy source](../../docs/design/hive-ui.md#hierarchy-source) documents the checks.

UI reads disable native auto-import and auto-export. Refresh and browser reload neither flush/export the tracker nor synchronize it. Native writers' local JSONL export and repository exchange through `bun run beads:sync` are separate operations. Changes from another clone must first reach the selected native database through the repository's synchronization procedure; family topology must also reach its export. After that, the relevant cycle—or manual Refresh—can display them.

## Changes to expect

| Change made elsewhere | What you see |
| --- | --- |
| Another bead adds or removes an incoming non-parent-child relationship to the selected bead | The next successful inspector cycle rereads native dependents, even if the selected bead's own revision is unchanged. A parent-child change instead waits for the background family read and export. |
| Someone edits the selected bead's notes or adds a comment | The next successful inspector cycle reads it; no task-revision-only cache hides the new detail. |
| A merge bead changes resolution or its task link | Icons wait for background annotations or manual Refresh. They describe the recorded merge bead, not live provider status. |
| A Bee starts, finishes or records new output | The selected Bee workspace page updates on the fast cycle. Matching Bee icons and activity on task cards wait for background annotations. Native assignee text can update sooner. |
| An off-page request reuses a requester's identity | The next successful Bee inventory refresh can remove an automatic inferred parent link even if both visible requests are unchanged. **Load ancestry** reports the ambiguity. |
| Another clone synchronizes changes | No UI update precedes arrival in the selected database. Native fields can then appear before exported family topology catches up. |

## Failures and timestamps

Previous snapshots remain visible while reading. Failures produce dismissible **unavailable** toasts when no snapshot exists, or **could not update · Showing previous data** when one is retained. An unchanged polling failure is not repeatedly announced. Background resources retry when next due or explicitly refreshed; their failures do not prevent primary detail from loading.

The work board's **Updated** time describes its board, outline or request-inventory snapshot, not every icon and panel. A card's update time is the native task revision; Bee output times are recorded observations. Neither is a promise that related records have been reread.

Implementation ownership: [refresh timing](./src/refresh.ts), [client read scheduling](./src/data.ts), [server reads and cache cutoffs](./server/data.ts), and [export checks](./server/topology.ts).
