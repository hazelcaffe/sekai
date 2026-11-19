import type { MachineBackend } from "@sekai/shared";
import helper from "./sekai-desktop.py" with { type: "text" };
import { shq } from "./ssh.ts";

/**
 * How bots' computers and devboxes are set up. Each is described once (packages, files, steps) as a SetupPlan,
 * then rendered for its backend: cloud-init user-data for a VM (on a NoCloud seed), or a bash script Sekai runs
 * as root over SSH in a container (containers don't run cloud-init).
 */

/** Where setup reports progress and readiness (read by Sekai through the guest agent or SSH). */
export const PROGRESS_FILE = "/var/lib/sekai/progress";
export const READY_FILE = "/var/lib/sekai/ready";
/** Containers: the setup script (deleted when it ends: it holds passwords), its log, and its exit code if it failed. */
export const SETUP_SCRIPT = "/var/lib/sekai/setup.sh";
export const SETUP_LOG = "/var/lib/sekai/setup.log";
export const FAILED_FILE = "/var/lib/sekai/failed";
export const HELPER_PATH = "/usr/local/bin/sekai-desktop";
export const SCREEN = { width: 1440, height: 900 };
/** The bot's desktop: display :0, VNC on 5900. Each account's display is written to /etc/sekai/desktop/<user>.env. */
export const DISPLAY = ":0";
export const VNC_PORT = 5900;

/**
 * Chrome on bots' computers: Sekai signs bots in itself, so Chrome's own password manager (and its breach
 * warnings, which pop up over the page where the bot can't see them), sign-in, sync and nags are off.
 */
export const CHROME_POLICY = {
	PasswordManagerEnabled: false,
	PasswordLeakDetectionEnabled: false,
	AutofillAddressEnabled: false,
	AutofillCreditCardEnabled: false,
	BrowserSignin: 0,
	SyncDisabled: true,
	DefaultBrowserSettingEnabled: false,
	PromotionalTabsEnabled: false,
	MetricsReportingEnabled: false,
	TranslateEnabled: false,
	ShowFullUrlsInAddressBar: true,
};

export interface ProvisionInput {
	hostname: string;
	/** The bot's display name (for the account's full name). */
	displayName: string;
	username: string;
	userPassword: string;
	rootPassword: string;
	/** VNC passwords are at most 8 characters. */
	vncPassword: string;
	publicKey: string;
	tailscaleAuthKey: string;
	timezone: string;
}

export { helper as desktopHelper };

/** A file setup writes. user: owned by the bot's account (written once the account exists). */
export interface SetupFile {
	path: string;
	content: string;
	mode?: string;
	user?: boolean;
}

/** A shell step. The label (if any) is shown as the machine's progress while it runs. */
export interface SetupStep {
	label?: string;
	run: string;
}

export interface SetupPlan {
	backend: MachineBackend;
	hostname: string;
	timezone: string;
	user: { name: string; gecos: string; groups: string[]; password: string; publicKey: string };
	rootPassword: string;
	/** Progress while packages install. */
	installing: string;
	packages: string[];
	/** Packages apt must leave out even when recommended (containers: no display manager). */
	without: string[];
	files: SetupFile[];
	/** Run in order once packages and files are in place. */
	steps: SetupStep[];
}

// ---------------------------------------------------------------- what goes on a machine

const SERVER_PACKAGES = ["curl", "wget", "gnupg", "ca-certificates", "sudo", "git", "unzip"];

const DEVBOX_PACKAGES = [
	...SERVER_PACKAGES,
	"build-essential",
	"jq",
	"python3",
	"python3-venv",
	"openssh-server",
	"locales",
];

const DESKTOP_PACKAGES = [
	"xfce4",
	"xfce4-goodies",
	"dbus-x11",
	"dbus-user-session",
	"x11vnc",
	"xrdp",
	"xorgxrdp",
	"xdotool",
	"wmctrl",
	"xclip",
	"x11-utils",
	"x11-xserver-utils",
	"imagemagick",
	"python3",
	"python3-gi",
	"gir1.2-atspi-2.0",
	"at-spi2-core",
	...SERVER_PACKAGES,
	"fonts-noto",
	"fonts-noto-color-emoji",
];

