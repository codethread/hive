# Shared contracts

`@hive/shared` provides contracts consumed across Hive products. [Architecture](../../docs/architecture.md#package-responsibilities-and-seams) owns package boundaries; the consumed Beads service and its adapters live in [`@hive/beads`](../beads/README.md).

## BV

Import the typed service and adapters from `@hive/shared/bv`. [`BvService`](src/bv.ts) has two asynchronous reads:

| Method | Result |
| --- | --- |
| `readPageRanks({ cwd, sqlitePath })` | `Record<string, number>` of scores for the complete visible SQLite graph. |
| `readGraph({ cwd, jsonlPath })` | `BvGraph`: nodes `{ id, status, labels }`, edges `{ from, to, type }` and `sourceStale`. Parent-child edges point from child to parent. |

### Native adapter

```ts
import { createNativeBv } from "@hive/shared/bv";

const bv = createNativeBv({ env: process.env });
const scores = await bv.readPageRanks({
	cwd: process.cwd(),
	sqlitePath: "/path/to/tracker/.beads/beads.db",
});
const graph = await bv.readGraph({
	cwd: process.cwd(),
	jsonlPath: "/path/to/tracker/.beads/issues.jsonl",
});
```

`createNativeBv({ execute, env } = {})` defaults to the Shared subprocess executor and process environment. It copies the environment and propagates command or validation failures. Native `bv` must be available on `PATH`; callers select each source explicitly.

- **PageRank:** invokes `--robot-insights --force-full-analysis --db SQLITE --format json` and overrides `BV_INSIGHTS_MAP_LIMIT` to request all scores. Requires computed PageRank, exactly one loaded, nonstale selected SQLite source with complete authority and zero failed sources/errors/read errors/skipped records. Finite nonnegative scores must cover the visible node count. Consumers check coverage of their requested task IDs.
- **Graph:** invokes `--db JSONL --robot-graph --graph-format=json` without recipe, label or depth filters. Requires exactly one loaded selected local JSONL source, zero failed sources/errors/read errors/skipped records, consistent graph counts, unique nodes and valid edge endpoints. Complete authority is required except for stale-only `partial` authority under the same checks; `sourceStale` preserves that signal.

The reads neither export nor reconcile the tracker and never fall back to another source or adapter. SQLite ranking and exported JSONL topology intentionally have different authorities; they are not an atomic snapshot. The adapter supplies no scheduling, freshness-bracketing or cache policy. [Colony scheduling](../colony/README.md#scheduling) and [UI hierarchy reads](../../docs/design/hive-ui.md#hierarchy-source) own those decisions.

### Alphabetical test fake

```ts
import { createFakeBv } from "@hive/shared/bv";

const bv = createFakeBv({ taskIds: ["task-b", "task-a"] });
const scores = await bv.readPageRanks({ cwd: ".", sqlitePath: "unused.db" });
// scores["task-a"] > scores["task-b"]
```

`createFakeBv({ taskIds, graph } = {})` ranks unique seeded IDs in lexicographic order, with earlier IDs receiving higher positive scores. Ranking is independent of the optional `BvGraph` seed; defaults are no scores and an empty, nonstale graph. Seeds are copied at construction, and each read returns a detached snapshot.

The fake ignores `cwd` and source paths, performs no I/O or native source validation, and does not compute PageRank from graph edges. Use it for deterministic consumer-policy tests, not numerical parity or native protocol conformance. The [native BV contract](tests/contract/bv.test.ts) checks that separate boundary; [Repository tooling](../tooling/README.md#native-contract-tests) explains its selection and timing gate.
