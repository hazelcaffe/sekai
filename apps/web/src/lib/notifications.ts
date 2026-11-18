import { api, desktop, mobile } from "@sekai/client";
import type { MobilePushToken } from "@sekai/shared";

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
	return Boolean(desktop || mobile) || "Notification" in window;
}

/** The phone app's answer, kept here since asking it takes a moment (see refreshMobilePermission). */
let mobilePermission: NotificationPermission = "default";

/** Asks the phone app whether it may show notifications (the system settings can change it any time). */
export async function refreshMobilePermission(): Promise<NotificationPermission> {
	if (!mobile) return notificationPermission() as NotificationPermission;
	const p = await mobile.push.permission().catch(() => "prompt" as const);
	mobilePermission = p === "prompt" ? "default" : p;
	return mobilePermission;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
	if (desktop) return "granted";
	if (mobile) return mobilePermission;
	return "Notification" in window ? Notification.permission : "unsupported";
}

export async function requestNotificationPermission(): Promise<boolean> {
	if (desktop) return true;
	if (mobile) {
		mobilePermission = await mobile.push.requestPermission().catch(() => "denied" as const);
		return mobilePermission === "granted";
	}
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
	if (mobile) {
		mobile.notify(title, body, { conversationId, approval: approval ?? null });
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

/**
 * Push needs a service worker and the Push API (on iPhone: only once Sekai is added to the Home Screen), or the
 * phone app (Apple's and Google's push services).
 */
export function pushSupported(): boolean {
	if (mobile) return true;
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
	if (mobile) return pushOn() && (await phoneToken().catch(() => null)) !== null;
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
	if (mobile) return enablePhonePush();
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
	if (mobile) {
		const token = localStorage.getItem(PHONE_TOKEN);
		localStorage.removeItem(PHONE_TOKEN);
		if (token) await api.push.removeDevice(token).catch(() => {});
		await mobile.push.unregister().catch(() => {});
		return;
	}
	const reg = await registration();
	const sub = await reg?.pushManager.getSubscription();
	if (!sub) return;
	await api.push.unsubscribe(sub.endpoint).catch(() => {});
	await sub.unsubscribe();
}

// ---------------------------------------------------------------- the phone apps

const PHONE_TOKEN = "sekai.push.phone";

/** What the app needs from this server for push (Firebase's client settings on Android). */
async function phoneConfig() {
	const config = await api.push.mobile();
	if (mobile?.platform === "android" && !config.fcm)
		throw new Error("Push isn't set up on this server yet. An admin can add Firebase in Admin → Mobile app.");
	if (mobile?.platform === "ios" && !config.apns)
		throw new Error("Push isn't set up on this server yet. An admin can add Apple push in Admin → Mobile app.");
	return { fcm: config.fcm };
}

async function phoneToken(): Promise<MobilePushToken | null> {
	if (!mobile) return null;
	return mobile.push.current(await phoneConfig());
}

async function savePhoneToken(token: MobilePushToken): Promise<void> {
	await api.push.addDevice(token);
	localStorage.setItem(PHONE_TOKEN, token.token);
	localStorage.setItem(PUSH_FLAG, "1");
}

async function enablePhonePush(): Promise<void> {
	if (!mobile) return;
	const config = await phoneConfig();
	await savePhoneToken(await mobile.push.register(config));
	mobilePermission = "granted";
}

/**
 * In the phone app, once signed in: tells the server this phone's push address again (it changes now and then),
 * and whenever the app says it changed.
 */
export function syncPhonePush(): () => void {
	if (!mobile) return () => {};
	void refreshMobilePermission();
	if (pushOn()) {
		void phoneToken()
			.then((token) => (token ? savePhoneToken(token) : undefined))
			.catch(() => {});
	}
	return mobile.push.onToken((token) => {
		if (pushOn()) void savePhoneToken(token).catch(() => {});
	});
}
