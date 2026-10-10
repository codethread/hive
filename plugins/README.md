# Hive plugins

The Honeycomb plugin provides Git worktree and merge queue guidance for Claude Code, Codex and Pi. All three harnesses load the same content; installing it does not install the executables or grant permission to commit, push or merge.

First install [Honeycomb](../lib/honeycomb/README.md#install-from-hive) and [qlock](../lib/qlock/README.md#install), and ensure both are on `PATH`.

## Install from a local checkout

Run the following commands from the Hive checkout you want to use. They register that checkout in the harness's personal settings.

### Claude Code

```nu
claude plugin marketplace add (pwd)
claude plugin install honeycomb@hive
```

### Codex

```nu
codex plugin marketplace add (pwd)
codex plugin add honeycomb@hive
```

### Pi

Pi uses packages rather than marketplace catalogs:

```nu
pi install (pwd)
```

Pi resolves duplicate skill names by load order. If you also use `codethread/agents`, run `pi config` and disable its Git workflow resource so Hive's copy is selected.

Restart the harness after installation. Claude Code and Codex cache plugins; refresh their marketplace and installed plugin after updating the source checkout. Pi loads a local package directly.

## Distribution

Claude Code reads the root `.claude-plugin/marketplace.json`; Codex reads `.agents/plugins/marketplace.json`. Both expose `honeycomb@hive`. Pi reads the explicit `pi.skills` paths in the root `package.json`, keeping Hive's repository-only contribution guidance out of the installed package.

The package remains private: local installation needs no npm publication. Once these files are on a published Git revision, Claude Code and Codex can also register `codethread/hive` as a marketplace, and Pi can install `git:github.com/codethread/hive`.
