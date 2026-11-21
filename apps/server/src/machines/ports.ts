import type { Machine, MachinePort, MachinePorts } from "@sekai/shared";
import { badRequest, errorMessage } from "../lib/errors.ts";
import { backendOf, sshTarget } from "./manager.ts";
import { sshText } from "./ssh.ts";

/**
 * Web apps on a bot's computer or devbox, reached over your tailnet (never the internet): at the machine's
 * Tailscale IP and the app's port, or over HTTPS at its tailnet name through `tailscale serve`.
 */

/** One listening TCP socket, from `ss -Hltn(p)`. */
export interface Listening {
	port: number;
	host: string;
	process: string | null;
}

/** Programs that come with the machine (SSH, the desktop, VNC, RDP, Tailscale…), not something a bot started. */
const SYSTEM_PROCESSES = new Set([
	"sshd",
	"sshd-session",
	"tailscaled",
	"systemd-resolve",
	"systemd-resolved",
	"x11vnc",
	"xrdp",
	"xrdp-sesman",
	"cupsd",
	"exim4",
	"master",
	"rpcbind",
	"Xvfb",
	"chrome",
	"chromium",
	"relay-engine",
]);

/**
 * SSH, VNC screens, RDP, screen-relay (faster screen control, 7700 + display) and Chrome's debugging ports (seats'
 * and shared browsers'): never offered as links.
 */
const isSystemPort = (p: number) =>
	p === 22 ||
	p === 3350 ||
	p === 3389 ||
	(p >= 5900 && p < 6000) ||
	(p >= 7700 && p < 7770) ||
	(p >= 9222 && p < 9400);

const isLoopback = (host: string) =>
	host.startsWith("127.") || host === "::1" || host.startsWith("::ffff:127.") || host === "localhost";

