import type { MobilePushToken } from "@sekai/shared";
import { requireActorId } from "../auth/actor.ts";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { allPrefs, readPref, writePref } from "../services/prefs.ts";
import { type ApnsEnvironment, sendApns } from "./apns.ts";
import { sendFcm } from "./fcm.ts";
import { mobileSettings, serviceAccount } from "./settings.ts";

/**
 * The phones that get pushes through the iOS and Android apps, each person's own (in their settings, like the
 * browsers that get Web Push). The page registers its app's token once signed in; one person per phone.
 */

interface Device extends MobilePushToken {
	createdAt: number;
}

export const DEVICES = "push.devices";

async function devices(userId: string): Promise<Device[]> {
	return (await readPref<Device[]>(userId, DEVICES)) ?? [];
}

/** Forgets a token wherever it's registered (another person signed in on that phone). */
async function forgetToken(token: string): Promise<void> {
	for (const { userId, value } of await allPrefs<Device[]>(DEVICES)) {
		if (value.some((d) => d.token === token))
			await writePref(
				userId,
				DEVICES,
				value.filter((d) => d.token !== token),
			);
	}
}

export async function addDevice(input: MobilePushToken): Promise<number> {
	const userId = requireActorId();
	await forgetToken(input.token);
	const all = (await devices(userId)).filter((d) => d.token !== input.token).slice(-19);
	all.push({ ...input, createdAt: Date.now() });
	await writePref(userId, DEVICES, all);
	return all.length;
}

export async function removeDevice(token: string): Promise<void> {
	const userId = requireActorId();
	await writePref(
		userId,
		DEVICES,
		(await devices(userId)).filter((d) => d.token !== token),
	);
}

export async function deviceCounts(): Promise<{ android: number; ios: number }> {
	let android = 0;
	let ios = 0;
	for (const { value } of await allPrefs<Device[]>(DEVICES)) {
		for (const d of value) d.provider === "fcm" ? android++ : ios++;
	}
	return { android, ios };
}

/** People with a phone that gets pushes. */
export async function peopleWithDevices(): Promise<string[]> {
	return (await allPrefs<Device[]>(DEVICES)).filter((p) => p.value.length > 0).map((p) => p.userId);
}

export interface MobilePush {
	title: string;
	body: string;
	url: string;
	tag?: string;
	ring?: boolean;
	approval?: { toolCallId: string };
	test?: boolean;
}

/** Sends to someone's phones; returns how many it reached. Tokens the push services say are gone are forgotten. */
export async function pushToDevices(userId: string, push: MobilePush): Promise<number> {
	const all = await devices(userId);
	if (all.length === 0) return 0;
	const s = await mobileSettings();
	const ttlSeconds = push.ring ? 45 : 3600;
	const gone: string[] = [];
	const switched = new Map<string, ApnsEnvironment>();
	let sent = 0;
	await Promise.all(
		all.map(async (d) => {
			try {
				if (d.provider === "fcm") {
					if (!s.firebaseServiceAccount) return;
					const data: Record<string, string> = {
						title: push.title,
						body: push.body,
						url: push.url,
						tag: push.tag ?? "",
						ring: push.ring ? "1" : "",
						toolCallId: push.approval?.toolCallId ?? "",
						test: push.test ? "1" : "",
					};
					const r = await sendFcm(serviceAccount(s.firebaseServiceAccount), d.token, data, {
						ttlSeconds,
						collapseKey: push.tag,
					});
					if (r === "gone") gone.push(d.token);
					else sent++;
					return;
				}
				if (!s.apnsKey || !s.apnsKeyId || !s.apnsTeamId) return;
				const key = { key: s.apnsKey, keyId: s.apnsKeyId, teamId: s.apnsTeamId, bundleId: d.appId };
				const payload = {
					aps: {
						alert: { title: push.title, body: push.body },
						sound: "default",
						...(push.tag ? { "thread-id": push.tag } : {}),
						...(push.approval ? { category: "SEKAI_APPROVAL" } : {}),
						"interruption-level": push.ring ? "time-sensitive" : "active",
					},
					url: push.url,
					tag: push.tag ?? "",
					toolCallId: push.approval?.toolCallId ?? "",
					test: push.test ? "1" : "",
				};
				const opts = { ttlSeconds, collapseId: push.tag };
				const env: ApnsEnvironment = d.environment ?? "production";
				let r = await sendApns(key, env, d.token, payload, opts);
				// Builds signed for development use Apple's sandbox, and the app can't always tell which it is.
				if (r === "wrong_environment") {
					const other: ApnsEnvironment = env === "production" ? "sandbox" : "production";
					r = await sendApns(key, other, d.token, payload, opts);
					if (r === "sent") switched.set(d.token, other);
					if (r === "wrong_environment") r = "gone";
				}
				if (r === "gone") gone.push(d.token);
				else sent++;
			} catch (err) {
				log.warn(`push to ${d.device || d.provider} failed: ${errorMessage(err)}`);
			}
		}),
	);
	if (gone.length || switched.size) {
		const now = await devices(userId);
		await writePref(
			userId,
			DEVICES,
			now
				.filter((d) => !gone.includes(d.token))
				.map((d) => (switched.has(d.token) ? { ...d, environment: switched.get(d.token) } : d)),
		);
	}
	return sent;
}
