# @hive/shared

Utilities and models common to all packages.

- shared is not a grab bag. Only add models, types and utilities that a consumer actually needs, and keep every addition clearly justified.
- shared must not import `@hive/colony`, `@hive/ghost`, or `@hive/honeycomb`, by package specifier or relative path; this is enforced by oxlint.
- Keep shared provider- and transport-agnostic; CLI plumbing belongs in `colony`, process lifecycle in `ghost`.
