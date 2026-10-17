/* eslint-disable no-await-in-loop -- Retain ordered evidence from the native candidate probes. */
/* eslint-disable unicorn/no-null -- Proof JSON retains explicitly unobserved fields. */
import type { Platform, ReleaseManifest } from "./release.ts";
import {
	archiveMembers,
	candidateManifest,
	embeddedRelease,
	nativePlatform,
} from "./release-verify.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Native verification filesystem boundary.
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
// eslint-disable-next-line import/no-nodejs-modules -- Native candidate and isolated probe paths.
import { dirname, join } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Native host evidence and isolated probe files.
import { release, tmpdir } from "node:os";
import { executables } from "./release.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve installed dependency copies.
import { fileURLToPath } from "node:url";
import { z } from "zod";

const SUCCESS = 0;
const FIRST = 0;
const INDENT = 2;
const PROBE_TIMEOUT_MS = 30_000;
const publicCommands = ["beeswax", "honeycomb", "bee", "colony", "busybee", "qlock", "hive-ui"];
const documentSchema = z.object({ ok: z.literal(true) }).passthrough();
const readySchema = z.object({ ok: z.literal(true), kind: z.literal("ui_started"), url: z.url() });

export interface VerificationInput {
	/** Explicit mutation actor for the disposable tracker. */
	actor: string;
	/** Directory containing the original four archives, manifest.json and SHA256SUMS. */
	artifacts: string;
	/** Exact immutable source commit expected in both metadata layers. */
	revision: string;
	/** Advertised platform, checked against this process's native OS and architecture. */
	platform: Platform;
	/** Proof JSON destination; partial evidence is written on probe failures too. */
	output: string;
}

interface Probe {
	/** Exact executable/arguments launched from the isolated probe repository. */
	command: string[];
	/** Actual native subprocess exit status. */
	code: number;
	/** Captured native stdout, including public help and structured results. */
	stdout: string;
	/** Captured native stderr. */
	stderr: string;
}

interface Proof {
	/** Success becomes true only after every native probe completes. */
	ok: boolean;
	/** Stable repository helper result discriminator. */
	kind: "release_verification";
	/** Requested commit and platform. */
	request: { revision: string; platform: Platform };
	/** Actual process OS/architecture and kernel release. */
	host: { os: string; arch: string; release: string };
	/** Actions artifact provenance; null when invoked locally. */
	ci: {
		repository: string | null;
		workflowRef: string | null;
		workflowSha: string | null;
		runId: string | null;
		runAttempt: string | null;
		artifactId: string | null;
		artifactDigest: string | null;
	};
	/** Digests computed from every candidate file before executing an archive. */
	files: { file: string; sha256: string }[];
	/** Complete parsed manifest after identity validation. */
	manifest: ReleaseManifest | null;
	/** Ordered executable smoke evidence. */
	probes: Probe[];
	/** Native dependency binaries actually resolved on the probe PATH. */
	dependencies: { name: string; path: string; sha256: string; version: string }[];
	/** HTTP observations from the candidate's embedded UI. */
	http: { path: string; status: number; contentType: string; bytes: number }[];
	/** First probe failure, retained alongside completed observations. */
	failure: string | null;
}

