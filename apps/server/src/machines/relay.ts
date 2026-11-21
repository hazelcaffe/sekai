import { type Client, createClient, type InputEvent } from "screen-relay";
import { errorMessage } from "../lib/errors.ts";
import { log } from "../lib/log.ts";
import { type SshTarget, sshText, sshTunnel, type Tunnel } from "./ssh.ts";

/**
 * Faster screen control (experimental, Settings → Computers): screen-relay (github.com/vercel-labs/screen-relay)
 * on a bot's Linux computer, attached to its screen, reached through one SSH tunnel. Screenshots and input go
 * through it instead of a helper command over SSH each time (about 34 ms against 250 for a screenshot, 3 against
 * 150 for a click); everything else stays with the helper, and so does anything screen-relay can't do or fails at.
 *
 * Sekai installs it on the computer the first time (Node 22 and a build of its engine, a minute or two, in the
 * background, as the bot's account with its passwordless sudo) and starts it with a token, on loopback only, on
 * port 7700 + the display's number, so a seat on a shared computer gets its own. The token stays on the computer
 * (readable by that account only) and in memory here.
 */

export const RELAY_VERSION = "0.1.2";
const NODE_VERSION = "22.22.0";
export const RELAY_PORT_BASE = 7700;
/** Above this width screenshots get too big for models, so such screens keep the helper. */
export const RELAY_MAX_WIDTH = 1600;
const SETUP_WAIT_MS = 20 * 60_000;
const RETRY_AFTER_MS = 10 * 60_000;
const DIR = "~/.local/share/sekai-relay";

/** Detached on the computer (a dropped connection doesn't stop it); writes the port to `ok`, or `failed`. */
export function relaySetupScript(): string {
	return `#!/usr/bin/env bash
set -euo pipefail
umask 077
D="$HOME/.local/share/sekai-relay"
mkdir -p "$D"
exec >"$D/setup.log" 2>&1
chmod 600 "$D/setup.log"
trap 'touch "$D/failed"' ERR
export PATH="$D/node/bin:$D/npm/bin:$PATH"
need_node() { ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; }
if need_node; then
  case "$(uname -m)" in x86_64) a=x64 ;; aarch64|arm64) a=arm64 ;; *) echo "screen-relay needs x64 or arm64"; false ;; esac
  rm -rf "$D/node" "$D/node-v${NODE_VERSION}-linux-$a"
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-$a.tar.gz" | tar -xz -C "$D"
  mv "$D/node-v${NODE_VERSION}-linux-$a" "$D/node"
fi
if [ "$(screen-relay --version 2>/dev/null || true)" != "${RELAY_VERSION}" ]; then
  npm install --global --prefix "$D/npm" --no-fund --no-audit "screen-relay@${RELAY_VERSION}"
fi
screen-relay install --yes --backend x11 --desktop none >/dev/null
DISPLAY=""
[ -f "/etc/sekai/desktop/$(id -un).env" ] && . "/etc/sekai/desktop/$(id -un).env"
DISPLAY="\${DISPLAY:-:0}"
N="\${DISPLAY#:}"; N="\${N%%.*}"
PORT=$((${RELAY_PORT_BASE} + N))
export DISPLAY XAUTHORITY="\${XAUTHORITY:-$HOME/.Xauthority}"
if ! screen-relay status --name sekai --json 2>/dev/null | grep -q '"state":"ready"'; then
  screen-relay down --name sekai >/dev/null 2>&1 || true
  # --public only turns its token on (it keeps listening on 127.0.0.1). What it prints holds the token (the viewer
  # link): only its messages reach the log, with any token taken out.
  screen-relay up --detach --yes --name sekai --display "$DISPLAY" --port "$PORT" --public https://screen-relay.invalid 2>&1 >/dev/null | sed -E 's/[0-9a-f]{64}/(token)/g'

fi
echo "$PORT" > "$D/ok"
`;
}

/** xdotool's key names (what bots send) in screen-relay's; null when it has no such key. */
export function relayCombo(combo: string): string | null {
	const NAMES: Record<string, string> = {
		page_up: "pageup",
		prior: "pageup",
		page_down: "pagedown",
		next: "pagedown",
		print: "printscreen",
		kp_enter: "numpadenter",
		super_l: "super",
		super_r: "super",
		control_l: "ctrl",
		control_r: "ctrl",
		alt_l: "alt",
		alt_r: "alt",
		shift_l: "shift",
		shift_r: "shift",
		escape: "esc",
		minus: "-",
		plus: "+",
		period: ".",
		comma: ",",
		slash: "/",
		semicolon: ";",
	};
	const parts = combo.split("+").filter(Boolean);
	if (!parts.length || combo.endsWith("++")) return combo === "+" || combo.endsWith("++") ? combo : null;
	const out: string[] = [];
	for (const part of parts) {
		const lower = part.toLowerCase();
		const name = NAMES[lower] ?? (lower === "ctrl" || lower === "control" ? "ctrl" : lower);
		if (name.length === 1) {
			out.push(part.length === 1 ? part : name);
			continue;
		}
		if (
			!/^(ctrl|shift|alt|super|meta|cmd|win|return|enter|esc|backspace|tab|space|delete|insert|home|end|pageup|pagedown|up|down|left|right|menu|printscreen|scrolllock|pause|numpadenter|f([1-9]|1[0-9]|2[0-4]))$/.test(
				name,
			)
		) {
			return null;
		}
		out.push(name);
	}
	return out.join("+");
}

