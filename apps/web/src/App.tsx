import { queryClient, ReauthHost } from "@sekai/client";
import { parseThemeChoice, resolveTheme, THEME_KEY, Toaster, TooltipProvider } from "@sekai/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { RouterProvider } from "react-router/dom";
import { router } from "./router.tsx";
import { applyTheme, useUi } from "./stores/ui.ts";

export function App() {
	const theme = useUi((s) => s.theme);
	useEffect(() => {
		applyTheme(theme);
		// Changed in another tab: follow it.
		const onStorage = (e: StorageEvent) => {
			if (e.key === THEME_KEY) useUi.getState().setTheme(parseThemeChoice(e.newValue));
		};
		window.addEventListener("storage", onStorage);
		if (theme !== "auto") return () => window.removeEventListener("storage", onStorage);
		const mql = matchMedia("(prefers-color-scheme: dark)");
		const onChange = () => applyTheme("auto");
		mql.addEventListener("change", onChange);
		return () => {
			mql.removeEventListener("change", onChange);
			window.removeEventListener("storage", onStorage);
		};
	}, [theme]);

	return (
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>
				<RouterProvider router={router} />
				<ReauthHost />
				<Toaster position="top-center" theme={theme === "auto" ? "system" : resolveTheme(theme).mode} />
			</TooltipProvider>
		</QueryClientProvider>
	);
}