/** Live adapter composed by the repository CLI; candidate files are read, never rebuilt or installed. */
// eslint-disable-next-line max-statements -- Keep candidate validation, isolated execution and retained proof together.
export async function verifyNativeRelease(input: VerificationInput): Promise<Proof> {
	const proof: Proof = {
		ok: false,
		kind: "release_verification",
		request: { revision: input.revision, platform: input.platform },
		host: { os: process.platform, arch: process.arch, release: release() },
		ci: {
			repository: process.env["GITHUB_REPOSITORY"] ?? null,
			workflowRef: process.env["GITHUB_WORKFLOW_REF"] ?? null,
			workflowSha: process.env["GITHUB_WORKFLOW_SHA"] ?? null,
			runId: process.env["GITHUB_RUN_ID"] ?? null,
			runAttempt: process.env["GITHUB_RUN_ATTEMPT"] ?? null,
			artifactId: process.env["CANDIDATE_ARTIFACT_ID"] ?? null,
			artifactDigest: process.env["CANDIDATE_ARTIFACT_DIGEST"] ?? null,
		},
		files: [],
		manifest: null,
		probes: [],
		dependencies: [],
		http: [],
		failure: null,
	};
	const temporary = await mkdtemp(join(tmpdir(), "hive-native-proof-"));
	try {
		nativePlatform(input.platform, proof.host.os, proof.host.arch);
		const manifestText = await readFile(join(input.artifacts, "manifest.json"), "utf8");
		const sums = await readFile(join(input.artifacts, "SHA256SUMS"), "utf8");
		const manifest = candidateManifest(JSON.parse(manifestText), sums, input.revision);
		proof.manifest = manifest;
		for (const file of [
			"manifest.json",
			"SHA256SUMS",
			...manifest.archives.map((archive) => archive.file),
		]) {
			const sha256 = await digest(join(input.artifacts, file));
			proof.files.push({ file, sha256 });
			const archive = manifest.archives.find((item) => item.file === file);
			if (archive !== undefined && sha256 !== archive.sha256) {
				throw new Error(`Checksum mismatch: ${file}`);
			}
		}
		const selected = manifest.archives.find((archive) => archive.platform === input.platform)!;
		const archive = join(input.artifacts, selected.file);
		const installed = join(temporary, "installed");
		const repository = join(temporary, "probe");
		await mkdir(installed);
		await mkdir(repository);
		const environment = {
			PATH: `${join(installed, "bin")}:${process.env["PATH"]}`,
			HOME: join(temporary, "home"),
			XDG_CONFIG_HOME: join(temporary, "config"),
			XDG_DATA_HOME: join(temporary, "data"),
			XDG_STATE_HOME: join(temporary, "state"),
			TMPDIR: temporary,
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_CONFIG_NOSYSTEM: "1",
			BD_ACTOR: input.actor,
			NO_COLOR: "1",
		};
		await mkdir(environment.HOME);
		const run = (command: string[]) =>
			invoke(command, { cwd: repository, env: environment, probes: proof.probes });
		const listing = await run(["tar", "-tzf", archive]);
		archiveMembers(listing.trim().split("\n"));
		await run(["tar", "-xzf", archive, "-C", installed]);
		const embedded = await readFile(join(installed, "release.json"), "utf8");
		embeddedRelease(JSON.parse(embedded), {
			manifest,
			platform: input.platform,
			names: await readdir(join(installed, "bin")),
		});
		for (const name of executables) {
			const version = await run([join(installed, "bin", name), "--version"]);
			if (version.trim() !== manifest.version) {
				throw new Error(`Unexpected ${name} version: ${version}`);
			}
		}
		for (const name of publicCommands) {
			const help = await run([join(installed, "bin", name), "--help"]);
			if (!help.includes("Usage:")) {
				throw new Error(`Missing public help: ${name}`);
			}
		}
		for (const name of ["br", "bv"]) {
			const path = z.string().parse(Bun.which(name, { PATH: environment.PATH }));
			const version = await run([path, "--version"]);
			proof.dependencies.push({ name, path, version: version.trim(), sha256: await digest(path) });
		}
		const queue = await run(["qlock", "status", "--lock", join(temporary, "queue.lock"), "--json"]);
		documentSchema.parse(JSON.parse(queue));
		await run(["git", "init", "--initial-branch=main"]);
		await run(["br", "init", "--prefix", "probe", "--actor", input.actor]);
		const db = join(repository, ".beads", "beads.db");
		await probeWorkflow({ repository, db, actor: input.actor }, run);
		await probeUi({ repository, db, env: environment }, proof);
		proof.ok = true;
		return proof;
	} catch (error) {
		proof.failure = String(error);
		throw error;
	} finally {
		try {
			await writeFile(input.output, `${JSON.stringify(proof, undefined, INDENT)}\n`);
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	}
}

// --- Native process and HTTP boundary ---

async function invoke(
	command: string[],
	{ cwd, env, probes }: { cwd: string; env: Record<string, string>; probes: Probe[] },
): Promise<string> {
	const child = Bun.spawn(command, {
		cwd,
		env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		timeout: PROBE_TIMEOUT_MS,
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	probes.push({ command, code, stdout, stderr });
	if (code !== SUCCESS) {
		throw new Error(`${command.join(" ")} exited ${code}: ${stderr}\n${stdout}`);
	}
	return stdout;
}

// eslint-disable-next-line max-statements -- Exercise an installed dependency import and a real completed Busy Bee run.
async function probeWorkflow(
	{ repository, db, actor }: { repository: string; db: string; actor: string },
	run: (command: string[]) => Promise<string>,
): Promise<void> {
	for (const name of ["xstate", "zod"]) {
		const packageFile = fileURLToPath(import.meta.resolve(`${name}/package.json`));
		await cp(dirname(packageFile), join(repository, "node_modules", name), {
			recursive: true,
			dereference: true,
		});
	}
	const source = join(repository, "workflow.ts");
	await writeFile(
		source,
		`import { createMachine } from "xstate";
import { z } from "zod";
export const inputSchema = z.object({});
export const commandSchemas = { next: z.object({}) };
export function runBrief() { return { title: "Native release probe", description: "Standalone dependency import" }; }
export const machine = createMachine({ initial: "done", states: { done: { type: "final" } } });
`,
	);
	const created = z
		.object({ id: z.string() })
		.parse(
			JSON.parse(
				await run([
					"br",
					"create",
					"Native release probe",
					"--db",
					db,
					"--owner",
					"ct",
					"--actor",
					actor,
					"--json",
				]),
			),
		);
	const result = documentSchema
		.extend({ status: z.literal("done") })
		.parse(
			JSON.parse(
				await run([
					"busybee",
					"--db",
					db,
					"--repo",
					repository,
					"--actor",
					actor,
					"--owner",
					"ct",
					"--parent",
					created.id,
					"start",
					source,
					"--json",
				]),
			),
		);
	void result;
}

// eslint-disable-next-line max-statements -- Keep foreground startup, HTTP probes and shutdown together.
async function probeUi(
	{ repository, db, env }: { repository: string; db: string; env: Record<string, string> },
	proof: Proof,
): Promise<void> {
	const command = [
		"hive-ui",
		"--repo",
		repository,
		"--beads-db",
		db,
		"--host",
		"127.0.0.1",
		"--port",
		"0",
		"--json",
		"--log-file",
		join(repository, "ui.log"),
	];
	const child = Bun.spawn(command, {
		cwd: repository,
		env,
		stdin: "ignore",
		stdout: "pipe",
		stderr: "pipe",
		timeout: PROBE_TIMEOUT_MS,
	});
	const stderr = new Response(child.stderr).text();
	let stdout = "";
	try {
		const reader = child.stdout.getReader();
		try {
			const decoder = new TextDecoder();
			while (!stdout.includes("\n")) {
				const chunk = await reader.read();
				if (chunk.done) {
					throw new Error(`UI exited before startup: ${stdout}`);
				}
				stdout += decoder.decode(chunk.value, { stream: true });
			}
		} finally {
			reader.releaseLock();
		}
		const ready = readySchema.parse(JSON.parse(stdout.trim()));
		const html = await requestUi(ready.url, "/", proof);
		const assets = [
			...html.matchAll(/(?:src|href)=["'](?<asset>[^"']+\.(?:js|css)(?:\?[^"']*)?)["']/gu),
		].map((match) => match.groups!["asset"]!);
		if (assets.length === FIRST || !html.includes("<html")) {
			throw new Error("Candidate UI did not serve embedded HTML/assets.");
		}
		for (const asset of assets) {
			await requestUi(ready.url, asset, proof);
		}
		const response = await requestUi(ready.url, "/api/colonies", proof);
		const colonySchema = z.object({ id: z.string() });
		const coloniesSchema = z.object({ colonies: z.array(colonySchema).nonempty() });
		const colonies = coloniesSchema.parse(JSON.parse(response));
		JSON.parse(
			await requestUi(ready.url, `/api/colonies/${colonies.colonies[FIRST]!.id}/board`, proof),
		);
	} finally {
		child.kill("SIGTERM");
		const code = await child.exited;
		proof.probes.push({ command, code, stdout, stderr: await stderr });
	}
}

// eslint-disable-next-line max-statements -- Keep the HTTP observation and its response checks together.
async function requestUi(base: string, path: string, proof: Proof): Promise<string> {
	const url = new URL(path, base);
	if (url.origin !== new URL(base).origin) {
		throw new Error(`UI asset is not embedded: ${path}`);
	}
	const response = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
	const body = await response.text();
	const contentType = response.headers.get("content-type") ?? "";
	proof.http.push({
		path,
		status: response.status,
		contentType,
		bytes: new TextEncoder().encode(body).byteLength,
	});
	if (!response.ok || body.length === FIRST) {
		throw new Error(`UI request failed: ${path} (${response.status})`);
	}
	if (
		(url.pathname.endsWith(".js") && !contentType.includes("javascript")) ||
		(url.pathname.endsWith(".css") && !contentType.includes("text/css"))
	) {
		throw new Error(`UI asset returned an unexpected content type: ${path} (${contentType})`);
	}
	return body;
}

async function digest(path: string): Promise<string> {
	return new Bun.CryptoHasher("sha256").update(await readFile(path)).digest("hex");
}
