# Hive UI

Presentation vocabulary nested under the [shared Hive glossary](../../GLOSSARY.md). These names are used by the component workshop and the [design catalogue](../../docs/design/hive-ui.md#component-catalogue).

## Bees

**Bee graph**: A spatial view of loaded Bee requests and requester provenance. _Avoid_: Graph bee view, agent tree.

**Bee workspace**: The request browsing surface with Outline and Graph presentations, a shared selection and linked work.

**Match**: A request that satisfies the current request-page search.

**Context**: A historical request added by explicitly loaded ancestry, separate from the matching inventory.

**Recorded requester**: The attributed identity that requested a Bee, without an inferred parent request.

**Inferred parent**: A historical request matched to a recorded requester identity through explicitly loaded ancestry.

## Beads

**Bead card**: A summary of an ordinary task bead, including its native status, priority, labels and assignment.

**Bead board**: The native-status Kanban presentation of matching ordinary task beads and their families.

**Bead outline**: A dedicated view of one bead and its native descendants, independent of board filters.

**Branch explorer**: The foldable native family tree beside a selected bead. _Avoid_: Bead outline when referring to the inspector tree.

**Workflow preview**: A modal opened from a workflow run or one of its generated beads, with a diagram and task instructions. Saved shows recorded state and Simulate explores temporary outcomes without changing the actual run.

**Bead inspector**: The selected bead's detail surface, including acceptance criteria, relationships, comments and its branch explorer.

**Family lane**: A horizontal board group for a bead family spanning statuses or containing many active descendants.

**Family rails**: A compact tree presentation for a small bead family sharing one active status.

## Workflow preview

**Canvas**: The navigable workflow diagram and its task instructions panel.

**Cards**: The workflow step presentations, including workflow position and independent Bee status indicators.

**Edges**: The connections between workflow steps, showing possible outcomes and their visual states.

**Simulation**: A temporary workflow walkthrough from saved state or explicit initial input, separate from the actual run.

**Nested actors**: The root and child workflow views within one run, each with its own state and instructions.

**Refresh**: The workflow preview's saved-state update and recovery presentation, including updates received during simulation.

**Inspection**: The workflow preview's completed-run and unavailable-preview presentations.

## Workspace

**Work board**: The complete colony browsing surface with navigation, filters, Beads or Bees, and selected details.

**Filter workspace**: The sidebar or mobile drawer containing saved views and bead filter controls.

**Filter controls**: The status, priority and exact label rules applied to ordinary beads or linked request work.

**Board navigation**: The Beads/Bees and Open/Completed choices determining which records are browsed.

**Board search**: The bead text search and the separate search of requests already loaded on the current page.

**Column settings**: The colony-specific preference for the order of visible native-status columns.

## Foundations

**Animations**: The shared motion catalogue for production components.

**Tabs**: The selectable panes used for inspector Bead and Outline presentations.

**Markdown content**: The rendered native Markdown in bead detail text.

**Resource notice**: A toast reporting a failed data read without occupying layout space.

**Bead metadata**: The compact labels and recorded Bee assignment accompanying a task bead.

**Moss**: The dark Hive UI palette.

**Paper**: The light Hive UI palette.
