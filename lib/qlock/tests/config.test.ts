/* eslint-disable no-magic-numbers -- Duration parsing contracts use explicit input/output values. */
import { configPath, parseConfig } from "../src/config.ts";
import { expect, test } from "bun:test";
import { QlockError } from "../src/queue.ts";

// Initialize the TOML/schema boundary outside per-case timing.
parseConfig("");

test.each([
	{ value: "5s", milliseconds: 5000 },
	{ value: "2m", milliseconds: 120_000 },
	{ value: "4m", milliseconds: 240_000 },
	{ value: "1.5s", milliseconds: 1500 },
	{ value: "2147483647ms", milliseconds: 2_147_483_647 },
])("parses timeout=$value with the duration library", ({ value, milliseconds }) => {
	expect(parseConfig(`timeout = "${value}"`)).toEqual({ kind: "timeout", milliseconds });
});

test("empty configuration leaves runtime unlimited", () => {
	expect(parseConfig("")).toEqual({ kind: "unlimited" });
});

test.each([
	{ text: "timeout =" },
	{ text: "timeout = 4" },
	{ text: 'timeout = ""' },
	{ text: 'timeout = "never"' },
	{ text: 'timeout = "4m junk"' },
	{ text: 'timeout = "0s"' },
	{ text: 'timeout = "-1s"' },
	{ text: 'timeout = "0.1ms"' },
	{ text: 'timeout = "2147483648ms"' },
	{ text: 'timeout_guidance = "3m"' },
])("invalid configuration fails rather than disabling the deadline: $text", ({ text }) => {
	expect(() => parseConfig(text)).toThrow(QlockError);
});

test.each([
	{ configHome: undefined, expected: "/home/user/.config/hive/qlock.toml" },
	{ configHome: "", expected: "/home/user/.config/hive/qlock.toml" },
	{ configHome: "/config", expected: "/config/hive/qlock.toml" },
])("resolves the XDG configuration path: $configHome", ({ configHome, expected }) => {
	expect(configPath("/home/user", configHome)).toBe(expected);
});
