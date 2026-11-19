import { generateVAPIDKeys, sendNotification, setVapidDetails } from "web-push";
import { actorFor, requireActorId } from "./auth/actor.ts";
import { bus } from "./events/bus.ts";
import { eventVisibleTo } from "./events/scope.ts";
import { errorMessage } from "./lib/errors.ts";
import { log } from "./lib/log.ts";
import { seal, unseal } from "./lib/secrets.ts";
import { peopleWithDevices, pushToDevices } from "./mobile/devices.ts";
import { readKey, writeKey } from "./services/kv.ts";
import { allPrefs, readPref, writePref } from "./services/prefs.ts";

/**
 * Web Push: notifications on your phone or browser even when Sekai isn't open. Each browser that turns it on
 * (Settings → Notifications) gets every notification the app would show its person; the service worker skips them
 * while you're looking at Sekai. Subscriptions are each person's own (in their settings). Phones with the iOS or
 * Android app get the same notifications through Apple's and Google's push services (mobile/devices.ts).
 */

interface Subscription {
	endpoint: string;
	keys: { p256dh: string; auth: string };
	device: string;
	createdAt: number;
}

const VAPID = "push.vapid";
const SUBS = "push";
let ready: Promise<string> | null = null;

/** The server's public key (browsers subscribe with it); made once. */
export function vapidPublicKey(): Promise<string> {
	ready ??= (async () => {
		let v = (await readKey(VAPID)) as { publicKey: string; privateKey: string } | undefined;
		if (!v) {
			const k = generateVAPIDKeys();
			v = { publicKey: k.publicKey, privateKey: seal(k.privateKey) };
			await writeKey(VAPID, v);
		}
		setVapidDetails("mailto:sekai@localhost", v.publicKey, unseal(v.privateKey));
		return v.publicKey;
	})();
	return ready;
}

async function subscriptions(userId: string): Promise<Subscription[]> {
	return (await readPref<Subscription[]>(userId, SUBS)) ?? [];
}

/** Adds this browser for the signed-in person (taking it from anyone else who had it: one person per browser). */
export async function addSubscription(
	sub: { endpoint: string; keys: { p256dh: string; auth: string } },
	device: string,
): Promise<number> {
	const userId = requireActorId();
	await forgetEndpoint(sub.endpoint);
	const all = (await subscriptions(userId)).filter((s) => s.endpoint !== sub.endpoint).slice(-19);
	all.push({ endpoint: sub.endpoint, keys: sub.keys, device: device.slice(0, 200), createdAt: Date.now() });
	await writePref(userId, SUBS, all);
	return all.length;
}

/** Forgets a browser wherever it's subscribed. */
async function forgetEndpoint(endpoint: string): Promise<void> {
	for (const { userId, value } of await allPrefs<Subscription[]>(SUBS)) {
		if (value.some((s) => s.endpoint === endpoint)) {
			await writePref(
				userId,
				SUBS,
				value.filter((s) => s.endpoint !== endpoint),
			);
		}
	}
}

export async function removeSubscription(endpoint: string): Promise<void> {
	const userId = requireActorId();
	await writePref(
		userId,
		SUBS,
		(await subscriptions(userId)).filter((s) => s.endpoint !== endpoint),
	);
}

/** Sends to the signed-in person's browsers and phones. */
export async function pushToMe(payload: PushPayload): Promise<number> {
	const userId = requireActorId();
	const [web, phones] = await Promise.all([pushTo(userId, payload), pushToDevices(userId, payload)]);
	return web + phones;
}

interface PushPayload {
	title: string;
	body: string;
	url: string;
	tag?: string;
	ring?: boolean;
	/** Approve / Deny right on the notification (not for requests that always need you in the app, like root). */
	approval?: { toolCallId: string };
	/** Shown even while Sekai is open (the Send test button). */
	test?: boolean;
}

async function pushTo(userId: string, payload: PushPayload): Promise<number> {
	const all = await subscriptions(userId);
	if (all.length === 0) return 0;
	await vapidPublicKey();
	let sent = 0;
	const gone: string[] = [];
	await Promise.all(
		all.map(async (s) => {
			try {
				await sendNotification(s, JSON.stringify(payload), {
					TTL: payload.ring ? 45 : 3600,
					urgency: payload.ring ? "high" : "normal",
				});
				sent++;
			} catch (err) {
				const status = (err as { statusCode?: number }).statusCode;
				// The browser unsubscribed (or the subscription expired).
				if (status === 404 || status === 410) gone.push(s.endpoint);
				else log.warn(`push failed: ${errorMessage(err)}`);
			}
		}),
	);
	if (gone.length) {
		await writePref(
			userId,
			SUBS,
			(await subscriptions(userId)).filter((s) => !gone.includes(s.endpoint)),
		);
	}
	return sent;
}

/** Every notification the app would show someone also goes to their browsers and phones as a push. */
export function startPush(): () => void {
	return bus.subscribe((ev, audience) => {
		if (ev.type !== "notification") return;
		void (async () => {
			const people = new Set([
				...(await allPrefs<Subscription[]>(SUBS)).map((p) => p.userId),
				...(await peopleWithDevices()),
			]);
			for (const userId of people) {
				const who = await actorFor(userId).catch(() => null);
				if (!who || !(await eventVisibleTo(ev, audience, who))) continue;
				const payload: PushPayload = {
					title: ev.title,
					body: ev.body,
					url: ev.url ?? (ev.conversationId ? `/c/${ev.conversationId}` : "/"),
					// Each request gets its own notification, so answering one doesn't replace another.
					tag: ev.approval ? `approval-${ev.approval.toolCallId}` : (ev.conversationId ?? undefined),
					ring: ev.title.startsWith("📞"),
					...(ev.approval && !ev.approval.alwaysAsk
						? { approval: { toolCallId: ev.approval.toolCallId } }
						: {}),
				};
				await Promise.all([pushTo(userId, payload), pushToDevices(userId, payload)]);
			}
		})().catch((err: unknown) => log.warn(`push failed: ${errorMessage(err)}`));
	});
}
