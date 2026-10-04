// oxlint-disable-next-line import/no-nodejs-modules -- Config discovery is a filesystem IO boundary.
import { existsSync, readFileSync } from "node:fs";
import type { ConfigPathContext } from "./domain/config.ts";
import type { ConfigService } from "./services.ts";
import { explainPolicy } from "./domain/config.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Home resolution is a process boundary.
import { homedir } from "node:os";
import { parseConfig } from "./config.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- Path resolution is a filesystem boundary.
import { resolve } from "node:path";

export function createLiveConfigService(
	normalizePath: ConfigPathContext["normalizePath"],
): ConfigService {
	return {
		explain: (config, root) => {
			const canonicalRoot = normalizePath(root);
			const canonicalPaths = new Map(
				config.projects.map((project) => [project.root, normalizePath(project.root)]),
			);
			return explainPolicy(config, canonicalRoot, (path) => canonicalPaths.get(path) ?? path);
		},
		read: () => {
			const home = homedir();
			const configPath = resolve(
				process.env.XDG_CONFIG_HOME ?? resolve(home, ".config"),
				"honeycomb.toml",
			);
			const context = { cwd: process.cwd(), home, normalizePath };
			// oxlint-disable-next-line node/no-sync -- ConfigService.read is a synchronous command-boundary contract.
			if (!existsSync(configPath)) {
				return parseConfig("", context);
			}
			// oxlint-disable-next-line node/no-sync -- ConfigService.read is a synchronous command-boundary contract.
			return parseConfig(readFileSync(configPath, "utf8"), context);
		},
	};
}