/** What each backend adds: the guest agent (progress and addresses) on VMs; the virtual screen in containers. */
const BACKEND_PACKAGES: Record<MachineBackend, { computer: string[]; devbox: string[] }> = {
	vm: { computer: ["qemu-guest-agent", "lightdm", "xserver-xorg"], devbox: ["qemu-guest-agent"] },
	lxc: { computer: ["xvfb", "xauth", "openssh-server"], devbox: [] },
};

const sshFiles = (publicKey: string): SetupFile[] => [
	{
		path: "/etc/ssh/sshd_config.d/50-sekai.conf",
		content: "PermitRootLogin prohibit-password\nPasswordAuthentication yes\n",
	},
	{ path: "/root/.ssh/authorized_keys", mode: "0600", content: `${publicKey}\n` },
];

/** VMs report progress through the QEMU guest agent: start it before anything slow. */
const guestAgent = (backend: MachineBackend): SetupStep[] =>
	backend === "vm" ? [{ run: "systemctl start qemu-guest-agent" }] : [];

/**
 * Joining the tailnet. Containers have no /dev/net/tun (the API token can't pass devices through), so Tailscale
 * runs in userspace mode there; it still takes connections to the machine's own ports.
 */
function tailscale(p: ProvisionInput, backend: MachineBackend): SetupStep[] {
	if (!p.tailscaleAuthKey) return [];
	const up = `tailscale up --authkey=${shq(p.tailscaleAuthKey)} --hostname=${shq(p.hostname)}`;
	const install = "curl -fsSL https://tailscale.com/install.sh | sh";
	if (backend === "vm") return [{ label: "Joining your tailnet", run: `${install} && ${up}` }];
	return [
		{
			label: "Joining your tailnet",
			run: [
				install,
				"mkdir -p /etc/systemd/system/tailscaled.service.d",
				"printf '[Service]\\nExecStart=\\nExecStart=/usr/sbin/tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/run/tailscale/tailscaled.sock --tun=userspace-networking\\n' > /etc/systemd/system/tailscaled.service.d/sekai.conf",
				"systemctl daemon-reload",
				"systemctl restart tailscaled",
				up,
			].join(" && "),
		},
	];
}

const xfconf = (channel: string, body: string) =>
	`<?xml version="1.0" encoding="UTF-8"?>\n<channel name="${channel}" version="1.0">\n${body}</channel>\n`;

/** The units behind a desktop. Templates per account, so another account's screen on :N is one more instance. */
const DESKTOP_UNITS = {
	/** VNC on an account's display, as that account (x11vnc's shared memory must belong to the X server's user). */
	vnc: [
		"[Unit]",
		"Description=VNC on %i's desktop (x11vnc)",
		"After=display-manager.service sekai-desktop@%i.service",
		"",
		"[Service]",
		"User=%i",
		"EnvironmentFile=/etc/sekai/desktop/%i.env",
		"ExecStart=/usr/bin/x11vnc -display $DISPLAY -auth /home/%i/.Xauthority -forever -shared -rfbport $VNC_PORT -rfbauth /etc/sekai/vnc/%i.pass -noxdamage -repeat -quiet",
		"Restart=always",
		"RestartSec=3",
		"",
		"[Install]",
		"WantedBy=multi-user.target",
		"",
	].join("\n"),
	/**
	 * A desktop on a virtual screen (containers have no display): Xvfb and XFCE as the account, in a login session
	 * like an autologin's, so it has its runtime folder and D-Bus (XFCE and AT-SPI need them).
	 */
	session: [
		"[Unit]",
		"Description=%i's desktop on a virtual screen (Xvfb and XFCE)",
		"After=systemd-user-sessions.service network.target",
		"",
		"[Service]",
		"User=%i",
		"PAMName=login",
		"EnvironmentFile=/etc/sekai/desktop/%i.env",
		"WorkingDirectory=~",
		"ExecStart=/usr/local/bin/sekai-session",
		"Restart=always",
		"RestartSec=3",
		"",
		"[Install]",
		"WantedBy=multi-user.target",
		"",
	].join("\n"),
	/** Starts Xvfb on $DISPLAY with a private cookie, then XFCE on the account's D-Bus. */
	script: [
		"#!/bin/sh",
		"set -eu",
		'export XAUTHORITY="$HOME/.Xauthority"',
		'export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus"',
		'touch "$XAUTHORITY" && chmod 600 "$XAUTHORITY"',
		'xauth -q remove "$DISPLAY" 2>/dev/null || true',
		'xauth -q add "$DISPLAY" . "$(mcookie)"',
		'Xvfb "$DISPLAY" -screen 0 "$SCREEN"x24 -auth "$XAUTHORITY" -nolisten tcp -dpi 96 -s 0 +extension RANDR &',
		"xvfb=$!",
		"trap 'kill $xvfb 2>/dev/null' EXIT",
		"i=0",
		"until xdpyinfo >/dev/null 2>&1; do",
		"\ti=$((i + 1))",
		'\t[ $i -lt 100 ] || { echo "The virtual screen did not start" >&2; exit 1; }',
		"\tkill -0 $xvfb 2>/dev/null || exit 1",
		"\tsleep 0.1",
		"done",
		"startxfce4",
		"",
	].join("\n"),
};

