import { haptic } from "@sekai/client";
import { ApiError } from "@sekai/shared";
import { errorMessage } from "@sekai/ui";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

/** The person closed "Confirm it's you" without confirming: that dialog already asked, so nothing more to say. */
export function cancelledReauth(err: unknown): boolean {
	return err instanceof ApiError && err.code === "reauth_required";
}

/** A failed action's error as a toast, except a cancelled "Confirm it's you". For a mutation's `onError`. */
export function actionError(err: unknown): void {
	if (cancelledReauth(err)) return;
	haptic("error");
	toast.error(errorMessage(err));
}

/**
 * A FormGroup's save. Its error shows under the fields (give the mutation `onError: () => {}` so there's no toast
 * too); a cancelled "Confirm it's you" leaves the form as it was, without an error.
 */
export async function saveForm(save: () => Promise<unknown>): Promise<void> {
	try {
		await save();
	} catch (err) {
		if (!cancelledReauth(err)) throw err;
	}
}

/**
 * Runs `go` (usually a navigation) once the form that just saved has rendered clean. Navigating from the save's own
 * callback would still find its unsaved changes, and the leave guard would ask "Leave without saving?".
 */
export function useAfterSave(): (go: () => void) => void {
	const [next, setNext] = useState<{ go: () => void } | null>(null);
	useEffect(() => {
		if (!next) return;
		setNext(null);
		next.go();
	}, [next]);
	return useCallback((go: () => void) => setNext({ go }), []);
}
