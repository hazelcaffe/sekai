import { useAutosave } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { useEffect } from "react";

/** Keep the shared autosave queue. Its mounted flag doesn't reset after a StrictMode remount, so take
 * the displayed result from the write, which also keeps hardware errors and retries local to the field. */
export function useComputerSave<T>(write: (patch: T) => Promise<unknown>) {
	const mutation = useMutation({ mutationFn: ({ patch }: { patch: T }) => write(patch), onError: () => {} });
	const queue = useAutosave((patch: T) => mutation.mutateAsync({ patch }));
	const { isSuccess, reset } = mutation;
	useEffect(() => {
		if (!isSuccess) return;
		const t = setTimeout(reset, 2000);
		return () => clearTimeout(t);
	}, [isSuccess, reset]);
	return {
		save: queue.save,
		retry: queue.retry,
		error: mutation.error,
		status: mutation.isPending
			? ("saving" as const)
			: mutation.isSuccess
				? ("saved" as const)
				: mutation.isError
					? ("error" as const)
					: ("idle" as const),
	};
}
