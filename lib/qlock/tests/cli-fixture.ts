/* eslint-disable no-magic-numbers */
import type { CliDependencies } from "../src/cli.ts";
import type { LockTarget } from "../src/run.ts";
import { createStaticProvider } from "skills-handler";
import { emptyQueue } from "../src/queue.ts";

export function cliFixture(queue = emptyQueue(), skills = createStaticProvider([])) {
	const state = {
		queue,
		now: 0,
		out: [] as string[],
		err: [] as string[],
		commands: [] as string[][],
		targets: [] as LockTarget[],
		sleeps: [] as number[],
		opened: 0,
		closed: 0,
	};
	const deps: CliDependencies = {
		loadSkills: () => Promise.resolve(skills),
		resolveLock: (target) => {
			state.targets.push(target);
			return Promise.resolve("/lock");
		},
		openQueue: () => {
			state.opened += 1;
			return Promise.resolve({
				update: (transform) => {
					state.queue = transform(state.queue);
					return state.queue;
				},
				close: () => {
					state.closed += 1;
				},
			});
		},
		now: () => state.now,
		sleep: (ms) => {
			state.sleeps.push(ms);
			state.now += ms;
			return Promise.resolve();
		},
		isAlive: () => true,
		execute: (command) => {
			state.commands.push(command);
			return Promise.resolve(23);
		},
		pid: 42,
		cwd: "/caller",
		stdout: (text) => {
			state.out.push(text);
		},
		stderr: (text) => {
			state.err.push(text);
		},
	};
	return Object.assign(state, { deps });
}
