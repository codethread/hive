import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { parseConfig } from "./config.ts";
import { explainPolicy, type ConfigPathContext } from "./domain/config.ts";
import type { ConfigService } from "./services.ts";

export const createLiveConfigService = (
	normalizePath: ConfigPathContext["normalizePath"],
): ConfigService => ({
	read: () => {
		const home = homedir();
		const configHome = process.env.XDG_CONFIG_HOME ?? resolve(home, ".config");
		const configPath = resolve(configHome, "honeycomb.toml");
		return parseConfig(existsSync(configPath) ? readFileSync(configPath, "utf8") : "", {
			home,
			cwd: process.cwd(),
			normalizePath,
		});
	},
	explain: (config, root) => {
		const canonicalRoot = normalizePath(root);
		const canonicalPaths = new Map(
			config.projects.map((project) => [project.root, normalizePath(project.root)]),
		);
		return explainPolicy(config, canonicalRoot, (path) => canonicalPaths.get(path) ?? path);
	},
});
