import type { BeadsScope, BeadsService } from "@hive/beads";
import type { RepositoryEndpoint, resolveRepository } from "@hive/shared";

/** Tracker I/O and its explicit repository/database authority travel together. */
export interface TrackerContext {
	/** Injected native or in-memory tracker service. */
	beads: BeadsService;
	/** Canonical repository and selected database. */
	repository: RepositoryEndpoint;
}

/** Offline commands select a tracker without requiring a Colony daemon. */
export interface TrackerCommands {
	/** Injected tracker implementation. */
	beads: BeadsService;
	/** Canonical repository and database discovery at the command boundary. */
	resolveRepository: typeof resolveRepository;
}

/** Select tracker authority and audit identity independently for each operation. */
export function trackerScope(repository: RepositoryEndpoint, actor?: string): BeadsScope {
	return { cwd: repository.root, db: repository.beadsDb, actor };
}
