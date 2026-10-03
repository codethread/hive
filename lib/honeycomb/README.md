# honeycomb

`honeycomb` is a deterministic git worktree manager. It creates, finds, prepares, finishes, and removes worktrees using one consistent contract for humans, shell/tmux wrappers, scripts, and agents.

It is useful when you want predictable worktree paths, safe cleanup, JSON output, optional fixed worktree pools, and repeatable setup for local files such as `.env`.

## Install from Hive

Requirements: git and Bun. The optional `wk` picker requires fzf and zsh or Nushell.

From the Hive root, install workspace dependencies and generate the `honeycomb` launcher:

```nu
bun install
bun run --filter @hive/honeycomb build
```

The build writes:

```text
~/.local/bin/honeycomb
```

Make sure `~/.local/bin` is on your `PATH`.

After installing, use the built-in help for the full command reference:

```nu
honeycomb --help
honeycomb add --help
honeycomb config explain --help
```

## Zsh completions

Generate a completion script after installing Honeycomb:

```nu
honeycomb completions zsh | save --force ~/.honeycomb-completion.zsh
```

Add these lines to `~/.zshrc`, after putting `honeycomb` on your `PATH`. Skip `compinit` if your shell framework already runs it:

```zsh
autoload -Uz compinit
compinit
source ~/.honeycomb-completion.zsh
```

Restart zsh to enable completion for commands, nested subcommands, and flags. The script queries the installed `honeycomb` at tab time, so suggestions follow the current CLI. Branch names and filesystem paths are not suggested.

## How it works

`honeycomb` resolves one checkout as the **canonical root** for a repository. That root is protected and anchors config lookup, default-branch policy, generated paths, and safety checks.

By default, normal worktrees are created beside the root:

```text
<canonical-root>__<branch-name-with-/encoded-as-->
```

Set `worktree_location = "nested"` to create new worktrees under the canonical root instead:

```text
<canonical-root>/.worktrees/<branch-name-with-/encoded-as-->
```

Pooled repositories reuse fixed slots. These are `<canonical-root>__featN` in sibling mode and `<canonical-root>/.worktrees/featN` in nested mode.

The setting is a preference for newly created worktrees and missing pool slots. Existing sibling, `.wktree`, and manually located worktrees remain discoverable through Git metadata, so changing the preference does not require migration.

There is no app database. Current state comes from git worktree metadata, filesystem paths, and config. Tmux integration consumes emitted path/session data; it is not the source of truth.

## Basic use

From any path inside a repository worktree set:

```bash
honeycomb root
honeycomb add --branch feature/example
honeycomb list
honeycomb path --branch feature/example
honeycomb remove --branch feature/example
# Remove a clean checkout while retaining its branch
honeycomb remove --branch feature/example --keep-branch
# Delete a clean branch after proving a squash merge into the fetched target
honeycomb remove --branch feature/example --integrated-into origin/main
# Fuzzy-pick a worktree with fzf and print its path
honeycomb pick
```

For scripts and agents, prefer JSON where available and branch on the payload `kind`:

```bash
honeycomb add --branch feature/example --json
honeycomb list --json
honeycomb finish --json
honeycomb finish --title "<subject>" --json   # squash strategy
```

With `--json`, stdout is always a single JSON object and stderr stays silent. Check `ok`: failures carry `ok: false` with a `kind` (`blocked` or `error`) and a machine-readable `reason`. `add` runs the configured setup command before reporting `ready`, capturing its output in `setup_output`. If setup fails, `add` rolls back and exits `1` with `reason: "setup_failed"`.

Use this to see what config applies to the current repository:

```bash
honeycomb config explain --json
```

## Config

Config is optional. Without it, `honeycomb` still creates deterministic sibling worktrees.

Config is read from:

```text
${XDG_CONFIG_HOME:-~/.config}/honeycomb.toml
```

Resolution order:

1. built-in defaults and top-level `worktree_location`;
2. matching `[[rule]]` entries in file order;
3. exact `[[project]]` entry for the canonical root.

Later layers override earlier ones.

### Editor completion and validation

Copy [`honeycomb.schema.json`](./honeycomb.schema.json) beside your `honeycomb.toml`, then place this directive at the top of the TOML file:

```toml
#:schema ./honeycomb.schema.json
```

