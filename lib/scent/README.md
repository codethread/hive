# Scent

Scent supplies Hive identity through a native Pi extension or Codex command hooks.

From a Hive checkout, install the workspace dependencies with `bun install`.

## Native Pi 1.2.0

Hive's [project settings](../../.pi/settings.json) load Scent when you start native Pi at the checkout root. No user installation is needed for that checkout.

Outside Hive, load the extension for one invocation by its absolute path:

```sh
~/.pi/agent/bin/pi --extension /absolute/path/to/hive/lib/scent/src/bin/pi.ts
```

For optional user-wide loading in native Pi, install that same entry point:

```sh
~/.pi/agent/bin/pi install /absolute/path/to/hive/lib/scent/src/bin/pi.ts
```

The installation command changes Pi settings; the one-off `--extension` command does not. Use the native executable: a PATH `pi` wrapper can run another runtime. Load Scent once. Extensions that replace the entire system prompt must preserve its named `scent` section themselves.

Native identities come from the actual session key through a seeded name generator. Repeated starts, resume and compact retain the name; new sessions resolve a new name. Names are attribution labels, without guaranteed uniqueness. Bee supplies its own name for both interactive and Colony-managed launches. Scent retains that name across conversation changes and binds it to the current session. Bee clears any inherited native session binding and marks its supplied identity before launch. The `HIVE_AGENT_SOURCE=bee|native` marker survives Pi recreating extensions during a session switch.

Scent sets `BD_ACTOR`, `BR_HARNESS=pi`, `HIVE_AGENT_NAME`, `HIVE_AGENT_SESSION` and `HIVE_AGENT_SOURCE`. It refreshes `BR_MODEL` and `BR_EFFORT` from Pi when known and deletes them when unknown. `BR_AGENT_NAME` retains a supplied Bee kind; native names do not imply a kind. `BR_EFFORT` is tool environment metadata, not a new Beads field. Other environment variables, including `BEADS_DB`, stay as supplied. Select the tracker before launching Pi; code cwd never selects it.

## Native Codex

Choose the local plugin or manual hooks below. Load Scent once: remove any manual Scent hooks when switching to the plugin.

After setup, start a new Codex session and open `/hooks` to review and trust the definitions. Installing or enabling the plugin does not trust its hooks. Project configuration also requires a trusted project. See the [Codex plugin guide](https://developers.openai.com/plugins/build/plugins) and [hooks reference](https://learn.chatgpt.com/docs/hooks).

### Local plugin

With workspace dependencies installed, build and install from the Hive checkout:

```sh
bun run --filter @hive/scent build:plugin
codex plugin marketplace add .
codex plugin add scent@hive
```

Codex needs `bun` on `PATH` to run the hooks. The build creates `plugins/scent/dist/codex.js`, including its dependencies; Codex copies it into the installed plugin cache. Rebuild and reinstall after changing Scent. The bundle is ignored by Git, so a Git checkout or marketplace without this local build is not ready to install.

`codex plugin add` enables Scent in user configuration. For Hive-only activation, set `enabled = false` under `[plugins."scent@hive"]` in `~/.codex/config.toml`, then merge this entry into the checkout's existing `.codex/config.toml`:

```toml
[plugins."scent@hive"]
enabled = true
```

Preserve the existing configuration, including Hive's generated tracker environment. The plugin handles session startup, resume, clear and compact, plus subagent startup.

### Manual hooks (optional)

Add these entries to either `~/.codex/hooks.json` or the project's `.codex/hooks.json`, merging with any existing hooks. Replace the absolute path with your checkout path:

```json
{
	"hooks": {
		"SessionStart": [
			{
				"matcher": "^(startup|resume|clear|compact)$",
				"hooks": [
					{
						"type": "command",
						"command": "bun '/absolute/path/to/hive/lib/scent/src/bin/codex.ts'"
					}
				]
			}
		],
		"SubagentStart": [
			{
				"hooks": [
					{
						"type": "command",
						"command": "bun '/absolute/path/to/hive/lib/scent/src/bin/codex.ts'"
					}
				]
			}
		]
	}
}
```

### Identity behavior

The hooks supply identity context requiring `--actor <own-friendly-name>` on every `br` mutation. Session hooks use the session key or adopt a supplied Bee identity; child hooks derive their own name from `agent_id`. The adapter leaves the tool environment unchanged and stores no identity state.

The [capability contract](../../docs/harness-capabilities.md#codex-scent-evidence) records verified Codex profiles, entry paths and limitations.
