// eslint-disable-next-line import/no-nodejs-modules -- Resolve source entries or installed companion executables at the process boundary.
import { dirname, resolve } from "node:path";

/** Colony's companion executables ship together in one bin directory. */
export function colonyEntry(name: "bee" | "colony" | "runtime" | "worker"): string {
	if (Bun.isStandaloneExecutable) {
		let command: string = name;
		if (name === "runtime" || name === "worker") {
			command = `colony-${name}`;
		}
		return resolve(dirname(process.execPath), command);
	}
	return resolve(import.meta.dirname, "../bin", `${name}.ts`);
}

/** Source entries use Bun; compiled entries execute their own embedded runtime. */
export function entryCommand(entry: string): [string, ...string[]] {
	if (Bun.isStandaloneExecutable) {
		return [entry];
	}
	return [process.execPath, entry];
}
