// Instrument the actual Hive UI topology + hierarchy helpers against disposable fixtures.
// Excludes HTTP, browser rendering, workflow/card decoration and warm server caches.
import { createNativeBeads } from '/Users/ct/dev/projects/hive/lib/beads/src/native.ts';
import { createNativeBv } from '/Users/ct/dev/projects/hive/lib/shared/src/bv.ts';
import { createTopologyReader } from '/Users/ct/dev/projects/hive/lib/hive-ui/server/topology.ts';
import { readHierarchy, SUMMARY_FIELDS } from '/Users/ct/dev/projects/hive/lib/hive-ui/server/hierarchy.ts';
const base = '/Users/ct/dev/projects/hive/.worktrees/codex--beads-policy-workshop';
const report = await Bun.file(`${base}/BEADS-GRAPH-EXPERIMENT.json`).json();
const environment = { ...process.env, BV_NO_CACHE: '1' };
for (const key of ['BEADS_DB', 'BEADS_DIR', 'BEADS_JSONL', 'BR_OUTPUT_FORMAT', 'BV_OUTPUT_FORMAT', 'TOON_DEFAULT_FORMAT']) delete environment[key];
const results = [];
for (const name of ['mixed-semantics', 'star-1000', 'star-5000', 'payload-star-1000', 'small-island-5000', 'parent-star-1000', 'parent-star-5000']) {
  for (let rep = 0; rep < 3; rep++) {
    const calls = [];
    async function execute(argv, cwd, env) {
      const started = performance.now();
      const child = Bun.spawn(argv, { cwd, env, stdout: 'pipe', stderr: 'pipe' });
      const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      calls.push({ tool: argv[0], operation: argv.includes('--robot-graph') ? 'graph' : argv.includes('--status') ? 'sync-status' : argv.includes('where') ? 'where' : argv.includes('list') ? 'list' : 'show', ms: performance.now()-started, bytes: new TextEncoder().encode(stdout).length });
      if (code !== 0) throw new Error(stderr + stdout);
      return stdout;
    }
    const beads = createNativeBeads({ execute, env: environment });
    const bv = createNativeBv({ execute, env: environment });
    const readTopology = createTopologyReader({ beads, bv });
    const colony = { root: `${report.root}/${name}`, beadsDb: `${report.root}/${name}/.beads/beads.db` };
    const scope = { cwd: colony.root, db: colony.beadsDb, noAutoImport: true, noAutoFlush: true };
    let batches = [];
    const started = performance.now();
    const result = await readTopology(colony, graph => readHierarchy(['gp-n00000'], { graph, rows: async ids => {
      batches.push(ids.length);
      const page = await beads.listProjected(scope, { ids, all: true, limit: ids.length }, SUMMARY_FIELDS);
      const found = new Set(page.issues.map(row => row.id));
      const missing = ids.filter(id => !found.has(id));
      if (missing.length) {
        const exact = await beads.showMany(scope, missing);
        page.issues.push(...exact.map(bead => ({ ...bead, dependency_count: bead.dependencies.length, dependent_count: bead.dependents.length })));
      }
      return page.issues;
    }}, 'family'));
    results.push({ case: name, rep, ms: performance.now()-started, nodes: result.value.length, stale: result.stale, batches, calls });
  }
  console.log(name);
}
await Bun.write(`${base}/BEADS-GRAPH-HYDRATION.json`, JSON.stringify(results, null, 2));
