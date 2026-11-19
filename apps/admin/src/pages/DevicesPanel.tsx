import { api, qk, timeAgo } from "@sekai/client";
import type { ApiTokenInfo, CreatedApiToken, SessionInfo } from "@sekai/shared";
import {
	Badge,
	Button,
	Callout,
	Confirm,
	Dialog,
	EmptyState,
	Field,
	Input,
	Section,
	SettingsPanel,
	Spinner,
} from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Check,
	Copy,
	Globe,
	KeyRound,
	Laptop,
	MonitorSmartphone,
	Plus,
	Smartphone,
	TerminalSquare,
	TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/** "Chrome on Mac", "Sekai desktop app on Windows", "Safari on iPhone"… */
export function describeAgent(ua: string | null): { label: string; phone: boolean } {
	if (!ua) return { label: "Unknown device", phone: false };
	const os = /iPhone/.test(ua)
		? "iPhone"
		: /iPad/.test(ua)
			? "iPad"
			: /Android/.test(ua)
				? "Android"
				: /Mac OS X/.test(ua)
					? "Mac"
					: /Windows/.test(ua)
						? "Windows"
						: /CrOS/.test(ua)
							? "ChromeOS"
							: /Linux/.test(ua)
								? "Linux"
								: null;
	const app = /SekaiApp\//.test(ua)
		? "Sekai app"
		: /Electron|Sekai\//.test(ua)
			? "Sekai desktop app"
			: /Edg\//.test(ua)
				? "Edge"
				: /Firefox\//.test(ua)
					? "Firefox"
					: /Chrome\//.test(ua)
						? "Chrome"
						: /Safari\//.test(ua)
							? "Safari"
							: /curl|bun|node/i.test(ua)
								? "A script"
								: "A browser";
	return { label: os ? `${app} on ${os}` : app, phone: /iPhone|Android.*Mobile|SekaiApp\//.test(ua) };
}

function Sessions() {
	const qc = useQueryClient();
	const list = useQuery({ queryKey: qk.sessions, queryFn: api.auth.sessions });
	const refresh = () => void qc.invalidateQueries({ queryKey: qk.sessions });
	const revoke = useMutation({ mutationFn: (id: string) => api.auth.revokeSession(id), onSuccess: refresh });
	const others = useMutation({
		mutationFn: () => api.auth.revokeOtherSessions(),
		onSuccess: () => {
			refresh();
			toast.success("Signed out everywhere else");
		},
	});
	const sessions = list.data ?? [];
	return (
		<Section
			title="Signed in"
			icon={<MonitorSmartphone />}
			description="Browsers and devices with Sekai open. Sessions last 30 days after their last use."
			action={
				sessions.length > 1 && (
					<Button variant="secondary" size="sm" onClick={() => others.mutate()} disabled={others.isPending}>
						Sign out others
					</Button>
				)
			}
		>
			{list.isLoading ? (
				<Spinner />
			) : (
				<div className="divide-y divide-border rounded-2xl border border-border bg-card">
					{sessions.map((s: SessionInfo) => {
						const d = describeAgent(s.userAgent);
						return (
							<div key={s.id} className="flex items-center gap-3 px-4 py-3">
								<span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-[18px]">
									{d.phone ? <Smartphone /> : <Laptop />}
								</span>
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-1.5">
										<span className="truncate text-sm font-medium">{d.label}</span>
										{s.current && <Badge tone="brand">This device</Badge>}
									</div>
									<div className="truncate text-xs text-fg-subtle">
										{s.current ? "Active now" : `Active ${timeAgo(s.lastSeenAt)}`}
										{s.ip ? ` · ${s.ip}` : ""} · signed in with{" "}
										{s.method === "app" ? "the app, through the browser" : s.method}
									</div>
								</div>
								{!s.current && (
									<Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)}>
										Sign out
									</Button>
								)}
							</div>
						);
					})}
				</div>
			)}
		</Section>
	);
}

