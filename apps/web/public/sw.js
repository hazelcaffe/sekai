// Sekai's service worker: makes it installable, opens the app when it's offline (the last copy of the app
// itself, never your data), and shows push notifications when Sekai isn't open.
const SHELL = "sekai-shell-v1";
const ASSETS = "sekai-assets-v1";
const PRECACHE = ["/", "/manifest.webmanifest", "/favicon-32.png", "/favicon-64.png", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches
			.open(SHELL)
			.then((c) => c.addAll(PRECACHE))
			.catch(() => {})
			.then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		(async () => {
			const keep = new Set([SHELL, ASSETS]);
			for (const name of await caches.keys()) if (!keep.has(name)) await caches.delete(name);
			await self.clients.claim();
		})(),
	);
});

// ---------------------------------------------------------------- offline

/** Only the app's own files: the API and other sites always go straight to the network. */
function handled(url, request) {
	if (request.method !== "GET" || url.origin !== self.location.origin) return false;
	return !url.pathname.startsWith("/api/");
}

self.addEventListener("fetch", (event) => {
	const { request } = event;
	const url = new URL(request.url);
	if (!handled(url, request)) return;

	// Pages: the live app when the server answers, the last copy when it doesn't.
	if (request.mode === "navigate") {
		event.respondWith(
			(async () => {
				try {
					const fresh = await fetch(request);
					// Only the app's page becomes the offline copy (not an image or file opened directly).
					if (fresh.ok && (fresh.headers.get("content-type") ?? "").includes("text/html")) {
						const cache = await caches.open(SHELL);
						await cache.put("/", fresh.clone());
					}
					return fresh;
				} catch {
					return (await caches.match("/")) ?? Response.error();
				}
			})(),
		);
		return;
	}

	// Built files have content hashes in their names: once fetched, they never change.
	if (url.pathname.startsWith("/assets/")) {
		event.respondWith(
			(async () => {
				const cached = await caches.match(request);
				if (cached) return cached;
				const fresh = await fetch(request);
				if (fresh.ok) {
					const cache = await caches.open(ASSETS);
					await cache.put(request, fresh.clone());
					// Old builds' files pile up otherwise: keep the newest few hundred.
					const keys = await cache.keys();
					for (const k of keys.slice(0, Math.max(0, keys.length - 300))) await cache.delete(k);
				}
				return fresh;
			})(),
		);
		return;
	}

	// Icons and the manifest: fresh when possible.
	event.respondWith(
		(async () => {
			try {
				const fresh = await fetch(request);
				if (fresh.ok && PRECACHE.includes(url.pathname)) {
					const cache = await caches.open(SHELL);
					await cache.put(request, fresh.clone());
				}
				return fresh;
			} catch {
				return (await caches.match(request)) ?? Response.error();
			}
		})(),
	);
});

// ---------------------------------------------------------------- push

/** Sekai is open and in front: it shows the notification itself. */
async function appInFront() {
	const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
	return windows.some((w) => w.visibilityState === "visible" && w.focused);
}

self.addEventListener("push", (event) => {
	let data = {};
	try {
		data = event.data ? event.data.json() : {};
	} catch {
		data = { title: "Sekai", body: event.data ? event.data.text() : "" };
	}
	event.waitUntil(
		(async () => {
			if (data.test !== true && (await appInFront())) return;
			await self.registration.showNotification(data.title || "Sekai", {
				body: data.body || "",
				icon: "/icon-192.png",
				badge: "/icon-192.png",
				tag: data.tag || undefined,
				renotify: Boolean(data.tag),
				// Approval requests stay until you answer them, like calls.
				requireInteraction: Boolean(data.ring || data.approval),
				vibrate: data.ring ? [400, 200, 400, 200, 400] : [120],
				data: { path: data.url || "/", approval: data.approval || null },
				// Answer right here; where buttons aren't supported, tapping opens the chat as usual.
				actions: data.approval
					? [
							{ action: "approve", title: "Approve" },
							{ action: "deny", title: "Deny" },
						]
					: [],
			});
		})(),
	);
});

/** Approves or denies a request from its notification; says how it went (or opens Sekai when it can't). */
async function answerApproval(notification, approve) {
	const { approval, path } = notification.data || {};
	const title = notification.title;
	try {
		const res = await fetch(`/api/approvals/${encodeURIComponent(approval.toolCallId)}`, {
			method: "POST",
			credentials: "include",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ approve, scope: "once" }),
		});
		if (res.status === 404) {
			await self.registration.showNotification(title, {
				body: "That request was already answered (or timed out).",
				icon: "/icon-192.png",
				badge: "/icon-192.png",
				tag: notification.tag || undefined,
			});
			return;
		}
		if (!res.ok) throw new Error(String(res.status));
		await self.registration.showNotification(approve ? "Approved" : "Denied", {
			body: title,
			icon: "/icon-192.png",
			badge: "/icon-192.png",
			tag: notification.tag || undefined,
			silent: true,
			data: { path },
		});
		// The confirmation goes away by itself.
		await new Promise((r) => setTimeout(r, 4000));
		for (const n of await self.registration.getNotifications({ tag: notification.tag })) n.close();
	} catch {
		// Signed out, offline…: open the chat so it can be answered there.
		await self.clients.openWindow(path || "/");
	}
}

self.addEventListener("notificationclick", (event) => {
	event.notification.close();
	const path = event.notification.data?.path ?? "/";
	if ((event.action === "approve" || event.action === "deny") && event.notification.data?.approval) {
		event.waitUntil(answerApproval(event.notification, event.action === "approve"));
		return;
	}
	event.waitUntil(
		(async () => {
			const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
			const app = windows[0];
			if (app) {
				app.postMessage({ type: "navigate", path });
				return app.focus();
			}
			return self.clients.openWindow(path);
		})(),
	);
});

// The browser replaced the subscription (keys rotated): tell the server about the new one.
self.addEventListener("pushsubscriptionchange", (event) => {
	event.waitUntil(
		(async () => {
			try {
				const res = await fetch("/api/push/key", { credentials: "include" });
				if (!res.ok) return;
				const { publicKey } = await res.json();
				const sub = await self.registration.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: publicKey,
				});
				await fetch("/api/push/subscriptions", {
					method: "POST",
					credentials: "include",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(sub.toJSON()),
				});
			} catch {}
		})(),
	);
});
