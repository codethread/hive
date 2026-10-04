---
name: docs-styleguide
description: Use when writing, updating or reviewing repository documentation, including READMEs, guides, AGENTS.md, CLAUDE.md and skills. Apply Hive's audience, placement, skill-reference and repository-grounding rules.
---

# Docs style guide

## Write for the right audience

- **README.md is for users:** answer “How do I use Honeycomb?” Cover installation, usage and user-facing configuration, not agent contribution procedures.
- **AGENTS.md is for agents:** answer “How do I contribute to the Hive project?” Put durable repository rules and contribution guidance here.
- **Nested AGENTS.md files provide nested guidance:** put package-specific instructions in that package's file.
- **Skills hold task-specific procedures:** keep reusable workflows in the relevant skill.
- **Guides hold longer user reference material outside the README:** link to ordinary guides where that helps users.

## Keep skill references within skills

Skills may reference other skills. Keep skill references out of repository documentation, including READMEs, guides, AGENTS.md and CLAUDE.md.

## Check the documentation

- Read the surrounding documentation and identify its audience before adding text.
- Preserve essential commands, prerequisites and behavior.
- Verify documentation links.

## Ground guidance in the repository

- Document tools and workflows the repository supports or requires, including external prerequisites. A tool being installed locally, preferred by the user or required by the harness does not make it a project requirement.
- Keep personal or harness-local machinery, such as lock wrappers and machine-specific paths, out of project guidance unless the repository explicitly adopts it.

For example, `bun run test:changed` is a supported iterative-testing command because the repository defines that script. A user's test-lock wrapper is not a repository requirement.
