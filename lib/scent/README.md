# Scent

Scent is Hive's installed identity runtime for native Pi, Claude Code and Codex. Beeswax owns repository integration; Scent resolves identity and supplies harness context independently of bee-kind configuration.

## Enable identity

Install the matching Hive suite through [installation and releases](../../docs/releases.md#homebrew-installation), then select your harnesses through [Beeswax onboarding](../beeswax/README.md#load-onboarding-in-your-harness). That guide owns installation, regeneration, removal and project trust. Consuming repositories need no Hive source checkout, application dependencies or Bun runtime for identity.

For callback protocols, use `scent system --help` and the focused command help. For breaking changes and required adoption actions, use `scent changelog`.

## Native Pi

The generated loader obtains Scent's bundled extension from the installed executable and runs it inside Pi. Scent contributes one named `scent` system-prompt section before each agent run; extensions that replace the whole system prompt must preserve that section.

Scent refreshes identity and known model/effort metadata in Pi's tool environment, clears unknown optional metadata and preserves unrelated variables, including the selected `BEADS_DB`. Select the tracker before launching Pi; code cwd never selects it. Native sessions and Bee launches follow the [shared identity rules](../../docs/agent-identity-scope.md#current-implementation-and-planned-bindings), including supplied Bee provenance across session switches.

Interactive sessions publish the friendly name through Pi's `scent-identity` status key for optional footer display. Session changes refresh it; shutdown clears it. Use the native executable: wrappers require their own capability profile.

## Native Claude Code

SessionStart appends quoted identity exports to `CLAUDE_ENV_FILE` for later Bash tools and returns identity context. It preserves unrelated environment, including the selected tracker, and clears unknown optional metadata according to the [Claude adoption rule](../../docs/agent-identity-scope.md#current-implementation-and-planned-bindings).

Both session and child context require `--actor <own-friendly-name>` on every `br` mutation. SubagentStart resolves the child's distinct `agent_id` and returns context only; child tools can inherit the parent's environment, so explicit attribution selects the child's actor. Invalid events, a missing SessionStart environment file or failed appends fail the hook.

## Native Codex

Session hooks resolve the session identity or adopt a supplied Bee identity; child hooks use the distinct `agent_id`. Both supply context requiring `--actor <own-friendly-name>` on every `br` mutation. Hooks leave the tool environment unchanged and store no identity state.

## Verification scope

The [capability contract](../../docs/harness-capabilities.md#current-hive-implementation-and-evidence) records exact harness versions, exercised entry paths and remaining checks, including the distinction between source-adapter evidence and installed delivery. Friendly names are attribution labels without guaranteed uniqueness. User forks, cache migration and parent ancestry remain outside the [identity scope](../../docs/agent-identity-scope.md).
