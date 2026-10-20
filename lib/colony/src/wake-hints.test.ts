/* eslint-disable max-statements -- Tests retain complete notification and cleanup traces. */
/* eslint-disable unicorn/no-null -- Native watch notifications may omit filenames. */
import type { ColonyHintEvent, FilesystemHintIO, HintWatchCallbacks } from "./wake-hints.ts";
import { expect, test } from "bun:test";
import { createFilesystemHints } from "./wake-hints.ts";

const ZERO = 0;
const SEVEN = 7;
const ONE = 1;
const TWO = 2;
const THREE = 3;
interface Watch extends HintWatchCallbacks {
	directory: string;
	closes: number;
}

test("exact database/WAL and shallow artifact names hint; noisy and foreign files do not", () => {
	const { io, watches, events } = fixture();
	const hints = createFilesystemHints("/tracker/selected.db", (event) => events.push(event), io);
	hints.update(["/attempt"]);
	const [database, attempt] = watches;
	for (const name of [
		"selected.db-shm",
		"selected.db.lock",
		"issues.jsonl",
		"other.db",
		"other.db-wal",
	]) {
		database!.changed("change", name);
	}
	for (const name of [
		"stdout.log",
		"stderr.log",
		"finish.json.tmp",
		"child/finish.json",
		"permission.json",
	]) {
		attempt!.changed("rename", name);
	}
	expect(events).toEqual([]);
	for (const name of ["selected.db", "selected.db-wal", null]) {
		database!.changed("change", name);
	}
	for (const name of ["finish.json", "worker.json", "ownership.json", null]) {
		attempt!.changed("rename", name);
	}
	expect(events).toEqual(Array.from({ length: SEVEN }, () => ({ type: "HINT" })));
	hints.dispose();
});

test("new subscriptions latch preexisting artifacts once and updates replace rather than traverse history", () => {
	const { io, watches, events, present } = fixture();
	present.add("/first/finish.json");
	present.add("/first/ownership.json");
	const hints = createFilesystemHints("/tracker/selected.db", (event) => events.push(event), io);
	hints.update(["/first", "/first"]);
	hints.update(["/first"]);
	expect(events).toEqual([{ type: "HINT" }]);
	expect(watches).toHaveLength(TWO);
	hints.update(["/second"]);
	expect(watches.map(({ directory }) => directory)).toEqual(["/tracker", "/first", "/second"]);
	expect(watches[ONE]!.closes).toBe(ONE);
	watches[ONE]!.changed("change", "finish.json");
	watches[ONE]!.closed();
	watches[ONE]!.failed(new Error("queued old failure"));
	expect(events).toHaveLength(ONE);
	watches[TWO]!.changed("rename", "finish.json");
	expect(events).toHaveLength(TWO);
	hints.dispose();
	hints.dispose();
	hints.update(["/third"]);
	for (const watcher of watches) {
		watcher.changed("change", null);
		watcher.failed(new Error("late error"));
		watcher.closed();
	}
	expect(events).toHaveLength(TWO);
	expect(watches).toHaveLength(THREE);
	expect(watches.map(({ closes }) => closes)).toEqual([ONE, ONE, ONE]);
});

test("artifact publication during watch attachment is latched even without a delivered event", () => {
	const { io, present, events } = fixture();
	const { watch } = io;
	io.watch = (directory, callbacks) => {
		const close = watch(directory, callbacks);
		if (directory === "/attempt") {
			present.add("/attempt/worker.json");
		}
		return close;
	};
	const hints = createFilesystemHints("/tracker/selected.db", (event) => events.push(event), io);
	hints.update(["/attempt"]);
	expect(events).toEqual([{ type: "HINT" }]);
	hints.dispose();
});

test.each(["setup", "update", "presence", "error", "close", "replacement", "loss", "attach-gap"])(
	"%s failure notifies once, closes all watches and permanently disables hints",
	(mode) => {
		const { io, watches, events } = fixture();
		if (mode === "setup") {
			io.watch = () => {
				throw new Error("cannot watch");
			};
		}
		const hints = createFilesystemHints("/tracker/selected.db", (event) => events.push(event), io);
		if (mode === "update") {
			io.watch = () => {
				throw new Error("cannot attach attempt");
			};
		}
		if (mode === "presence") {
			io.exists = () => {
				throw new Error("presence failed");
			};
		}
		if (mode === "attach-gap") {
			let calls = ZERO;
			io.identity = () => String(calls++);
		}
		hints.update(["/attempt"]);
		const [database] = watches;
		if (mode === "error") {
			database!.failed(new Error("watch error"));
		}
		if (mode === "close") {
			database!.closed();
		}
		if (mode === "replacement") {
			io.identity = () => "new inode";
			database!.changed("rename", "tracker");
		}
		if (mode === "loss") {
			io.identity = () => {
				throw new Error("directory missing");
			};
			database!.changed("rename", null);
		}
		expect(events).toHaveLength(ONE);
		expect(events[ZERO]).toMatchObject({ type: "HINT_FAILURE", message: expect.any(String) });
		for (const watcher of watches) {
			expect(watcher.closes).toBe(ONE);
			watcher.changed("change", null);
			watcher.failed(new Error("secondary error"));
			watcher.closed();
		}
		hints.update(["/later"]);
		hints.dispose();
		expect(events).toHaveLength(ONE);
	},
);

// --- Private functions ---
function fixture() {
	const watches: Watch[] = [];
	const events: ColonyHintEvent[] = [];
	const present = new Set<string>();
	const io: FilesystemHintIO = {
		identity: (directory) => directory,
		exists: (path) => present.has(path),
		watch(directory, callbacks) {
			const watcher = { directory, ...callbacks, closes: ZERO };
			watches.push(watcher);
			return () => {
				watcher.closes += ONE;
				watcher.closed();
			};
		},
	};
	return { io, watches, events, present };
}
