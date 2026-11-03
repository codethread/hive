# Native policy enforcement: verified limits

A disposable native tracker was tested on 24 October 2026 using installed br 0.7.6. No shared tracker or policy was modified. Source comparison used beads_rust b77ae70, especially src/close_policy.rs (Workflow.required_fields, required_fields_for and evaluate_transition_required_fields), src/cli/commands/create.rs and src/cli/commands/close.rs. The installed version string alone does not independently establish its exact source revision.

Raw commands, stdout, stderr and the complete test policy are in BEADS-POLICY-ENFORCEMENT-EXPERIMENT.json; the small repeatable script is beside it. Each command explicitly selected the new disposable database and actor amaranth-fat-bedbug. Native stderr also reported a WAL-FEC runtime-pool warning stating primary WAL durability was unchanged; results below are native return codes/documents, not claims about that optional feature.

| Scenario | Observed result |
| --- | --- |
| Strict initial status allows draft; create omits status | Rejected: default remains open. YAML can refuse it, but does not silently select draft. Producers must pass draft. |
| Create with explicit draft | Accepted. |
| draft to open without AC | Rejected by acceptance_criteria_present. |
| draft to open with unchecked checklist | Accepted by presence gate. |
| Close with unchecked AC | Rejected by target closed: acceptance_criteria. |
| Close with no supplied reason | Rejected when require_close_reason enabled with min_length: 1. This implements nonempty presence, not a new substantive length rule. |
| Nonempty paragraph in AC, no checkbox | Close accepted with reason. Native predicate does not establish checklist structure or truth. |
| System-labelled bead leaves draft without AC | Rejected by the same global required-field rule. |
| Response-labelled record created closed | Rejected by initial draft restriction. |
| Add native entry_routes for system/open and response/closed, with existing relation | Creation accepted. |
| System record admitted open via entry route, later closed without AC | Still rejected by global target closed rule. Entry routes do not exempt later field gates. |
| Response created closed via entry route without AC or close reason | Accepted. This is not evidence that ordinary closure checks run at creation. |

## Implications for the proposal

The accepted ordinary-work gates are expressible as status-transition requirements plus agent verification. Apply presence rules to every permitted departure from draft and the dedicated AC completion rule to closed; avoid the older closure gate that searches checklist text across descriptions/design/notes. Do not invent wildcard syntax: supported required-field keys are exact from -> to pairs or a bare target status.

There is currently no label/type selector on these required-field or close-reason gates. Conditional reported gates are a different feature, excluded by the workshop because their results are not exported. Additive class_transitions and initial entry_routes do not provide the missing field-gate scope.

Consequently the combined target needs an explicit design: either new native record-class-scoped field/closure policy, or a different lifecycle vocabulary/route that is honestly described and validated. Recommend a small native policy extension with disjoint ordinary-work versus machine/artifact classes, preserving the ordinary policy and avoiding fake machine AC, bypass flags or relabelling executable work as system. Any proposed syntax for that extension must be marked NOT SUPPORTED YET and tested before live configuration. Classification and initial/terminal creation must be checked coherently, including attempts to change classification to evade ordinary gates.

This is a required implementation boundary, not a blocker to producing the full proposal. No native feature has been added, and no production YAML was installed.