/** A press and release at one point, `count` times (a double click is two). */
export function clickEvents(x: number, y: number, button: 1 | 2 | 3, count: number): InputEvent[] {
	const events: InputEvent[] = [{ type: "pointerMove", x, y }];
	for (let i = 0; i < count; i++) {
		events.push({ type: "buttonDown", button, x, y }, { type: "buttonUp", button, x, y });
	}
	return events;
}

/** Press, a few moves on the way (apps that watch the pointer see a drag), release. */
export function dragEvents(x1: number, y1: number, x2: number, y2: number): InputEvent[] {
	const events: InputEvent[] = [
		{ type: "pointerMove", x: x1, y: y1 },
		{ type: "buttonDown", button: 1, x: x1, y: y1 },
	];
	for (let i = 1; i <= 8; i++) {
		events.push({ type: "pointerMove", x: x1 + ((x2 - x1) * i) / 8, y: y1 + ((y2 - y1) * i) / 8 });
	}
	events.push({ type: "buttonUp", button: 1, x: x2, y: y2 });
	return events;
}

const links = new Set<ScreenRelay>();

/** screen-relay on one seat's screen: set up in the background on first use, then used while it works. */
export class ScreenRelay {
	private state: "off" | "setting-up" | "ready" | "failed" | "unsuitable" = "off";
	private failedAt = 0;
	private client: Client | null = null;
	private tunnel: Tunnel | null = null;
	private size = { width: 0, height: 0 };

	constructor(
		private readonly target: SshTarget,
		private readonly label: string,
	) {
		links.add(this);
	}

	/** Usable now. Otherwise it starts setting it up (in the background) and says no meanwhile. */
	ready(): boolean {
		if (this.state === "ready") return true;
		if (this.state === "setting-up" || this.state === "unsuitable") return false;
		if (this.state === "failed" && Date.now() - this.failedAt < RETRY_AFTER_MS) return false;
		this.state = "setting-up";
		void this.bringUp();
		return false;
	}

	/** The screen's real size. */
	get screen(): { width: number; height: number } {
		return this.size;
	}

	/** Runs a call through it; a failure (other than another controller holding input) puts it aside for a while. */
	async call<T>(fn: (client: Client) => Promise<T>): Promise<T> {
		if (!this.client) throw new Error("screen-relay isn't connected");
		try {
			return await fn(this.client);
		} catch (err) {
			const reason = (err as { reason?: string }).reason;
			if (reason !== "busy" && reason !== "unsupported_input" && reason !== "invalid_input") this.fail(err);
			throw err;
		}
	}

	/** Coordinates as fractions of the screen (what screen-relay takes), from real pixels. */
	fraction(x: number, y: number): { x: number; y: number } {
		const clamp = (v: number) => Math.min(0.9999, Math.max(0, v));
		return { x: clamp(x / this.size.width), y: clamp(y / this.size.height) };
	}

	close(): void {
		this.tunnel?.close();
		this.tunnel = null;
		this.client = null;
		this.state = "off";
		links.delete(this);
	}

	private fail(err: unknown): void {
		log.warn(`screen-relay on ${this.label}: ${errorMessage(err).slice(0, 300)}; using the helper for now`);
		this.tunnel?.close();
		this.tunnel = null;
		this.client = null;
		this.state = "failed";
		this.failedAt = Date.now();
	}

	private async bringUp(): Promise<void> {
		try {
			await sshText(
				this.target,
				`mkdir -p ${DIR} && chmod 700 ${DIR} && cat > ${DIR}/setup.sh && rm -f ${DIR}/ok ${DIR}/failed && (setsid nohup bash ${DIR}/setup.sh >/dev/null 2>&1 < /dev/null &)`,
				{ input: relaySetupScript(), timeoutMs: 30_000 },
			);
			const until = Date.now() + SETUP_WAIT_MS;
			let port = 0;
			for (let wait = 1_000; !port; wait = Math.min(wait * 2, 10_000)) {
				if (Date.now() > until) throw new Error("setting it up took too long");
				await Bun.sleep(wait);
				const out = (
					await sshText(
						this.target,
						`cat ${DIR}/ok 2>/dev/null || { test -f ${DIR}/failed && echo FAILED; } || true`,
						{
							timeoutMs: 20_000,
						},
					)
				).trim();
				if (out === "FAILED") {
					const why = await sshText(this.target, `tail -n 5 ${DIR}/setup.log`, { timeoutMs: 20_000 }).catch(
						() => "",
					);
					throw new Error(`setting it up failed: ${why.trim().split("\n").join(" / ").slice(-400)}`);
				}
				port = Number(out) || 0;
			}
			const token = (
				await sshText(this.target, `cat "\${XDG_STATE_HOME:-$HOME/.local/state}/screen-relay/sekai/token"`, {
					timeoutMs: 20_000,
				})
			).trim();
			if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("it has no token");
			const tunnel = await sshTunnel(this.target, port);
			const client = createClient({ url: `http://127.0.0.1:${tunnel.localPort}`, token, timeout: 15_000 });
			try {
				const caps = await client.capabilities();
				if (caps.width > RELAY_MAX_WIDTH) {
					tunnel.close();
					this.state = "unsuitable";
					log.info(`screen-relay on ${this.label}: the screen is ${caps.width} wide; keeping the helper`);
					return;
				}
				await client.screenshot();
				this.size = { width: caps.width, height: caps.height };
			} catch (err) {
				tunnel.close();
				throw err;
			}
			this.tunnel = tunnel;
			this.client = client;
			this.state = "ready";
			log.info(`screen-relay on ${this.label}: ready (${this.size.width}x${this.size.height})`);
		} catch (err) {
			this.fail(err);
		}
	}
}

/** Closes every tunnel (on shutdown). */
export function closeRelays(): void {
	for (const link of [...links]) link.close();
}
