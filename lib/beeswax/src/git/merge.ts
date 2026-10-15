import type { MergeResult } from "./merge-core.ts";
import { mergeIssueJsonl } from "./merge-core.ts";

export interface MergePaths {
	/** Common ancestor file supplied by Git. */
	ancestor: string;
	/** Current-side file overwritten only after all inputs pass validation. */
	current: string;
	/** Other-side file supplied by Git. */
	other: string;
}

export interface MergeFiles {
	/** Read one Git temporary file. */
	read: (path: string) => Promise<string>;
	/** Replace the current-side file with the merge result. */
	write: (path: string, contents: string) => Promise<void>;
}

/** Preserve invalid input untouched and retain explicit conflict markers for Git. */
export async function mergeFiles(paths: MergePaths, files: MergeFiles): Promise<MergeResult> {
	const [ancestor, current, other] = await Promise.all([
		files.read(paths.ancestor),
		files.read(paths.current),
		files.read(paths.other),
	]);
	const result = mergeIssueJsonl(ancestor, current, other);
	if (result.kind !== "invalid") {
		await files.write(paths.current, result.contents);
	}
	return result;
}
