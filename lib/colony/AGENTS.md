# @hive/colony

CLI abstraction over providers.

- Depends on `@hive/shared` only. Importing `@hive/ghost`, `@hive/honeycomb`, or any relative path that escapes into another package, is rejected by oxlint.
- Import shared code through the `@hive/shared` package specifier.
- User-facing CLI behaviour belongs here; long-running process work belongs to `ghost`.
