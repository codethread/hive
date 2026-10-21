import { defaultProjectConfig, selectOnboardingConfig } from "../src/config.ts";
import { expect, test } from "bun:test";
import { BeeswaxError } from "../src/errors.ts";

const base = defaultProjectConfig("none");
const configured = selectOnboardingConfig(base, {
	harness: ["codex", "pi", "codex"],
	include: ["colony"],
	exclude: ["bee"],
});

test("harness selection records repo intent and leaves unspecified selections alone", () => {
	expect(configured.onboarding).toEqual({
		harnesses: ["codex", "pi"],
		include: ["colony"],
		exclude: ["bee"],
	});
	expect(selectOnboardingConfig(configured, {})).toEqual(configured);
	expect(selectOnboardingConfig(configured, { harness: ["none"] })).toEqual(base);
});

test.each([{ harness: ["unknown"] }, { harness: ["none", "codex"] }, { include: ["colony"] }])(
	"invalid onboarding selections fail: %j",
	(flags) => {
		expect(() => selectOnboardingConfig(base, flags)).toThrow(BeeswaxError);
	},
);
