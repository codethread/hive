// eslint-disable-next-line import/no-nodejs-modules -- Resolve server paths at the executable boundary.
import { join, resolve } from "node:path";
import type { ServerTarget } from "./client.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Default user state directory.
import { homedir } from "node:os";

export interface ServerSelection {
	/** Explicit socket requires an explicit state directory. */
	socket?: string;
	/** Defaults to the user's Colony state directory. */
	state?: string;
}

export function resolveServerTarget(options: ServerSelection, runtimeEntry: string): ServerTarget {
	if (options.socket !== undefined && options.state === undefined) {
		throw new Error("--socket requires an explicit --state directory");
	}
	const userState = process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local", "state");
	const state = resolve(options.state ?? join(userState, "hive", "colony"));
	return {
		runtimeEntry,
		socket: resolve(options.socket ?? join(state, "colony.sock")),
		state,
	};
}
