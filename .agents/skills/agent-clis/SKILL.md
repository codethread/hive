---
name: agent-clis
description: Design, implement or review agent-facing CLIs, including JSON output and context efficiency. All Hive CLIs serve agents.
---

# Agent CLIs

Design each response around the caller's next decision, not the backing storage record.

## Make the interface discoverable

Keep CLI flags and arguments consistent across tools wherever possible. Before adding an interface, check existing tools for equivalent concepts and reuse their names, argument shapes, defaults and environment-variable precedence.

- Put the short workflow and command composition in `--help`, with progressive detail in subcommand help. Keep usage knowledge beside the implementation rather than duplicating it in agent instructions.
- Document output defaults, filters and explicit expansions where callers discover the command.
- Expose machine-readable output schemas on demand, separately from routine results. Keep schemas aligned with the actual output.
- Use [skills-handler](https://github.com/vercel-labs/skills-handler) to power a nested `<cli> skills ...` subcommand for bundled agent instructions. Follow Honeycomb's `skills list`, `skills get <name>`, and `skills file <name> <path>` pattern: list discovery metadata, return only the Markdown body for instructions, and load supporting resources on demand.

## Return focused defaults

- **Lists:** return decision-making summaries. When designing new lists or changing collection retrieval, bound growing collections with filtering and pagination and an explicit continuation or completeness signal. Distinguish an empty page from an exhausted collection; never silently truncate.
- **Detail:** expand one identified item. Make heavyweight prompts, logs, histories and configuration explicit opt-ins rather than repeating them on every inspection.
- **Mutations:** acknowledge the confirmed effect and return the identifiers needed for the next command. Avoid echoing entire native records or supplied instructions.
- Apply filters before expensive hydration where practical. Caller-side `jq` or other JSON projection is useful composition, not a substitute for focused producer output.

## Preserve meaning

Follow the repository's [CLI output contract](../../../docs/architecture.md#cli-output-contract) for JSON envelopes, streams, errors and exit codes. Finite JSON commands emit one document on stdout, including failures, with no prose mixed in and silent stderr.

Keep stable identifiers, machine-readable failure reasons and actionable diagnostics. For partially completed mutations, identify confirmed effects and remaining work so callers can avoid repeating successful side effects. Distinguish submission from completion, recorded observations from live state, and unknown values from known absence. Smaller output must not erase facts the caller needs to act safely.

## Verify the result

Keep improvements and reviews within the authorized scope. For existing commands, report remaining inefficiencies separately rather than expanding an unrelated patch or treating unchanged behavior as a regression.

- Exercise representative long text and growing collections, not only tiny fixtures. Measure default payload bytes; label token estimates separately and state how they were obtained.
- Check that summaries and acknowledgements exclude heavyweight fields, explicit expansion retrieves the full value, and bounded collections expose remaining results honestly.
- Verify success, failure and partial-effect responses through the public command boundary. Preserve the established envelope and exit behavior.

Prefer excluding irrelevant content over shortening clear field names. A small schema is useful only if the agent can understand and act on it.
