import { api, desktop } from "@sekai/client";

let swRegistration: ServiceWorkerRegistration | null = null;

/** Registers the tiny service worker used for installability and notifications on mobile. */
export async function registerServiceWorker(): Promise<void> {
	if (desktop || !("serviceWorker" in navigator) || !window.isSecureContext) return;
	try {
		swRegistration = await navigator.serviceWorker.register("/sw.js");
		navigator.serviceWorker.addEventListener("message", (e: MessageEvent<{ type?: string; path?: string }>) => {
			if (e.data?.type === "navigate" && e.data.path)
				window.dispatchEvent(new CustomEvent("sekai:navigate", { detail: e.data.path }));
		});
	} catch {
		// Not fatal: notifications fall back to the Notification constructor.
	}
}

export function notificationsSupported(): boolean {
	return Boolean(desktop) || "Notification" in window;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
	if (desktop) return "granted";
	return "Notification" in window ? Notification.permission : "unsupported";
}

export async function requestNotificationPermission(): Promise<boolean> {
	if (desktop) return true;
	if (!("Notification" in window)) return false;
	if (Notification.permission === "granted") return true;
	return (await Notification.requestPermission()) === "granted";
}

/** Shows a system notification when the app isn't in front (desktop app, or browser tab in the background). */
export async function systemNotify(
	title: string,
	body: string,
	conversationId: string | null,
	/** An approval request: the notification gets Approve / Deny (answered by the service worker). */
	approval?: { toolCallId: string; alwaysAsk: boolean },
): Promise<void> {
	if (desktop) {
		desktop.notify(title, body, { conversationId });
		return;
	}
	if (!("Notification" in window) || Notification.permission !== "granted") return;
	const path = conversationId ? `/c/${conversationId}` : "/";
	const actionable = approval && !approval.alwaysAsk;
	const options: NotificationOptions & { actions?: { action: string; title: string }[] } = {
		body,
		icon: "/icon-192.png",
		badge: "/icon-192.png",
		tag: approval ? `approval-${approval.toolCallId}` : (conversationId ?? undefined),
		data: { path, approval: actionable ? { toolCallId: approval.toolCallId } : null },
		...(actionable
			? {
					requireInteraction: true,
					actions: [
						{ action: "approve", title: "Approve" },
						{ action: "deny", title: "Deny" },
					],
				}
			: {}),
	};
	if (swRegistration) {
		await swRegistration.showNotification(title, options);
		return;
	}
	const n = new Notification(title, options);
	n.onclick = () => {
		window.focus();
		window.dispatchEvent(new CustomEvent("sekai:navigate", { detail: path }));
		n.close();
	};
}

// ---------------------------------------------------------------- push

const PUSH_FLAG = "sekai.push";

/** Push needs a service worker and the Push API (on iPhone: only once Sekai is added to the Home Screen). */
export function pushSupported(): boolean {
	return !desktop && "serviceWorker" in navigator && "PushManager" in window && window.isSecureContext;
}

/** Whether this browser gets pushes (so the open app doesn't show the same notification twice). */
export function pushOn(): boolean {
	return localStorage.getItem(PUSH_FLAG) === "1";
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
	if (!pushSupported()) return null;
	return swRegistration ?? (await navigator.serviceWorker.ready.catch(() => null));
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
	const pad = "=".repeat((4 - (base64url.length % 4)) % 4);
	const raw = atob((base64url + pad).replace(/-/g, "+").replace(/_/g, "/"));
	const out = new Uint8Array(new ArrayBuffer(raw.length));
	for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
	return out;
}

/** This browser's push subscription, kept in step with the server. */
export async function pushSubscribed(): Promise<boolean> {
	const reg = await registration();
	const sub = await reg?.pushManager.getSubscription().catch(() => null);
	if (!sub) {
		localStorage.removeItem(PUSH_FLAG);
		return false;
	}
	return pushOn();
}

/** Turns on push for this browser: asks for permission, subscribes, and tells the server. */
export async function enablePush(): Promise<void> {
	if (!(await requestNotificationPermission())) throw new Error("Notifications are blocked for this site");
	const reg = await registration();
	if (!reg) throw new Error("This browser can't get push notifications");
	const { publicKey } = await api.push.key();
	let sub = await reg.pushManager.getSubscription();
	// A subscription made with another server key can't be used: start over.
	const current = sub?.options.applicationServerKey;
	if (
		sub &&
		current &&
		btoa(String.fromCharCode(...new Uint8Array(current))) !== btoa(String.fromCharCode(...keyBytes(publicKey)))
	) {
		await sub.unsubscribe();
		sub = null;
	}
	try {
		sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
	} catch (err) {
		const why = err instanceof Error ? err.message : String(err);
		throw new Error(
			`This browser didn't sign up for push (${why}). Some browsers (like Brave, or private windows) turn push off.`,
		);
	}
	const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
	await api.push.subscribe({ endpoint: json.endpoint, keys: json.keys });
	localStorage.setItem(PUSH_FLAG, "1");
}

export async function disablePush(): Promise<void> {
	localStorage.removeItem(PUSH_FLAG);
	const reg = await registration();
	const sub = await reg?.pushManager.getSubscription();
	if (!sub) return;
	await api.push.unsubscribe(sub.endpoint).catch(() => {});
	await sub.unsubscribe();
}
