# honeycomb

`honeycomb` is a deterministic git worktree manager. It creates, finds, prepares, finishes, and removes worktrees using one consistent contract for humans, shell/tmux wrappers, scripts, and agents.

It is useful when you want predictable worktree paths, safe cleanup, JSON output, optional fixed worktree pools, and repeatable setup for local files such as `.env`.

## Install from Hive

Requirements: Git; Bun for building. The optional `wk` picker requires fzf and zsh or Nushell.

From the Hive root, install workspace dependencies, compile locally, then install the executable:

```nu
bun install
bun run --filter @hive/honeycomb build
bun run --filter @hive/honeycomb install:bin
```

The build writes `lib/honeycomb/dist/honeycomb`. Installation copies that standalone executable to `~/.local/bin`; put that directory on `PATH`. Use `install:bin --directory /path/to/bin` to select another destination. Building alone does not change installed commands.

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

Pooled repositories reuse fixed slots. These are `<canonical-root>__featN` in sibling mode and `<canonical-root>/.worktrees/featN` in nested mode. `add` initializes missing or half-initialized slots before allocation; use `ensure` to pre-warm or repair the pool explicitly.

`list` only reads Git's registered worktree inventory. It does not load config, scan checkout contents, contact remotes, or run setup, so missing slots stay absent and existing slots remain listable even when setup is broken. `status` inspects pool readiness without repairing it. Pooled `remove` recycles its existing target without initializing any slots.

The setting is a preference for newly created worktrees and missing pool slots. Existing sibling, `.wktree`, and manually located worktrees remain discoverable through Git metadata, so changing the preference does not require migration.

There is no app database. Current state comes from git worktree metadata, filesystem paths, and config. Tmux integration consumes emitted path/session data; it is not the source of truth.

## Basic use

From any path inside a repository worktree set:

```bash
honeycomb root
honeycomb add --branch feature/example
honeycomb list
honeycomb tree
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

## Worktree ancestry tree

```nu
honeycomb tree
honeycomb tree --json
```

`tree` renders registered worktrees using **current Git commit ancestry**, not recorded branch creation history:

```text
Worktrees (inferred from Git ancestry; not creation history)
└── main [canonical] [? parent unclear: no ancestor worktree]
    ├── feature/api
    │   └── feature/ui = feature/ui-review [same HEAD]
    └── feature/docs
```

Worktrees at the same commit share a node (`=` / `[same HEAD]`); this does not imply parentage between them. Each node nests under its nearest strict ancestor among the registered HEAD groups. Nodes with no registered ancestor or multiple incomparable nearest ancestors stay at the top level, marked `?`. Bare and unborn worktrees have no HEAD and remain separate, marked `[? no HEAD]`. Detached worktrees are labelled by their paths.

The view follows locally available history, so merges, rebases, and shallow history can change the shape. Already-integrated branches may appear **above** `main`. Even an unmarked edge proves commit ancestry, not which branch a worktree was created from.

Like `list`, `tree` never loads config or runs setup. It also reads local commit history, requires Git 2.45+ to prevent on-demand fetching, and never contacts remotes. Git errors fail the command rather than becoming uncertainty markers.

JSON uses `kind: "tree"`, `basis: "git_ancestry"`, and a flat `nodes` array. Each node contains `id` (its full commit OID, or worktree path when no commit exists), `worktrees` (the same fields as `list --json`), and `parentage`:

- `{ "kind": "inferred", "head": "<parent OID>" }`
- `{ "kind": "ambiguous", "heads": ["<candidate OID>", "..."] }`
- `{ "kind": "unknown", "reason": "no_ancestor" }` or `"no_head"`

## Config

Config is optional. Without it, `honeycomb` still creates deterministic sibling worktrees.

Global config is read from:

```text
${XDG_CONFIG_HOME:-~/.config}/honeycomb.toml
```

Repository-local config is read from `honeycomb.toml` at the **canonical root** (the path printed by `honeycomb root`). Commit that file to share setup and policy with the repository. Every worktree uses the canonical file, including commands invoked from a feature worktree or its subdirectories. A same-named file in a feature worktree is ignored; changes take effect when the canonical file changes.

Resolution order:

1. built-in defaults, global `[defaults]` and top-level `worktree_location`;
2. matching `[[rule]]` entries in file order;
3. exact global `[[project]]` entry for the canonical root;
4. repository-local `honeycomb.toml`.

Later layers override earlier ones. Omitted local fields inherit the resolved global values. Nested `[finish]` fields merge individually, including explicit `false` values. A local `copy` list replaces the inherited list; `copy = []` disables inherited copying.

`honeycomb config explain --json` reports global `matched_rules` and `project`, the local file's path and explicit settings in `local_config` when present, effective `add`/`finish`/`worktree_location`, and effective name, pool size and copy settings in `setup`. Local command and hook sources use `local:<canonical-root>/honeycomb.toml`; inherited values retain their global sources. The text output also shows the local path and effective setup.

### Repository-local configuration

The local file accepts the same repository options as a global project entry: `name`, `command`, `pre_remote_check`, `worktree_location`, `pool_size`, `copy_mode_default`, `copy`, `[add]` and `[finish]`. Every option is optional. Put the options directly in the file:

```toml
command = "bun install"
worktree_location = "nested"
copy = [".env"]

