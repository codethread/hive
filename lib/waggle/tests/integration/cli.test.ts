import { expect, test } from "bun:test";
import type { ClassificationRequest } from "../../src/classifiers.ts";
import type { WaggleDependencies } from "../../src/cli.ts";
import { parseClassifier } from "../../src/classifiers.ts";
import { runCli } from "../../src/cli.ts";

const EXIT = { failure: 1, success: 0, usage: 2 };

const classifier = parseClassifier(
	"example",
	await Bun.file(new URL("../fixtures/example.toml", import.meta.url)).text(),
);
const response = {
	answers: {
		review: {
			choice: "concern",
			confidence: 0.6,
			probabilities: { concern: 0.8, no_concern: 0.2 },
			type: "choice",
		},
	},
	model: "jev-1.13.0",
	usage: { input_tokens: 100, output_tokens: 20 },
};

function harness(input = '{"evidence":"private source"}') {
	const stdout: string[] = [];
	const stderr: string[] = [];
	const requests: ClassificationRequest[] = [];
	const files: string[] = [];
	const directories: string[] = [];
	const deps: WaggleDependencies = {
		classify: (request) => {
			requests.push(request);
			return Promise.resolve(response);
		},
		list: (directory) => {
			directories.push(directory);
			return Promise.resolve([classifier]);
		},
		load: (directory) => {
			directories.push(directory);
			return Promise.resolve(classifier);
		},
		readInput: (path) => {
			files.push(path);
			return Promise.resolve(input);
		},
		stderr: (text) => {
			stderr.push(text);
		},
		stdout: (text) => {
			stdout.push(text);
		},
	};
	return { deps, directories, files, requests, stderr, stdout };
}

test.each([{ args: ["list"] }, { args: ["describe", "example"] }])(
	"discovery command $args never contacts JEV",
	async ({ args }) => {
		const capture = harness();
		expect(await runCli([...args], capture.deps)).toBe(EXIT.success);
		expect(capture.requests).toEqual([]);
		expect(capture.files).toEqual([]);
		expect(capture.stderr).toEqual([]);
		expect(JSON.parse(capture.stdout.join(""))).toMatchObject({ ok: true });
	},
);

test("describe exposes the full evidence and question contract", async () => {
	const capture = harness();
	await runCli(["describe", "example", "--classifiers", "local-rules"], capture.deps);
	expect(capture.directories).toEqual(["local-rules"]);
	expect(JSON.parse(capture.stdout.join(""))).toMatchObject({
		...classifier.definition,
		id: "example",
		kind: "classifier",
		ok: true,
	});
});

test.each(["context.json", "-"])(
	"run reads %s once and treats a concern as successful execution",
	async (path) => {
		const capture = harness();
		expect(await runCli(["run", "example", "--input", path, "--json"], capture.deps)).toBe(
			EXIT.success,
		);
		expect(capture.files).toEqual([path]);
		expect(capture.requests).toEqual([
			{
				model: "jev-latest",
				questions: classifier.definition.questions,
				state: { evidence: "private source" },
			},
		]);
		expect(capture.stderr).toEqual([]);
		const output = JSON.parse(capture.stdout.join(""));
		expect(output).toMatchObject({
			...response,
			classifier: { id: "example", version: 1 },
			kind: "classification",
			ok: true,
		});
		expect(output.request_hash).toMatch(/^[a-f0-9]{64}$/u);
		expect(capture.stdout.join("")).not.toContain("private source");
	},
);

test("invalid evidence fails before contacting JEV", async () => {
	const capture = harness("{}");
	expect(await runCli(["run", "example", "--input", "-", "--json"], capture.deps)).toBe(
		EXIT.failure,
	);
	expect(capture.requests).toEqual([]);
	expect(capture.stderr).toEqual([]);
	expect(JSON.parse(capture.stdout.join(""))).toMatchObject({
		kind: "error",
		ok: false,
		reason: "execution_failed",
	});
});

test("provider failure stays on stderr in human mode", async () => {
	const capture = harness();
	capture.deps.classify = () => Promise.reject(new Error("provider unavailable"));
	expect(await runCli(["run", "example", "--input", "-"], capture.deps)).toBe(EXIT.failure);
	expect(capture.stdout).toEqual([]);
	expect(capture.stderr.join("")).toContain("provider unavailable");
});

test("malformed provider success becomes a JSON execution failure", async () => {
	const capture = harness();
	capture.deps.classify = () => Promise.resolve({ answers: {} });
	expect(await runCli(["run", "example", "--input", "-", "--json"], capture.deps)).toBe(
		EXIT.failure,
	);
	expect(capture.stderr).toEqual([]);
	expect(JSON.parse(capture.stdout.join(""))).toMatchObject({
		ok: false,
		reason: "execution_failed",
	});
});

test("argument errors preserve the single-document machine contract", async () => {
	const capture = harness();
	expect(await runCli(["run", "example", "--json"], capture.deps)).toBe(EXIT.usage);
	expect(capture.requests).toEqual([]);
	expect(capture.stderr).toEqual([]);
	expect(JSON.parse(capture.stdout.join(""))).toMatchObject({ ok: false, reason: "usage" });
});

test("help succeeds without loading a catalogue", async () => {
	const capture = harness();
	expect(await runCli(["--help"], capture.deps)).toBe(EXIT.success);
	expect(capture.directories).toEqual([]);
	expect(capture.stdout.join("")).toContain("describe");
});
