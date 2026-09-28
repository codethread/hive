# Architecture

Hive is a Bun workspace monorepo written in strict TypeScript. TypeScript runs directly on Bun:
each package exports its `src/index.ts`, there is no build step, and packages consume each
other through workspace dependencies.

## Packages

```
lib/
├── shared/   utilities and models common to all packages (not a grab bag)
├── colony/   CLI abstraction over model providers
└── ghost/    daemon process that runs
```

## Dependency rules

```
colony ──▶ shared ◀── ghost
```

- Cross-package imports must use the `@hive/shared` package specifier.
- `colony` and `ghost` must not import each other, by package specifier or by relative path.
- `shared` must not import `colony` or `ghost`.

`.oxlintrc.json` enforces this with per-package `no-restricted-imports` overrides. Each override
matches both `@hive/<package>` specifiers and relative specifiers that traverse into the
package, so `../..` tricks cannot bypass the boundary.

## Runtime model

- Bun 1.4+ runs the TypeScript sources; `tsc --noEmit` in each workspace is the only type gate.
- `colony` and `ghost` declare `"@hive/shared": "workspace:*"`, so imports resolve to source.
- Formatting, linting and typechecking are wired into Husky; see
  [Development](./development.md).

## Tooling

- **oxlint** — strict categories (correctness, suspicious, pedantic, perf, style) at error,
  with `nursery` and `restriction` off. The restriction category is a wholesale ban-list, so
  bans are configured explicitly instead (see `no-restricted-imports` below). The named-export
  style rules (`import/no-named-export`, `import/prefer-default-export`, `import/group-exports`)
  and `one-var` are disabled because they fight the repository's conventions.
- **oxfmt** — tabs (`useTabs: true`), otherwise defaults; formats TypeScript, JSON and
  Markdown.
- **commitlint** — Conventional Commits.
