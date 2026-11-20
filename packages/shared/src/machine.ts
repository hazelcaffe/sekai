import { z } from "zod";
import { patchOf } from "./patch.ts";

/**
 * Machines: a bot's own computer (with a desktop), devboxes (temporary, without one), and devices: your own
 * computer, lent to bots through the desktop app. Computers and devboxes on Proxmox run as a VM or a container.
 * Bots reach them over SSH with their own key; devices through the desktop app's connection to Sekai.
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

/**
 * What a Proxmox machine runs as. vm: a virtual machine, fully separate with its own kernel (Docker-heavy or
 * kernel work). lxc: a container, much lighter and quicker to start, sharing the host's kernel.
 */
export const MACHINE_BACKENDS = ["vm", "lxc"] as const;
export const MachineBackend = z.enum(MACHINE_BACKENDS);
export type MachineBackend = z.infer<typeof MachineBackend>;

export const MachineStatus = z.enum(["creating", "provisioning", "running", "stopped", "error", "deleting"]);
export type MachineStatus = z.infer<typeof MachineStatus>;

export const MachineSpecs = z.object({
	cores: z.number().int().min(1).max(64),
	memoryMb: z.number().int().min(512).max(262_144),
	/** Ballooning floor: the VM gets between this and memoryMb. 0 turns ballooning off (always, for containers). */
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
	/** Proxmox machines: a VM or a container. null for the others. */
	backend: MachineBackend.nullable(),
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
	/**
	 * Its bots (its own and the ones sharing it) may use it when people they're shared with chat with them, not
	 * only in your chats. Off unless you turn it on.
	 */
	shareWithViewers: z.boolean(),
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
	/** provider "proxmox": a VM or a container (without it, the settings' default for the kind). */
	backend: MachineBackend.optional(),
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
		shareWithViewers: z.boolean(),
	})
	.partial();
export type MachineUpdate = z.input<typeof MachineUpdate>;

// ---------------------------------------------------------------- sharing a machine with other bots

/**
 * Other bots can share a bot's computer or devbox. Each gets a seat there: its own account, home folder and SSH
 * key, and on a computer its own screen (a virtual display with its own VNC port and password) and Chrome.
 */
export const MemberStatus = z.enum(["adding", "ready", "error", "removing"]);
export type MemberStatus = z.infer<typeof MemberStatus>;

export interface MachineMember {
	id: string;
	machineId: string;
	agentId: string;
	agentName: string;
	/** Who shared this bot with you (null: it's your own bot). */
	sharedBy: string | null;
	/** False once its owner stops sharing it with you: it can't use the machine until they share it again. */
	available: boolean;
	username: string;
	/** Computers: its screen (display :N), VNC port and Chrome's debugging port. */
	display: number | null;
	vncPort: number | null;
	cdpPort: number | null;
	status: MemberStatus;
	statusDetail: string | null;
	createdAt: number;
	updatedAt: number;
}

export const MemberAdd = z.object({ agentId: z.string().min(1) });
export type MemberAdd = z.input<typeof MemberAdd>;

/** A shared machine as one of its member bots has it: the machine, and the bot's seat there. */
export interface MachineSeat {
	machine: Machine;
	member: MachineMember;
	/** The name of the bot whose machine it is. */
	ownerBot: string;
}

// ---------------------------------------------------------------- shared browsers

/**
 * A browser several bots use. shared: one profile for all (a site one bot signed in to is signed in for the
 * others; each works in its own tab). separate: each bot gets its own profile in it.
 */
export const SIGN_IN_MODES = ["shared", "separate"] as const;
export const SignInMode = z.enum(SIGN_IN_MODES);
export type SignInMode = z.infer<typeof SignInMode>;

export const SharedBrowserInput = z.object({
	name: z.string().trim().min(1).max(60),
	/** One of your computers it runs on (Chrome on that computer's screen); null: on the Sekai server. */
	machineId: z.string().nullable().default(null),
	signIns: SignInMode.default("shared"),
	/** Its bots you own may use it when people they're shared with chat with them. */
	shareWithViewers: z.boolean().default(false),
	agentIds: z.array(z.string().min(1)).max(50).default([]),
});
export type SharedBrowserInput = z.input<typeof SharedBrowserInput>;
export const SharedBrowserUpdate = patchOf(SharedBrowserInput);
export type SharedBrowserUpdate = z.input<typeof SharedBrowserUpdate>;

export interface SharedBrowserMember {
	agentId: string;
	agentName: string;
	/** Who shared this bot with you (null: it's your own bot). */
	sharedBy: string | null;
	/** False once its owner stops sharing it with you. */
	available: boolean;
}

export interface SharedBrowser {
	id: string;
	name: string;
	machineId: string | null;
	/** The computer's name, when it runs on one. */
	machineName: string | null;
	signIns: SignInMode;
	shareWithViewers: boolean;
	members: SharedBrowserMember[];
	createdAt: number;
	updatedAt: number;
}

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

// ---------------------------------------------------------------- web apps on a machine

/**
 * A program listening on a computer or devbox (a dev server, an API…), with its links on your tailnet. Nothing
 * here is on the internet: both links only work from devices on your tailnet.
 */
export interface MachinePort {
	port: number;
	/** The program, when Sekai can tell ("node", "python3"…). */
	process: string | null;
	/** Something listens on it now (false: still shared over HTTPS, but nothing answers). */
	running: boolean;
	/** It only takes connections from inside the machine (127.0.0.1). */
	localOnly: boolean;
	/** http://<Tailscale IP>:<port>, when connections from the tailnet reach it (else null). */
	ipUrl: string | null;
	/** https://<name>.<tailnet>.ts.net[:port], once it's shared over HTTPS (tailscale serve). */
	httpsUrl: string | null;
}

export interface MachinePorts {
	/** The machine on your tailnet (null: it isn't on it). */
	tailscale: { ip: string | null; dnsName: string | null } | null;
	ports: MachinePort[];
}

export const MachinePortShare = z.object({
	port: z.number().int().min(1).max(65_535),
	/** true: share it over HTTPS at its tailnet name; false: stop. */
	https: z.boolean(),
});
export type MachinePortShare = z.input<typeof MachinePortShare>;

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
	/**
	 * It may be remembered for the bot. Not for someone else's bot (or yours in a chat of someone it's shared
	 * with): a bot's saved logins are its owner's.
	 */
	canRemember: boolean;
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
