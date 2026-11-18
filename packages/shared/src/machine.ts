import { z } from "zod";

/**
 * Machines: a bot's own computer (a Proxmox VM with a desktop), devboxes (temporary Proxmox containers
 * without one), and devices: your own computer, lent to bots through the desktop app. Bots reach VMs and
 * devboxes over SSH with their own key; devices through the desktop app's connection to Sekai.
 */
export const MACHINE_KINDS = ["computer", "devbox", "device"] as const;
export const MachineKind = z.enum(MACHINE_KINDS);
export type MachineKind = z.infer<typeof MachineKind>;

/**
 * proxmox: created and managed by Sekai on your Proxmox server.
 * ssh: a machine you already have, reached over SSH (also how tests and local VMs plug in).
 * local: your own computer, through the Sekai desktop app (only it can add these).
 */
export const MachineProvider = z.enum(["proxmox", "ssh", "local"]);
export type MachineProvider = z.infer<typeof MachineProvider>;

export const MachineStatus = z.enum(["creating", "provisioning", "running", "stopped", "error", "deleting"]);
export type MachineStatus = z.infer<typeof MachineStatus>;

export const MachineSpecs = z.object({
	cores: z.number().int().min(1).max(64),
	memoryMb: z.number().int().min(512).max(262_144),
	/** Ballooning floor: the VM gets between this and memoryMb. 0 turns ballooning off. */
	minMemoryMb: z.number().int().min(0).max(262_144),
	diskGb: z.number().int().min(4).max(4096),
});
export type MachineSpecs = z.infer<typeof MachineSpecs>;

export const DEFAULT_COMPUTER_SPECS: MachineSpecs = { cores: 4, memoryMb: 8192, minMemoryMb: 2048, diskGb: 64 };
export const DEFAULT_DEVBOX_SPECS: MachineSpecs = { cores: 2, memoryMb: 4096, minMemoryMb: 0, diskGb: 32 };

export const Machine = z.object({
	id: z.string(),
	agentId: z.string(),
	kind: MachineKind,
	provider: MachineProvider,
	name: z.string(),
	status: MachineStatus,
	/** What's happening now ("Installing the desktop…") or what went wrong. */
	statusDetail: z.string().nullable(),
	specs: MachineSpecs,
	hostname: z.string(),
	/** The bot's own account (sudo). root also exists. */
	username: z.string(),
	addresses: z.object({ lan: z.string().nullable(), tailscale: z.string().nullable() }),
	/** SSH is always there; VNC and RDP only on computers. */
	ports: z.object({ ssh: z.number().int(), vnc: z.number().int().nullable(), rdp: z.number().int().nullable() }),
	/** Where it lives on the provider, e.g. "pve/105". */
	remoteId: z.string().nullable(),
	/** Devboxes are temporary: they're deleted after this. */
	expiresAt: z.number().nullable(),
	createdBy: z.enum(["user", "agent"]),
	createdAt: z.number(),
	updatedAt: z.number(),
	lastUsedAt: z.number().nullable(),
});
export type Machine = z.infer<typeof Machine>;

export const MachineCreate = z.object({
	agentId: z.string().min(1),
	kind: MachineKind,
	name: z.string().trim().max(60).optional(),
	specs: MachineSpecs.partial().optional(),
	/** Devboxes only: hours until it's deleted. */
	ttlHours: z
		.number()
		.min(0.25)
		.max(24 * 30)
		.optional(),
	provider: MachineProvider.default("proxmox"),
	/** provider "ssh": where it is. */
	ssh: z
		.object({
			host: z.string().min(1),
			port: z.number().int().min(1).max(65_535).default(22),
			username: z.string().min(1),
			vncPort: z.number().int().nullable().default(null),
			rdpPort: z.number().int().nullable().default(null),
		})
		.optional(),
});
export type MachineCreate = z.input<typeof MachineCreate>;

export const MachineUpdate = z
	.object({
		name: z.string().trim().min(1).max(60),
		/** Resizing a running computer restarts it when the change needs that (cores, disk). */
		specs: MachineSpecs.partial(),
		ttlHours: z
			.number()
			.min(0.25)
			.max(24 * 30),
	})
	.partial();
export type MachineUpdate = z.input<typeof MachineUpdate>;

/** How to get in: shown to you in the Computer tab and given to the bot. */
export interface MachineAccess {
	machineId: string;
	username: string;
	userPassword: string;
	rootPassword: string;
	vncPassword: string | null;
	/** The bot's SSH key (the same for all its machines). */
	publicKey: string;
	privateKey: string;
}

// ---------------------------------------------------------------- browser logins

/**
 * A bot that needs to sign in somewhere asks you: you type the username and password into Sekai, they're
 * filled straight into the page, and the bot never sees them.
 */
export interface CredentialRequest {
	id: string;
	agentId: string;
	conversationId: string | null;
	/** The site, e.g. github.com. */
	site: string;
	url: string;
	reason: string;
	fields: ("username" | "password" | "otp")[];
	/** A saved login exists for this site but you asked to be asked. */
	hasSaved: boolean;
	createdAt: number;
	expiresAt: number;
}

export const CredentialAnswer = z.object({
	username: z.string().max(500).default(""),
	password: z.string().max(2000).default(""),
	otp: z.string().max(20).default(""),
	/** Save it (encrypted) so this bot can sign in to this site again without asking. */
	remember: z.boolean().default(false),
	cancel: z.boolean().default(false),
});
export type CredentialAnswer = z.input<typeof CredentialAnswer>;

/** A login a bot may reuse. The password stays on the server, encrypted. */
export interface SavedLogin {
	id: string;
	agentId: string;
	site: string;
	username: string;
	createdAt: number;
	lastUsedAt: number | null;
}

// ---------------------------------------------------------------- your computer (desktop app)

/** What the desktop app lets bots do on this computer. Kept on the computer itself, not on the server. */
export interface LocalComputerSettings {
	enabled: boolean;
	/** Bots allowed to use this computer. */
	agentIds: string[];
	/** Where commands run and files are read and written by default. */
	workdir: string;
	/** Approve every action (click, type, command) on this computer, whatever the approval mode. */
	askEachAction: boolean;
}

/** A saved state of a bot's computer or devbox (a Proxmox snapshot of its disk) to roll back to. */
export interface Checkpoint {
	name: string;
	/** What it was for ("Before sudo apt upgrade", or what you typed). */
	label: string;
	/** Made by Sekai before a risky command (only the latest few are kept). */
	auto: boolean;
	at: number;
	/** snapshot: instant, on the machine's own storage. backup: a full copy (for storage that can't snapshot). */
	kind: "snapshot" | "backup";
	/** Bytes, for backups. */
	size: number | null;
}

export interface CheckpointList {
	/** What a new checkpoint will be on this machine. */
	mode: "snapshot" | "backup";
	checkpoints: Checkpoint[];
}
