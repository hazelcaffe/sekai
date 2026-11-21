/** Where you're signed in, and tokens for scripts, for Settings → Sign-in & security. */
import { api, qk, timeAgo } from "@sekai/client";
import type { ApiTokenInfo, CreatedApiToken, SessionInfo } from "@sekai/shared";
import {
	Badge,
	Button,
	Callout,
	Confirm,
	CopyField,
	Dialog,
	EmptyState,
	ErrorState,
	errorMessage,
	Field,
	Fold,
	Input,
	List,
	Row,
	Section,
	SkeletonRows,
	Spinner,
} from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Globe, KeyRound, Laptop, Plus, Smartphone, TerminalSquare, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { actionError, cancelledReauth } from "../../lib/forms.ts";

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

export function Sessions() {
	const qc = useQueryClient();
	const list = useQuery({ queryKey: qk.sessions, queryFn: api.auth.sessions });
	const refresh = () => void qc.invalidateQueries({ queryKey: qk.sessions });
	const [signingOut, setSigningOut] = useState<SessionInfo | "others" | null>(null);
	const revoke = useMutation({
		mutationFn: (id: string) => api.auth.revokeSession(id),
		onSuccess: refresh,
		onError: actionError,
	});
	const others = useMutation({
		mutationFn: () => api.auth.revokeOtherSessions(),
		onSuccess: () => {
			refresh();
			toast.success("Signed out everywhere else");
		},
		onError: actionError,
	});
	const sessions = list.data ?? [];
	return (
		<Section
			id="sessions"
			title="Signed in"
			description="Sessions last 30 days after their last use."
			action={
				sessions.length > 1 ? (
					<Button
						variant="secondary"
						size="sm"
						onClick={() => setSigningOut("others")}
						disabled={others.isPending}
					>
						Sign out others
					</Button>
				) : undefined
			}
		>
			{list.isLoading ? (
				<SkeletonRows count={2} />
			) : list.isError ? (
				<ErrorState size="sm" error={list.error} onRetry={() => void list.refetch()} />
			) : (
				<List>
					{sessions.map((s: SessionInfo) => {
						const d = describeAgent(s.userAgent);
						return (
							<Row
								key={s.id}
								icon={d.phone ? <Smartphone /> : <Laptop />}
								title={d.label}
								subtitle={`${s.current ? "Active now" : `Active ${timeAgo(s.lastSeenAt)}`}${s.ip ? ` · ${s.ip}` : ""} · signed in with ${
									s.method === "app" ? "the app, through the browser" : s.method
								}`}
								badge={s.current ? <Badge tone="brand">This device</Badge> : undefined}
								trailing={
									!s.current ? (
										<Button variant="ghost" size="sm" onClick={() => setSigningOut(s)}>
											Sign out
										</Button>
									) : undefined
								}
							/>
						);
					})}
				</List>
			)}
			<Confirm
				open={signingOut !== null}
				onOpenChange={(o) => !o && setSigningOut(null)}
				title={signingOut === "others" ? "Sign out everywhere else?" : "Sign out this device?"}
				description={
					signingOut === "others"
						? "Every other browser and app. This one stays signed in. API tokens keep working."
						: "That browser or app will need to sign in again. API tokens keep working."
				}
				confirmLabel="Sign out"
				onConfirm={() => {
					if (signingOut === "others") others.mutate();
					else if (signingOut) revoke.mutate(signingOut.id);
				}}
			/>
		</Section>
	);
}

function CopyToken({ token }: { token: CreatedApiToken }) {
	return (
		<div className="flex flex-col gap-3">
			<Callout tone="warning" icon={<TriangleAlert />}>
				Copy it now. You won't see it again. Anyone with it can use Sekai as you.
			</Callout>
			<CopyField label="token" value={token.token} />
			<Fold title="Learn more" variant="link">
				Send it as <code className="font-mono">Authorization: Bearer …</code>, or set{" "}
				<code className="font-mono">SEKAI_AUTH_TOKEN</code> for Sekai's scripts.
			</Fold>
		</div>
	);
}