/**
 * A bot's computer: Debian 13 with XFCE (and xfce-goodies), Google Chrome, the bot's sudo account plus root
 * (random passwords), SSH with the bot's key, VNC on the desktop, RDP (its own session), and Tailscale. The desktop
 * starts by itself and never locks, so the bot (and you, over VNC) always see it. On a VM it's lightdm's
 * autologin on the real screen; in a container, a virtual screen (Xvfb) started by systemd as the bot's account.
 */
export function computerPlan(p: ProvisionInput, backend: MachineBackend): SetupPlan {
	const user = p.username;
	const home = `/home/${user}`;
	const screen = `${SCREEN.width}x${SCREEN.height}`;
	const files: SetupFile[] = [
		{ path: HELPER_PATH, mode: "0755", content: helper },
		{ path: "/etc/opt/chrome/policies/managed/sekai.json", content: `${JSON.stringify(CHROME_POLICY, null, 2)}\n` },
		...sshFiles(p.publicKey),
		{
			// No screensaver or power saving: the bot needs to see its screen.
			path: "/etc/xdg/autostart/sekai-session.desktop",
			content:
				"[Desktop Entry]\nType=Application\nName=Sekai session\nExec=xset s off -dpms s noblank\nX-GNOME-Autostart-enabled=true\n",
		},
		{
			path: `/etc/sekai/desktop/${user}.env`,
			content: `DISPLAY=${DISPLAY}\nSCREEN=${screen}\nVNC_PORT=${VNC_PORT}\n`,
		},
		{ path: "/etc/systemd/system/sekai-vnc@.service", content: DESKTOP_UNITS.vnc },
		{
			path: `${home}/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-session.xml`,
			user: true,
			content: xfconf(
				"xfce4-session",
				'  <property name="general" type="empty">\n    <property name="StartAssistiveTechnologies" type="bool" value="true"/>\n    <property name="LockCommand" type="string" value=""/>\n  </property>\n  <property name="shutdown" type="empty">\n    <property name="LockScreen" type="bool" value="false"/>\n  </property>\n',
			),
		},
		{
			// XFCE's power manager would turn the screen off (and the bot would see black).
			path: `${home}/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-power-manager.xml`,
			user: true,
			content: xfconf(
				"xfce4-power-manager",
				'  <property name="xfce4-power-manager" type="empty">\n    <property name="dpms-enabled" type="bool" value="false"/>\n    <property name="blank-on-ac" type="int" value="0"/>\n    <property name="dpms-on-ac-sleep" type="uint" value="0"/>\n    <property name="dpms-on-ac-off" type="uint" value="0"/>\n    <property name="presentation-mode" type="bool" value="true"/>\n  </property>\n',
			),
		},
		{
			// RDP gives its own session: XFCE on a D-Bus of its own, since the bot's desktop uses the account's.
			path: `${home}/.xsession`,
			user: true,
			content: "unset DBUS_SESSION_BUS_ADDRESS\nexec dbus-run-session -- startxfce4\n",
		},
	];
	if (backend === "vm") {
		files.push(
			{
				path: "/etc/lightdm/lightdm.conf.d/50-sekai.conf",
				// The screen size is set before the session starts, so the desktop fills it.
				content: `[Seat:*]\nautologin-user=${user}\nautologin-user-timeout=0\nautologin-session=xfce\nuser-session=xfce\ndisplay-setup-script=/usr/local/bin/sekai-display-setup\n`,
			},
			{
				path: "/usr/local/bin/sekai-display-setup",
				mode: "0755",
				content: `#!/bin/sh\nxrandr -s ${screen} || true\n`,
			},
		);
	} else {
		files.push(
			{ path: "/etc/systemd/system/sekai-desktop@.service", content: DESKTOP_UNITS.session },
			{ path: "/usr/local/bin/sekai-session", mode: "0755", content: DESKTOP_UNITS.script },
		);
	}
	const vncPass = `/etc/sekai/vnc/${user}.pass`;
	return {
		backend,
		hostname: p.hostname,
		timezone: p.timezone,
		user: {
			name: user,
			gecos: p.displayName,
			groups: ["sudo", "audio", "video", "users", "plugdev"],
			password: p.userPassword,
			publicKey: p.publicKey,
		},
		rootPassword: p.rootPassword,
		installing: "Installing the desktop (takes a few minutes)",
		packages: [...BACKEND_PACKAGES[backend].computer, ...DESKTOP_PACKAGES],
		without: backend === "lxc" ? ["lightdm"] : [],
		files,
		steps: [
			...guestAgent(backend),
			{
				label: "Installing Google Chrome",
				run: "curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb && DEBIAN_FRONTEND=noninteractive apt-get install -y /tmp/chrome.deb && rm -f /tmp/chrome.deb",
			},
			{
				label: "Turning off the screen lock",
				run: "DEBIAN_FRONTEND=noninteractive apt-get purge -y light-locker xfce4-screensaver || true",
			},
			{
				label: "Setting up VNC and RDP",
				run: [
					"install -d -m 755 /etc/sekai/vnc",
					`x11vnc -storepasswd ${shq(p.vncPassword)} ${vncPass} >/dev/null`,
					`chown ${user}:${user} ${vncPass}`,
					`chmod 600 ${vncPass}`,
					"adduser xrdp ssl-cert",
					"systemctl daemon-reload",
					`systemctl enable xrdp sekai-vnc@${user}`,
					"systemctl restart ssh",
				].join(" && "),
			},
			...tailscale(p, backend),
			{ run: `chown -R ${user}:${user} ${home}` },
			{
				label: "Starting the desktop",
				run:
					backend === "vm"
						? `systemctl set-default graphical.target && systemctl restart lightdm && sleep 8 && systemctl start sekai-vnc@${user}`
						: `systemctl enable --now sekai-desktop@${user} && sleep 5 && systemctl start sekai-vnc@${user}`,
			},
		],
	};
}

