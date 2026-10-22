import {
	BACKGROUND_REFRESH_INTERVAL_MS,
	REFRESH_INTERVAL_MS,
	createRefreshSchedule,
} from "./src/refresh.ts";
import { expect, test } from "bun:test";

test("polls refresh current data while background work waits a minute", () => {
	let clock = 1;
	const schedule = createRefreshSchedule(() => clock);
	expect(schedule("board", false)).toEqual({ refreshAfter: clock, background: true });
	clock += REFRESH_INTERVAL_MS;
	expect(schedule("board", false)).toEqual({ refreshAfter: clock, background: false });
	clock = BACKGROUND_REFRESH_INTERVAL_MS + 1;
	expect(schedule("board", false)).toEqual({ refreshAfter: clock, background: true });
});

test("manual refresh, newly opened views and browser reload bypass background age", () => {
	let clock = 1;
	const schedule = createRefreshSchedule(() => clock);
	schedule("board", false);
	clock += 1;
	expect(schedule("board", true).background).toBe(true);
	expect(schedule("outline", false).background).toBe(true);
	expect(createRefreshSchedule(() => clock)("board", false)).toEqual({
		refreshAfter: clock,
		background: true,
	});
});

test("opening or refreshing an inspector does not postpone the board background pass", () => {
	let clock = 1;
	const schedule = createRefreshSchedule(() => clock);
	schedule("page/board", false);
	clock = BACKGROUND_REFRESH_INTERVAL_MS;
	schedule("bead/selected", true);
	clock += 1;
	expect(schedule("page/board", false).background).toBe(true);
	expect(schedule("bead/selected", false).background).toBe(false);
});
