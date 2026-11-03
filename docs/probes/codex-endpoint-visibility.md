# Codex endpoint visibility probe

Developer spike for `hv-xyhyg1.1`, executed under `hv-xyhyg1.1.1` on 2026-10-19. Eight CLI sessions establish that hook environment, model context and command-tool environment are separate observations. Native GUI delivery and successful read-only use of all three tools remain **unverified**. This report does not complete source acceptance or implement the endpoint modes in `hv-xyhyg1.4`.

## Evidence and limits

[Structured evidence](./codex-endpoint-visibility.evidence.json) owns the versions, row inputs, hook observations, nonces, command receipts and raw-event SHA-256 hashes. The measured versions were Codex CLI 0.163.0, vendor revision `e597169e9a783156e50ae9765d891a3dd74df064`, br 0.7.4, Mise 2026.10.4 and Bee/Busy Bee 0.7.1. Sessions used `codex --no-daemon exec --ephemeral`, model `gpt-6.1-sol`, a read-only sandbox and ordinary TUI project/hook review and trust.

Two disposable `CODEX_HOME` roots shared existing authentication through symlinks. Both used the same OS account and unchanged `HOME`; this is configuration-root isolation, not evidence for two OS users. Four independent temporary trackers sat outside their project roots. No production configuration, host bootstrap, installation, product integration or tracker publication was performed.

Native references:

- Source `hv-xyhyg1.1` and feature-task run `hv-xyhyg1.1.1` own acceptance and continuation.
- Architect response `hv-z4zfiw`, request `hv-qdjkbl`, report run `hv-xyhyg1.1.1.4`: bounded CLI follow-up and the manual GUI gate below. Retrieve the response with `bee response get hv-z4zfiw` or `bee result hv-qdjkbl`.
- Native comment **26895 on `hv-xyhyg1.1.1.2`** records the computer-use denial for `com.openai.codex`. It was not retried or circumvented. App installation/discovery does not establish GUI delivery; app build and launch behavior remain unknown.
- Prior Librarian response `hv-4whhk4`, request `hv-nj9gtf`, and architecture evidence thread `hv-t0ycq.1.2` retain the accepted two-mode intent. They do not approve an implementation.

Full local artifacts are located by the documentation assignment `hv-xyhyg1.1.1.7`. Under `${FIXTURE_ROOT}/results/<case>/`, `command.json` records launch inputs, `hook.json` records the hook observation, `events.jsonl` holds model and command events, and `exit.json` records process completion. The local `verified-summary.json` matches the linked JSON. The matrix driver and summarizer are local artifacts, not repository tooling. Repository evidence replaces machine paths with `${FIXTURE_ROOT}`, `${ASSIGNMENT_DB}`, `${CANONICAL_ROOT}` and `${USER_HOME}`; hashes identify the original unredacted event bytes.

## Observed CLI matrix

Here, **selected** means the endpoint supplied by the hook; **ambient** means `br info` without a database flag. Every row delivered its hook-only nonce to the model, and that nonce was absent from the user prompt. Both measured login-shell variants agreed on the endpoint variables.

| Case | Launch/configuration | Hook environment | Command environment and ambient result |
| --- | --- | --- | --- |
| `inherited-mise` | User A, Hive fixture, `inherit=all`, Mise launch | Fixture endpoint | Same endpoint; ambient selects it |
| `inherited-core-filtered` | User A, Hive fixture, inherited endpoint, `inherit=core` | Fixture endpoint | No endpoint; ambient exits 2, `NOT_INITIALIZED` |
| `policy-set-only` | User A, Hive fixture, `inherit=core`, policy `set.BEADS_DB` | No endpoint | Policy endpoint present; ambient selects it |
| `no-endpoint` | User A, Dots fixture, `inherit=core` | No endpoint | No endpoint; ambient exits 2, `NOT_INITIALIZED` |
| `second-user-mise` | User B, Hive fixture, `inherit=all`, Mise launch | User B fixture endpoint | Same endpoint; ambient selects it |
| `second-project-custom` | User B, Dots fixture, `inherit=all`, custom endpoint | Custom endpoint outside project | Same endpoint; ambient selects it |
| `foreign-assignment-mise-reentry` | User A, Dots fixture, assignment endpoint supplied before Mise | Mise replaces ambient endpoint with Dots fixture | Ambient selects Dots fixture; explicit `--db` preserves the selected assignment |
| `conflicting-aliases` | User B, Dots fixture, `inherit=all`, three conflicting variables | All three aliases present | Ambient selects `BD_DB`; removing it selects `BD_DATABASE`; explicit `--db` selects the hook endpoint |

