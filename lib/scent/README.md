# Scent

Scent supplies Hive identity through a native Pi extension or Claude Code and Codex command hooks. Enable it in each adopting repository; it is independent of Beeswax's tool onboarding.

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

Native sessions and Bee launches follow the [shared identity rules](../../docs/agent-identity-scope.md#current-implementation-and-planned-bindings). Friendly names are attribution labels, without guaranteed uniqueness. Pi retains supplied Bee provenance when recreating extensions during a session switch.

In interactive Pi sessions, Scent publishes the friendly name through Pi's `scent-identity` status key for optional footer display. Session changes refresh the value; session shutdown clears it.

Scent sets `BD_ACTOR`, `BR_HARNESS=pi`, `HIVE_AGENT_NAME`, `HIVE_AGENT_SESSION` and `HIVE_AGENT_SOURCE`. It refreshes `BR_MODEL` and `BR_EFFORT` from Pi when known and deletes them when unknown. `BR_AGENT_NAME` retains a supplied Bee kind; native names do not imply a kind. `BR_EFFORT` is tool environment metadata, not a new Beads field. Other environment variables, including `BEADS_DB`, stay as supplied. Select the tracker before launching Pi; code cwd never selects it.

## Native Claude Code

Hive's [project settings](../../.claude/settings.json) load Scent alongside the existing Beeswax hooks. Outside Hive, merge these entries into the adopting repository's `.claude/settings.json`, preserving its existing settings and hooks. Replace the absolute path with your Hive checkout and make `bun` available on Claude Code's `PATH`. Load Scent once, then start a new session in that repository.

```json
{
	"hooks": {
		"SessionStart": [
			{
				"matcher": "^(startup|resume|clear|compact)$",
				"hooks": [
					{
						"type": "command",
						"command": "bun '/absolute/path/to/hive/lib/scent/src/bin/claude.ts'"
					}
				]
			}
		],
		"SubagentStart": [
			{
				"hooks": [
					{
						"type": "command",
						"command": "bun '/absolute/path/to/hive/lib/scent/src/bin/claude.ts'"
					}
				]
			}
		]
	}
}
```

SessionStart appends quoted exports to Claude's [session environment file](https://code.claude.com/docs/en/hooks#persist-environment-variables) for later Bash tools: `BD_ACTOR`, `HIVE_AGENT_NAME`, `HIVE_AGENT_SESSION`, `HIVE_AGENT_SOURCE` and `BR_HARNESS=claude`. The event's model supplies `BR_MODEL` when present; otherwise a supplied Bee model is retained. Bee kind and effort are retained when supplied. Native sessions unset unknown `BR_MODEL`, `BR_AGENT_NAME` and `BR_EFFORT` values. Scent preserves unrelated environment, including the selected `BEADS_DB`.

Both hooks return identity context requiring `--actor <own-friendly-name>` on every `br` mutation. SessionStart follows the [shared identity rules](../../docs/agent-identity-scope.md#current-implementation-and-planned-bindings). SubagentStart derives the child's name from `agent_id` and writes only context: child Bash tools inherit the parent session's environment, so explicit attribution selects the child's actor.

Invalid events, a missing SessionStart `CLAUDE_ENV_FILE` or failed writes cause the hook command to fail. The SessionStart matcher deliberately excludes user forks. The [Claude Scent evidence](../../docs/harness-capabilities.md#claude-scent-evidence) records the exercised versions, entry paths and remaining verification.

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
