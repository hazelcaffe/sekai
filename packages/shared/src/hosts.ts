import { z } from "zod";
import { patchOf } from "./patch.ts";

/** One of your own servers or devices, reached with Sekai's master SSH key (often over your tailnet). */
export interface Host {
	id: string;
	name: string;
	address: string;
	port: number;
	/** The account the master key logs in as; bots you allow get their keys added to it. */
	user: string;
	/** More accounts bots may be let into (root, a service account…), each with the master key installed. */
	accounts: string[];
	source: "manual" | "tailscale";
	tailscaleId: string | null;
	os: string | null;
	description: string;
	createdAt: number;
	updatedAt: number;
}

export interface HostStatus {
	/** null: not checked yet. */
	ok: boolean | null;
	error: string | null;
	checkedAt: number | null;
	/** What the device said about itself (uname). */
	about: string | null;
}

/** A bot allowed onto a host or another bot's machine (its own key is installed there). */
export interface AccessGrant {
	id: string;
	hostId: string | null;
	machineId: string | null;
	agentId: string;
	/** On a host: the account the bot's key is in (null: the host's own account). */
	account: string | null;
	/** user, reviewer, primary, yolo… */
	grantedBy: string;
	reason: string;
	createdAt: number;
}

export type HostWithStatus = Host & {
	/** The host's own account. */
	status: HostStatus;
	/** Each of its other accounts. */
	accountStatus: Record<string, HostStatus>;
	grants: AccessGrant[];
};

/** A Linux, macOS or Windows account name. */
export const AccountName = z
	.string()
	.trim()
	.min(1)
	.max(64)
	.regex(/^[a-z_][\w.$-]*$/i, "A Linux, macOS or Windows account name");

/** What adding an account to a host did: Sekai's key was already there, it was added with sudo, or it's up to you. */
export interface HostAccountResult {
	account: string;
	setup: "ready" | "sudo" | "manual";
	status: HostStatus;
	/** Why it couldn't be set up automatically (manual). */
	note: string | null;
}

export const HostCreate = z.object({
	name: z
		.string()
		.trim()
		.min(1)
		.max(60)
		.regex(/^[\w.-]+$/, "Letters, digits, dots, dashes"),
	address: z.string().trim().min(1).max(255),
	port: z.number().int().min(1).max(65_535).default(22),
	user: AccountName,
	accounts: z.array(AccountName).max(10).default([]),
	source: z.enum(["manual", "tailscale"]).default("manual"),
	tailscaleId: z.string().max(100).nullable().default(null),
	os: z.string().max(60).nullable().default(null),
	description: z.string().max(500).default(""),
});
export type HostCreate = z.input<typeof HostCreate>;
export const HostUpdate = patchOf(HostCreate);
export type HostUpdate = z.input<typeof HostUpdate>;

/** A device on your tailnet (from the Sekai server's own Tailscale). */
export interface TailnetDevice {
	id: string;
	name: string;
	dnsName: string;
	address: string;
	os: string;
	online: boolean;
	lastSeen: string | null;
	/** Already added as a host. */
	hostId: string | null;
	/** Whose it is: a login, or "Tagged" for tagged devices. */
	owner: string | null;
	tags: string[];
	/** One of your bots' own computers or devboxes (managed in Computers). */
	botMachine: { machineId: string; agentId: string; name: string } | null;
	/** From the Tailscale API: when its key expires (null: never, or unknown without the API). */
	keyExpires: string | null;
	updateAvailable: boolean;
	clientVersion: string | null;
}

/** The Sekai server's own place on your tailnet, and what the Tailscale API adds. */
export interface TailscaleOverview {
	/** This server, from its own Tailscale. */
	self: {
		running: boolean;
		error: string | null;
		name: string | null;
		dnsName: string | null;
		address: string | null;
		login: string | null;
		version: string | null;
		tailnet: string | null;
	};
	/** Sekai at an HTTPS address on your tailnet (tailscale serve), needed for push notifications. */
	https: { on: boolean; url: string | null; canServe: boolean; error: string | null };
	/** Sekai at http://<tailnet IP>:<port> (tailnet only; browsers keep the mic, push and passkeys off on http). */
	byIp: { on: boolean; url: string | null };
	api: {
		configured: boolean;
		kind: "token" | "oauth" | null;
		ok: boolean | null;
		error: string | null;
		devices: number | null;
		/** When the access token stops working (OAuth clients don't expire). */
		expires: string | null;
		/** A key that looked like a device auth key was offered as the API key. */
		hint: string | null;
	};
	/** The auth key new bot machines join your tailnet with. */
	authKey: {
		set: boolean;
		/** Only known with the API. */
		expires: string | null;
		expired: boolean;
		revoked: boolean;
		reusable: boolean | null;
	};
	/** Your account on your devices: bots get keys to it there. */
	defaultUser: string;
}

export const TailscaleApiInput = z.union([
	z.object({ token: z.string().trim().min(10).max(200) }),
	z.object({ clientId: z.string().trim().min(4).max(200), clientSecret: z.string().trim().min(10).max(300) }),
]);
export type TailscaleApiInput = z.input<typeof TailscaleApiInput>;

export interface MasterKey {
	publicKey: string;
	fingerprint: string;
	createdAt: number;
}
