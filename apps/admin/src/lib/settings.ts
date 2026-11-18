import { api, qk } from "@sekai/client";
import type { SettingsUpdate } from "@sekai/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/** Saves server settings and shows a quiet "Saved". */
export function useSaveSettings() {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (patch: SettingsUpdate) => api.settings.update(patch),
		onSuccess: (settings) => {
			qc.setQueryData(qk.settings, settings);
			toast.success("Saved", { duration: 1200 });
		},
	});
}
