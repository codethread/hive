# Scent

Scent gives native Pi 1.2.0 a stable Hive identity in its prompt and tool environment.

From a Hive checkout, install the workspace dependencies with `bun install`. Load the extension by its absolute path, from any working directory:

```sh
~/.pi/agent/bin/pi --extension /absolute/path/to/hive/lib/scent/pi.ts
```

To keep loading it in native Pi, explicitly install that same entry point:

```sh
~/.pi/agent/bin/pi install /absolute/path/to/hive/lib/scent/pi.ts
```

The installation command changes Pi settings; the one-off `--extension` command does not. Use the native executable: a PATH `pi` wrapper can run another runtime. Load Scent once. Extensions that replace the entire system prompt must preserve its named `scent` section themselves.

Native identities come from the actual session key through a seeded name generator. Repeated starts, resume and compact retain the name; new sessions resolve a new name. Names are attribution labels, without guaranteed uniqueness. Bee supplies its own name for both interactive and Colony-managed launches. Scent retains that name across conversation changes and binds it to the current session. Bee clears any inherited native session binding and marks its supplied identity before launch. The `HIVE_AGENT_SOURCE=bee|native` marker survives Pi recreating extensions during a session switch.

Scent sets `BD_ACTOR`, `BR_HARNESS=pi`, `HIVE_AGENT_NAME`, `HIVE_AGENT_SESSION` and `HIVE_AGENT_SOURCE`. It refreshes `BR_MODEL` and `BR_EFFORT` from Pi when known and deletes them when unknown. `BR_AGENT_NAME` retains a supplied Bee kind; native names do not imply a kind. `BR_EFFORT` is tool environment metadata, not a new Beads field. Other environment variables, including `BEADS_DB`, stay as supplied. Select the tracker before launching Pi; code cwd never selects it.

The reusable resolver lives in `src/identity.ts`. Pi event mapping and environment publication live in `src/pi.ts`; `pi.ts` is the native loader entry point. There is no identity service, registry, database or workspace gate.

Only native Pi is implemented. Claude, Codex, Pies, user-fork migration, parent tracking and third-party subagent extensions remain outside this slice. See the [capability contract](../../docs/harness-capabilities.md) for supported surfaces.
