/** Common delivery rules appended to kind roles for ordinary Bee sessions. */
export const RESPONSE_PROTOCOL = `## Response delivery

Preserve supplied identity and tracker settings. In direct conversations, answer the user.
For managed work, follow the assigned run/stage instructions and read bee response --help
before filing your complete answer or blocker. Read bee finish --help before reporting completion.
Read-only roles may deliver and complete their own report work; examined work stays unchanged.
For delegated answers, retain submission's request.id and follow bee result --help.`;

/** Preserve the selected role, including an explicit empty override, before system guidance. */
export function renderBeeSystemPrompt(role: string): string {
	return [role, RESPONSE_PROTOCOL].filter(Boolean).join("\n\n");
}
