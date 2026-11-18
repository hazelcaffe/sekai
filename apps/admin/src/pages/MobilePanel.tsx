import { api, pluralize } from "@sekai/client";
import { MOBILE_APP_ID, type MobilePushSettings, type MobilePushStatus } from "@sekai/shared";
import { Badge, Button, Callout, Field, Input, Section, SettingsPanel, Skeleton, Spinner } from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, Info, TriangleAlert } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { toast } from "sonner";
import { adminError } from "./PeoplePanel.tsx";

const KEY = ["admin", "mobile"] as const;
/** What the server sends back for a saved secret (sending it back keeps it). */
const MASKED = "••••••••";

/** Picks a file and hands over its text (the keys are small text files: JSON, or a .p8). */
function FilePick({
	label,
	hint,
	accept,
	chosen,
	saved,
	onText,
}: {
	label: string;
	hint: ReactNode;
	accept: string;
	chosen: string | null;
	saved: string | null;
	onText: (text: string, name: string) => void;
}) {
	const input = useRef<HTMLInputElement>(null);
	return (
		<Field label={label} hint={hint}>
			<div className="flex min-w-0 items-center gap-3">
				<Button variant="secondary" onClick={() => input.current?.click()}>
					<FileUp /> {chosen || saved ? "Replace…" : "Choose file…"}
				</Button>
				<span className="min-w-0 truncate text-sm text-fg-muted">{chosen ?? saved ?? "No file yet"}</span>
			</div>
			<input
				ref={input}
				type="file"
				accept={accept}
				className="hidden"
				onChange={async (e) => {
					const file = e.target.files?.[0];
					e.target.value = "";
					if (!file) return;
					if (file.size > 50_000) {
						toast.error("That file is too big to be a key.");
						return;
					}
					onText(await file.text(), file.name);
				}}
			/>
		</Field>
	);
}

function Status({ ready, problem, idle }: { ready: boolean; problem: string | null; idle: boolean }) {
	if (ready) return <Badge tone="success">Ready</Badge>;
	if (problem && !idle) return <Badge tone="danger">Needs a fix</Badge>;
	return <Badge tone="neutral">Not set up</Badge>;
}

function Steps({ children }: { children: ReactNode }) {
	return <ol className="list-decimal space-y-1 pl-5 text-sm text-fg-muted">{children}</ol>;
}

function useDraft(status: MobilePushStatus | undefined) {
	const [draft, setDraft] = useState<Partial<MobilePushSettings>>({});
	const [names, setNames] = useState<Record<string, string>>({});
	return {
		draft,
		names,
		value: { ...(status?.settings ?? {}), ...draft } as MobilePushSettings,
		dirty: Object.keys(draft).length > 0,
		set: (patch: Partial<MobilePushSettings>, file?: { key: string; name: string }) => {
			setDraft((d) => ({ ...d, ...patch }));
			if (file) setNames((n) => ({ ...n, [file.key]: file.name }));
		},
		reset: () => {
			setDraft({});
			setNames({});
		},
	};
}

function SaveRow({
	dirty,
	pending,
	onSave,
	onReset,
}: {
	dirty: boolean;
	pending: boolean;
	onSave: () => void;
	onReset: () => void;
}) {
	if (!dirty) return null;
	return (
		<div className="flex flex-wrap items-center justify-end gap-2">
			<Button variant="ghost" onClick={onReset} disabled={pending}>
				Undo changes
			</Button>
			<Button variant="primary" onClick={onSave} disabled={pending}>
				{pending && <Spinner className="text-primary-foreground" />} Save
			</Button>
		</div>
	);
}

function useSave(reset: () => void) {
	const qc = useQueryClient();
	return useMutation({
		mutationFn: (patch: Partial<MobilePushSettings>) => api.admin.saveMobile(patch),
		onSuccess: (next) => {
			qc.setQueryData(KEY, next);
			reset();
			toast.success("Saved", { duration: 1200 });
		},
		onError: adminError,
	});
}

