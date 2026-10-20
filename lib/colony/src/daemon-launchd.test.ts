import { expect, mock, test } from "bun:test";
import { launchdServiceStatus, prepareLaunchdServer } from "./daemon-launchd.ts";

import type { Launchctl } from "./daemon-launchd.ts";

const FIRST = 0;
const service = "gui/501/dev.hive.colony.fixture";
const success = { code: 0, stdout: "", stderr: "" };

test("GUI availability depends on the selected domain, not the caller's Background manager", async () => {
	const run = mock<Launchctl>((args) => {
		if (args.at(FIRST) === "managername") {
			return Promise.resolve({ ...success, stdout: "Background\n" });
		}
		return Promise.resolve(success);
	});
	await prepareLaunchdServer(service, run);
	expect(run.mock.calls).toEqual([[["print", "gui/501"]]]);
});

test("an unavailable GUI domain rejects native startup", async () => {
	const run = mock<Launchctl>(() =>
		Promise.resolve({ ...success, code: 125, stderr: "Domain not found" }),
	);
	await expect(prepareLaunchdServer(service, run)).rejects.toBeInstanceOf(Error);
	expect(run.mock.calls).toEqual([[["print", "gui/501"]]]);
});

test.each([
	{ name: "absent", result: { ...success, code: 113 }, status: { kind: "absent" } },
	{
		name: "idle",
		result: { ...success, stdout: `${service} = {\n\tstate = not running\n}\n` },
		status: { kind: "loaded", pid: undefined },
	},
	{
		name: "running",
		result: { ...success, stdout: `${service} = {\n\tstate = running\n\tpid = 1234\n}\n` },
		status: { kind: "loaded", pid: 1234 },
	},
	{
		name: "idle with nested process metadata",
		result: { ...success, stdout: `${service} = {\n\toriginator = {\n\t\tpid = 99\n\t}\n}\n` },
		status: { kind: "loaded", pid: undefined },
	},
])("reads $name service from the explicit GUI domain", async ({ result, status }) => {
	const run = mock<Launchctl>(() => Promise.resolve(result));
	expect(await launchdServiceStatus(service, run)).toEqual(status);
	expect(run.mock.calls).toEqual([[["print", service]]]);
});

test.each([
	{
		name: "permission failure",
		result: { ...success, code: 1, stderr: "Operation not permitted" },
	},
	{ name: "invalid PID", result: { ...success, stdout: `${service} = {\n\tpid = invalid\n}\n` } },
])("does not treat $name as an absent or idle service", async ({ result }) => {
	await expect(launchdServiceStatus(service, () => Promise.resolve(result))).rejects.toBeInstanceOf(
		Error,
	);
});
