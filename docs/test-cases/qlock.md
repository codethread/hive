# Parked Qlock test case

This scenario records one removed executable check, with no parameterized variants. Remaining tests may cover portions of the behavior. The removal ledger is `hv-luv2v` comment 4466; the source inventory is `hv-hu8eo.7` comment 4385. Follow-up work remains on `hv-luv2v`.

```gherkin
Scenario: Resumed execution waits for its predecessor to release the slot
  Given two tickets in the same queue, with the first ready and the second waiting
  When the second ticket resumes execution of a command that prints "resumed"
  Then its diagnostic reports "ticket <second ticket ID> waiting"
  When the first ticket executes its command
  Then the first execution exits with status 0
  And the resumed execution prints exactly "resumed" and exits with status 0
  And queue status reports "free" followed by a newline
```

Restoration pointers (all at Git revision `61e736f8e1f4bfad9b7338e140d33938d0426f71`):

- Source: `lib/qlock/tests/integration/qlock.test.ts:104`, “resumed exec waits for its predecessor and launches when the slot is released”; assertions at lines 127, 130–132 and 138. One original case maps to the one scenario above.
- Fixture: setup/cleanup at lines 26/32, queue seeding at 517 and subprocess wrapper at 541 in the same file. The check used real SQLite queue state, Bun/Qlock processes and external `printf`/`true` commands.
- Removal evidence: measured 1174.226ms in the baseline DANGER run.
