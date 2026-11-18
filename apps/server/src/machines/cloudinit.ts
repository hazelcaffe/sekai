import helper from "./sekai-desktop.py" with { type: "text" };
import { shq } from "./ssh.ts";

/** Where provisioning reports progress and readiness (read by Sekai through the guest agent or SSH). */
export const PROGRESS_FILE = "/var/lib/sekai/progress";
export const READY_FILE = "/var/lib/sekai/ready";
export const HELPER_PATH = "/usr/local/bin/sekai-desktop";
export const SCREEN = { width: 1440, height: 900 };

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

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");

/** One shell step that also tells Sekai what's happening. */
function step(label: string, command: string): string[] {
	return ["sh", "-c", `echo ${JSON.stringify(label)} > ${PROGRESS_FILE} && ${command}`];
}

/**
 * cloud-config for a bot's computer: Debian 13 with XFCE (and xfce-goodies), Google Chrome, the bot's sudo
 * account plus root (random passwords), SSH with the bot's key, VNC on the real desktop, RDP, and Tailscale.
 * The desktop logs in automatically and never locks, so the bot (and you, over VNC) always see it.
 * JSON is valid YAML, so the config is emitted as JSON.
 */
export function computerUserData(p: ProvisionInput): string {
	const home = `/home/${p.username}`;
	const config = {
		hostname: p.hostname,
		fqdn: p.hostname,
		manage_etc_hosts: true,
		timezone: p.timezone,
		users: [
			{
				name: p.username,
				gecos: p.displayName,
				groups: ["sudo", "audio", "video", "users", "plugdev"],
				shell: "/bin/bash",
				sudo: "ALL=(ALL) NOPASSWD:ALL",
				ssh_authorized_keys: [p.publicKey],
			},
		],
		disable_root: false,
		ssh_pwauth: true,
		chpasswd: {
			expire: false,
			users: [
				{ name: "root", password: p.rootPassword, type: "text" },
				{ name: p.username, password: p.userPassword, type: "text" },
			],
		},
		write_files: [
			{ path: HELPER_PATH, permissions: "0755", encoding: "b64", content: b64(helper) },
			{
				path: "/etc/opt/chrome/policies/managed/sekai.json",
				content: `${JSON.stringify(CHROME_POLICY, null, 2)}\n`,
			},
			{
				path: "/etc/ssh/sshd_config.d/50-sekai.conf",
				content: "PermitRootLogin prohibit-password\nPasswordAuthentication yes\n",
			},
			{
				path: "/root/.ssh/authorized_keys",
				permissions: "0600",
				content: `${p.publicKey}\n`,
			},
			{
				path: "/etc/lightdm/lightdm.conf.d/50-sekai.conf",
				// The screen size is set before the session starts, so the desktop fills it.
				content: `[Seat:*]\nautologin-user=${p.username}\nautologin-user-timeout=0\nautologin-session=xfce\nuser-session=xfce\ndisplay-setup-script=/usr/local/bin/sekai-display-setup\n`,
			},
			{
				path: "/usr/local/bin/sekai-display-setup",
				permissions: "0755",
				content: `#!/bin/sh\nxrandr -s ${SCREEN.width}x${SCREEN.height} || true\n`,
			},
			{
				// No screensaver or power saving: the bot needs to see its screen.
				path: "/etc/xdg/autostart/sekai-session.desktop",
				content:
					"[Desktop Entry]\nType=Application\nName=Sekai session\nExec=xset s off -dpms s noblank\nX-GNOME-Autostart-enabled=true\n",
			},
			{
				path: "/etc/systemd/system/sekai-vnc.service",
				content: [
					"[Unit]",
					"Description=VNC on the bot's desktop (x11vnc)",
					"After=display-manager.service",
					"",
					"[Service]",
					"ExecStart=/usr/bin/x11vnc -display :0 -auth guess -forever -shared -rfbport 5900 -rfbauth /etc/x11vnc.pass -noxdamage -repeat -quiet",
					"Restart=always",
					"RestartSec=3",
					"",
					"[Install]",
					"WantedBy=graphical.target",
					"",
				].join("\n"),
			},
			{
				path: `${home}/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-session.xml`,
				owner: `${p.username}:${p.username}`,
				defer: true,
				content:
					'<?xml version="1.0" encoding="UTF-8"?>\n<channel name="xfce4-session" version="1.0">\n  <property name="general" type="empty">\n    <property name="StartAssistiveTechnologies" type="bool" value="true"/>\n    <property name="LockCommand" type="string" value=""/>\n  </property>\n  <property name="shutdown" type="empty">\n    <property name="LockScreen" type="bool" value="false"/>\n  </property>\n</channel>\n',
			},
			{
				// XFCE's power manager would turn the screen off (and the bot would see black).
				path: `${home}/.config/xfce4/xfconf/xfce-perchannel-xml/xfce4-power-manager.xml`,
				owner: `${p.username}:${p.username}`,
				defer: true,
				content:
					'<?xml version="1.0" encoding="UTF-8"?>\n<channel name="xfce4-power-manager" version="1.0">\n  <property name="xfce4-power-manager" type="empty">\n    <property name="dpms-enabled" type="bool" value="false"/>\n    <property name="blank-on-ac" type="int" value="0"/>\n    <property name="dpms-on-ac-sleep" type="uint" value="0"/>\n    <property name="dpms-on-ac-off" type="uint" value="0"/>\n    <property name="presentation-mode" type="bool" value="true"/>\n  </property>\n</channel>\n',
			},
			{
				path: `${home}/.xsession`,
				owner: `${p.username}:${p.username}`,
				defer: true,
				content: "startxfce4\n",
			},
		],
		package_update: true,
		package_upgrade: false,
		packages: [
			"qemu-guest-agent",
			"xfce4",
			"xfce4-goodies",
			"lightdm",
			"xserver-xorg",
			"dbus-x11",
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
			"curl",
			"wget",
			"gnupg",
			"ca-certificates",
			"sudo",
			"git",
			"unzip",
			"fonts-noto",
			"fonts-noto-color-emoji",
		],
		runcmd: [
			["mkdir", "-p", "/var/lib/sekai"],
			["systemctl", "start", "qemu-guest-agent"],
			step(
				"Installing Google Chrome",
				"curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb && DEBIAN_FRONTEND=noninteractive apt-get install -y /tmp/chrome.deb && rm -f /tmp/chrome.deb",
			),
			step(
				"Turning off the screen lock",
				"DEBIAN_FRONTEND=noninteractive apt-get purge -y light-locker xfce4-screensaver || true",
			),
			step(
				"Setting up VNC and RDP",
				`x11vnc -storepasswd ${JSON.stringify(p.vncPassword)} /etc/x11vnc.pass && chmod 600 /etc/x11vnc.pass && adduser xrdp ssl-cert && systemctl enable xrdp sekai-vnc && systemctl restart ssh`,
			),
			...(p.tailscaleAuthKey
				? [
						step(
							"Joining your tailnet",
							`curl -fsSL https://tailscale.com/install.sh | sh && tailscale up --authkey=${JSON.stringify(p.tailscaleAuthKey)} --hostname=${JSON.stringify(p.hostname)}`,
						),
					]
				: []),
			step(
				"Starting the desktop",
				"systemctl set-default graphical.target && systemctl restart lightdm && sleep 8 && systemctl start sekai-vnc",
			),
			// The setup files hold passwords and the tailnet key: gone once they've done their job.
			[
				"sh",
				"-c",
				`rm -f /var/lib/cloud/instance/user-data.txt /var/lib/cloud/instance/user-data.txt.i /var/lib/cloud/instance/scripts/runcmd; date +%s > ${READY_FILE} && echo Ready > ${PROGRESS_FILE}`,
			],
		],
		final_message: "Sekai computer ready after $UPTIME seconds",
	};
	return `#cloud-config\n${JSON.stringify(config, null, 2)}\n`;
}

