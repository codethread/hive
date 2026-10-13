import type { Bee } from "../contracts.ts";

const ACTIVE_WINDOW_MS = 120_000;
const INVESTIGATE_AFTER_MS = 600_000;
const SECOND_MS = 1000;
const MINUTE_SECONDS = 60;
const HOUR_SECONDS = 3600;

/** Presentation signal only: recent output does not establish task progress or process health. */
export function beeActivity(bee: Pick<Bee, "outcome" | "stdout">, now: number) {
	if (bee.outcome !== "pending") {
		return "ended";
	}
	if (bee.stdout === null || bee.stdout.lastOutputAt === null) {
		return "unknown";
	}
	const age = now - Date.parse(bee.stdout.lastOutputAt);
	if (age >= INVESTIGATE_AFTER_MS) {
		return "attention";
	}
	return age >= 0 && age < ACTIVE_WINDOW_MS ? "active" : "quiet";
}

export function outputAge(at: string, now: number): string {
	const seconds = Math.max(0, Math.floor((now - Date.parse(at)) / SECOND_MS));
	if (seconds < MINUTE_SECONDS) {
		return `${seconds}s ago`;
	}
	if (seconds < HOUR_SECONDS) {
		return `${Math.floor(seconds / MINUTE_SECONDS)}m ago`;
	}
	return `${Math.floor(seconds / HOUR_SECONDS)}h ago`;
}