[add]
policy = "origin_default"

[finish]
strategy = "squash"
push = false
```

The local file rejects `defaults`, `rule`, `project`, `root`, `root_glob` and unknown fields. Malformed TOML and invalid options fail with an error identifying the local file. Either file can be absent; an empty local file inherits all global settings. The global file must still be valid on its own.

Local pools, nonempty copy lists and explicitly set `copy_mode_default` require an effective bootstrap command, supplied locally or inherited from a matching global rule/project. For a local copy list, omitted entry modes use local `copy_mode_default`, then the inherited exact project's default, then `copy`; explicit entry modes win. When local `copy` is omitted, inherited entries keep their already-resolved modes, even if local `copy_mode_default` changes.

### Editor completion and validation

Choose the schema for the file you are editing:

| Config file | Editor schema |
| --- | --- |
| Global XDG config | [`honeycomb.schema.json`](./honeycomb.schema.json) |
| Canonical-root repository config | [`honeycomb.local.schema.json`](./honeycomb.local.schema.json) |

Copy the chosen schema beside your `honeycomb.toml`, then place the corresponding directive at the top of the TOML file. For repository-local config:

```toml
#:schema ./honeycomb.local.schema.json
```

For global config:

```toml
#:schema ./honeycomb.schema.json
```

[Taplo](https://taplo.tamasfe.dev/configuration/directives.html), including editors using its TOML language server, resolves that path relative to the saved TOML file. Only comments or other directives may precede it. The schema supplies field completion, descriptions, allowed values, and validation of nested tables. Unknown fields are configuration errors.

Once the schemas are available on Hive's `main` branch, a remotely fetched repository-local schema can use this header instead:

```toml
#:schema https://raw.githubusercontent.com/codethread/hive/main/lib/honeycomb/honeycomb.local.schema.json
```

Use `honeycomb.schema.json` in that URL for global config. The remote URL requires access to that GitHub repository and follows `main`; replace `main` with a published commit SHA to pin the schema to your installed revision. The local-file directive works before publication and without network access.

Both artifacts are [JSON Schema Draft 4](https://taplo.tamasfe.dev/configuration/developing-schemas.html), generated with [Zod's native JSON Schema conversion](https://zod.dev/json-schema) from the same TOML schemas used by the CLI. They describe the input, so fields with defaults remain optional. Runtime loading also checks expanded-root uniqueness, inherited bootstrap requirements and normalized copy destination containment; JSON Schema cannot express those filesystem and cross-entry rules. Effective finish-policy safety is checked when the command runs.

### Global configuration reference

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

- `worktree_location` may be set globally, on a rule, on an exact project, or locally. It controls where new worktrees and missing pool slots are created; registered worktrees keep their actual Git-reported paths. `nested` adds `/.worktrees/` and the previous `/.wktree/` path to the repository's shared exclude file so the canonical checkout remains clean.
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