function CopyToken({ token }: { token: CreatedApiToken }) {
	const [copied, setCopied] = useState(false);
	return (
		<div className="flex flex-col gap-3">
			<Callout tone="warning" icon={<TriangleAlert />}>
				Copy it now: you won't see it again. Anyone with it can use Sekai as you.
			</Callout>
			<div className="flex items-center gap-2 rounded-xl bg-muted px-3 py-2.5">
				<code className="min-w-0 flex-1 truncate font-mono text-[13px]">{token.token}</code>
				<Button
					size="xs"
					variant="secondary"
					onClick={() => {
						void navigator.clipboard.writeText(token.token);
						setCopied(true);
					}}
				>
					{copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
				</Button>
			</div>
			<p className="text-xs leading-5 text-fg-subtle">
				Send it as <code className="font-mono">Authorization: Bearer …</code>, or set{" "}
				<code className="font-mono">SEKAI_AUTH_TOKEN</code> for Sekai's scripts.
			</p>
		</div>
	);
}

function TokenRow({ t, onRevoke }: { t: ApiTokenInfo; onRevoke: () => void }) {
	return (
		<div className="flex items-center gap-3 px-4 py-3">
			<span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-[18px]">
				{t.scope === "bridge" ? <Laptop /> : t.scope === "extension" ? <Globe /> : <TerminalSquare />}
			</span>
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm font-medium">{t.name}</div>
				<div className="truncate text-xs text-fg-subtle">
					<code className="font-mono">{t.prefix}…</code> · made {timeAgo(t.createdAt)} ·{" "}
					{t.lastUsedAt ? `used ${timeAgo(t.lastUsedAt)}` : "never used"}
				</div>
			</div>
			<Button variant="danger-ghost" size="sm" onClick={onRevoke}>
				Revoke
			</Button>
		</div>
	);
}

function Tokens() {
	const qc = useQueryClient();
	const list = useQuery({ queryKey: qk.apiTokens, queryFn: api.auth.tokens });
	const [creating, setCreating] = useState(false);
	const [name, setName] = useState("");
	const [created, setCreated] = useState<CreatedApiToken | null>(null);
	const [revoking, setRevoking] = useState<ApiTokenInfo | null>(null);
	const refresh = () => void qc.invalidateQueries({ queryKey: qk.apiTokens });
	const create = useMutation({
		mutationFn: () => api.auth.createToken({ name: name.trim(), scope: "full" }),
		onSuccess: (t) => {
			setCreated(t);
			refresh();
		},
	});
	const revoke = useMutation({ mutationFn: (id: string) => api.auth.revokeToken(id), onSuccess: refresh });
	const desktops = (list.data ?? []).filter((t) => t.scope === "bridge");
	const scripts = (list.data ?? []).filter((t) => t.scope === "full");
	const browsers = (list.data ?? []).filter((t) => t.scope === "extension");
	const close = () => {
		setCreating(false);
		setCreated(null);
		setName("");
	};

	return (
		<>
			<Section
				title="Desktop apps"
				icon={<Laptop />}
				description="Each desktop app lending its computer to your bots has its own token. It can only do that."
			>
				{list.isLoading ? (
					<Spinner />
				) : desktops.length === 0 ? (
					<p className="text-[13px] text-fg-subtle">
						None yet. In the desktop app, open Settings → This computer and turn on lending.
					</p>
				) : (
					<div className="divide-y divide-border rounded-2xl border border-border bg-card">
						{desktops.map((t) => (
							<TokenRow key={t.id} t={t} onRevoke={() => setRevoking(t)} />
						))}
					</div>
				)}
			</Section>
			{browsers.length > 0 && (
				<Section
					title="Browser extensions"
					icon={<Globe />}
					description="Each one can chat with your bots and lend them the tabs you share, nothing else. Make them in Settings → Browser extension."
				>
					<div className="divide-y divide-border rounded-2xl border border-border bg-card">
						{browsers.map((t) => (
							<TokenRow key={t.id} t={t} onRevoke={() => setRevoking(t)} />
						))}
					</div>
				</Section>
			)}
			<Section
				title="API tokens"
				icon={<KeyRound />}
				description="For scripts and other apps that use Sekai's API."
				action={
					<Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
						<Plus /> New token
					</Button>
				}
			>
				{scripts.length === 0 ? (
					<EmptyState
						icon={<TerminalSquare />}
						tone="neutral"
						title="No API tokens"
						description="Make one for a script, like Sekai's own end-to-end tests."
						className="rounded-2xl border border-dashed border-border py-8"
					/>
				) : (
					<div className="divide-y divide-border rounded-2xl border border-border bg-card">
						{scripts.map((t) => (
							<TokenRow key={t.id} t={t} onRevoke={() => setRevoking(t)} />
						))}
					</div>
				)}
			</Section>
			<Dialog
				open={creating}
				onOpenChange={(o) => !o && close()}
				title={created ? "Your new token" : "New API token"}
				icon={<KeyRound />}
				footer={
					created ? (
						<Button variant="primary" onClick={close}>
							Done
						</Button>
					) : (
						<>
							<Button variant="ghost" onClick={close}>
								Cancel
							</Button>
							<Button
								variant="primary"
								disabled={!name.trim() || create.isPending}
								onClick={() => create.mutate()}
							>
								{create.isPending && <Spinner className="text-primary-foreground" />} Create
							</Button>
						</>
					)
				}
			>
				{created ? (
					<CopyToken token={created} />
				) : (
					<Field label="Name" hint="So you know what uses it.">
						<Input
							autoFocus
							value={name}
							placeholder="Discord test script"
							onChange={(e) => setName(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && name.trim() && create.mutate()}
						/>
					</Field>
				)}
			</Dialog>
			<Confirm
				open={revoking !== null}
				onOpenChange={(o) => !o && setRevoking(null)}
				title={`Revoke “${revoking?.name}”?`}
				description={
					revoking?.scope === "bridge"
						? "That desktop app stops lending its computer until you turn lending on there again."
						: revoking?.scope === "extension"
							? "That browser stops chatting and sharing tabs until you connect it again with a new token."
							: "Anything using it stops working right away."
				}
				confirmLabel="Revoke"
				danger
				onConfirm={() => revoking && revoke.mutate(revoking.id)}
			/>
		</>
	);
}

function OtherDevices() {
	return (
		<Section title="Use Sekai elsewhere" icon={<Globe />}>
			<div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-[13px] leading-6">
				<p>
					Open <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{location.origin}</code> on
					your phone, tablet or another computer and sign in. To reach it over your LAN or Tailscale, start
					the server with <code className="rounded bg-muted px-1 font-mono text-xs">SEKAI_HOST=0.0.0.0</code>{" "}
					(or <code className="rounded bg-muted px-1 font-mono text-xs">SEKAI_BIND=0.0.0.0</code> with
					Docker).
				</p>
				<p className="text-fg-subtle">
					For passkeys on other devices, serve Sekai over https, for example with{" "}
					<code className="rounded bg-muted px-1 font-mono text-xs">tailscale serve 7420</code>.
				</p>
			</div>
		</Section>
	);
}

export function DevicesPanel() {
	return (
		<SettingsPanel
			value="devices"
			title="Devices & access"
			description="Where you're signed in, and the tokens that let apps and scripts in."
		>
			<Sessions />
			<Tokens />
			<OtherDevices />
		</SettingsPanel>
	);
}
