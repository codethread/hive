import { expect, test } from "bun:test";
import { CommandError } from "./model.ts";

test("native stdout diagnostic survives stderr warnings without logging unrelated context", () => {
	const stdout = JSON.stringify({
		error: {
			code: "UPDATE_PRECONDITION_FAILED",
			context: { issue_id: "test-task", private_payload: "not a diagnostic" },
			message: "test-task changed since you read it. Nothing was written.",
		},
	});
	const error = new CommandError("br update", {
		code: 6,
		stderr: "unrelated runtime warning\n",
		stdout,
	});
	expect(error).toBeInstanceOf(CommandError);
	expect(error.message).toMatchInlineSnapshot(
		'"br update exited 6: UPDATE_PRECONDITION_FAILED: test-task changed since you read it. Nothing was written."',
	);
	expect(error.stdout).toBe(stdout);
	expect(error.nativeError?.code).toBe("UPDATE_PRECONDITION_FAILED");
});

test("native claim validation retains its machine-readable field", () => {
	const error = new CommandError("br update", {
		code: 4,
		stderr: "",
		stdout: JSON.stringify({
			error: {
				code: "VALIDATION_FAILED",
				context: { field: "claim" },
				message: "Validation failed: claim: issue test-task already assigned to another actor",
			},
		}),
	});
	expect(error.nativeError).toEqual({
		code: "VALIDATION_FAILED",
		context: { field: "claim" },
		message: "Validation failed: claim: issue test-task already assigned to another actor",
	});
});

test.each(["", "not json", '{"error":{"code":6}}', '{"payload":"private"}'])(
	"ordinary command errors preserve stderr with stdout %j",
	(stdout) => {
		const error = new CommandError("honeycomb", { code: 1, stderr: "failed\n", stdout });
		expect(error.message).toMatchInlineSnapshot('"honeycomb exited 1: failed"');
		expect(error.nativeError).toBeUndefined();
	},
);