[Taplo](https://taplo.tamasfe.dev/configuration/directives.html), including editors using its TOML language server, resolves that path relative to the saved TOML file. Only comments or other directives may precede it. The schema supplies field completion, descriptions, allowed values, and validation of nested tables. Unknown fields are configuration errors.

Once this file is available on Hive's `main` branch, a remotely fetched schema can use this header instead:

```toml
#:schema https://raw.githubusercontent.com/codethread/hive/main/lib/honeycomb/honeycomb.schema.json
```

The remote URL requires access to that GitHub repository and follows `main`; replace `main` with a published commit SHA to pin the schema to your installed revision. The local-file directive works before publication and without network access.

The artifact is [JSON Schema Draft 4](https://taplo.tamasfe.dev/configuration/developing-schemas.html), generated with [Zod's native JSON Schema conversion](https://zod.dev/json-schema) from the same complete TOML schema used by the CLI. It describes the input, so fields with defaults remain optional. Environment-dependent checks—expanded-root uniqueness, inherited bootstrap commands, and normalized copy destination containment—run in the Zod schema at load time; JSON Schema cannot express those filesystem and cross-entry rules. Effective finish-policy safety is checked when the command runs.

### Configuration reference

```toml
worktree_location = "sibling" # "sibling" | "nested"; defaults to "sibling"

[defaults.add]
policy = "origin_default" # "origin_default" | "fresh_canonical"

[defaults.finish]
enabled = true
strategy = "ff_only"      # "ff_only" | "rebase_ff" | "squash" | "merge_commit"
push = false
remove_worktree = false
delete_branch = false

[[rule]]
root_glob = "~/dev/projects/**"   # required for rules; leading ~/ supported
worktree_location = "nested"      # optional override for matching repositories
command = "bun install"           # optional bash snippet
pre_remote_check = "test -f .env" # optional bash snippet

[rule.add]
policy = "fresh_canonical"

[rule.finish]
enabled = true
strategy = "squash"
push = true
remove_worktree = true
delete_branch = true

[[project]]
root = "~/dev/projects/example"   # required for projects
name = "example"                  # optional; defaults to basename(root)
command = "bun install"           # required for pools/copy unless inherited from a rule
pre_remote_check = "test -f .env" # optional
worktree_location = "sibling"     # optional exact-root override
pool_size = 3                      # optional; enables fixed slots
copy_mode_default = "copy"        # optional: "copy" | "symlink"; default "copy"
copy = [                           # optional
  ".env",
  { from = "~/shared/tooling", to = ".tooling", mode = "symlink" },
  { from = ".claude", to = [".claude", ".pi/claude"], mode = "copy" },
]

[project.add]
policy = "origin_default"

[project.finish]
enabled = true
strategy = "ff_only"
push = false
remove_worktree = false
delete_branch = false
```

Notes:

- `worktree_location` may be set globally, on a rule, or on an exact project. It controls where new worktrees and missing pool slots are created; registered worktrees keep their actual Git-reported paths. `nested` adds `/.worktrees/` and the previous `/.wktree/` path to the repository's shared exclude file so the canonical checkout remains clean.
- `command` and `pre_remote_check` run under bash.
- `command` receives `WK_ROOT` and `WK_CREATED`.
- `origin_default` starts default-base work from `origin/<default>` without mutating the canonical root.
- `fresh_canonical` fetches, requires a clean canonical root on the default branch, fast-forwards it, then starts work from that fresh local branch.
- `copy` destinations are always worktree-relative. String entries copy from the canonical root to the same relative path.
- `delete_branch = true` requires `remove_worktree = true` in the same effective finish policy.

## Examples

### Personal defaults

```toml
[defaults.add]
policy = "origin_default"

[[rule]]
root_glob = "~/dev/projects/**"
command = '''
if [[ -f bun.lock ]]; then
  bun install
elif [[ -f package-lock.json ]]; then
  npm install
else
  echo "honeycomb: no known install step"
fi
'''
```

### Strict work repos

```toml
[[rule]]
root_glob = "~/work/**"
pre_remote_check = "test -f .envrc || { echo 'missing .envrc' >&2; exit 1; }"

[rule.add]
policy = "fresh_canonical"
```

### Expensive repo with a pool

```toml
[[project]]
name = "big-app"
root = "~/dev/projects/big-app"
pool_size = 4
command = "bun install"
copy = [".env"]
```

```bash
honeycomb ensure --cwd ~/dev/projects/big-app
honeycomb status --cwd ~/dev/projects/big-app
```

### Finish and clean up

```toml
[[project]]
name = "library"
root = "~/dev/projects/library"

[project.finish]
strategy = "squash"
push = true
remove_worktree = true
delete_branch = true
```

From a non-canonical worktree:

```bash
honeycomb finish --title "feat: integrate library work" --json
```

The `squash` strategy requires `--title` and accepts an optional `--body`. The squash commit body also carries the source branch and every source commit message, oldest first, so breaking-change notes and per-commit context survive squashing. Other strategies reject `--title` and `--body`.

## Shell picker

`honeycomb shell-init zsh` and `honeycomb shell-init nu` print shell integration without requiring a repository. They define just `wk`: a function that runs `honeycomb --interactive pick` and changes the current shell's directory to the selected worktree. Arguments are forwarded to `pick`; use `honeycomb` directly for other commands.

### zsh

Add this line to `~/.zshrc`, then restart zsh:

```text
eval "$(honeycomb shell-init zsh)"
```

### Nushell

Generate the module once, and regenerate it after upgrading Honeycomb:

```nu
honeycomb shell-init nu | save --force ($nu.default-config-dir | path join "honeycomb.nu")
```

Add this import to `config.nu`, then restart Nushell:

```nu
use ($nu.default-config-dir | path join "honeycomb.nu") wk
```

### Use

```nu
wk                         # pick a worktree and cd into it
wk --cwd ~/dev/my-project   # pick from another repository
wk --open                  # focus its multiplexer session instead of changing directory
```

The engine owns selection and multiplexer behaviour; the function only applies the `HONEYCOMB_CD_FILE` handoff and cleans up its temporary file. Cancellation or failure leaves the current directory unchanged. Agents and scripts call `honeycomb` directly and must not pass `--interactive`.
