#!/usr/bin/env bun

import { createConfigSchema } from "../src/schemas.ts";
import { format } from "oxfmt";
import { z } from "zod";

const schema = z.toJSONSchema(
	createConfigSchema({ cwd: "/", home: "/", normalizePath: (path) => path }),
	{ io: "input", target: "draft-04" },
);
const { code: contents } = await format("honeycomb.schema.json", JSON.stringify(schema), {
	useTabs: true,
});
const artifact = Bun.file(new URL("../honeycomb.schema.json", import.meta.url));

if (process.argv.includes("--check")) {
	if (!(await artifact.exists()) || (await artifact.text()) !== contents) {
		console.error(
			"honeycomb.schema.json is stale; run bun run --filter @hive/honeycomb schema:generate",
		);
		process.exitCode = 1;
	}
} else {
	await Bun.write(artifact, contents);
}
