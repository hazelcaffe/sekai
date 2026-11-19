/**
 * Live test of bots' computers and devboxes on your Proxmox server, through a running Sekai: creates a test
 * bot, gives it a computer and a devbox, checks they work (screen, SSH, browser), then deletes everything.
 * Set up Proxmox in Settings → Computers first.
 *
 *   SEKAI_URL (default http://127.0.0.1:7420), SEKAI_AUTH_TOKEN if your server needs one
 *   SEKAI_E2E_BACKEND=vm or lxc makes both machines VMs or containers (default: the settings' defaults)
 *   SEKAI_E2E_KEEP=1 keeps the bot and its machines afterwards
 *
 *   bun run test:proxmox
 */
import { createApiClient, type Machine } from "@sekai/shared";

const api = createApiClient({
	baseUrl: process.env.SEKAI_URL ?? "http://127.0.0.1:7420",
	getToken: () => process.env.SEKAI_AUTH_TOKEN || null,
});
const KEEP = process.env.SEKAI_E2E_KEEP === "1";
const BACKEND =
	process.env.SEKAI_E2E_BACKEND === "vm" || process.env.SEKAI_E2E_BACKEND === "lxc"
		? process.env.SEKAI_E2E_BACKEND
		: undefined;

let passed = 0;
const failed: string[] = [];
function check(label: string, ok: unknown, detail = "") {
	if (ok) {
		passed++;
		console.log(`  ✓ ${label}`);
	} else {
		failed.push(label);
		// One line per detail (it can hold text from the machine).
		const oneLine = String(detail)
			.replace(/[\r\n]+/g, " ")
			.slice(0, 500);
		console.log(`  ✗ ${label}${oneLine ? `\n      ${oneLine}` : ""}`);
	}
}

async function follow(id: string, minutes: number): Promise<Machine> {
	const end = Date.now() + minutes * 60_000;
	let last = "";
	for (;;) {
		const m = await api.machines.get(id);
		const line = `${m.status}${m.statusDetail ? `: ${m.statusDetail}` : ""}`;
		if (line !== last) console.log(`    ${new Date().toLocaleTimeString()} ${line}`);
		last = line;
		if (m.status === "running" || m.status === "error" || Date.now() > end) return m;
		await Bun.sleep(5000);
	}
}

async function main() {
	const test = await api.machines.testProxmox();
	if (!test.ok) throw new Error(`Proxmox isn't reachable: ${test.error}`);
	console.log(`Proxmox ${test.version}, nodes ${test.nodes.join(", ")}`);
	const agent = await api.agents.create({
		name: `Probe${Math.floor(Math.random() * 900 + 100)}`,
		job: "Proxmox test bot.",
	});
	const made: Machine[] = [];
	try {
		console.log("Computer");
		const computer = await api.machines.create({ agentId: agent.id, kind: "computer", backend: BACKEND });
		made.push(computer);
		const c = await follow(computer.id, 30);
		check("set up and running", c.status === "running", c.statusDetail ?? "");
		check(`runs as ${BACKEND ?? "the default"}`, c.backend && (!BACKEND || c.backend === BACKEND), c.backend ?? "");
		if (c.status === "running") {
			check("has an address", c.addresses.lan || c.addresses.tailscale, JSON.stringify(c.addresses));
			const screen = await fetch(api.machines.screenUrl(c.id));
			const png = new Uint8Array(await screen.arrayBuffer());
			check("screen preview", screen.ok && png.length > 20_000, `${screen.status}, ${png.length} bytes`);
			const access = await api.machines.access(c.id);
			check(
				"passwords and key",
				access.userPassword && access.rootPassword && access.vncPassword && access.privateKey,
			);
			const ws = new WebSocket(api.machines.vncUrl(c.id));
			const vnc = await new Promise<string>((resolve) => {
				ws.binaryType = "arraybuffer";
				ws.onmessage = (e) => resolve(new TextDecoder().decode(e.data as ArrayBuffer).trim());
				ws.onerror = () => resolve("error");
				setTimeout(() => resolve("timeout"), 10_000);
			});
			ws.close();
			check("VNC through Sekai", vnc.startsWith("RFB"), vnc);
		}

		console.log("Devbox");
		const devbox = await api.machines.create({
			agentId: agent.id,
			kind: "devbox",
			backend: BACKEND,
			name: "probe",
			ttlHours: 1,
		});
		made.push(devbox);
		const d = await follow(devbox.id, 15);
		check("set up and running", d.status === "running", d.statusDetail ?? "");
		check(`runs as ${BACKEND ?? "the default"}`, d.backend && (!BACKEND || d.backend === BACKEND), d.backend ?? "");
		check("deleted on its own later", d.expiresAt && d.expiresAt > Date.now());

		if (c.status === "running" || d.status === "running") {
			console.log("The bot using them");
			const conv = await api.agents.directConversation(agent.id);
			await api.conversations.send(conv.id, {
				text: "Run `uname -a && whoami && sudo -n true && echo SUDO_OK` on your devbox, then open https://example.com in your browser and tell me the page's heading. Reply in two short lines.",
			});
			for (let i = 0; i < 180; i++) {
				await Bun.sleep(2000);
				const runs = await api.runs.list({ agentId: agent.id, limit: 1 });
				if (runs[0] && ["done", "error", "cancelled"].includes(runs[0].status)) break;
			}
			const reply = (await api.conversations.messages(conv.id)).findLast((m) => m.sender === "agent");
			const tools = reply?.parts.flatMap((p) => (p.type === "tool" ? [`${p.name}:${p.status}`] : [])) ?? [];
			check(
				"ran a command on the devbox",
				tools.some((t) => t === "run_command:done"),
				tools.join(", "),
			);
			check(
				"used its browser",
				tools.some((t) => t.startsWith("browser_open:done")),
				tools.join(", "),
			);
			const text = reply?.parts.map((p) => (p.type === "text" ? p.text : "")).join("") ?? "";
			check("got the answers", /SUDO_OK|sudo/i.test(text) && /Example Domain/i.test(text), text.slice(0, 300));
		}
	} finally {
		if (!KEEP) {
			for (const m of made)
				await api.machines.delete(m.id).catch((err) => console.log(`  couldn't delete ${m.name}: ${err}`));
			await api.agents.delete(agent.id).catch(() => {});
		}
	}
	console.log(`\n${passed} passed, ${failed.length} failed`);
	process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
