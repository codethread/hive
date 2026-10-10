import tailwind from "bun-plugin-tailwind";

await Bun.build({
	compile: { outfile: "./dist/hive-ui" },
	entrypoints: ["./server/index.ts"],
	plugins: [tailwind],
});
