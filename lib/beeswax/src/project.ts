import { BeeswaxError, EXIT } from "./errors.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Versioned project contract is checkout-owned.
import { isAbsolute, join } from "node:path";
import type { ProjectConfig } from "./config.ts";
import type { WorkspaceIO } from "./services.ts";
import { hookSection } from "./templates.ts";
import { readProjectConfig } from "./config.ts";
import { version } from "../package.json";
import { z } from "zod";

const REVISION = 1;
const componentSchema = z.strictObject({ revision: z.literal(REVISION) });
export const lockSchema = z.strictObject({
	format: z.literal(REVISION),
	beeswaxVersion: z.string(),
	configDigest: z.string(),
	hooks: z.record(z.string(), z.string()),
	skills: z.array(z.string()),
	components: z.strictObject({
		hooks: componentSchema,
		mergeDriver: componentSchema,
		skills: componentSchema,
	}),
});
export type ProjectLock = z.infer<typeof lockSchema>;

/** Load accepted project intent without deriving it from one machine's installation receipt. */
export async function readProjectLock(
	root: string,
	io: WorkspaceIO,
): Promise<ProjectLock | undefined> {
	const path = join(root, ".hive/beeswax/meta/lock.json");
	const contents = await io.read(path);
	if (contents === "") {
		return undefined;
	}
	try {
		return lockSchema.parse(JSON.parse(contents));
	} catch {
		throw projectMigration(`Can't establish the project upgrade path from ${path}.`);
	}
}

/** Ordinary synchronization reproduces the accepted release; changing it is an explicit update. */
export function requireProjectVersion(lock: ProjectLock): void {
	if (lock.beeswaxVersion !== version) {
		throw new BeeswaxError(
			"version_mismatch",
			`Project requires Beeswax ${lock.beeswaxVersion}; running ${version}. ` +
				'Install the accepted release, or explicitly run "beeswax update" to update this project lock.',
			{
				context: {
					expectedVersion: lock.beeswaxVersion,
					actualVersion: version,
					nextCommand: "beeswax update",
				},
				exitCode: EXIT.usage,
			},
		);
	}
}

/** Validate known generation identities independently of the selected release. */
export function requireProjectGeneration(lock: ProjectLock, config: ProjectConfig): void {
	if (
		lock.skills.join("\n") !== "repository-setup" ||
		Object.values(lock.hooks).some((hash) => hash !== digest(hookSection))
	) {
		throw projectMigration(
			"The lock contains unsupported bundled instructions or generated section identities.",
		);
	}
	const paths = [...new Set(Object.values(config.hooks))].toSorted();
	if (Object.keys(lock.hooks).toSorted().join("\n") !== paths.join("\n")) {
		throw projectMigration(
			"Hook paths changed. Agree how to remove or move the old managed sections with the user.",
		);
	}
}

/** Record portable component intent for Git review; no machine paths, actors or timestamps enter this lock. */
export async function writeProjectLock(root: string, io: WorkspaceIO): Promise<string> {
	const config = await readProjectConfig(root, io);
	if (!config) {
		throw projectMigration("Missing .hive/beeswax/config.toml.");
	}
	const lock: ProjectLock = {
		format: REVISION,
		beeswaxVersion: version,
		configDigest: digestConfig(config),
		hooks: Object.fromEntries(
			Object.values(config.hooks).map((path) => [path, digest(hookSection)]),
		),
		skills: ["repository-setup"],
		components: {
			hooks: { revision: REVISION },
			mergeDriver: { revision: REVISION },
			skills: { revision: REVISION },
		},
	};
	const path = join(root, ".hive/beeswax/meta/lock.json");
	if (!Bun.deepEquals(await readProjectLock(root, io), lock)) {
		await io.write(path, `${JSON.stringify(lock, undefined, "\t")}\n`);
	}
	return path;
}

/** Verify the stable installed command before persisting an adapter that will invoke it. */
export async function verifyExecutable(
	root: string,
	executable: string,
	io: WorkspaceIO,
): Promise<void> {
	if (!isAbsolute(executable)) {
		throw new BeeswaxError("usage", "--executable must be an absolute installed CLI path.", {
			exitCode: EXIT.usage,
		});
	}
	const actual = await io.command([executable, "--version"], root);
	if (actual.trim() !== version) {
		throw new BeeswaxError(
			"version_mismatch",
			`Installed executable ${executable} is ${actual.trim()}; setup requires ${version}. ` +
				"Build/install the matching release first.",
			{ context: { executable, expectedVersion: version, actualVersion: actual.trim() } },
		);
	}
}

/** Unsupported project metadata requires interpretation with the user, rather than a guessed rewrite. */
export function projectMigration(message: string): BeeswaxError {
	return new BeeswaxError(
		"migration_required",
		`${message} Ask an agent to run "beeswax migrate setup" and walk through the migration with you.`,
		{ context: { nextCommand: "beeswax migrate setup", requiresUser: true } },
	);
}

/** Configuration changes are reviewed updates, never implicit local synchronization. */
export function requireProjectConfig(lock: ProjectLock, config: ProjectConfig): void {
	if (lock.configDigest !== digestConfig(config)) {
		throw new BeeswaxError(
			"configuration_changed",
			'Configuration differs from the committed lock. Run "beeswax update" after reviewing it.',
			{
				context: { nextCommand: "beeswax update" },
			},
		);
	}
}

export function digestConfig(config: ProjectConfig): string {
	return digest(JSON.stringify({ bootstrap: config.bootstrap, hooks: config.hooks }));
}

// --- Private functions ---

function digest(contents: string): string {
	return new Bun.CryptoHasher("sha256").update(contents).digest("hex");
}
