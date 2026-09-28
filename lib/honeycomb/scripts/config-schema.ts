#!/usr/bin/env bun

import { z } from "zod";
import { format } from "oxfmt";
import { createConfigSchema } from "../src/schemas.ts";

const schema = z.toJSONSchema(
	createConfigSchema({ home: "/", cwd: "/", normalizePath: (path) => path }),
	{ target: "draft-04", io: "input" },
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
