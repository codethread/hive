import { hello } from "@hive/shared";

/** Entry point for the ghost daemon. */
export function main(): string {
	return hello("ghost");
}
