# Kind and harness configuration

Use `colony init --help` for first setup with Codex, Claude or both, including model and permission choices. For custom kinds or harnesses, edit the canonical worktree's `.hive/bees.toml`; worktree-local and root-level `bees.toml` files are ignored. Preserve the repository's human ownership and reservation policy.

Reuse valid existing configuration. Review the selected formula's executable and model access before activation. Restricted execution must permit the attempt's private completion-artifact writes; generated configuration alone does not verify that access. Trust of repository onboarding hooks is separate from the harness permission mode. Review hook trust in the actual execution checkout and verify received context in the first execution below.

Use `colony config schema` for JSON schemas of central configuration, defaults and runtime updates. It works without a repository, tracker or daemon. The `configuration` schema describes `.hive/bees.toml`; `runtimeUpdates` describes temporary changes through `colony config update`. Schema discovery does not read or validate your current configuration; read back effective kinds as below and follow [policy and recovery](recovery.md) for activation.

## Define kinds

The central file requires `owner`, `humans` and `formulas`; inline `kinds` and the folder catalog are optional. Each kind requires `description`, `harness`, `model` and `effort`. Its `harness` names a matching formula under `[formulas]`. The optional `workflow` defaults to `do-work`; follow `bee spawn --help` for workflow installation and input discovery.

This minimal central configuration illustrates the shape. Replace the human, model, executable and flags with values supported by your repository and installed harness:

```toml
owner = "ct"
humans = ["ct"]

[kinds.reviewer]
description = "Review code changes against repository standards."
harness = "example"
model = "selected-model"
effort = "high"
system_prompt = "Review the assigned changes and report actionable findings."

[formulas.example]
executable = "/path/to/harness"
headless = ["--print"]
argv = ["--model", "{{model}}", "{{#if system_prompt}}--system-prompt{{/if}}", "{{system_prompt}}", "{{prompt}}"]
```

Keep the role's remit, judgement, authority limits and professional result contract in `system_prompt`. Busy Bee workflows own task-specific sequence; the same role can serve different workflows. Put task scope, context, deliverables and acceptance in workflow input and stage briefs, and optional execution direction in `prompt`; prompt overrides do not change the assignment.

To store a kind separately, move its fields into an immediate `.hive/bees/` subdirectory:

```text
.hive/bees/review-role/
  bee.toml
  system_prompt.md  # optional role instructions
  prompt.md         # optional execution direction
```

In `bee.toml`, replace the `[kinds.reviewer]` table header with `name = "reviewer"` and retain the four required kind fields. The declared name identifies the kind independently of the folder name. Put prompts in the sibling Markdown files: folder definitions reject inline `prompt` and `system_prompt`. Sibling files are read verbatim; absent or empty files mean empty prompts. Central kinds may instead set prompts inline, with omitted prompts defaulting to empty text.

Discovery reads immediate directories only and excludes directory symlinks. The central file remains required. A central kind replaces the whole folder definition with the same declared name and emits a warning. Duplicate declared names across folders without a central winner fail; missing or invalid folder definitions fail even when shadowed.

Read back the effective kind with `bee kinds reviewer --as reviewer --verbose --json --repo CHECKOUT`, substituting your kind name. An explicit kind bypasses the discovery filter; `--as` overrides any caller kind inherited from another repository. This validates configuration without launching work. Editing kind defaults affects new submissions; captured recipes retain their original values.

## Deliver instructions through formulas

Each formula requires `executable` and `argv`; `headless` is optional. `argv` applies to every invocation. `headless` tokens prepend only for managed executions, inactivity reviews and post-run inspectors. Interactive runs require a TTY.

Executable and argument tokens use strict Handlebars with the recipe fields `kind`, `harness`, `model`, `effort`, `cwd`, `system_prompt` and `prompt`, without HTML escaping. Unknown fields fail. Each token becomes one argument; empty rendered arguments are omitted. Condition both an optional flag and its value so neither survives alone. For a JSON-valued harness setting, use the `json` helper, for example:

```toml
argv = ["{{#if system_prompt}}-c{{/if}}", '{{#if system_prompt}}developer_instructions={{json system_prompt}}{{/if}}', "{{prompt}}"]
```

Ordinary argument values remain raw; use JSON quoting only where the harness expects it. Route `system_prompt` to native role instructions and `prompt` to the execution message. Keep both routes: the managed execution message carries the assignment and delivery target. Validation renders formulas with present and absent prompts and canonical and explicit execution directories; a matching formula is required to invoke a kind.

For an authorized live formula change, read `colony config update --help` for the payload and [policy and recovery](recovery.md) for activation/reset behavior (`colony skills file operations references/recovery.md`).

## Verify the first execution

1. Read back the configured kind as above. In its intended execution checkout, use `busybee skills get workflow-execution` to prepare and discover the kind's workflow and input schema.
2. Choose a bounded assignment under existing onboarding work that leaves application files unchanged. Require an authored response, confirmation of received onboarding context and normal completion reporting. Submit through `bee spawn --help`, then deliberately activate the selected repository with `colony wake --help`.
3. Retain the request and run IDs. Use `bee result --help` to read the response, `busybee show` to confirm the run reports `done`, and `colony explain --help` to verify execution settlement and released capacity. Confirm application files remain unchanged.

If any check disagrees, retain the IDs and observations and follow [stalled-execution diagnosis](../SKILL.md#diagnose-stalled-execution) before submitting another check. Generated files and schema discovery alone do not prove runtime readiness.
