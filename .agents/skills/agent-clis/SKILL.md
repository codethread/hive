---
name: agent-clis
description: Use when creating or updating CLIs intended for agentic use, as are all CLIs in this repository.
---

# Agent CLIs

For now, agents like JSON and typically work in a headless fashion. Ideally, all APIs return JSON, including errors. Rather than splitting on success and forcing the agent to handle `stdin`, `stdout` and `stderr`, return a single status flag such as `ok`. Follow the convention of the existing CLI. If none exists, use `ok`, `error`, or, where applicable, `partial success`, each with the appropriate body.

Agents are very good at then using that JSON with `jq`, especially when they can know the schema up front and follow the usage guidance. CLIs are ideally self-descriptive: clear, well-named commands and flags are much better than needing a document.

Keep CLI flags and arguments consistent across tools wherever possible. Before adding an interface, check existing tools for equivalent concepts and reuse their names, argument shapes, defaults and environment-variable precedence.

That said, the composition of CLI arguments, how two commands may compose together, and the general flow of a series of commands are not always clear. That should be self-descriptive. Ideally, most CLIs provide `--help` that gives a useful overview, avoiding the need to add additional information to agentic instruction files and instead allowing guidance such as "use `honeycomb --help`". That is all that is needed: the agent runs the command and the CLI is self-descriptive. This keeps the knowledge of how to use the tool and the actual API together, which is the best place to keep them efficient and in sync.

Agents do not know what they will get from a command until they have run it. A command should not be the best place to keep everything; instead, it should aim at exactly what this agent needs to know right now from this command. To this end, commands can use flags to provide additional information, various filters, different types of information, and so on. The defaults should be these focused responses, rather than unbounded lists or bloated JSON responses.

It is critical to avoid wasting agents' context on needless information. When adding information to a JSON response, always ask: does the agent need to know this? And critically: what should the defaults of the JSON response be? Then add JSON schemas in the CLI behind separate flags for agents that want to interrogate the tooling further and use `jq` at their own leisure.
