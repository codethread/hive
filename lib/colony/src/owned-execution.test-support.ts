import type { ExecutionRef } from "./processes.ts";

const SUCCESS = 0;

/** Start the actual ownership writer in a disposable process group and await its launch receipt. */
// eslint-disable-next-line max-statements -- Keep detached launch, readiness and cleanup in one fixture boundary.
export async function startOwnedTestExecution(ref: Readonly<ExecutionRef>) {
	const previousTimezone = process.env.TZ;
	// Bun test selects a runtime timezone without exporting TZ to ps or spawned Bun processes.
	// Align the disposable runner's subprocess environment before recording either fingerprint.
	process.env.TZ = new Intl.DateTimeFormat().resolvedOptions().timeZone;
	const source = `
		import { runOwnedExecution } from ${JSON.stringify(new URL("processes.ts", import.meta.url).href)};
		await runOwnedExecution(
			JSON.parse(process.argv[1]),
			() => Bun.spawn(
				[process.execPath, "-e", 'process.stdin.resume();process.stdin.on("end",()=>process.exit(0));'],
				{ stdin: "inherit", stdout: "ignore", stderr: "inherit" },
			),
			async () => { console.log("ready"); },
		);
	`;
	const supervisor = Bun.spawn([process.execPath, "-e", source, JSON.stringify(ref)], {
		detached: true,
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	const errors = new Response(supervisor.stderr).text();
	const close = async () => {
		try {
			await supervisor.stdin.end();
			const code = await supervisor.exited;
			if (code !== SUCCESS) {
				throw new Error(`Owned fixture exited ${code}: ${await errors}`);
			}
		} finally {
			if (previousTimezone === undefined) {
				delete process.env.TZ;
			} else {
				process.env.TZ = previousTimezone;
			}
		}
	};
	const output = supervisor.stdout.getReader();
	const ready = await output.read();
	output.releaseLock();
	if (new TextDecoder().decode(ready.value) !== "ready\n") {
		await close();
		throw new Error(`Owned fixture failed before readiness: ${await errors}`);
	}
	return { supervisor, close };
}
