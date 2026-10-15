/* eslint-disable no-await-in-loop -- Hook bootstrap effects are ordered and activated last. */
import { EXIT } from "./errors.ts";
import type { HookAdapter } from "./config.ts";
import type { WorkspaceIO } from "./services.ts";
import { hookMigration } from "./hooks.ts";
import huskyLicense from "../assets/HUSKY-LICENSE" with { type: "text" };
import huskyRunner from "../assets/husky.sh" with { type: "text" };
// eslint-disable-next-line import/no-nodejs-modules -- Concrete Husky bootstrap paths.
import { join } from "node:path";

const mode = 0o755;
const names = [
	"pre-commit",
	"pre-merge-commit",
	"prepare-commit-msg",
	"commit-msg",
	"post-commit",
	"applypatch-msg",
	"pre-applypatch",
	"post-applypatch",
	"pre-rebase",
	"post-rewrite",
	"post-checkout",
	"post-merge",
	"pre-push",
	"pre-auto-gc",
];
const wrapper = '#!/usr/bin/env sh\n. "$(dirname "$0")/h"';

/** Husky is an initial bootstrap convenience; ongoing requirements follow explicit configured files. */
// eslint-disable-next-line max-statements -- Preflight the concrete bootstrap before activating Git configuration.
export async function bootstrapHooks(
	root: string,
	adapter: HookAdapter,
	io: WorkspaceIO,
): Promise<void> {
	if (adapter === "none") {
		return;
	}
	const selected = await io.exec(["git", "config", "--get", "core.hooksPath"], root);
	if (selected.exitCode !== EXIT.success && selected.exitCode !== EXIT.failure) {
		throw hookMigration(selected.stderr || selected.stdout);
	}
	const existing = selected.stdout.trim();
	if (adapter === "git") {
		if (existing !== "") {
			throw hookMigration(
				`Existing hooksPath ${existing} needs an agreed integration. Set bootstrap.hooks to none when retaining it.`,
			);
		}
		return;
	}
	if (existing !== "" && existing !== ".husky/_") {
		throw hookMigration(
			`Existing hooksPath ${existing} needs an agreed integration. Set bootstrap.hooks to none when retaining it.`,
		);
	}
	await installHuskyRuntime(root, io);
	if (existing !== ".husky/_") {
		await io.command(["git", "config", "--local", "core.hooksPath", ".husky/_"], root);
	}
}

/** Materialize the selected Husky runner without changing the checkout's effective hook path. */
export async function installHuskyRuntime(root: string, io: WorkspaceIO): Promise<void> {
	const files = [
		{ path: join(root, ".husky/_/h"), contents: huskyRunner },
		{ path: join(root, ".husky/_/LICENSE"), contents: huskyLicense },
		{ path: join(root, ".husky/_/.gitignore"), contents: "*" },
		...names.map((name) => ({ path: join(root, ".husky/_", name), contents: wrapper })),
	];
	for (const file of files) {
		const previous = await io.read(file.path);
		if (previous !== "" && previous !== file.contents) {
			throw hookMigration(`Existing Husky bootstrap file differs: ${file.path}.`);
		}
	}
	for (const file of files) {
		if ((await io.read(file.path)) !== file.contents) {
			await io.write(file.path, file.contents);
		}
		await io.chmod(file.path, mode);
	}
}
