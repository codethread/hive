import { localSetupServices, setupBeads } from "./beads-setup.ts";

const source = process.env.WK_ROOT ?? process.cwd();
if (await Bun.file(`${source}/mise.local.toml`).exists()) {
	await setupBeads(process.cwd(), { kind: "source", root: source }, localSetupServices);
}
