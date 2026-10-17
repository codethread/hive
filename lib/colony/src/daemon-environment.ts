const CONFIGURATION_PATHS = [
	"PATH",
	"CODEX_HOME",
	"XDG_CONFIG_HOME",
	"XDG_DATA_HOME",
	"XDG_CACHE_HOME",
	"XDG_STATE_HOME",
] as const;

/** Select tool and configuration paths for native registration; credentials stay in their existing locations. */
export function daemonEnvironment(
	environment: Record<string, string | undefined>,
): Record<string, string> {
	const selected: Record<string, string> = {};
	for (const name of CONFIGURATION_PATHS) {
		const value = environment[name];
		if (value !== undefined) {
			selected[name] = value;
		}
	}
	return selected;
}
