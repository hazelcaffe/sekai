import { MOBILE_APP_ID, type MobileFcmConfig, MobilePushSettings, type MobilePushStatus } from "@sekai/shared";
import { badRequest } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { seal, unseal } from "../lib/secrets.ts";
import { readKey, writeKey } from "../services/kv.ts";
import { deviceCounts } from "./devices.ts";

/**
 * The phone apps' push (PUT /api/admin/mobile; Settings → Server → Network & devices → Phone notifications):
 * Firebase (Android) and Apple push (iOS). The service account key and the .p8 key are sealed at rest and masked
 * when read back; Firebase's client settings are public and go to the apps.
 */

const KEY = "push.mobile";
const SECRETS = ["firebaseServiceAccount", "apnsKey"] as const;
/** What a masked secret reads as: sending it back keeps the stored one. */
export const MASKED = "••••••••";

type Stored = Partial<MobilePushSettings> & { sealed?: Record<string, string> };

/**
 * A saved key in clear, or empty when it can't be opened (sealed under another secret key, after
 * SEKAI_SECRET_KEY or data/secret.key changed): it reads as missing, so an admin can paste it again.
 */
function open(name: string, sealed: string | undefined): string {
	if (!sealed) return "";
	try {
		return unseal(sealed);
	} catch {
		log.warn(`phone apps: the saved ${name} can't be read with this server's secret key; add it again`);
		return "";
	}
}

export async function mobileSettings(): Promise<MobilePushSettings> {
	const raw = ((await readKey(KEY)) as Stored | undefined) ?? {};
	const value = MobilePushSettings.parse(raw);
	for (const k of SECRETS) value[k] = open(k, raw.sealed?.[k]);
	return value;
}

export async function saveMobileSettings(input: Partial<MobilePushSettings>): Promise<MobilePushStatus> {
	const current = await mobileSettings();
	const next = MobilePushSettings.parse({ ...current, ...input });
	for (const k of SECRETS) if (next[k] === MASKED) next[k] = current[k];
	// Check what was pasted now, so a wrong file is caught here rather than at the first notification.
	if (next.firebaseConfig) firebaseClient(next.firebaseConfig);
	if (next.firebaseServiceAccount) serviceAccount(next.firebaseServiceAccount);
	if (next.apnsKey && !next.apnsKey.includes("BEGIN PRIVATE KEY"))
		throw badRequest("That isn't an Apple push key. Paste the whole .p8 file, BEGIN and END lines included.");
	const sealed: Record<string, string> = {};
	const plain: Record<string, unknown> = { ...next };
	for (const k of SECRETS) {
		if (next[k]) sealed[k] = seal(next[k]);
		delete plain[k];
	}
	await writeKey(KEY, { ...plain, sealed });
	return mobileStatus();
}

/** Firebase's client settings for the app, from the project's google-services.json. Throws when it isn't one. */
export function firebaseClient(json: string, appId = MOBILE_APP_ID): MobileFcmConfig {
	let file: {
		project_info?: { project_id?: string; project_number?: string };
		client?: {
			client_info?: { mobilesdk_app_id?: string; android_client_info?: { package_name?: string } };
			api_key?: { current_key?: string }[];
		}[];
	};
	try {
		file = JSON.parse(json);
	} catch {
		throw badRequest("That isn't a google-services.json file. Download it from your Firebase project's settings.");
	}
	const clients = file.client ?? [];
	const client =
		clients.find((c) => c.client_info?.android_client_info?.package_name === appId) ?? clients[0] ?? null;
	const config = {
		apiKey: client?.api_key?.[0]?.current_key ?? "",
		appId: client?.client_info?.mobilesdk_app_id ?? "",
		projectId: file.project_info?.project_id ?? "",
		senderId: file.project_info?.project_number ?? "",
	};
	if (!config.apiKey || !config.appId || !config.projectId || !config.senderId) {
		throw badRequest(
			`That google-services.json has no Android app. Add one with the package name ${appId} in Firebase, then download it again.`,
		);
	}
	return config;
}

export interface ServiceAccount {
	projectId: string;
	clientEmail: string;
	privateKey: string;
}

/** The Firebase service account key (a JSON file from Project settings → Service accounts). */
export function serviceAccount(json: string): ServiceAccount {
	let file: { type?: string; project_id?: string; client_email?: string; private_key?: string };
	try {
		file = JSON.parse(json);
	} catch {
		throw badRequest(
			"That isn't a service account key. In Firebase, open Service accounts and generate a new key.",
		);
	}
	if (file.type !== "service_account" || !file.project_id || !file.client_email || !file.private_key) {
		throw badRequest(
			"That isn't a service account key. In Firebase, open Service accounts and generate a new key.",
		);
	}
	return { projectId: file.project_id, clientEmail: file.client_email, privateKey: file.private_key };
}

function check<T>(fn: () => T): { value: T | null; problem: string | null } {
	try {
		return { value: fn(), problem: null };
	} catch (err) {
		return { value: null, problem: err instanceof Error ? err.message : String(err) };
	}
}

/** Firebase's client settings for the apps, if Android push is set up. */
export async function fcmClientConfig(): Promise<MobileFcmConfig | null> {
	const s = await mobileSettings();
	if (!s.firebaseConfig || !s.firebaseServiceAccount) return null;
	return check(() => firebaseClient(s.firebaseConfig)).value;
}

export async function apnsReady(): Promise<boolean> {
	const s = await mobileSettings();
	return Boolean(s.apnsKey && s.apnsKeyId && s.apnsTeamId && s.apnsBundleId);
}

export async function mobileStatus(): Promise<MobilePushStatus> {
	const s = await mobileSettings();
	const client = s.firebaseConfig ? check(() => firebaseClient(s.firebaseConfig)) : null;
	const account = s.firebaseServiceAccount ? check(() => serviceAccount(s.firebaseServiceAccount)) : null;
	let androidProblem = client?.problem ?? account?.problem ?? null;
	if (!androidProblem && client?.value && account?.value && client.value.projectId !== account.value.projectId) {
		androidProblem = `The service account is for ${account.value.projectId}, but google-services.json is for ${client.value.projectId}.`;
	}
	const iosMissing = s.apnsKey
		? [!s.apnsKeyId && "the key ID", !s.apnsTeamId && "the team ID", !s.apnsBundleId && "the bundle ID"].filter(
				Boolean,
			)
		: [];
	return {
		settings: {
			...s,
			firebaseServiceAccount: s.firebaseServiceAccount ? MASKED : "",
			apnsKey: s.apnsKey ? MASKED : "",
		},
		android: {
			ready: Boolean(client?.value && account?.value && !androidProblem),
			projectId: client?.value?.projectId ?? null,
			problem: androidProblem,
		},
		ios: {
			ready: Boolean(s.apnsKey) && iosMissing.length === 0,
			problem: iosMissing.length ? `Add ${iosMissing.join(" and ")}.` : null,
		},
		devices: await deviceCounts(),
	};
}
