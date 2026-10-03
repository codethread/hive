/** Records shell directory-change requests in a log shared with TestMultiplexer. */
export class TestCdDirective {
	paths: string[] = [];
	private readonly log: string[];

	constructor(log: string[] = []) {
		this.log = log;
	}

	write(path: string): void {
		this.log.push(`cd ${path}`);
		this.paths.push(path);
	}
}
