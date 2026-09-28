# @hive/ghost

The daemon process that runs.

- Depends on `@hive/shared` only. Importing `@hive/colony`, or any relative path that escapes into another package, is rejected by oxlint.
- Import shared code through the `@hive/shared` package specifier.
- Process lifecycle, scheduling and provider sessions belong here; user-facing CLI behaviour belongs to `colony`.
