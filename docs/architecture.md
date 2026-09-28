# Architecture

Hive is a Bun workspace monorepo written in strict TypeScript. TypeScript runs directly on Bun: each package exports its `src/index.ts`, there is no transpilation step, and packages consume each other through workspace dependencies.

## Packages

```
lib/
├── shared/   utilities and models common to all packages (not a grab bag)
├── colony/   CLI abstraction over model providers
├── ghost/    daemon process that runs
└── honeycomb/   Git worktree manager and Nushell wrapper
```

## Dependency rules

```
colony ──▶ shared ◀── ghost
honeycomb
```

- Cross-package imports must use the `@hive/shared` package specifier.
- `colony`, `ghost`, and `honeycomb` must not import each other, by package specifier or by relative path.
- `shared` must not import `colony`, `ghost`, or `honeycomb`.
- `honeycomb` is self-contained and does not import the other Hive packages.

`.oxlintrc.json` enforces this with per-package `no-restricted-imports` overrides. The overrides reject relative specifiers that traverse into any other package — including `shared` — so `../..` tricks cannot bypass the boundary.

## Runtime model

- Bun 1.4+ runs the TypeScript sources; `tsc --noEmit` in each workspace checks all application and test sources.
- `colony` and `ghost` declare `"@hive/shared": "workspace:*"`, so imports resolve to source.
- `honeycomb` runs its TypeScript CLI from source; its optional build script writes a launcher for that CLI.
- Formatting, linting and typechecking are wired into Husky; see [Development](./development.md).

## Tooling

- **oxlint** — strict categories (correctness, suspicious, pedantic, perf, style) at error, with `nursery` and `restriction` off. The restriction category is a wholesale ban-list, so bans are configured explicitly instead (see `no-restricted-imports` below). The named-export style rules (`import/no-named-export`, `import/prefer-default-export`, `import/group-exports`) and `one-var` are disabled because they fight the repository's conventions.
- The imported `honeycomb` package has package-scoped exceptions for legacy style rules that would otherwise rewrite its source without changing behavior. Global rules and package import boundaries remain active.
- **oxfmt** — tabs and unwrapped prose (`useTabs: true`, `proseWrap: "never"`), otherwise defaults; formats TypeScript, JSON and Markdown.
- **commitlint** — Conventional Commits.
- **bun test** — built-in runner with `bun:test` imports, colocated `src/*.test.ts` and package-local unit/integration suites. Root `bunfig.toml` limits discovery to `lib/` and excludes the opt-in Nushell wrapper. Root and package scripts run isolated files across CPU cores with failure-only output and explicit 5s timeouts. See [Development](./development.md) for package and layer selection.
