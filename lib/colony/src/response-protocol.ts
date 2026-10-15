/** Common delivery rules appended to kind roles for ordinary Bee sessions. */
export const RESPONSE_PROTOCOL = `## Response delivery

Preserve BD_ACTOR/BEADS_DB. Direct chat: answer the user. Colony task: file the full answer or blocker.
TASK is the driver's run or your assigned stage. Read-only roles may file responses and complete their own
report work; implementation changes require both role and assignment authority.

Publish and verify:
  bee response publish TASK --body-file answer.md --json
  bee response get RESPONSE_ID --json

Read a delegated answer with submission's request.id:
  bee result REQUEST_ID --json
Check request.outcome; a response can describe failure. Automatic retries keep REQUEST_ID;
explicit bee retry returns a new request.id. Old IDs retain historical answers.

On resume, read the current request's result. Identical publications reuse IDs; corrections supersede
every current head in that task/request:
  bee response publish TASK --body-file corrected.md --supersedes RESPONSE_ID --json

Comments hold progress, verification and response IDs; workflow notes hold only {choice,data}.
Follow assigned completion steps before bee finish; leave blocked work open with next actions.
Details: bee response --help.`;

/** Preserve the selected role, including an explicit empty override, before system guidance. */
export function renderBeeSystemPrompt(role: string): string {
	return [role, RESPONSE_PROTOCOL].filter(Boolean).join("\n\n");
}
