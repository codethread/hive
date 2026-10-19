# Beeswax

Read the [project contract](README.md#commit-the-project-contract) before changing generation or hook ownership.

Keep the CLI and Clack wizard on one setup path, resolving options before effects.

Place repository files whose locations we control under `.hive/`, grouped by owning tool. Honor harness, Git and Husky discovery requirements and user-selected Git hook paths. Native entrypoints that must stay elsewhere must be as thin as possible, delegating tool behavior.

Prefer minimal defaults; add a setting only for a concrete need. Keep team defaults visible in committed, editable intent and machine-specific selections in ignored local settings or explicit invocations. Treat committed tool-owned artifacts as the accepted project contract and reproduce generated output from it.

When changing harness integration, use the [environment capability guide](README.md#environment-capability-and-guidance) to distinguish onboarding from environment delivery. Configured environment bridges need less agent guidance; otherwise use the available instruction channel.

Identify managed content deterministically with versioned fenced comment blocks where the format supports comments, or recognized structured entries in JSON. JSON onboarding ownership uses the versioned `statusMessage` and checked command shape in [onboarding.ts](src/onboarding.ts).

Automate recognizable version changes and replacements of clearly owned sections, preserving surrounding user configuration and content. Fail on unfamiliar or ambiguous state with the observed state, intended result, affected paths and bundled guidance so an agent can resolve it with the user.

Verify standalone operation without Hive sources or application dependencies, including a permanent tracker whose HEAD predates Beeswax configuration. Keep the bundled Husky runner and license together.
