import { PickerCancelled } from "../../../src/errors.ts";

const INITIAL_CONFIRM_CALLS = 0;

interface PickerItem {
	display: string;
	key: string;
	preview: string;
}

/**
 * Picker double that returns a fixed selection. A null choice models the user
 * cancelling in fzf and must stay supported for the pooled add suites.
 */
export class TestPicker {
	items: PickerItem[] = [];
	options: { interactive?: boolean } | undefined;
	confirmCalls = INITIAL_CONFIRM_CALLS;
	private readonly choice: string | null;
	private readonly confirmed: boolean;

	constructor(choice: string | null, confirmed: boolean) {
		this.choice = choice;
		this.confirmed = confirmed;
	}

	pick(
		items: PickerItem[],
		_header: string,
		options?: { interactive?: boolean },
	): Promise<PickerItem> {
		this.items = items;
		this.options = options;
		if (this.choice === null) {
			return Promise.reject(new PickerCancelled());
		}
		const item = items.find((candidate) => candidate.key === this.choice);
		if (!item) {
			return Promise.reject(new PickerCancelled());
		}
		return Promise.resolve(item);
	}

	confirm(): Promise<boolean> {
		this.confirmCalls++;
		return Promise.resolve(this.confirmed);
	}
}
