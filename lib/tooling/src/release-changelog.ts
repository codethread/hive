import type { ChangelogChange, ChangelogRelease } from "@hive/shared/changelog";
import { CommitParser } from "conventional-commits-parser";
import type { ReleaseCommit } from "./release.ts";
import { fromMarkdown } from "mdast-util-from-markdown";

const FIRST = 0;
const ONE = 1;
const TOOL_HISTORIES = [
	{ tool: "beeswax", file: "lib/beeswax/changelog.json" },
	{ tool: "honeycomb", file: "lib/honeycomb/changelog.json" },
	{ tool: "busybee", file: "lib/busybee/changelog.json" },
	{ tool: "bee", file: "lib/colony/bee-changelog.json" },
	{ tool: "colony", file: "lib/colony/changelog.json" },
	{ tool: "qlock", file: "lib/qlock/changelog.json" },
	{ tool: "hive-ui", file: "lib/hive-ui/changelog.json" },
	{ tool: "waggle", file: "lib/waggle/changelog.json" },
];
const parser = new CommitParser({
	headerPattern: /^(?<type>\w+)(?:\((?<scope>[^)]+)\))?!?: (?<subject>.+)$/u,
	headerCorrespondence: ["type", "scope", "subject"],
	breakingHeaderPattern: /^(?<type>\w+)(?:\((?<scope>[^)]+)\))?!: (?<subject>.+)$/u,
});

interface ToolChange {
	/** Explicit public executable scope from the block header. */
	tool: string;
	/** Authored record with its source revision. */
	change: ChangelogChange;
}

/** Generate tool candidates from all range commits; reviewed adoption notes stay in history. */
export function generateChangelogs(
	version: string,
	commits: ReleaseCommit[],
): { file: string; release: ChangelogRelease }[] {
	const changes = commits.flatMap((commit) => parseChangelogBlocks(commit));
	return TOOL_HISTORIES.map(({ tool, file }) => ({
		file,
		release: {
			version,
			changes: changes.filter((entry) => entry.tool === tool).map((entry) => entry.change),
		},
	}));
}

/** Only root-level named fences declare changes; quoted source archives remain ordinary Markdown. */
export function parseChangelogBlocks(commit: ReleaseCommit): ToolChange[] {
	return fromMarkdown(commit.message).children.flatMap((node) => {
		if (node.type !== "code" || node.lang !== "changelog") {
			return [];
		}
		if (node.meta !== "v1") {
			throw new Error(
				`Commit ${commit.hash}: unsupported changelog format ${node.meta ?? "(missing)"}; expected v1.`,
			);
		}
		const source = commit.message.slice(node.position!.start.offset, node.position!.end.offset);
		assertClosedFence(source, commit.hash);
		return [parseChange(node.value, commit.hash)];
	});
}

// --- Private functions ---

function assertClosedFence(source: string, hash: string): void {
	const opening = source.trimStart().match(/^(?:`{3,}|~{3,})/u)![FIRST]!;
	const closing = source.split("\n").at(-ONE)!;
	if (
		source.includes("\n") &&
		new RegExp(`^ {0,3}${opening[FIRST]}{${opening.length},}[\\t ]*$`, "u").test(closing)
	) {
		return;
	}
	throw new Error(`Commit ${hash}: changelog block requires a closing fence.`);
}

function parseChange(value: string, hash: string): ToolChange {
	const parsed = parser.parse(value);
	if (!parsed.type || !parsed.subject) {
		throw new Error(`Commit ${hash}: changelog block requires a Conventional Commit header.`);
	}
	if (!TOOL_HISTORIES.some(({ tool }) => tool === parsed.scope)) {
		throw new Error(
			`Commit ${hash}: changelog scope ${parsed.scope ?? "(missing)"} must name one public tool: ` +
				`${TOOL_HISTORIES.map(({ tool }) => tool).join(", ")}.`,
		);
	}
	const header = value.split("\n", ONE).join("");
	return {
		tool: parsed.scope!,
		change: {
			commit: hash,
			summary: parsed.subject,
			body: value.slice(header.length).replaceAll(/^\n+|\n+$/gu, ""),
			breaking: parsed.notes.map((note) => note.text),
			adoption: [],
		},
	};
}
