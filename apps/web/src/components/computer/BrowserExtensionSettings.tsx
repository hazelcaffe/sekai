import { api, qk, queryClient, useAuth } from "@sekai/client";
import type { CreatedApiToken } from "@sekai/shared";
import { Button, Callout, Field, Input } from "@sekai/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

/** A dedicated token can chat and connect tabs, but can't change the server or mint other tokens. */
export function BrowserExtensionSettings() {
	const { data: auth } = useAuth();
	const [name, setName] = useState("My browser");
	const [created, setCreated] = useState<CreatedApiToken | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const allowed = !auth?.access || auth.access.admin || auth.access.permissions.includes("browser");
	const tokens = useQuery({ queryKey: qk.apiTokens, queryFn: api.auth.tokens, enabled: allowed });
	async function revoke(id: string) {
		try {
			await api.auth.revokeToken(id);
			if (created?.id === id) setCreated(null);
			await queryClient.invalidateQueries({ queryKey: qk.apiTokens });
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't revoke the token.");
		}
	}
	async function create() {
		setBusy(true);
		setError("");
		try {
			setCreated(await api.extension.createToken(name.trim()));
			await queryClient.invalidateQueries({ queryKey: qk.apiTokens });
		} catch (err) {
			setError(err instanceof Error ? err.message : "Couldn't make a token.");
		} finally {
			setBusy(false);
		}
	}
	if (!allowed) {
		return (
			<Callout title="Not part of your role">
				Using your own browser with bots isn't included in your role. Ask an admin if you'd like it.
			</Callout>
		);
	}
	return (
		<div className="space-y-5">
			<p className="text-sm text-fg-muted">
				Chat in your browser's sidebar and let a bot use the tabs you choose, with your existing sign-ins. Get
				the Sekai extension for Chromium, Firefox or Safari from the{" "}
				<a
					href="https://github.com/hazelcaffe/sekai/releases/latest"
					target="_blank"
					rel="noreferrer"
					className="font-medium text-brand-ink hover:underline"
				>
					latest release
				</a>{" "}
				(or build it with <code className="font-mono text-xs">bun run build:extension</code>), then connect it
				below.
			</p>
			<Callout title="You're in control">
				Only tabs you share are accessible. Actions ask first. Stop sharing or close the panel to end access.
				Safari uses a toolbar popover or companion window instead of a native sidebar.
			</Callout>
			<Field
				label="Server address"
				hint="Paste this into the extension. Use HTTPS except when developing on localhost."
			>
				<Input readOnly value={location.origin} onFocus={(e) => e.currentTarget.select()} />
			</Field>
			{created ? (
				<div className="space-y-3">
					<Field
						label="Browser token (shown once)"
						hint="Paste it into the extension, never a chat. It can access your own chats and approvals, but not server settings. It is saved only in this browser profile, not sync."
					>
						<Input
							readOnly
							type="password"
							value={created.token}
							onFocus={(e) => e.currentTarget.select()}
						/>
					</Field>
					<div className="flex flex-wrap gap-2">
						<Button
							variant="secondary"
							onClick={() =>
								void navigator.clipboard
									.writeText(created.token)
									.catch(() => setError("Select and copy the token from the field above."))
							}
						>
							Copy token
						</Button>
						<Button variant="ghost" onClick={() => void revoke(created.id)}>
							Revoke token
						</Button>
						<Button variant="ghost" onClick={() => setCreated(null)}>
							Done
						</Button>
					</div>
				</div>
			) : (
				<div className="space-y-3">
					<Field label="Browser name">
						<Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
					</Field>
					<Button disabled={busy || !name.trim()} onClick={() => void create()}>
						{busy ? "Making token…" : "Make browser token"}
					</Button>
				</div>
			)}
			{error && (
				<p role="alert" className="text-sm text-danger">
					{error}
				</p>
			)}
			<div className="space-y-2">
				<h3 className="text-sm font-medium">Connected browser tokens</h3>
				{(tokens.data ?? [])
					.filter((t) => t.scope === "extension")
					.map((t) => (
						<div
							key={t.id}
							className="flex items-center justify-between gap-3 rounded-xl border border-border p-3"
						>
							<span className="min-w-0 truncate text-sm">{t.name}</span>
							<Button variant="danger-ghost" size="sm" onClick={() => void revoke(t.id)}>
								Revoke
							</Button>
						</div>
					))}
				{tokens.error && (
					<p role="alert" className="text-sm text-danger">
						{tokens.error.message}
					</p>
				)}
			</div>
			<p className="text-xs text-fg-subtle">
				Disconnect in the extension to remove its saved token. Browser access is never restored automatically.
			</p>
		</div>
	);
}