export function Tokens() {
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
		// Shown in the dialog.
		onError: () => {},
	});
	const revoke = useMutation({
		mutationFn: (id: string) => api.auth.revokeToken(id),
		onSuccess: refresh,
		onError: actionError,
	});
	const desktops = (list.data ?? []).filter((t) => t.scope === "bridge");
	const scripts = (list.data ?? []).filter((t) => t.scope === "full");
	const close = () => {
		setCreating(false);
		setCreated(null);
		setName("");
	};

	return (
		<>
			{desktops.length > 0 && (
				<Section
					title="Desktop apps"
					description="Each app lending its computer has its own token. Revoke it here if you lost the computer."
				>
					<List>
						{desktops.map((t) => (
							<Row
								key={t.id}
								icon={<Laptop />}
								title={t.name}
								subtitle={`${t.prefix}… · made ${timeAgo(t.createdAt)} · ${
									t.lastUsedAt ? `used ${timeAgo(t.lastUsedAt)}` : "never used"
								}`}
								trailing={
									<Button variant="danger-ghost" size="sm" onClick={() => setRevoking(t)}>
										Revoke
									</Button>
								}
							/>
						))}
					</List>
				</Section>
			)}
			<Section
				title="API tokens"
				description="For scripts and other apps that use Sekai as you."
				action={
					<Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
						<Plus /> New token
					</Button>
				}
			>
				{list.isLoading ? (
					<SkeletonRows count={2} />
				) : list.isError ? (
					<ErrorState size="sm" error={list.error} onRetry={() => void list.refetch()} />
				) : scripts.length === 0 ? (
					<EmptyState
						size="sm"
						icon={<TerminalSquare />}
						title="No API tokens"
						description="Make one for a script."
					/>
				) : (
					<List>
						{scripts.map((t) => (
							<Row
								key={t.id}
								icon={<KeyRound />}
								title={t.name}
								subtitle={`${t.prefix}… · made ${timeAgo(t.createdAt)} · ${
									t.lastUsedAt ? `used ${timeAgo(t.lastUsedAt)}` : "never used"
								}`}
								trailing={
									<Button variant="danger-ghost" size="sm" onClick={() => setRevoking(t)}>
										Revoke
									</Button>
								}
							/>
						))}
					</List>
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
								{create.isPending && <Spinner />} Create
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
							placeholder="e.g. Discord test script"
							onChange={(e) => setName(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && name.trim() && create.mutate()}
						/>
					</Field>
				)}
				{create.isError && !cancelledReauth(create.error) && (
					<p role="alert" className="mt-3 text-small text-danger-ink">
						{errorMessage(create.error)}
					</p>
				)}
			</Dialog>
			<Confirm
				open={revoking !== null}
				onOpenChange={(o) => !o && setRevoking(null)}
				title={`Revoke “${revoking?.name}”?`}
				description={
					revoking?.scope === "bridge"
						? "That desktop app stops lending its computer until you turn lending on there again."
						: "Anything using it stops working right away."
				}
				confirmLabel="Revoke"
				danger
				onConfirm={() => revoking && revoke.mutate(revoking.id)}
			/>
		</>
	);
}

export function OtherDevices() {
	return (
		<Section
			title="Another device"
			description="Open this address on your phone, tablet or another computer and sign in."
		>
			<List>
				<Row icon={<Globe />} title="This Sekai" value={location.origin} />
			</List>
			<Fold title="Learn more" variant="link">
				To reach it over your network, start the server with{" "}
				<code className="font-mono">SEKAI_HOST=0.0.0.0</code> (or{" "}
				<code className="font-mono">SEKAI_BIND=0.0.0.0</code> with Docker). Passkeys on other devices need
				https, for example <code className="font-mono">tailscale serve 7420</code>.
			</Fold>
		</Section>
	);
}
