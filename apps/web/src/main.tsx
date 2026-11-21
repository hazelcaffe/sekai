import { applyPlatform } from "@sekai/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { registerServiceWorker } from "./lib/notifications.ts";
import "./index.css";

// A part of the app loaded on demand (the signed-in app after signing in, the remote screen…) that a new build replaced:
// reload, once a minute at most so a real outage can't loop. Here, not in a lazily loaded part, so it's listening
// before the first one is fetched (a sign-in page left open across a deploy).
window.addEventListener("vite:preloadError", (e) => {
	const last = Number(sessionStorage.getItem("sekai.reloadedForBuild") ?? 0);
	if (Date.now() - last < 60_000) return;
	e.preventDefault();
	sessionStorage.setItem("sekai.reloadedForBuild", String(Date.now()));
	location.reload();
});

// <html data-platform> before the first render: the phone apps' platform, or "web" (?platform=ios previews in dev).
applyPlatform({ dev: import.meta.env.DEV });

const root = document.getElementById("root");
if (!root) throw new Error("#root is missing");

createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);

void registerServiceWorker();
