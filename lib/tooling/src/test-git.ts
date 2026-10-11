const successExitCode = 0;

/** Include branch commits, staged/unstaged edits and newly added contract inputs. */
export async function readChangedPaths(reference: string, cwd: string): Promise<string[]> {
	const outputs = await Promise.all([
		gitOutput(cwd, ["diff", "--no-renames", "--name-only", "-z", `${reference}...HEAD`, "--"]),
		gitOutput(cwd, ["diff", "--no-renames", "--name-only", "-z", "HEAD", "--"]),
		gitOutput(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]),
	]);
	return outputs.flatMap((output) => output.split("\0").filter(Boolean));
}

async function gitOutput(cwd: string, args: string[]): Promise<string> {
	const child = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
	const [exitCode, stdout, stderr] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	if (exitCode !== successExitCode) {
		throw new Error(`Git test selection failed: ${stderr.trim()}`);
	}
	return stdout;
}
