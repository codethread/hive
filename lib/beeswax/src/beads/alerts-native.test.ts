import { alertSessionReceiptPath, alertStateHome, alertStatePath } from "./alerts-native.ts";
import { expect, test } from "bun:test";

const endpointKey = "84122c593b886e85ec55e58038d263f5be2c27b3ae755fbb6eb08363f397c6d1";
const sessionKey = "3f3af1ecebbd1410ab417ec0d27bbfcb5d340e177ae159b59fc8626c2dfd9175";

test.each([
	{ name: "unset", configured: undefined, expected: "/home/fixture/.local/state" },
	{ name: "empty", configured: "", expected: "/home/fixture/.local/state" },
	{ name: "relative", configured: "relative/state", expected: "/home/fixture/.local/state" },
	{ name: "absolute XDG", configured: "/selected/state", expected: "/selected/state" },
])("alert state root selection: $name", ({ configured, expected }) => {
	expect(alertStateHome(configured, "/home/fixture")).toBe(expected);
});

test("incident and session paths retain their keys beneath the Beeswax namespace #test-689", () => {
	const database = "/repo/.beads/beads.db";
	const directory = "/selected/state/hive/beeswax/tracker-alerts";
	expect(alertStatePath("/selected/state", database)).toBe(`${directory}/${endpointKey}.json`);
	expect(
		alertSessionReceiptPath("/selected/state", database, { harness: "pi", id: "session" }),
	).toBe(`${directory}/${endpointKey}.sessions/pi-${sessionKey}.json`);
});