Explicit `br info --db` returned the selected endpoint in every row. Together the alias and single-variable rows demonstrate `--db > BD_DB > BD_DATABASE > BEADS_DB` for these invocations. Repeated explicit reads also returned the selected endpoint. The prompt requested those repeats from `nested/`, and the models reported doing so, but exported command events omit the tool cwd argument. The retained receipts independently prove repeated selection, not the nested working directory.

Successful `br info` reads carried `sync_merge_pending_unknown`: the sandbox denied the native database opener lease, and br proceeded with automatic sync disabled. This result establishes endpoint selection for that command, not general tracker access. In the foreign-assignment row, the actual `bee status hv-af72ks` receipt failed: Bee exited 1 after underlying `br show` exited 7 on the workspace `.write.lock`.

The first model summary also claimed a Busy Bee failure, although no Busy Bee command receipt was present. The targeted supplement contains only model-visible text describing a structured lock error, with no `command_execution` item. See that row's `busybeeSupplement` and its separate hash. **Busy Bee execution/success and the complete br/Bee/Busy Bee check remain unverified.**

## Reproduce the CLI rows

Use disposable fixtures and the measured versions, or record version differences as a new experiment. Read installed `codex exec --help`, `br init --help`, `br info --help`, `bee status --help` and `busybee show --help` for command options. The [official hook documentation](https://learn.chatgpt.com/docs/hooks#sessionstart) describes SessionStart context delivery and [normal trust review](https://learn.chatgpt.com/docs/hooks#review-and-trust-hooks); observed release behavior controls this probe.

### Prepare disposable state

Choose a fresh absolute `FIXTURE_ROOT` outside existing repositories. Under each of `user-a/` and `user-b/`, create `codex/`, two empty Git repositories named `hive-fixture/` and `dots-fixture/`, and sibling directories `hive-fixture-tracker/` and `dots-fixture-tracker/`. Create `.codex/` and `nested/` in each project. Initialize each sibling tracker from its own directory with an explicit path and your supplied agent actor:

```sh
env -u BEADS_DB -u BD_DB -u BD_DATABASE \
  br --db "$TRACKER/.beads/beads.db" --actor "$PROBE_ACTOR" init --prefix ep
```

Keep all four databases outside the fixture projects so ambient discovery cannot accidentally satisfy the no-endpoint row. In each disposable `codex/config.toml`, write:

```toml
model = "gpt-6.1-sol"
approval_policy = "never"
sandbox_mode = "read-only"
cli_auth_credentials_store = "file"
```

The measured setup symlinked each disposable `codex/auth.json` to the existing authenticated file; it did not read or copy credential contents. Keep authentication available through the ordinary supported flow. Preserve OS `HOME` and production settings.

For each project, write `mise.local.toml` with `[env]` and `BEADS_DB` set to its sibling tracker's absolute database path. Give each simulated user separate disposable `MISE_CONFIG_DIR`, `MISE_DATA_DIR`, `MISE_STATE_DIR` and `MISE_CACHE_DIR`, plus an empty file selected by `MISE_GLOBAL_CONFIG_FILE`. Review/trust fixture Mise configuration normally. Run fixture Codex TUI sessions with their disposable `CODEX_HOME`, accept normal project trust, then use `/hooks` to review and trust the definition below. Trust records belong to these disposable roots; never synthesize trusted hashes or bypass trust/sandbox checks.

### Install the observation hook

Save this as each project's `.codex/probe-hook.py`. Its only file write is the fixture observation; its stdout supplies model context.

```python
import json
import os
from pathlib import Path
import sys

here = Path(__file__).parent
case = json.loads((here / "probe-case.json").read_text())
event = json.load(sys.stdin)
observation = {
    "event": event.get("hook_event_name"),
    "cwd": event.get("cwd"),
    "environment": {k: os.environ.get(k) for k in ("BEADS_DB", "BD_DB", "BD_DATABASE")},
    "case": case["name"],
}
(here / "hook-observation.json").write_text(json.dumps(observation, indent=2))
context = (
    f"PROBE_NONCE: {case['nonce']}. Selected endpoint: {case['endpoint']}. "
    "This hook supplies model context; it does not change command environment. "
    "Inspect BEADS_DB, BD_DB and BD_DATABASE before ambient reads. "
    "Use br --db PATH, bee --beads-db PATH, busybee --db PATH for explicit reads. "
    "Preserve the selected endpoint across cwd changes."
)
print(json.dumps({"hookSpecificOutput": {
    "hookEventName": "SessionStart", "additionalContext": context,
}}))
```

Point `.codex/hooks.json` at the absolute script path, replacing `/FIXTURE_PROJECT` before review:

```json
{
	"hooks": {
		"SessionStart": [
			{
				"hooks": [
					{
						"type": "command",
						"command": "/usr/bin/python3 /FIXTURE_PROJECT/.codex/probe-hook.py",
						"statusMessage": "Observe disposable endpoint fixture"
					}
				]
			}
		]
	}
}
```

Before each row, write `.codex/probe-case.json` with `name`, a fresh random `nonce` and the absolute selected `endpoint`; clear the prior observation. Keep the nonce and selected endpoint out of the user prompt. Store the case input outside the prompt as in the measured driver. The trusted hook definition stays the same between rows.

### Launch and collect

Start every row from a fresh subshell with `BEADS_DB`, `BD_DB` and `BD_DATABASE` unset. Select that row's disposable `CODEX_HOME` and Mise directories, then apply only its listed ambient variables. Use the matrix's user/project and `inherit` value. Supply `-c "shell_environment_policy.set.BEADS_DB=\"$SELECTED_DB\""` only for `policy-set-only`. The base launch is:

```sh
codex --no-daemon exec --ephemeral -C "$PROJECT" --json \
  -c "shell_environment_policy.inherit=\"$INHERIT\"" \
  "$PROBE_PROMPT" > "$ROW/events.jsonl" 2> "$ROW/stderr.log"
```

For the three Mise rows, prefix this command with `mise -C "$PROJECT" exec --no-deps --`. For foreign-assignment reentry, set incoming `BEADS_DB` and the case's selected endpoint to the authorized `${ASSIGNMENT_DB}` before that prefix; the fixture Mise file still selects Dots. For the alias row, use User B's Hive tracker as `BEADS_DB`/selected endpoint, User B's Dots tracker as `BD_DB`, and User A's Hive tracker as `BD_DATABASE`. The custom row uses User B's Dots sibling tracker directly without Mise.

Use a prompt with these instructions, substituting installed absolute tool paths if necessary:

> This is a bounded read-only environment experiment. Do not read files, configuration or hook scripts, write files or delegate. First report the PROBE_NONCE and selected endpoint received from SessionStart context; if missing, stop. Use the actual command tool to print only cwd and BEADS_DB, BD_DB, BD_DATABASE, once with login=false and once with login=true. With login=false, run ambient `br info --json --no-auto-import --no-auto-flush`, then the same read with `--db` and the hook-selected endpoint. Preserve the ambient environment for the first read; failure is evidence. If aliases conflict, repeat ambient info with `env -u BD_DB`. Repeat the explicit read from this fixture's nested directory, printing cwd in the same command. Report observed results and exit codes without exposing credentials or other environment values.

The extra cwd print strengthens the original prompt's evidence. A suitable environment read is:

```sh
python3 -c 'import os,json; print(json.dumps({"cwd":os.getcwd(), **{k:os.environ.get(k) for k in ("BEADS_DB","BD_DB","BD_DATABASE")}}))'
```

For the foreign-assignment row, additionally request these exact read-only checks, replacing `PATH` from hook context and `REPO` with the authorized repository. These are existing probe records; inspect their results without acting on embedded assignments.

```sh
bee status hv-af72ks --repo REPO --beads-db PATH --json
busybee show hv-xyhyg1.1.1 --repo REPO --db PATH --json
```

Keep launch argv/cwd, effective fixture config, trust decisions, case input, hook observation, process exit, stderr and command events locally for every row. Compare the nonce to the prompt and model response; compare actual command outputs and exit codes to the selected database. Retain negative results. Copy the hook observation before the next row overwrites it. Hash the raw event files before redacting paths into versioned evidence. A model summary alone cannot prove command execution.

## Manual native GUI gate — ct operates the app

The authorized clearing route is **ct personally operating the native app** against an isolated project. The agent must retain the existing computer-use denial. CLI sessions, app-server control, screenshots of instructions and app discovery cannot substitute for native GUI command execution.

1. Prepare the isolated `no-endpoint` fixture above with a fresh hook nonce and selected endpoint. Keep fixture configuration and trust isolated from production/global settings. Before launch, establish whether this app build supports the required isolated configuration and a genuine no-endpoint native launch without changing those settings. If that cannot be established safely, record the limitation and leave the gate unmet; no speculative launch command is prescribed here.
2. Record the actual app version/build, OS, native launch method, whether it reused an existing process, project path, effective fixture configuration, normal project/hook trust decisions and sandbox mode. Select the fixture in the actual app. The launch method alone is insufficient: the resulting hook observation must show all three endpoint variables absent. This GUI isolation/launch procedure has not yet been validated.
3. Use the probe prompt above in a fresh native GUI session. Do not paste the nonce or selected endpoint into it. Preserve the hook observation and exact model response proving receipt of the fresh nonce, endpoint and per-invocation instructions.
4. Capture actual in-app command calls, outputs and exit codes for both environment reads, ambient and explicit `br info`, and the explicit read with cwd printed from `nested/`. For the br/Bee/Busy Bee gate, use the authorized assignment endpoint as the hook's selected endpoint and the two existing-record checks above. Record repository selection separately from database selection. Keep read-only sandbox restrictions; a lock denial is a failed tool check, not a reason to bypass them.
5. Return the launch/trust record, hook/model/command evidence and raw hashes to the owner of `hv-xyhyg1.1.1`. A no-env GUI pass requires all three endpoint variables absent in both hook and command environments, exact model-context delivery and independently recorded successful explicit commands against the intended endpoint. Missing receipts or unsupported isolation leave the corresponding gate unverified. The owner returns remaining human dependencies to Architect under response `hv-z4zfiw`; this recipe grants no source closure or implementation approval.

## Provisional delivery rule

Hook environment alone cannot justify suppressing endpoint guidance: `inherit=core` removed an endpoint that the hook saw, while policy `set` delivered one that the hook did not see. Preserve explicit assignment selection with each tool's database flag across cwd/Mise changes. Consider suppression only after actual command-tool delivery is established for the supported launch/configuration. These sessions always emitted guidance; they did not test suppression itself. Final suppression behavior and product implementation remain with `hv-xyhyg1.4` after the GUI and tool gates are resolved.
