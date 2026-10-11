# Semantic review signals

When reviewing domain-state modelling, abstraction choices or failure semantics, use [Waggle](../../lib/waggle/README.md) as an optional review aid. From the checkout root, run `bun run --silent waggle list --json`, then `describe <id> --json` to learn when a classifier applies and what evidence it needs. Supply only authorized context via `run <id> --input <file-or-dash> --json`; definitions live in `classifiers/`.

When selecting files for human review, use `review-attention` for I/O boundaries and persistence decisions; describe it before gathering its distinct inputs. Treat `show` as attention, not a defect, and investigate `needs_context` before excluding a file. `skip` is not approval.

State missing context rather than inventing contracts. Validate any concern against the source before reporting it; `no_concern` is not approval. Waggle sends supplied evidence to Typesafe and is not a replacement for lint, tests or reviewer judgment.