/** A devbox: Debian 13 for development work, no desktop. The bot's sudo account, SSH with its key, Tailscale. */
export function devboxPlan(p: Omit<ProvisionInput, "vncPassword">, backend: MachineBackend): SetupPlan {
	return {
		backend,
		hostname: p.hostname,
		timezone: p.timezone,
		user: {
			name: p.username,
			gecos: p.displayName,
			groups: ["sudo"],
			password: p.userPassword,
			publicKey: p.publicKey,
		},
		rootPassword: p.rootPassword,
		installing: "Installing tools",
		packages: [...BACKEND_PACKAGES[backend].devbox, ...DEVBOX_PACKAGES],
		without: [],
		files: sshFiles(p.publicKey),
		steps: [
			...guestAgent(backend),
			{ run: "systemctl restart ssh || systemctl restart sshd || true" },
			...tailscale({ ...p, vncPassword: "" }, backend),
		],
	};
}

// ---------------------------------------------------------------- rendering

/**
 * Where cloud-init keeps copies of the user-data (passwords, the tailnet key). They go once setup is done, and
 * cloud-init is turned off: it has nothing left to do (the seed is gone too), and a later run must not miss them.
 */
const CLOUD_INIT_COPIES = [
	"/var/lib/cloud/instance/user-data.txt",
	"/var/lib/cloud/instance/user-data.txt.i",
	"/var/lib/cloud/instance/cloud-config.txt",
	"/var/lib/cloud/instance/obj.pkl",
	"/var/lib/cloud/instance/scripts/runcmd",
	"/run/cloud-init/combined-cloud-config.json",
	"/run/cloud-init/instance-data-sensitive.json",
];

/**
 * cloud-config for a VM. JSON is valid YAML, so it's emitted as JSON. Files owned by the bot's account wait until
 * the account exists (defer).
 */
