import type { MultiplexerOpenRequest } from "../../../src/index";
import { gitLogPreviewCommand } from "../../../src/integrations/multiplexer.ts";

const INITIAL_PREVIEW_CALLS = 0;

/** Records session calls, optionally into a log shared with TestCdDirective to check ordering. */
export class TestMultiplexer {
	opened: MultiplexerOpenRequest[] = [];
	closedPaths: string[] = [];
	previewCalls = INITIAL_PREVIEW_CALLS;
	readonly attached: boolean;
	private readonly log: string[];

	constructor(attached = true, log: string[] = []) {
		this.attached = attached;
		this.log = log;
	}

	open(request: MultiplexerOpenRequest): Promise<void> {
		this.log.push(`open ${request.path}`);
		this.opened.push(request);
		return Promise.resolve();
	}

	closeUnder(path: string): Promise<void> {
		this.log.push(`close ${path}`);
		this.closedPaths.push(path);
		return Promise.resolve();
	}

	previewCommand(): string {
		this.previewCalls++;
		if (this.attached) {
			return "test-preview";
		}
		return gitLogPreviewCommand();
	}
}
