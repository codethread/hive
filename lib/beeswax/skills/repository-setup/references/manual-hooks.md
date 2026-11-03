# Integrate repository-owned hooks

`--hooks manual` prints this task and stops the whole setup invocation without changing hooks, the tracker, Git configuration, project files or onboarding, even when other setup options were supplied. It needs no `--tracker` choice and is not saved in project configuration. Existing policy stays unchanged. By contrast, `--hooks none` runs setup and installs managed validation sections, but skips framework bootstrap.

Integrate Beeswax with the repository's preferred hook tooling. Follow established project policy; ask the user only about unresolved policy or ownership decisions. This task grants no authority to commit, publish or change user-global hooks.

## Choose the integration

Use `beeswax setup --help` to compare installed presets. For native hk, Beeswax requires installed hk >=2.8.1, Git >=2.54 and valid application-local Pkl with an installable Git event. It validates Pkl without creating or editing it, then runs `hk install` only from the application checkout. hk owns native repository-local registrations; Beeswax owns independent validation sections in the fixed common-directory `.git/hooks/pre-commit` and `.git/hooks/pre-merge-commit` files. Git dispatches native policy first. hk merge policy is optional; both validators remain installed, including when `HK=0` skips hk.

The hk preset does not migrate legacy shims, global/system/worktree registrations, `core.hooksPath` overrides or ambiguous ownership. Disabled events and nonserial merge dispatch also need review. Use `beeswax migrate hooks` for an existing conflict; retain user policy rather than forcing installation.

**After an hk failure**, inspect the JSON error receipt and current hooks/config before retrying. `hkInstallAttempted: true` records an attempted installer invocation; `hkInstallCompleted: true` means it returned exit code 0, not that verification passed. Even a failed invocation can leave changes. Failed native commands retain diagnostics in `stdout`/`stderr` when available; `hkInstallResult` retains successful installer output if later verification fails. Completed effects are not rolled back.

Snapshot-safe hk policy belongs to the project. A nested tracker can inherit an ancestor's configuration even without a tracker-local `hk.pkl`; inspect effective policy with `hk validate --json` in both checkouts. Absence of a local file is not an exemption. Standalone hk is a runtime prerequisite; Beeswax validation requires no Node, Husky or Cargo application dependencies. Verify actual dispatch as described below before claiming readiness.

For another topology or framework, use the custom integration procedure below. A manual handoff itself selects or installs nothing.

## Custom integration

1. **Inspect effective dispatch.** Identify the existing framework, hook files, Beeswax contract and selected tracker. Inspect Git configuration with origins and scopes, including `core.hooksPath`, `hook.*` registrations and worktree overrides. Trace what actually runs for `pre-commit` and `pre-merge-commit` in application checkouts and the permanent tracker; file presence alone proves neither event is covered.

2. **Choose stable entrypoints.** Preserve application checks, commit-message policy and custom hooks. Arrange for both events to reach project-owned POSIX-shell files containing Beeswax validation, independent of replaceable framework shims. In particular, legacy hk-generated shims are replaced on reinstall; keep validation outside them. Ensure snapshot-only validation runs without application dependencies or a disposable checkout. Keep application checks and any snapshot-only exemption outside the Beeswax section: successful validation returns to the caller rather than skipping the remaining hook.

3. **Use the exact section.** Obtain the installed release's `tracker-validation` section from a generated hook in a disposable repository using `--tracker none`, or from that release's `hookSection` source. Use `beeswax info --help` to locate matching source; an unrelated checkout is not authoritative. Copy the complete section unchanged, preserving surrounding content and file modes. Do not invent a marker body or approve custom contents through a receipt.

4. **Apply the agreed integration.** Only after choosing dispatch and insertion points, use `beeswax setup --help` to select the tracker operation and run setup with `--hooks none`, explicit `--pre-commit` and `--pre-merge-commit` paths, and the other intended options. These paths must name the actual shell entrypoints reached above, not merely files registered in configuration. For an existing contract or conflicting hooks, use `beeswax migrate hooks` or `beeswax migrate setup` for the supported handoff rather than overwriting policy.

   The permanent tracker must have the same configured hook pair with exact sections before binding. Preserve its accepted files and history; setup does not rewrite its tracked hooks. For first initialization, follow the canonical-checkout preparation in setup help. If an existing tracker lacks the prerequisites, resolve that migration within the user's authorization before retrying.

## Verify and report

Exercise the effective dispatch, not just the validation command. Use disposable test repositories for destructive probes, retaining the chosen framework and Git configuration:

- On `tracker/state`, stage only `.beads/issues.jsonl`: a valid index with an invalid working copy must pass; an invalid index with a valid working copy must fail. Check both `pre-commit` and `pre-merge-commit` paths.
- Verify ordinary application commits and real merge commits retain their checks, arguments and failure propagation. Repeat snapshot-only checks without application dependencies, and confirm framework reinstall preserves validation routing. For hk, also verify rejection with `HK=0` and after a synchronous policy step changes the index.
- Inspect the real application and permanent tracker checkouts for unexpected changes and effective local bindings.

Report configured files and registrations separately from demonstrated execution readiness. Name the commands, checkouts and results verified, plus unresolved decisions or untested paths. Printed guidance and successful setup receipts alone do not establish readiness.