export function toCloudConfig(plan: SetupPlan): string {
	const step = (s: SetupStep) =>
		s.label ? ["sh", "-c", `echo ${shq(s.label)} > ${PROGRESS_FILE} && ${s.run}`] : ["sh", "-c", s.run];
	const config = {
		hostname: plan.hostname,
		fqdn: plan.hostname,
		manage_etc_hosts: true,
		timezone: plan.timezone,
		users: [
			{
				name: plan.user.name,
				gecos: plan.user.gecos,
				groups: plan.user.groups,
				shell: "/bin/bash",
				sudo: "ALL=(ALL) NOPASSWD:ALL",
				ssh_authorized_keys: [plan.user.publicKey],
			},
		],
		disable_root: false,
		ssh_pwauth: true,
		chpasswd: {
			expire: false,
			users: [
				{ name: "root", password: plan.rootPassword, type: "text" },
				{ name: plan.user.name, password: plan.user.password, type: "text" },
			],
		},
		write_files: plan.files.map((f) => ({
			path: f.path,
			...(f.mode ? { permissions: f.mode } : {}),
			// Big files (the desktop helper) as base64, so nothing in them can trip up YAML.
			...(f.content.length > 4096
				? { encoding: "b64", content: Buffer.from(f.content, "utf8").toString("base64") }
				: { content: f.content }),
			...(f.user ? { owner: `${plan.user.name}:${plan.user.name}`, defer: true } : {}),
		})),
		package_update: true,
		package_upgrade: false,
		packages: plan.packages,
		runcmd: [
			["mkdir", "-p", "/var/lib/sekai"],
			...plan.steps.map(step),
			[
				"sh",
				"-c",
				`touch /etc/cloud/cloud-init.disabled; rm -f ${CLOUD_INIT_COPIES.join(" ")}; date +%s > ${READY_FILE} && echo Ready > ${PROGRESS_FILE}`,
			],
		],
		final_message: "Sekai machine ready after $UPTIME seconds",
	};
	return `#cloud-config\n${JSON.stringify(config, null, 2)}\n`;
}

/**
 * The same setup as a bash script, for containers. Sekai uploads it and starts it detached (systemd-run), then
 * follows PROGRESS_FILE and READY_FILE over SSH; output goes to SETUP_LOG (nothing in it prints a secret), and
 * a failure leaves its exit code in FAILED_FILE. The script deletes itself when it ends, whatever happens.
 */
