---
name: agent-docs-hotpath
description: analyse what agents see during a given session, use when the user asks to know what agents 'see' when working or use after updating any agent files like AGENTS.md or Skills
---

Startup context is harness-specific: check whether the active harness injects `AGENTS.md` and which skill descriptions it exposes. Inspect its discovery and invocation settings before counting a skill as implicitly available; an advertised description is not a loaded skill body.

This means we must consider what 'noise' agents are getting for every task.

## Self reflection

If you are authoring changes to these files, ask yourself:

- does every agent need this on _every_ run?
- what's the cost of an agent missing this if its _off_ the hotpath?
- is this well signposted if it's off the hotpath for agents that need it?
- does it use terms from the `GLOSSARY.md` to maximise searchability

Ensure your work aligns well with these aspirations

## "Show me"

If the user asks directly, map the files that **will** and **might** be read for the stated session or task. Distinguish automatically injected content, required reads once a condition applies, and optional reads. Separate skill descriptions from skill bodies, and a parent agent's context from delegated agents' contexts. Say whether the map comes from instructions or an observed session trace.

Structure the report as several small trees or graphs, not one giant diagram:

- Group by reading trigger: startup, exploration or editing, task-specific documents and skills, then specialist delegation. Split busy groups further when needed.
- Use short node labels and terse trigger labels on connections. Put exact file paths and supporting detail directly beneath each tree, rather than crowding the nodes.
- Keep every section visible in one reading sequence; normal scrolling is fine. Avoid tabs, accordions and deeply nested expandable lists that hide branches.
- Reuse references to shared files across trees rather than implying each occurrence is another mandatory read.

Use any available visualisation tools you may already have; no particular tool, renderer or document format is required. Without one, use several small labelled text trees or grouped lists with the same structure. Do not install tooling just to produce the report.

For the **might** reads, give a separate terse list beneath the relevant tree: **file — likely trigger — score out of 5**. Score expected reading for the stated scenario: **5 = always read, 0 = never read**. Treat intermediate scores as estimates, not measured probabilities; say unknown when the evidence is insufficient.

Finish with a short distinction between baseline and conditional context cost. If giving size or token estimates, state the method and what is excluded.
