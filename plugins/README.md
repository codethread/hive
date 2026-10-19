# Hive plugins

Hive's plugins package tool guidance for Claude Code, Codex and Pi. Adopt Hive behavior per repository; executables may be installed once on `PATH`.

For native harness identity, select harnesses through [Beeswax onboarding](../lib/beeswax/README.md#load-onboarding-in-your-harness). It installs Scent's repository adapters alongside primer and tracker-alert callbacks.

## Repository onboarding

[Beeswax setup](../lib/beeswax/README.md#load-onboarding-in-your-harness) is the repository adoption path. It generates local harness adapters that run `beeswax prime`; agents follow that map to the installed tools' help and bundled instructions. Select harnesses and guidance through setup/update, then commit the generated contract and adapters.

Install [Honeycomb](../lib/honeycomb/README.md#install-from-hive) and [qlock](../lib/qlock/README.md#install) on `PATH` for the default worktree and queue guidance. Repository onboarding grants no permission to commit, push or merge.

## Honeycomb distribution

Claude Code reads the root `.claude-plugin/marketplace.json`; Codex reads `.agents/plugins/marketplace.json`. Both expose `honeycomb@hive`. Pi reads the explicit `pi.skills` paths in the root `package.json`, keeping Hive's repository-only contribution guidance out of the installed package.
