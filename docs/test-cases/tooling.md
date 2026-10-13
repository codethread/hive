# Removed Tooling configuration checks

These are removed executable checks: two redundant lint-staged configuration rows removed at the user's request in `hv-hu8eo.13`, outside the measured DANGER cleanup. Remaining tests may cover portions of the same behavior. One scenario outline with two examples accounts for both original cases.

## Partially staged Markdown and TypeScript

```gherkin
Scenario Outline: Preserve partially staged content while running applicable tools
  Given a real Git repository with generation 1 staged for <file> and generation 2 in its working copy
  And fake oxfmt and oxlint commands that record calls and leave that file unchanged
  When the installed lint-staged CLI runs with the repository's copied configuration
  Then it exits successfully
  And the staged content remains generation 1 and the working copy remains generation 2
  And exactly <oxfmt_calls> oxfmt calls and <oxlint_calls> oxlint calls are recorded, regardless of order
  And the Git stash is empty

  Examples:
    | file      | oxfmt_calls | oxlint_calls |
    | notes.md  | 1           | 0            |
    | source.ts | 2           | 1            |
```

The original fixture stored each generation as `{"generation":N}` followed by a newline, even for these Markdown and TypeScript filenames. These checks repeated configured tool lists; they did not exercise destructive formatting of either file.

## Restoration pointers

Baseline: `61e736f8e1f4bfad9b7338e140d33938d0426f71`. Source: `lib/tooling/tests/integration/lint-staged.test.ts`; shared fixture at lines 26–75, table at 78–82, title at 83, assertions at 91–101.

| Example | Original row | Original expanded title |
| --- | --- | --- |
| `notes.md` | Line 80 | staged notes.md preserves newer working content and runs only applicable tools |
| `source.ts` | Line 81 | staged source.ts preserves newer working content and runs only applicable tools |

Source correspondence is recorded in scout `hv-hu8eo.2` comment 4378 and removal task `hv-hu8eo.13`. Ledger `hv-luv2v` comment 4466 retains the Tooling Beads checks; those executable checks are not parked scenarios here. The focused `.beads/issues.jsonl` regression also remains executable in the same integration file, with a destructive fake formatter that exposes a broken JSONL exclusion.
