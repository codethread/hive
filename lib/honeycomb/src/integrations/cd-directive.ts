import { writeFileSync } from "node:fs";
import type { CdDirective } from "../services.ts";

/** Writes the directory to the file a wrapper names in HONEYCOMB_CD_FILE; a no-op without one. */
export class FileCdDirective implements CdDirective {
	private readonly file: string | undefined;

	constructor(file: string | undefined) {
		this.file = file;
	}

	write(path: string): void {
		if (this.file) writeFileSync(this.file, path);
	}
}
