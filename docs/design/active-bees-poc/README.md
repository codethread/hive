# Active bees work board — design POC

Throwaway design reference for `hv-active-bees-work-board-x68q`. It is **not production code** and makes no tracker or daemon calls. Every prototype uses fictional fixture data and opens directly in a browser.

## Open a prototype

Start with `prototypes/work-native-filters.html` — the settled direction: a bead-first work board with provenance and native label filters, on the Moss and Paper themes. It is a single self-contained HTML file; no server or build step.

## What the POC settled

- **Beads first, bees as attribution.** Native status sets the board columns; each card leads with the bead title, then priority and useful labels. The bee (friendly name, kind, recorded attempt state) is a quieter footer, never the heading.
- **Provenance chain.** A bead inspector shows the chain of requesters behind its bee, linking each inferred step.
- **Native label filters in the GUI.** Three groups mirror `br`: *All of* (`--label`), *Any of* (`--label-any`), *Exclude* (`--exclude-label`). A preview shows the equivalent native command.
- **Two themes only.** Moss (dark) and Paper (light).
- **One colony at a time.** A switcher scopes the whole view to a single project, with filter and selection state kept per colony. There is deliberately no cross-project view.

## Prototype order

| File | Shows |
| --- | --- |
| `prototypes/control-room.html` | Direction 1: dense dark operations board (chosen). |
| `prototypes/field-notes.html` | Direction 2: warm card gallery (dropped). |
| `prototypes/flight-deck.html` | Direction 3: time-based swimlanes (dropped). |
| `prototypes/control-room-ledger.html` | Bee-first nested rows with bead details. |
| `prototypes/control-room-lanes.html` | One column per bee; beads as cards. |
| `prototypes/control-room-split.html` | Roster plus bead inspector. |
| `prototypes/provenance.html` | Requester graph; plain versus bee-matched attribution. |
| `prototypes/work-first.html` | Beads become the primary cards; provenance map groups by bee. |
| `prototypes/work-palettes.html` | Palette study (five studied; Moss and Paper kept). |
| `prototypes/work-native-filters.html` | **Final:** single-colony switcher, native label filters, Moss/Paper. |

## Verified native behaviour (`br 0.7.4`)

Confirmed against a disposable seven-bead fixture; no real tracker was read or changed.

- Repeated `--label` is AND (all required); repeated `--label-any` is OR (any matches); repeated `--exclude-label` hides a bead on any match. Combined: `(AND ∩ OR) − excludes`.
- Matching is exact and case-sensitive. `area`, `area:`, `area:*`, `area:%` match nothing; `AREA:COLONY` is not `area:colony`. There is no prefix, wildcard or substring matching.
- On `list`/`search`/`query` label flags, a comma is a literal character. Only `create -l` and `label add` split on commas.
- `br search` matches bead title, description, id and comment text; label flags AND with the text query.
- `list`/`search`/`query run` exclude closed beads by default; `--all` includes them and label filters then apply.
- `system`-labelled beads are not hidden automatically; `--exclude-label system` hides them.
- `br label list-all --json` returns `[{label, count}]`, where counts include closed and system beads. Treat those counts as whole-tracker totals, not current-board totals.
- Saved queries accept the same filters, and run-time flags replace the corresponding saved group rather than merging.

## Provenance caveat

Native spawn beads record `created_by`, the requester identity. A worker's environment sets `BD_ACTOR` to its friendly identity and injects `HIVE_SPAWN_ID`, so a bee that spawns another bee normally records its own friendly name as the child's requester. There is **no recorded parent spawn-request id**, and the current `bee status`/`colony inspect` read models do not expose `created_by` at all. Bee-to-bee parentage in these prototypes is therefore inferred by matching a requester string to a bee, and is drawn as dashed. It can be ambiguous or point outside the loaded history, and must never be presented as a recorded fact.

## Regenerating the prototypes

The generators under `scripts/` are throwaway but reproducible. Run them from `scripts/` with Python 3; each writes into `../prototypes/`:

```
python3 generate.py
python3 control-room-variants.py
python3 provenance.py
python3 work-first.py
python3 palettes.py
python3 work-filters.py
```

`work-first.py`, `palettes.py` and `work-filters.py` depend on earlier outputs, so keep the order. The committed prototypes already embed the graph libraries, so viewing needs no download. Regenerating the graph prototypes needs the two pinned builds in `vendor/` first:

```sh
mkdir -p vendor
curl -fLsS https://cdn.jsdelivr.net/npm/cytoscape@3.34.3/dist/cytoscape.min.js -o vendor/cytoscape-3.34.3.min.js
curl -fLsS https://cdn.jsdelivr.net/npm/cytoscape-dagre@4.0.1/dist/cytoscape-dagre.js -o vendor/cytoscape-dagre-4.0.1.js
```

The scripts are excluded from the repository markdown formatter via `.prettierignore`, because they emit large self-contained HTML. Third-party build output is fetched on demand rather than committed.

## Boundaries

Read-only: the prototypes never claim, close, relabel, retry or control a colony. Recorded attempt state is not proved process liveness, and agents' plugin labels in the `agents` sample are fictional vocabulary local to that sample — they are not additions to Hive's label taxonomy.