export function parseListening(out: string): Listening[] {
	const rows: Listening[] = [];
	for (const line of out.split("\n")) {
		const cols = line.trim().split(/\s+/);
		if (cols.length < 5 || cols[0] !== "LISTEN") continue;
		const local = cols[3] ?? "";
		const at = local.lastIndexOf(":");
		const port = Number(local.slice(at + 1));
		if (at < 0 || !Number.isInteger(port) || port < 1 || port > 65_535) continue;
		const host = local
			.slice(0, at)
			.replace(/^\[|\]$/g, "")
			.replace(/%.*$/, "");
		rows.push({ port, host, process: /users:\(\("([^"]+)"/.exec(line)?.[1] ?? null });
	}
	return rows;
}

/** The machine on the tailnet, from `tailscale status --json` (null when it isn't connected). */
export function parseTailscaleSelf(json: string): MachinePorts["tailscale"] {
	try {
		const s = JSON.parse(json) as { BackendState?: string; Self?: { TailscaleIPs?: string[]; DNSName?: string } };
		if (s.BackendState !== "Running" || !s.Self) return null;
		return {
			ip: s.Self.TailscaleIPs?.find((ip) => ip.includes(".")) ?? null,
			dnsName: s.Self.DNSName?.replace(/\.$/, "") || null,
		};
	} catch {
		return null;
	}
}

export interface Served {
	url: string;
	/** The port its HTTPS link listens on (on the tailnet address). */
	httpsPort: number;
}

/** What `tailscale serve status --json` shares over HTTPS: each local app port, and its link. */
export function parseServe(json: string): { byApp: Map<number, Served>; taken: Set<number> } {
	const byApp = new Map<number, Served>();
	const taken = new Set<number>();
	try {
		const s = JSON.parse(json.trim() || "{}") as {
			TCP?: Record<string, unknown>;
			Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>;
		};
		for (const p of Object.keys(s.TCP ?? {})) taken.add(Number(p));
		for (const [hostPort, web] of Object.entries(s.Web ?? {})) {
			const at = hostPort.lastIndexOf(":");
			const target = /^https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)\/?$/.exec(web.Handlers?.["/"]?.Proxy ?? "");
			if (at < 0 || !target) continue;
			const httpsPort = Number(hostPort.slice(at + 1));
			taken.add(httpsPort);
			byApp.set(Number(target[1]), {
				url: `https://${hostPort.slice(0, at)}${httpsPort === 443 ? "" : `:${httpsPort}`}`,
				httpsPort,
			});
		}
	} catch {}
	return { byApp, taken };
}

/**
 * The port a new HTTPS link listens on: 443 (a link without a port) when it's free, else 8443 and up. Never one an
 * app listens on itself: serve would take it over on the tailnet address.
 */
export function pickHttpsPort(taken: Set<number>): number {
	if (!taken.has(443)) return 443;
	for (let p = 8443; p < 8543; p++) if (!taken.has(p)) return p;
	throw badRequest("This computer already shares a hundred apps over HTTPS. Stop sharing one first.");
}

/**
 * The links for what's listening. A container's Tailscale runs in userspace and hands tailnet connections to
 * the machine's own 127.0.0.1, so apps listening only there are reachable too; on a VM they must listen on
 * 0.0.0.0 (or the Tailscale IP).
 */
export function portsView(
	listening: Listening[],
	tailscale: MachinePorts["tailscale"],
	serve: ReturnType<typeof parseServe>,
	opts: { container: boolean; lan: string | null },
): MachinePorts {
	const apps = new Map<number, { hosts: string[]; process: string | null }>();
	for (const l of listening) {
		if (isSystemPort(l.port) || (l.process && SYSTEM_PROCESSES.has(l.process))) continue;
		const a = apps.get(l.port) ?? { hosts: [], process: l.process };
		a.hosts.push(l.host);
		a.process ??= l.process;
		apps.set(l.port, a);
	}
	const address = tailscale?.ip ?? opts.lan;
	const ports: MachinePort[] = [];
	for (const port of new Set([...apps.keys(), ...serve.byApp.keys()])) {
		const a = apps.get(port);
		const localOnly = Boolean(a?.hosts.every(isLoopback));
		// Something tailscale serve listens on (an HTTPS link) takes that port over on the tailnet address.
		const hijacked = serve.taken.has(port);
		const reachable = a && (!localOnly || (opts.container && Boolean(tailscale?.ip)));
		ports.push({
			port,
			process: a?.process ?? null,
			running: Boolean(a),
			localOnly,
			ipUrl: address && reachable && !hijacked ? `http://${address}:${port}` : null,
			httpsUrl: serve.byApp.get(port)?.url ?? null,
		});
	}
	return { tailscale, ports: ports.sort((x, y) => x.port - y.port) };
}

const MARK = "---sekai-ports---";
/** One round trip: what listens (with the programs when sudo allows), the tailnet, and what serve shares. */
const SCRIPT = [
	"(sudo -n ss -Hltnp 2>/dev/null || ss -Hltn)",
	`echo ${MARK}`,
	"tailscale status --json 2>/dev/null",
	`echo ${MARK}`,
	"sudo -n tailscale serve status --json 2>/dev/null || true",
].join("; ");

/** agentId: the bot whose account it goes in as (its own machine's, or its seat on a shared one). */
async function inspect(m: Machine, agentId: string) {
	if (m.provider === "local") throw badRequest("Programs on your own computer aren't listed here.");
	if (m.status !== "running") throw badRequest(`${m.name} isn't running.`);
	const target = await sshTarget(m, agentId);
	const out = await sshText(target, SCRIPT, { timeoutMs: 20_000 });
	const [ss = "", status = "", served = ""] = out.split(MARK);
	const tailscale = parseTailscaleSelf(status.trim());
	const serve = parseServe(served);
	const listening = parseListening(ss);
	const view = portsView(listening, tailscale, serve, {
		container: backendOf(m) === "lxc",
		lan: m.addresses.lan,
	});
	return { target, view, serve, listening };
}

/** What listens on the machine, and its links on your tailnet. */
export async function machinePorts(m: Machine, agentId = m.agentId): Promise<MachinePorts> {
	return (await inspect(m, agentId)).view;
}

/** Shares an app over HTTPS at the machine's tailnet name (tailscale serve, tailnet only), or stops. */
export async function shareMachinePort(
	m: Machine,
	port: number,
	https: boolean,
	agentId = m.agentId,
): Promise<MachinePorts> {
	const { target, view, serve, listening } = await inspect(m, agentId);
	const current = serve.byApp.get(port);
	if (https === Boolean(current)) return view;
	if (https) {
		if (!view.tailscale?.dnsName)
			throw badRequest(
				`${m.name} isn't on your tailnet. Add a Tailscale auth key in Settings → Network & devices before making it, or join it yourself with tailscale up.`,
			);
		const taken = new Set([...serve.taken, ...listening.map((l) => l.port)]);
		const httpsPort = pickHttpsPort(taken);
		await serveCommand(target, `--https=${httpsPort} http://127.0.0.1:${port}`);
	} else if (current) {
		await serveCommand(target, `--https=${current.httpsPort} off`);
	}
	return (await inspect(m, agentId)).view;
}

/** Runs tailscale serve as root; a tailnet without HTTPS certificates gets told how to turn them on. */
async function serveCommand(target: Awaited<ReturnType<typeof sshTarget>>, args: string): Promise<void> {
	const background = args.endsWith(" off") ? "" : "--bg ";
	try {
		await sshText(target, `sudo -n timeout 45 tailscale serve ${background}${args}`, { timeoutMs: 60_000 });
	} catch (err) {
		const text = errorMessage(err);
		if (/https|cert|not enabled|enable|login\.tailscale\.com/i.test(text) || /Timed out|exit 124/.test(text)) {
			throw badRequest(
				"Tailscale didn't make the HTTPS link. Turn on MagicDNS and HTTPS certificates for your tailnet (Tailscale's admin console → DNS), then try again.",
			);
		}
		throw badRequest(`Tailscale: ${text.split("\n")[0]}`);
	}
}
