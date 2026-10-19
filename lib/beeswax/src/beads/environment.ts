// eslint-disable-next-line import/no-nodejs-modules -- Repository CLI filesystem paths.
import { basename, dirname, isAbsolute } from "node:path";
import { getStaticTOMLValue, parseTOML } from "toml-eslint-parser";
import type { AST } from "toml-eslint-parser";
import { CommandError } from "@hive/beads";
import { parse } from "smol-toml";
import { z } from "zod";

const databaseSchema = z.string().refine((value) => {
	const parent = dirname(value);
	return isAbsolute(value) && basename(value) === "beads.db" && basename(parent) === ".beads";
}, "BEADS_DB must be an absolute path to the tracker checkout's .beads/beads.db");
const miseSchema = z.looseObject({
	env: z.looseObject({ BEADS_DB: z.string().optional() }).optional(),
});
const environmentSchema = z.object({ BEADS_DB: databaseSchema });
const EXIT_SUCCESS = 0;
const FIRST = 0;
const SECOND = 1;
const NOT_FOUND = -1;

/** Repository-maintenance subprocess boundary; failed commands retain their diagnostics. */
export type Command = (argv: readonly string[], cwd: string) => Promise<string>;

export interface TrackerEnvironment {
	/** Absolute path to the selected tracker database. */
	BEADS_DB: string;
}

export function parseDatabase(value: unknown): string {
	return databaseSchema.parse(value);
}

export function parseEnvironment(value: unknown): TrackerEnvironment {
	return environmentSchema.parse(value);
}

export function trackerRoot(database: string): string {
	return dirname(dirname(database));
}

// eslint-disable-next-line max-statements -- Preserve TOML spelling and comments when editing the endpoint.
export function renderMiseConfig(contents: string, environment: TrackerEnvironment): string {
	miseSchema.parse(parseConfig(contents));
	const ast = parseTOML(contents, { tomlVersion: "1.1.0" });
	const entries = ast.body[FIRST].body;
	const value = JSON.stringify(environment.BEADS_DB);
	for (const entry of entries) {
		let prefix: string[] = [];
		let body: AST.TOMLKeyValue[] = [];
		if (entry.type === "TOMLTable") {
			prefix = entry.resolvedKey.map(String);
			({ body } = entry);
		} else {
			body = [entry];
		}
		const existing = findEndpoint(body, prefix);
		if (existing) {
			const before = contents.slice(FIRST, existing.range[FIRST]);
			return `${before}${value}${contents.slice(existing.range[SECOND])}`;
		}
	}
	const env = entries.find(
		(entry) => entry.type === "TOMLTable" && entry.resolvedKey.join(".") === "env",
	);
	if (env?.type === "TOMLTable") {
		const headerEnd = contents.indexOf("\n", env.key.range[SECOND]);
		if (headerEnd !== NOT_FOUND) {
			const before = contents.slice(FIRST, headerEnd + SECOND);
			return `${before}BEADS_DB = ${value}\n${contents.slice(headerEnd + SECOND)}`;
		}
		return `${contents}\nBEADS_DB = ${JSON.stringify(environment.BEADS_DB)}\n`;
	}
	const inline = entries.find(
		(entry) => entry.type === "TOMLKeyValue" && getStaticTOMLValue(entry.key).join(".") === "env",
	);
	if (inline?.type === "TOMLKeyValue" && inline.value.type === "TOMLInlineTable") {
		const position = inline.value.range[SECOND] - SECOND;
		let separator = "";
		if (inline.value.body.length > FIRST) {
			separator = ", ";
		}
		const before = contents.slice(FIRST, position);
		return `${before}${separator}BEADS_DB = ${value}${contents.slice(position)}`;
	}
	return `env.BEADS_DB = ${JSON.stringify(environment.BEADS_DB)}\n${contents}`;
}

/** Retain both streams even when native JSON supplies the primary error diagnostic. */
export class CapturedCommandError extends CommandError {
	/** Captured child diagnostics for structured CLI failure output. */
	readonly stderr: string;
	constructor(command: string, result: { code: number; stdout: string; stderr: string }) {
		super(command, result);
		this.name = "CapturedCommandError";
		this.stderr = result.stderr;
	}
}

export async function runCommand(
	argv: readonly string[],
	cwd: string,
	env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
	const child = Bun.spawn([...argv], { cwd, env, stderr: "pipe", stdout: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	if (code !== EXIT_SUCCESS) {
		throw new CapturedCommandError(argv.join(" "), { code, stderr, stdout });
	}
	return stdout.trim();
}

export async function resolveEnvironment(
	cwd: string,
	command: Command,
	inherited: string | undefined,
): Promise<TrackerEnvironment | undefined> {
	if (inherited !== undefined) {
		return { BEADS_DB: parseDatabase(inherited) };
	}
	const output = await command(["mise", "env", "--json"], cwd);
	const selected = z.object({ BEADS_DB: z.string().optional() }).parse(JSON.parse(output));
	if (selected.BEADS_DB === undefined) {
		return;
	}
	return parseEnvironment(selected);
}

// -----------------------------------------------------------------------------

function parseConfig(contents: string): unknown {
	return parse(contents, { integersAsBigInt: true });
}

function findEndpoint(
	entries: AST.TOMLKeyValue[],
	prefix: string[],
): AST.TOMLContentNode | undefined {
	for (const entry of entries) {
		const path = [...prefix, ...getStaticTOMLValue(entry.key)];
		if (path.length === SECOND + SECOND && path[FIRST] === "env" && path[SECOND] === "BEADS_DB") {
			return entry.value;
		}
		if (entry.value.type === "TOMLInlineTable") {
			const found = findEndpoint(entry.value.body, path.map(String));
			if (found) {
				return found;
			}
		}
	}
	return undefined;
}
