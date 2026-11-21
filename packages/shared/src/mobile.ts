import { z } from "zod";

/** The iOS and Android apps' package name and bundle id (people who build their own copy change it). */
export const MOBILE_APP_ID = "io.github.hazelcaffe.sekai";

/** Firebase's client settings for this server's project (Android push); public values, not secrets. */
export interface MobileFcmConfig {
	apiKey: string;
	appId: string;
	projectId: string;
	senderId: string;
}

/** What the apps need to turn push on: Firebase's client settings (null until an admin adds them). */
export interface MobilePushClientConfig {
	fcm: MobileFcmConfig | null;
	apns: boolean;
}

/** A phone's push address, as the app reports it (the page registers it for the signed-in person). */
export const MobilePushToken = z.object({
	provider: z.enum(["fcm", "apns"]),
	token: z
		.string()
		.min(8)
		.max(4096)
		.regex(/^[A-Za-z0-9_:\-.]+$/, "That isn't a push token"),
	/** Apple's push servers to use: development builds get "sandbox". */
	environment: z.enum(["sandbox", "production"]).optional(),
	/** The app's package (Android) or bundle id (iOS). */
	appId: z.string().trim().min(1).max(200),
	/** The phone's name for the device list, e.g. "Pixel 8". */
	device: z.string().trim().max(120).default(""),
});
export type MobilePushToken = z.infer<typeof MobilePushToken>;

/**
 * Settings → Server → Network & devices (Phone notifications): Firebase for Android (the project's google-services.json and a service account key) and
 * Apple push for iOS (a .p8 key with its key and team ids). The service account and the .p8 key are masked when
 * read back.
 */
export const MobilePushSettings = z.object({
	firebaseConfig: z.string().max(50_000).default(""),
	firebaseServiceAccount: z.string().max(50_000).default(""),
	apnsKeyId: z.string().trim().max(20).default(""),
	apnsTeamId: z.string().trim().max(20).default(""),
	apnsBundleId: z.string().trim().max(200).default(MOBILE_APP_ID),
	apnsKey: z.string().max(10_000).default(""),
});
export type MobilePushSettings = z.infer<typeof MobilePushSettings>;

/** Settings → Server → Network & devices, as shown: the settings (secrets masked) and whether each side is ready. */
export interface MobilePushStatus {
	settings: MobilePushSettings;
	android: { ready: boolean; projectId: string | null; problem: string | null };
	ios: { ready: boolean; problem: string | null };
	/** Phones signed up for push, everyone's. */
	devices: { android: number; ios: number };
}
