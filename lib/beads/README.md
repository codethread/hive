# @hive/beads

Typed Beads operations for Hive's server packages. Inject `createNativeBeads()` in production and `createMemoryBeads()` in behavior tests. Both implement the [public service](src/service.ts); native arguments and JSON parsing stay inside the native adapter.

```ts
import { createMemoryBeads } from "@hive/beads";

const beads = createMemoryBeads();
const scope = {
	cwd: "/execution-checkout",
	db: "/fixture/beads.db",
	actor: "worker",
};
const created = await beads.create(scope, {
	title: "Example",
	owner: "ct",
	labels: ["team"],
});
await beads.update(scope, [created.id], {
	claim: true,
	ifUnchanged: created.updated_at,
});
const detail = await beads.show(scope, created.id);
const page = await beads.list(scope, { labels: ["team"], limit: 0 });
```

Each operation receives `BeadsScope`: execution `cwd`, optional database `db`, optional audit `actor`, and optional `noAutoImport`/`noAutoFlush`. Explicit database and actor values override native flags and environment; omitted values preserve native environment and discovery. Owner and assignee remain separate issue fields. `createNativeBeads({ env, execute })` accepts an invocation environment and an injectable process boundary.

The service exposes `create`, `show`, `showMany`, `list`, `search`, `ready`, `update`, `close` and `where`, plus `comments.add/list`, `dep.add/remove`, `query.save/list/run/delete` and `sync.import/flush/merge/status`. `showMany` performs one native batch read; an empty batch returns no records. `formatBeadsQuery(selection, text?)` formats the equivalent list/search command for diagnostics from the same typed inputs used by native execution.

Results describe the consumed native facts: create and list/search return unhydrated issue fields; show returns detail with relationship titles, statuses, priorities and comments; ready uses the native brief summary. Update and close return their compact native receipts. List pages carry `total`; search pages carry `hidden_closed_count`. Saved queries retain typed filters in memory, and run overrides replace the corresponding saved filters.

Every memory factory owns independent stores for each database identity. It performs no subprocess, filesystem or SQLite operations. `createMemoryBeads({ db, actor, now })` supplies fixture defaults. `where` returns the fixture database without filesystem discovery. `now` returns RFC3339 time; revisions increase even with a constant clock. Without a clock, revisions start at `2026-01-01T00:00:00.000Z`. IDs and timestamps are deterministic fixture values, and returned records are detached snapshots.

Memory rejects filesystem synchronization visibly. Native `sync.status` disables auto-import and auto-flush for read-only inspection; import, flush and merge retain their live filesystem effects. Git publication, JSONL behavior and discovery tests stay at their actual boundaries.

`Bead` is the narrow structural input used by Shared's domain decoders. Native DTOs and `CommandError` belong to this package. Native and memory errors retain command status and structured diagnostics, including CAS and claim failures. Native close refusals emit multiple JSON documents; their stdout remains unparseable as one diagnostic, matching native error behavior.

The bounded [differential contracts](tests/contract/native.test.ts) compare both adapters against disposable native trackers. Run `bun run test:contracts` from the repository root. The test runner selects those contracts when their adapter or contract inputs change; consumer behavior tests use memory.
