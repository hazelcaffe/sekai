import { describe, expect, test } from "bun:test";
import { ApiError } from "@sekai/shared";
import { cancelledReauth, saveForm } from "../src/lib/forms.ts";

const cancelled = new ApiError(403, "Confirm it's you to continue", undefined, "reauth_required");

describe("a cancelled Confirm it's you", () => {
	test("is told apart from other errors", () => {
		expect(cancelledReauth(cancelled)).toBe(true);
		expect(cancelledReauth(new ApiError(403, "Admins only"))).toBe(false);
		expect(cancelledReauth(new Error("reauth_required"))).toBe(false);
		expect(cancelledReauth(null)).toBe(false);
	});

	test("leaves a form's save without an error", async () => {
		await expect(saveForm(() => Promise.reject(cancelled))).resolves.toBeUndefined();
	});

	test("other errors still reach the form", async () => {
		const wrong = new ApiError(400, "That username is taken.");
		await expect(saveForm(() => Promise.reject(wrong))).rejects.toBe(wrong);
	});

	test("a save that works goes through once", async () => {
		let calls = 0;
		await saveForm(async () => {
			calls++;
		});
		expect(calls).toBe(1);
	});
});
