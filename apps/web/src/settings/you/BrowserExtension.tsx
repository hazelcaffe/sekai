import { api, qk, queryClient, timeAgo, useAuth } from "@sekai/client";
import { type CreatedApiToken, SEKAI_RELEASES_URL } from "@sekai/shared";
import {
	Button,
	Callout,
	Confirm,
	EmptyState,
	ErrorState,
	errorMessage,
	Field,
	Fold,
	Input,
	List,
	Page,
	Row,
	Section,
	SkeletonRows,
} from "@sekai/ui";
import { useQuery } from "@tanstack/react-query";
import { Copy, Globe, Puzzle } from "lucide-react";
import { useState } from "react";
import { cancelledReauth } from "../../lib/forms.ts";
import type { SettingsSectionProps } from "../section.ts";

/** A token for the browser extension: chat and the tabs you share, nothing else. */
export function BrowserExtensionSection({ back }: SettingsSectionProps) {
	const { data: auth } = useAuth();
	const allowed = !auth?.access || auth.access.admin || auth.access.permissions.includes("browser");
	return (
		<Page back={back} title="Browser extension" description="Share the tabs you choose, not your whole browser.">
			{!auth ? (
				<SkeletonRows count={3} />
			) : !allowed ? (
				<Callout title="Not part of your role">
					Using your own browser with bots isn't included in your role. Ask an admin if you'd like it.
				</Callout>
			) : (
				<ExtensionBody />
			)}
		</Page>
	);
}

function ExtensionBody() {
	const [name, setName] = useState("My browser");
	const [created, setCreated] = useState<CreatedApiToken | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [revoking, setRevoking] = useState<string | null>(null);
	const [copied, setCopied] = useState<"address" | "token" | null>(null);
	const tokens = useQuery({ queryKey: qk.apiTokens, queryFn: api.auth.tokens });
	const mine = (tokens.data ?? []).filter((t) => t.scope === "extension");
	const copy = async (text: string, which: "address" | "token") => {
		try {
			await navigator.clipboard.writeText(text);
			setCopied(which);
		} catch {
			setError("Couldn't copy it. Select it and copy it by hand.");
		}
	};
	async function revoke(id: string) {
		try {
			await api.auth.revokeToken(id);
			if (created?.id === id) setCreated(null);
			await queryClient.invalidateQueries({ queryKey: qk.apiTokens });
		} catch (err) {
			if (!cancelledReauth(err)) setError(errorMessage(err));
		}
	}
	async function create() {
		setBusy(true);
		setError("");
		try {
			setCreated(await api.extension.createToken(name.trim()));
			await queryClient.invalidateQueries({ queryKey: qk.apiTokens });
		} catch (err) {
			if (!cancelledReauth(err)) setError(errorMessage(err));
		} finally {
			setBusy(false);
		}
	}
	return (
		<>
			<Section title="Get it" description="Chat in the sidebar, and let a bot use the tabs you share.">
				<List>
					<Row
						icon={<Puzzle />}
						title="Sekai extension"
						subtitle="Chromium, Firefox or Safari."
						trailing={
							<Button
								variant="secondary"
								size="sm"
								onClick={() => window.open(`${SEKAI_RELEASES_URL}/latest`, "_blank", "noreferrer")}
							>
								Get it
							</Button>
						}
					/>
				</List>
				<Fold title="Learn more" variant="link">
					Only tabs you share are accessible, and actions ask first. Close the panel to end access. Safari
					uses a toolbar popover instead of a sidebar. To build it yourself, run{" "}
					<code className="font-mono">bun run build:extension</code>.
				</Fold>
			</Section>
			<Section title="Connect" description="Paste the address and a token into the extension.">
				<Field
					label="Server address"
					action={
						<button
							type="button"
							className="text-small font-medium text-brand-ink hover:underline coarse:py-1"
							onClick={() => void copy(location.origin, "address")}
						>
							{copied === "address" ? "Copied" : "Copy"}
						</button>
					}
				>
					<Input readOnly value={location.origin} onFocus={(e) => e.currentTarget.select()} />
				</Field>
				{created ? (
					<div className="flex flex-col gap-3">
						<Callout tone="warning" title="Shown once">
							Paste it into the extension, never a chat. It can reach your chats, not the server's
							settings.
						</Callout>
						<Field
							label="Browser token"
							action={
								<button
									type="button"
									className="inline-flex items-center gap-1 text-small font-medium text-brand-ink hover:underline coarse:py-1"
									onClick={() => void copy(created.token, "token")}
								>
									<Copy className="size-3.5" /> {copied === "token" ? "Copied" : "Copy"}
								</button>
							}
						>
							<Input
								readOnly
								type="password"
								value={created.token}
								onFocus={(e) => e.currentTarget.select()}
							/>
						</Field>
						<div className="flex flex-wrap gap-2">
							<Button variant="ghost" onClick={() => setRevoking(created.id)}>
								Revoke token
							</Button>
							<Button variant="ghost" onClick={() => setCreated(null)}>
								Done
							</Button>
						</div>
					</div>
				) : (
					<div className="flex flex-col gap-3">
						<Field label="Browser name" hint="So you know which one this token is for.">
							<Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
						</Field>
						<Button disabled={busy || !name.trim()} loading={busy} onClick={() => void create()}>
							Make a token
						</Button>
					</div>
				)}
				{error && (
					<p role="alert" className="text-small text-danger-ink">
						{error}
					</p>
				)}
			</Section>
			<Section title="Tokens" description="Each browser has its own. Revoke one to disconnect it.">
				{tokens.isLoading ? (
					<SkeletonRows count={2} />
				) : tokens.isError ? (
					<ErrorState size="sm" error={tokens.error} onRetry={() => void tokens.refetch()} />
				) : mine.length === 0 ? (
					<EmptyState size="sm" icon={<Globe />} title="No browsers connected yet." />
				) : (
					<List>
						{mine.map((t) => (
							<Row
								key={t.id}
								icon={<Globe />}
								title={t.name}
								subtitle={`${t.lastUsedAt ? `used ${timeAgo(t.lastUsedAt)}` : "never used"} · made ${timeAgo(t.createdAt)}`}
								trailing={
									<Button variant="danger-ghost" size="sm" onClick={() => setRevoking(t.id)}>
										Revoke
									</Button>
								}
							/>
						))}
					</List>
				)}
			</Section>
			<p className="text-small text-fg-subtle">Disconnect in the extension too, to remove its saved token.</p>
			<Confirm
				open={revoking !== null}
				onOpenChange={(o) => !o && setRevoking(null)}
				title="Revoke this token?"
				description="That browser stops chatting and sharing tabs until you connect it again with a new token."
				confirmLabel="Revoke"
				danger
				onConfirm={() => {
					if (revoking) void revoke(revoking);
				}}
			/>
		</>
	);
}