export function toBashScript(plan: SetupPlan): string {
	const u = plan.user.name;
	const lines = [
		"#!/bin/bash",
		"set -euo pipefail",
		"mkdir -p /var/lib/sekai",
		`exec >>${SETUP_LOG} 2>&1`,
		`trap 'rc=$?; rm -f ${SETUP_SCRIPT}; if [ $rc -ne 0 ]; then echo $rc > ${FAILED_FILE}; fi' EXIT`,
		"export DEBIAN_FRONTEND=noninteractive",
		`progress() { echo "$1" > ${PROGRESS_FILE}; echo "== $1"; }`,
		`progress ${shq(plan.installing)}`,
		`ln -sf ${shq(`/usr/share/zoneinfo/${plan.timezone}`)} /etc/localtime && echo ${shq(plan.timezone)} > /etc/timezone || true`,
		"apt-get update -qq",
		`apt-get install -y -qq ${[...plan.packages, ...plan.without.map((p) => `${p}-`)].join(" ")}`,
		'progress "Creating the account"',
		// Single-quoted: a bot can rename itself, and "$(…)" in a name must stay text.
		`id ${u} >/dev/null 2>&1 || useradd -m -s /bin/bash -c ${shq(plan.user.gecos)} -G ${plan.user.groups.join(",")} ${u}`,
		`echo ${shq(`${u}:${plan.user.password}`)} | chpasswd`,
		`echo ${shq(`root:${plan.rootPassword}`)} | chpasswd`,
		`echo ${shq(`${u} ALL=(ALL) NOPASSWD:ALL`)} > /etc/sudoers.d/90-sekai`,
		"chmod 440 /etc/sudoers.d/90-sekai",
		`install -d -m 700 -o ${u} -g ${u} /home/${u}/.ssh`,
		`echo ${shq(plan.user.publicKey)} > /home/${u}/.ssh/authorized_keys`,
		`chown ${u}:${u} /home/${u}/.ssh/authorized_keys`,
		`chmod 600 /home/${u}/.ssh/authorized_keys`,
	];
	for (const f of plan.files) {
		const dir = f.path.slice(0, f.path.lastIndexOf("/")) || "/";
		// mkdir leaves folders that exist alone (the bot's home stays private).
		lines.push(`mkdir -p ${shq(dir)}`);
		if (dir.endsWith("/.ssh")) lines.push(`chmod 700 ${shq(dir)}`);
		lines.push(
			`base64 -d > ${shq(f.path)} <<'SEKAI_FILE'`,
			...(Buffer.from(f.content, "utf8")
				.toString("base64")
				.match(/.{1,76}/g) ?? []),
			"SEKAI_FILE",
		);
		if (f.mode) lines.push(`chmod ${f.mode} ${shq(f.path)}`);
		if (f.user) lines.push(`chown ${u}:${u} ${shq(f.path)}`);
	}
	for (const s of plan.steps) {
		if (s.label) lines.push(`progress ${shq(s.label)}`);
		// set -e doesn't stop at a failure inside an && chain: stop here explicitly.
		lines.push(/\|\| true$/.test(s.run) ? s.run : `${s.run} || exit $?`);
	}
	lines.push(`date +%s > ${READY_FILE}`, 'progress "Ready"');
	return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------- another bot's seat on a machine

/** Members' screens start at :10 (VNC 5910, Chrome 9232); shared browsers' Chromes take ports from 9300. */
export const FIRST_MEMBER_DISPLAY = 10;
export const LAST_MEMBER_DISPLAY = 69;

/** Where a member's setup keeps its state (the script, which holds passwords, deletes itself when it ends). */
export const memberDir = (user: string) => `/var/lib/sekai/members/${user}`;

export interface MemberInput {
	username: string;
	/** The bot's display name (the account's full name). */
	displayName: string;
	password: string;
	publicKey: string;
	/** Computers: its own screen. */
	desktop: { display: number; vncPassword: string } | null;
}

/** What a member's screen needs; VMs set up before containers existed have none of the virtual-screen parts. */
const SEAT_PACKAGES = [
	"xvfb",
	"xauth",
	"x11vnc",
	"dbus-user-session",
	"dbus-x11",
	"xdotool",
	"wmctrl",
	"xclip",
	"x11-utils",
	"x11-xserver-utils",
	"imagemagick",
	"python3",
	"python3-gi",
	"gir1.2-atspi-2.0",
	"at-spi2-core",
];

/** The first free display for a new member's screen (null when the machine has no room left). */
export function nextDisplay(taken: Iterable<number>): number | null {
	const used = new Set(taken);
	for (let d = FIRST_MEMBER_DISPLAY; d <= LAST_MEMBER_DISPLAY; d++) if (!used.has(d)) return d;
	return null;
}

/** A username for a new account that nobody on the machine has yet ("smoke", then "smoke-2"…). */
export function uniqueUsername(base: string, taken: Iterable<string>): string {
	const used = new Set(taken);
	if (!used.has(base)) return base;
	for (let i = 2; ; i++) {
		const name = `${base.slice(0, 28).replace(/-+$/, "")}-${i}`;
		if (!used.has(name)) return name;
	}
}

/** Writes a file from base64 (so nothing in it reaches the shell). */
function writeFile(lines: string[], f: SetupFile, user: string): void {
	const dir = f.path.slice(0, f.path.lastIndexOf("/")) || "/";
	lines.push(f.user ? `install -d -o ${user} -g ${user} ${shq(dir)}` : `mkdir -p ${shq(dir)}`);
	lines.push(
		`base64 -d > ${shq(f.path)} <<'SEKAI_FILE'`,
		...(Buffer.from(f.content, "utf8")
			.toString("base64")
			.match(/.{1,76}/g) ?? []),
		"SEKAI_FILE",
	);
	if (f.mode) lines.push(`chmod ${f.mode} ${shq(f.path)}`);
	if (f.user) lines.push(`chown ${user}:${user} ${shq(f.path)}`);
}

/**
 * Sets up another bot's seat on a machine, as root (idempotent, so it can run again after a problem): its account
 * with passwordless sudo and its own key; on a computer also its own screen (Xvfb and XFCE on :N under
 * sekai-desktop@, x11vnc on 5900+N under sekai-vnc@, with its own password), installing what's missing first.
 * Sekai starts it detached and follows the progress and ready files; the log never holds a password.
 */
export function memberSetupScript(p: MemberInput): string {
	const u = p.username;
	if (!/^[a-z][a-z0-9-]{0,31}$/.test(u)) throw new Error(`Not a valid username: ${u}`);
	const dir = memberDir(u);
	const home = `/home/${u}`;
	const lines = [
		"#!/bin/bash",
		"set -euo pipefail",
		`mkdir -p ${dir}`,
		`exec >>${dir}/log 2>&1`,
		`trap 'rc=$?; rm -f ${dir}/setup.sh; if [ $rc -ne 0 ]; then echo $rc > ${dir}/failed; fi' EXIT`,
		`rm -f ${dir}/ready ${dir}/failed`,
		"export DEBIAN_FRONTEND=noninteractive",
		`progress() { echo "$1" > ${dir}/progress; echo "== $1"; }`,
		'progress "Creating the account"',
		`groups=$(for g in ${p.desktop ? "sudo audio video users plugdev" : "sudo"}; do getent group "$g" >/dev/null && printf "%s," "$g"; done; true)`,
		// Single-quoted: a bot can rename itself, and "$(…)" in a name must stay text.
		`id ${u} >/dev/null 2>&1 || useradd -m -s /bin/bash -c ${shq(p.displayName)} -G "\${groups%,}" ${u}`,
		`echo ${shq(`${u}:${p.password}`)} | chpasswd`,
		`echo ${shq(`${u} ALL=(ALL) NOPASSWD:ALL`)} > /etc/sudoers.d/91-sekai-${u}`,
		`chmod 440 /etc/sudoers.d/91-sekai-${u}`,
		`install -d -m 700 -o ${u} -g ${u} ${home}/.ssh`,
		`echo ${shq(p.publicKey)} > ${home}/.ssh/authorized_keys`,
		`chown ${u}:${u} ${home}/.ssh/authorized_keys`,
		`chmod 600 ${home}/.ssh/authorized_keys`,
	];
	if (p.desktop) {
		const { display, vncPassword } = p.desktop;
		const vncPort = VNC_PORT + display;
		const screen = `${SCREEN.width}x${SCREEN.height}`;
		lines.push(
			'progress "Installing what a second screen needs"',
			`missing=$(for p in ${SEAT_PACKAGES.join(" ")}; do dpkg-query -W -f='\${Status}' "$p" 2>/dev/null | grep -q "install ok installed" || printf "%s " "$p"; done)`,
			'if [ -n "$missing" ]; then apt-get update -qq && apt-get install -y -qq --no-install-recommends $missing; fi',
			'progress "Setting up its screen"',
		);
		const files: SetupFile[] = [
			{ path: HELPER_PATH, mode: "0755", content: helper },
			{ path: "/etc/systemd/system/sekai-desktop@.service", content: DESKTOP_UNITS.session },
			{ path: "/etc/systemd/system/sekai-vnc@.service", content: DESKTOP_UNITS.vnc },
			{ path: "/usr/local/bin/sekai-session", mode: "0755", content: DESKTOP_UNITS.script },
			{
				path: `/etc/sekai/desktop/${u}.env`,
				content: `DISPLAY=:${display}\nSCREEN=${screen}\nVNC_PORT=${vncPort}\n`,
			},
			{
				path: `${home}/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-session.xml`,
				user: true,
				content: xfconf(
					"xfce4-session",
					'  <property name="general" type="empty">\n    <property name="StartAssistiveTechnologies" type="bool" value="true"/>\n    <property name="LockCommand" type="string" value=""/>\n  </property>\n  <property name="shutdown" type="empty">\n    <property name="LockScreen" type="bool" value="false"/>\n  </property>\n',
				),
			},
			{
				path: `${home}/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-power-manager.xml`,
				user: true,
				content: xfconf(
					"xfce4-power-manager",
					'  <property name="xfce4-power-manager" type="empty">\n    <property name="dpms-enabled" type="bool" value="false"/>\n    <property name="blank-on-ac" type="int" value="0"/>\n    <property name="dpms-on-ac-sleep" type="uint" value="0"/>\n    <property name="dpms-on-ac-off" type="uint" value="0"/>\n    <property name="presentation-mode" type="bool" value="true"/>\n  </property>\n',
				),
			},
			{
				path: `${home}/.xsession`,
				user: true,
				content: "unset DBUS_SESSION_BUS_ADDRESS\nexec dbus-run-session -- startxfce4\n",
			},
		];
		lines.push(`install -d -o ${u} -g ${u} ${home}/.config ${home}/.config/xfce4 ${home}/.config/xfce4/xfconf`);
		for (const f of files) writeFile(lines, f, u);
		const pass = `/etc/sekai/vnc/${u}.pass`;
		lines.push(
			"install -d -m 755 /etc/sekai/vnc",
			`x11vnc -storepasswd ${shq(vncPassword)} ${pass} >/dev/null 2>&1`,
			`chown ${u}:${u} ${pass}`,
			`chmod 600 ${pass}`,
			// RDP sessions start at :10 too: from now on they start well above members' screens.
			"if [ -f /etc/xrdp/sesman.ini ]; then sed -i 's/^X11DisplayOffset=.*/X11DisplayOffset=200/' /etc/xrdp/sesman.ini; fi",
			"systemctl daemon-reload",
			'progress "Starting its screen"',
			`systemctl enable sekai-desktop@${u} sekai-vnc@${u} >/dev/null 2>&1`,
			`systemctl restart sekai-desktop@${u}`,
			`for i in $(seq 1 60); do runuser -u ${u} -- env DISPLAY=:${display} XAUTHORITY=${home}/.Xauthority xdpyinfo >/dev/null 2>&1 && break; sleep 1; done`,
			`runuser -u ${u} -- env DISPLAY=:${display} XAUTHORITY=${home}/.Xauthority xdpyinfo >/dev/null 2>&1 || { echo "Its screen didn't start"; exit 1; }`,
			`systemctl restart sekai-vnc@${u}`,
		);
	}
	lines.push(`date +%s > ${dir}/ready`, 'progress "Ready"');
	return `${lines.join("\n")}\n`;
}

/** Takes a member's seat off a machine, as root: its screen, processes, account and home, and its files. */
export function memberRemoveScript(username: string, display: number | null = null): string {
	if (!/^[a-z][a-z0-9-]{0,31}$/.test(username)) throw new Error(`Not a valid username: ${username}`);
	if (display !== null && !Number.isInteger(display)) throw new Error("Not a display number");
	const u = username;
	return [
		"#!/bin/bash",
		"set -u",
		`systemctl disable --now sekai-vnc@${u} sekai-desktop@${u} >/dev/null 2>&1 || true`,
		`systemctl reset-failed sekai-vnc@${u} sekai-desktop@${u} >/dev/null 2>&1 || true`,
		`systemctl stop sekai-member-${u} >/dev/null 2>&1 || true`,
		`loginctl terminate-user ${u} >/dev/null 2>&1 || true`,
		`pkill -KILL -u ${u} >/dev/null 2>&1 || true`,
		`for i in 1 2 3 4 5; do id ${u} >/dev/null 2>&1 || break; userdel -r ${u} >/dev/null 2>&1 && break; sleep 1; pkill -KILL -u ${u} >/dev/null 2>&1 || true; done`,
		`if id ${u} >/dev/null 2>&1; then userdel -r -f ${u} >/dev/null 2>&1 || true; fi`,
		`rm -f /etc/sekai/desktop/${u}.env /etc/sekai/vnc/${u}.pass /etc/sudoers.d/91-sekai-${u}`,
		`rm -rf ${memberDir(u)}`,
		// Its screen's lock and socket, so the display is free again.
		...(display !== null ? [`rm -f /tmp/.X${display}-lock /tmp/.X11-unix/X${display}`] : []),
		`if id ${u} >/dev/null 2>&1; then echo "The account ${u} is still there" >&2; exit 1; fi`,
		"echo removed",
		"",
	].join("\n");
}

export const computerUserData = (p: ProvisionInput) => toCloudConfig(computerPlan(p, "vm"));
export const computerSetupScript = (p: ProvisionInput) => toBashScript(computerPlan(p, "lxc"));
export const devboxUserData = (p: Omit<ProvisionInput, "vncPassword">) => toCloudConfig(devboxPlan(p, "vm"));
export const devboxSetupScript = (p: Omit<ProvisionInput, "vncPassword">) => toBashScript(devboxPlan(p, "lxc"));

export function metaData(instanceId: string, hostname: string): string {
	return `instance-id: ${instanceId}\nlocal-hostname: ${hostname}\n`;
}

/** Installs the desktop helper on a machine you added over SSH (no cloud-init there). */
export function installHelperScript(): string {
	return `tmp=$(mktemp) && cat > "$tmp" && { sudo -n install -m 0755 "$tmp" ${HELPER_PATH} 2>/dev/null || { mkdir -p "$HOME/.local/bin" && install -m 0755 "$tmp" "$HOME/.local/bin/sekai-desktop"; }; }; rc=$?; rm -f "$tmp"; exit $rc`;
}
