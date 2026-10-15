export interface ProcessResult {
	/** Child status, retained for Git's hook and merge protocols. */
	exitCode: number;
	/** Captured result output. */
	stdout: string;
	/** Captured diagnostics, never leaked into JSON mode. */
	stderr: string;
}

export interface WorkspaceIO {
	/** Read a UTF-8 file; absent optional configuration is an empty document. */
	read: (path: string) => Promise<string>;
	/** Persist a UTF-8 file, creating parent directories. */
	write: (path: string, contents: string) => Promise<void>;
	/** Inspect a path without changing it. */
	exists: (path: string) => Promise<boolean>;
	/** List an optional hook directory; missing directories have no entries. */
	list: (path: string) => Promise<string[]>;
	/** Set executable mode on generated hook entry points. */
	chmod: (path: string, mode: number) => Promise<void>;
	/** Invoke a child process with captured streams and status. */
	exec: (argv: readonly string[], cwd: string) => Promise<ProcessResult>;
	/** Invoke a child and fail loudly on nonzero status. */
	command: (argv: readonly string[], cwd: string) => Promise<string>;
}
