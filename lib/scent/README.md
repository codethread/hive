# Scent

Scent supplies Hive identity through a native Pi extension or Codex command hooks. Enable it in each adopting repository; it is independent of Beeswax's tool onboarding.

From a Hive checkout, install the workspace dependencies with `bun install`.

## Native Pi 1.2.0

Hive's [project settings](../../.pi/settings.json) load Scent when you start native Pi at the checkout root. No user installation is needed for that checkout.

Outside Hive, add the extension to that repository's `.pi/settings.json`, merging with its existing `extensions` array:

```json
{
	"extensions": ["/absolute/path/to/hive/lib/scent/src/bin/pi.ts"]
}
```

Replace the path with your Hive checkout. Relative extension paths resolve from the project's `.pi` directory. Start native Pi in that project and grant project trust to load its settings. Use the native executable: a PATH `pi` wrapper can run another runtime. Load Scent once. Extensions that replace the entire system prompt must preserve its named `scent` section themselves.

Native identities come from the actual session key through a seeded name generator. Repeated starts, resume and compact retain the name; new sessions resolve a new name. Names are attribution labels, without guaranteed uniqueness. Bee supplies its own name for both interactive and Colony-managed launches. Scent retains that name across conversation changes and binds it to the current session. Bee clears any inherited native session binding and marks its supplied identity before launch. The `HIVE_AGENT_SOURCE=bee|native` marker survives Pi recreating extensions during a session switch.

In interactive Pi sessions, Scent publishes the friendly name through Pi's `scent-identity` status key for optional footer display. Session changes refresh the value; session shutdown clears it.

Scent sets `BD_ACTOR`, `BR_HARNESS=pi`, `HIVE_AGENT_NAME`, `HIVE_AGENT_SESSION` and `HIVE_AGENT_SOURCE`. It refreshes `BR_MODEL` and `BR_EFFORT` from Pi when known and deletes them when unknown. `BR_AGENT_NAME` retains a supplied Bee kind; native names do not imply a kind. `BR_EFFORT` is tool environment metadata, not a new Beads field. Other environment variables, including `BEADS_DB`, stay as supplied. Select the tracker before launching Pi; code cwd never selects it.

## Native Codex

Add these entries to the adopting repository's `.codex/hooks.json`, merging with existing hooks. Replace the absolute path with your Hive checkout path and make `bun` available on the harness's `PATH`. Preserve the existing configuration, including Beeswax onboarding and tracker settings. Load Scent once.

Start a new Codex session, trust the project and open `/hooks` to review and trust the definitions. Project hooks and changed-definition trust are described in the [Codex hooks reference](https://learn.chatgpt.com/docs/hooks).

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