function AndroidSection({ status }: { status: MobilePushStatus }) {
	const form = useDraft(status);
	const save = useSave(form.reset);
	const saved = status.settings;
	const { ready, problem, projectId } = status.android;
	return (
		<Section
			title="Android"
			description="Through Firebase Cloud Messaging, which is free. You need a Google account."
			action={
				<Status ready={ready} problem={problem} idle={!saved.firebaseConfig && !saved.firebaseServiceAccount} />
			}
		>
			<div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4">
				<Steps>
					<li>
						In the{" "}
						<a
							href="https://console.firebase.google.com/"
							target="_blank"
							rel="noreferrer"
							className="font-medium text-brand-ink hover:underline"
						>
							Firebase console
						</a>
						, create a project (or open one).
					</li>
					<li>
						Add an Android app with the package name{" "}
						<code className="font-mono text-xs text-foreground">{MOBILE_APP_ID}</code>, and download its
						google-services.json.
					</li>
					<li>In Project settings → Service accounts, generate a new private key.</li>
				</Steps>
				<FilePick
					label="google-services.json"
					accept=".json,application/json"
					hint="The app's settings for your project. Phones get these to sign up for push."
					chosen={form.names.firebaseConfig ?? null}
					saved={saved.firebaseConfig ? (projectId ? `Saved, for ${projectId}` : "Saved") : null}
					onText={(text, name) => form.set({ firebaseConfig: text }, { key: "firebaseConfig", name })}
				/>
				<FilePick
					label="Service account key"
					accept=".json,application/json"
					hint="Lets this server send the pushes. It's kept encrypted and never shown again."
					chosen={form.names.firebaseServiceAccount ?? null}
					saved={saved.firebaseServiceAccount === MASKED ? "Saved" : null}
					onText={(text, name) =>
						form.set({ firebaseServiceAccount: text }, { key: "firebaseServiceAccount", name })
					}
				/>
				{problem && !form.dirty && (
					<Callout tone="danger" icon={<TriangleAlert />}>
						{problem}
					</Callout>
				)}
				<SaveRow
					dirty={form.dirty}
					pending={save.isPending}
					onSave={() => save.mutate(form.draft)}
					onReset={form.reset}
				/>
			</div>
		</Section>
	);
}

function IosSection({ status }: { status: MobilePushStatus }) {
	const form = useDraft(status);
	const save = useSave(form.reset);
	const saved = status.settings;
	const c = form.value;
	const { ready, problem } = status.ios;
	return (
		<Section
			title="iPhone and iPad"
			description="Through Apple's push service. It needs an Apple developer account, and the app signed by that same team."
			action={<Status ready={ready} problem={problem} idle={!saved.apnsKey} />}
		>
			<div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4">
				<Steps>
					<li>
						In{" "}
						<a
							href="https://developer.apple.com/account/resources/authkeys/list"
							target="_blank"
							rel="noreferrer"
							className="font-medium text-brand-ink hover:underline"
						>
							Apple Developer → Keys
						</a>
						, make a key with Apple Push Notifications service (APNs) and download the .p8 file.
					</li>
					<li>Copy its key ID, and your team ID (top right of the developer site).</li>
				</Steps>
				<div className="grid gap-4 sm:grid-cols-2">
					<Field label="Key ID">
						<Input
							value={c.apnsKeyId}
							onChange={(e) => form.set({ apnsKeyId: e.target.value.trim() })}
							placeholder="ABC123DEFG"
							autoCapitalize="characters"
							spellCheck={false}
						/>
					</Field>
					<Field label="Team ID">
						<Input
							value={c.apnsTeamId}
							onChange={(e) => form.set({ apnsTeamId: e.target.value.trim() })}
							placeholder="DEF123GHIJ"
							autoCapitalize="characters"
							spellCheck={false}
						/>
					</Field>
					<Field
						label="Bundle ID"
						className="sm:col-span-2"
						hint="The app's, as it was signed. Change it only if you built your own copy with another one."
					>
						<Input
							value={c.apnsBundleId}
							onChange={(e) => form.set({ apnsBundleId: e.target.value.trim() })}
							placeholder={MOBILE_APP_ID}
							autoCapitalize="none"
							spellCheck={false}
						/>
					</Field>
				</div>
				<FilePick
					label="Push key (.p8)"
					accept=".p8,text/plain"
					hint="Kept encrypted and never shown again."
					chosen={form.names.apnsKey ?? null}
					saved={saved.apnsKey === MASKED ? "Saved" : null}
					onText={(text, name) => form.set({ apnsKey: text }, { key: "apnsKey", name })}
				/>
				{problem && !form.dirty && (
					<Callout tone="warning" icon={<TriangleAlert />}>
						{problem}
					</Callout>
				)}
				<SaveRow
					dirty={form.dirty}
					pending={save.isPending}
					onSave={() => save.mutate(form.draft)}
					onReset={form.reset}
				/>
			</div>
		</Section>
	);
}

export function MobilePanel() {
	const query = useQuery({ queryKey: KEY, queryFn: api.admin.mobile });
	const status = query.data;
	return (
		<SettingsPanel
			value="mobile"
			title="Phone apps"
			description="Notifications for the iOS and Android apps, even when the app is closed. Without this, the apps still work, and notify only while they're open."
		>
			{!status ? (
				<Skeleton className="h-64 rounded-2xl" />
			) : (
				<>
					<AndroidSection status={status} />
					<IosSection status={status} />
					<Callout tone="info" icon={<Info />}>
						{status.devices.android + status.devices.ios > 0
							? `${pluralize(status.devices.android, "Android phone")} and ${pluralize(status.devices.ios, "iPhone")} get pushes. `
							: "No phone gets pushes yet. "}
						People turn push on in the app, under Settings → Notifications.
					</Callout>
				</>
			)}
		</SettingsPanel>
	);
}
