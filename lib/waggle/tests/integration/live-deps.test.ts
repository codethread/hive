import { afterAll, expect, test } from "bun:test";
import { classifyWithJev, createLiveDependencies } from "../../src/live-deps.ts";
// eslint-disable-next-line import/no-nodejs-modules -- Resolve fixture paths under an isolated temporary directory.
import { join, resolve } from "node:path";
// eslint-disable-next-line import/no-nodejs-modules -- Integration tests own real temporary classifier files.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { parseClassifier, prepareRequest } from "../../src/classifiers.ts";
import { APIError } from "@typesafe-ai/sdk";
// eslint-disable-next-line import/no-nodejs-modules -- Use the host's temporary directory for fixtures.
import { tmpdir } from "node:os";

const source = await Bun.file(new URL("../fixtures/example.toml", import.meta.url)).text();
const request = prepareRequest(parseClassifier("example", source), '{"evidence":"source"}');
const directory = await mkdtemp(join(tmpdir(), "waggle-"));
await Bun.write(join(directory, "zebra.toml"), source);
await Bun.write(join(directory, "alpha.toml"), source);
await Bun.write(join(directory, "README.md"), "Not a classifier");
await mkdir(join(directory, "nested.toml"));

afterAll(async () => {
	await rm(directory, { force: true, recursive: true });
});

test("live catalogue reads only direct TOML files and sorts IDs", async () => {
	const deps = createLiveDependencies();
	const classifiers = await deps.list(directory);
	expect(classifiers.map(({ id }) => id)).toEqual(["alpha", "zebra"]);
	expect(await deps.load(directory, "alpha")).toEqual(parseClassifier("alpha", source));
	await expect(deps.load(directory, "../secret")).rejects.toBeInstanceOf(Error);
	await expect(deps.load(directory, "missing")).rejects.toBeInstanceOf(Error);
});

test("shipped classifiers expose their own evidence and answer contracts", async () => {
	const catalogue = await createLiveDependencies().list(
		resolve(import.meta.dir, "../../../..", "classifiers"),
	);
	const concernContract = {
		inputs: ["callers", "code", "contract", "purpose"],
		questions: { review: ["concern", "needs_context", "no_concern"] },
	};
	expect(
		catalogue.map(({ id, definition }) => ({
			id,
			inputs: Object.keys(definition.inputs).toSorted(),
			questions: Object.fromEntries(
				Object.entries(definition.questions).map(([name, question]) => [
					name,
					Object.keys(question.criteria).toSorted(),
				]),
			),
		})),
	).toEqual([
		{ id: "abstraction-payoff", ...concernContract },
		{ id: "failure-transparency", ...concernContract },
		{
			id: "review-attention",
			inputs: ["change", "code", "context", "path"],
			questions: { attention: ["needs_context", "show", "skip"] },
		},
		{ id: "state-coherence", ...concernContract },
	]);
});

test("missing credentials fail before an SDK request", async () => {
	await expect(
		classifyWithJev(request, undefined, () => {
			throw new Error("Transport must not run");
		}),
	).rejects.toBeInstanceOf(Error);
});

test("SDK adapter sends state and questions once and preserves provider metadata", async () => {
	const calls: unknown[] = [];
	const expected = {
		answers: {},
		model: "jev-test",
		usage: { input_tokens: 10, output_tokens: 5 },
	};
	const result = await classifyWithJev(request, "test-key", (url, init) => {
		calls.push({
			authorization: new Headers(init?.headers).get("Authorization"),
			body: init?.body,
			method: init?.method,
			url,
		});
		return Promise.resolve(Response.json(expected));
	});
	expect(result).toEqual(expected);
	expect(calls).toEqual([
		{
			authorization: "Bearer test-key",
			body: JSON.stringify(request),
			method: "POST",
			url: "https://api.typesafe.ai/v1/systemone",
		},
	]);
});

test.each([{ status: 401 }, { status: 429 }, { status: 500 }])(
	"HTTP $status fails without retrying",
	async ({ status }) => {
		const calls: string[] = [];
		const result = classifyWithJev(request, "test-key", (url) => {
			calls.push(url);
			return Promise.resolve(Response.json({ message: "unavailable" }, { status }));
		});
		await expect(result).rejects.toBeInstanceOf(APIError);
		expect(calls).toEqual(["https://api.typesafe.ai/v1/systemone"]);
	},
);
