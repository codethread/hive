import type { CdDirective } from "../services.ts";
// oxlint-disable-next-line import/no-nodejs-modules -- The cd handoff is a filesystem IO boundary.
import { writeFileSync } from "node:fs";

/** Writes the directory to the file a wrapper names in HONEYCOMB_CD_FILE; a no-op without one. */
export function createFileCdDirective(file: string | undefined): CdDirective {
	return { write };

	function write(path: string): void {
		if (file) {
			// oxlint-disable-next-line node/no-sync -- CdDirective.write is synchronous: the wrapper reads the file after process exit.
			writeFileSync(file, path);
		}
	}
}