export function metaData(instanceId: string, hostname: string): string {
	return `instance-id: ${instanceId}\nlocal-hostname: ${hostname}\n`;
}

/**
 * Devboxes are containers (no cloud-init): Sekai runs this as root over SSH once the container is up.
 * Tailscale uses userspace networking, which works in unprivileged containers without /dev/net/tun.
 */
export function devboxSetupScript(p: Omit<ProvisionInput, "vncPassword">): string {
	const user = p.username;
	const lines = [
		"set -eu",
		"export DEBIAN_FRONTEND=noninteractive",
		"mkdir -p /var/lib/sekai",
		`progress() { echo "$1" > ${PROGRESS_FILE}; }`,
		'progress "Installing tools"',
		"apt-get update -qq",
		"apt-get install -y -qq sudo curl wget git ca-certificates gnupg build-essential unzip jq python3 python3-venv openssh-server locales >/dev/null",
		`ln -sf /usr/share/zoneinfo/${p.timezone} /etc/localtime || true`,
		'progress "Creating the account"',
		// Single-quoted: a bot can rename itself, and "$(…)" in a name must stay text.
		`id ${user} >/dev/null 2>&1 || useradd -m -s /bin/bash -c ${shq(p.displayName)} -G sudo ${user}`,
		`echo ${shq(`${user}:${p.userPassword}`)} | chpasswd`,
		`echo ${shq(`root:${p.rootPassword}`)} | chpasswd`,
		`echo "${user} ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/90-sekai && chmod 440 /etc/sudoers.d/90-sekai`,
		`install -d -m 700 -o ${user} -g ${user} /home/${user}/.ssh`,
		`echo ${JSON.stringify(p.publicKey)} > /home/${user}/.ssh/authorized_keys`,
		`chown ${user}:${user} /home/${user}/.ssh/authorized_keys && chmod 600 /home/${user}/.ssh/authorized_keys`,
		`printf 'PermitRootLogin prohibit-password\\nPasswordAuthentication yes\\n' > /etc/ssh/sshd_config.d/50-sekai.conf`,
		"systemctl restart ssh || systemctl restart sshd || true",
	];
	if (p.tailscaleAuthKey) {
		lines.push(
			'progress "Joining your tailnet"',
			"curl -fsSL https://tailscale.com/install.sh | sh >/dev/null",
			"mkdir -p /etc/systemd/system/tailscaled.service.d",
			"printf '[Service]\\nExecStart=\\nExecStart=/usr/sbin/tailscaled --state=/var/lib/tailscale/tailscaled.state --socket=/run/tailscale/tailscaled.sock --tun=userspace-networking\\n' > /etc/systemd/system/tailscaled.service.d/sekai.conf",
			"systemctl daemon-reload && systemctl restart tailscaled",
			`tailscale up --authkey=${JSON.stringify(p.tailscaleAuthKey)} --hostname=${JSON.stringify(p.hostname)}`,
		);
	}
	lines.push(`date +%s > ${READY_FILE}`, 'progress "Ready"');
	return `${lines.join("\n")}\n`;
}

/** Installs the desktop helper on a machine you added over SSH (no cloud-init there). */
export function installHelperScript(): string {
	return `tmp=$(mktemp) && cat > "$tmp" && { sudo -n install -m 0755 "$tmp" ${HELPER_PATH} 2>/dev/null || { mkdir -p "$HOME/.local/bin" && install -m 0755 "$tmp" "$HOME/.local/bin/sekai-desktop"; }; }; rc=$?; rm -f "$tmp"; exit $rc`;
}
