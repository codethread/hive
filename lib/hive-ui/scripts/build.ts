import tailwind from "bun-plugin-tailwind";
import { z } from "zod";

const target = z
	.enum(["bun-darwin-arm64", "bun-darwin-x64", "bun-linux-arm64", "bun-linux-x64"])
	.optional()
	.parse(process.env["HIVE_BUILD_TARGET"]);

const compile: { outfile: string; target?: Exclude<typeof target, undefined> } = {
	outfile: "./dist/hive-ui",
};
if (target !== undefined) {
	compile.target = target;
}

await Bun.build({
	compile,
	entrypoints: ["./server/index.ts"],
	plugins: [tailwind],
});
