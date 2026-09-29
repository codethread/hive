const EXIT_SUCCESS = 0;

const mergeDriver = {
	command: 'bun ./scripts/beads-merge.ts "%O" "%A" "%B"',
	name: "Hive Beads JSONL merge driver",
	recursive: "hive-beads",
} as const;

const setLocalConfig = async (key: string, value: string): Promise<void> => {
	const subprocess = Bun.spawn(["git", "config", "--local", key, value], {
		stderr: "inherit",
		stdout: "inherit",
	});
	const exitCode = await subprocess.exited;
	if (exitCode !== EXIT_SUCCESS) {
		throw new Error(`git config failed for ${key} with exit code ${exitCode}`);
	}
};

const setupGit = async (): Promise<void> => {
	await setLocalConfig("merge.hive-beads.name", mergeDriver.name);
	await setLocalConfig("merge.hive-beads.driver", mergeDriver.command);
	await setLocalConfig("merge.hive-beads.recursive", mergeDriver.recursive);
};

if (import.meta.main) {
	await setupGit();
}

export { setupGit };
