---
name: docs-writing
description: Write, update or review repository documentation, including READMEs, guides, AGENTS.md and SKILL.md files. Use for any documentation change to keep content concise, audience-appropriate and free of redundant agent-discovery instructions.
---

# Docs writing

## Write for the right audience

- **README.md is for users:** answer “How do I use Honeycomb?” Cover installation, usage and user-facing configuration, not agent contribution procedures.
- **AGENTS.md is for agents:** answer “How do I contribute to the Hive project?” Put durable repository rules and contribution guidance here.
- **Nested AGENTS.md files provide nested guidance:** put package-specific instructions in that package's file. Add only what differs from or extends the root guidance; do not repeat inherited rules.
- **Skills hold task-specific procedures:** keep reusable workflows in the relevant skill rather than copying them into READMEs or every package's instructions.
- **Guides hold longer reference material:** keep detailed user explanations outside the README when they would obscure getting started. Link to ordinary guides where that helps users.

## Rely on automatic discovery

The harness reads AGENTS.md automatically. It also surfaces skills automatically; each SKILL.md description governs whether an agent loads its body.

Do not add links, inventories, “read AGENTS.md” reminders or “load this skill” prompts for routine agent work. If a skill is not being selected for the right tasks, improve its description rather than adding discovery instructions elsewhere.

Reference an AGENTS.md or skill file only when intentionally directing a maintainer to update that file. For example, “When changing testing policy, update the testing skill” is a maintenance instruction; “Read the testing skill before running tests” is redundant discovery guidance.

## Keep the change small

- Read the surrounding documentation and identify its audience before adding text. Move misplaced guidance instead of duplicating it.
- Preserve essential commands, prerequisites and behavior; remove repeated explanations, command catalogs and implementation detail the reader does not need.
- Verify documentation links. Check that each added paragraph changes something the intended reader needs to know or do.

## Ground guidance in the repository

- Verify recommended commands against existing scripts, configuration, implementation or declared prerequisites. Use actual invocations, not plausible script names.
- Document tools and workflows the repository supports or requires, including external prerequisites. A tool being installed locally, preferred by the user or required by the harness does not make it a project requirement.
- Keep personal or harness-local machinery, such as lock wrappers and machine-specific paths, out of project guidance unless the repository explicitly adopts it.

For example, `bun run test:changed` is a supported iterative-testing command because the repository defines that script. A user's test-lock wrapper is not a repository requirement.
