import {
	adminUrl,
	api,
	desktop,
	qk,
	queryClient,
	ThemePicker,
	useAgents,
	useAuth,
	useInfo,
	useSettings,
} from "@sekai/client";
import type { AuthStatus } from "@sekai/shared";
import {
	Button,
	Field,
	IconTile,
	Input,
	Segmented,
	Select,
	SettingsGroup,
	SettingsPanel,
	SettingsRow,
	SettingsTabs,
	Spinner,
	Switch,
} from "@sekai/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	AudioLines,
	Bell,
	BellOff,
	ChevronRight,
	Clock,
	Download,
	Laptop,
	LogOut,
	MessageSquareText,
	Palette,
	ShieldCheck,
	Smartphone,
	Sunrise,
	UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { toast } from "sonner";
import { ThisComputerSettings } from "../components/computer/ThisComputerSettings.tsx";
import { Page } from "../components/layout/PageHeader.tsx";
import {
	disablePush,
	enablePush,
	notificationPermission,
	pushSubscribed,
	pushSupported,
	requestNotificationPermission,
} from "../lib/notifications.ts";
import { useUi } from "../stores/ui.ts";

type InstallPrompt = Event & { prompt: () => Promise<void> };

export async function signOut(): Promise<void> {
	// This browser stops getting notifications (with message previews) once you've signed out of it.
	await disablePush().catch(() => {});
	await api.auth.logout().catch(() => {});
	queryClient.clear();
	location.assign("/");
}

function ProfileTab() {
	const { data: auth } = useAuth();
	const { data: settings } = useSettings();
	const { data: info } = useInfo();
	const [name, setName] = useState("");
	const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const zones = useMemo(() => {
		try {
			return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
		} catch {
			return [browserTz];
		}
	}, [browserTz]);
	useEffect(() => setName(auth?.user?.name ?? settings?.userName ?? ""), [auth?.user?.name, settings?.userName]);

	const rename = useMutation({
		mutationFn: () => api.auth.updateAccount({ name: name.trim() }),
		onSuccess: (user) => {
			queryClient.setQueryData<AuthStatus>(qk.auth, (s) => (s ? { ...s, user } : s));
			void queryClient.invalidateQueries({ queryKey: qk.settings });
			toast.success("Saved", { duration: 1200 });
		},
	});
	const save = useMutation({
		mutationFn: (timezone: string) => api.settings.update({ timezone }),
		onSuccess: (s) => {
			queryClient.setQueryData(qk.settings, s);
			toast.success("Saved", { duration: 1200 });
		},
	});
	if (!settings) return <Spinner />;
	const current = auth?.user?.name ?? settings.userName;

	return (
		<>
			<Field label="Your name" hint="What your bots call you.">
				<div className="flex gap-2">
					<Input
						value={name}
						onChange={(e) => setName(e.target.value)}
						placeholder="Sam"
						autoComplete="name"
					/>
					<Button
						variant="secondary"
						disabled={!name.trim() || name === current || rename.isPending}
						onClick={() => rename.mutate()}
					>
						Save
					</Button>
				</div>
			</Field>
			<Field
				label="Time zone"
				hint={`Routines and reminders run in this zone. This device is in ${browserTz.replace(/_/g, " ")}.`}
				action={
					settings.timezone !== browserTz && (
						<button
							type="button"
							onClick={() => save.mutate(browserTz)}
							className="text-xs font-medium text-brand-ink hover:underline"
						>
							Use this device's
						</button>
					)
				}
			>
				<Select
					value={settings.timezone}
					onValueChange={(tz) => save.mutate(tz)}
					options={[
						{ value: "auto", label: `Server default (${info?.timezone ?? "…"})` },
						...zones.map((z) => ({ value: z, label: z.replace(/_/g, " ") })),
					]}
				/>
			</Field>
		</>
	);
}

function AppearanceTab() {
	const theme = useUi((s) => s.theme);
	const setTheme = useUi((s) => s.setTheme);
	const [install, setInstall] = useState<InstallPrompt | null>(null);
	useEffect(() => {
		const onPrompt = (e: Event) => {
			e.preventDefault();
			setInstall(e as InstallPrompt);
		};
		window.addEventListener("beforeinstallprompt", onPrompt);
		return () => window.removeEventListener("beforeinstallprompt", onPrompt);
	}, []);
	return (
		<>
			<Field
				label="Theme"
				hint="One for each group. Automatic shows Virtual Singers when your device is light and Nightcord at 25:00 when it's dark."
			>
				<ThemePicker value={theme} onChange={setTheme} />
			</Field>
			{install && (
				<SettingsGroup>
					<SettingsRow
						icon={<Download />}
						title="Install Sekai as an app"
						description="Its own window and icon, and notifications like a native app."
					>
						<Button variant="secondary" size="sm" onClick={() => void install.prompt()}>
							Install
						</Button>
					</SettingsRow>
				</SettingsGroup>
			)}
		</>
	);
}

function NotificationsTab() {
	const [perm, setPerm] = useState(notificationPermission());
	const [push, setPush] = useState<boolean | null>(null);
	const [busy, setBusy] = useState(false);
	useEffect(() => {
		if (pushSupported()) void pushSubscribed().then(setPush);
	}, []);
	const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
	const standalone = window.matchMedia("(display-mode: standalone)").matches;
	const text =
		perm === "granted"
			? "On while Sekai is open, even in the background."
			: perm === "denied"
				? "Blocked in your browser's site settings."
				: perm === "unsupported"
					? ios && !standalone
						? "On iPhone and iPad, add Sekai to your Home Screen first (Share → Add to Home Screen), then open it from there."
						: "This browser can't show notifications."
					: "Off. Turn them on to hear from bots while Sekai is in the background.";
	const toggle = async (on: boolean) => {
		setBusy(true);
		try {
			if (on) await enablePush();
			else await disablePush();
			setPush(on);
			setPerm(notificationPermission());
			if (on) toast.success("Push is on for this device");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : String(err));
			setPerm(notificationPermission());
		} finally {
			setBusy(false);
		}
	};
	const test = useMutation({
		mutationFn: api.push.test,
		onSuccess: (r) => {
			if (r.sent === 0) toast.error("No device has push turned on");
		},
		onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
	});
	return (
		<SettingsGroup>
			<SettingsRow icon={perm === "granted" ? <Bell /> : <BellOff />} title="This device" description={text}>
				{perm === "default" && (
					<Button
						variant="primary"
						size="sm"
						onClick={async () =>
							setPerm((await requestNotificationPermission()) ? "granted" : notificationPermission())
						}
					>
						Turn on
					</Button>
				)}
			</SettingsRow>
			{!window.isSecureContext && <HttpsHint />}
			{pushSupported() && perm !== "denied" && (
				<SettingsRow
					icon={<Smartphone />}
					title="Even when Sekai is closed"
					description="Calls, approvals, messages bots send you and finished routines reach this device as push notifications."
				>
					<div className="flex items-center gap-2">
						{push && (
							<Button variant="ghost" size="sm" disabled={test.isPending} onClick={() => test.mutate()}>
								Send a test
							</Button>
						)}
						{busy || push === null ? (
							<Spinner />
						) : (
							<Switch
								checked={push}
								label="Push notifications"
								onCheckedChange={(on) => void toggle(on)}
							/>
						)}
					</div>
				</SettingsRow>
			)}
		</SettingsGroup>
	);
}

/** Every morning: what bots did, what didn't work, what waits for you and what's on today. */
function DigestSettings() {
	const { data: status } = useQuery({ queryKey: ["digest"], queryFn: api.digest.status });
	const { data: agents = [] } = useAgents();
	const [time, setTime] = useState<string | null>(null);
	const configure = useMutation({
		mutationFn: api.digest.configure,
		onSuccess: (s) => {
			queryClient.setQueryData(["digest"], s);
			setTime(null);
		},
		onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
	});
	const send = useMutation({
		mutationFn: api.digest.send,
		onSuccess: (r) => toast.success(r.sent ? "Sent: it's in the chat" : "There's no bot to send it yet"),
		onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
	});
	if (!status) return null;
	const cfg = status.config;
	const bot = agents.find((a) => a.id === status.agentId);
	return (
		<SettingsGroup>
			<SettingsRow
				icon={<Sunrise />}
				title="Morning digest"
				description={`${bot ? `${bot.name} posts` : "Your primary bot posts"} what your bots did, what didn't work, what's waiting for you and what's on today, in its chat.`}
			>
				<Switch
					checked={cfg.enabled}
					label="Morning digest"
					onCheckedChange={(enabled) => configure.mutate({ enabled })}
				/>
			</SettingsRow>
			{cfg.enabled && (
				<>
					<SettingsRow icon={<Clock />} title="When" description="In your time zone, every day.">
						<form
							className="flex items-center gap-2"
							onSubmit={(e) => {
								e.preventDefault();
								if (time) configure.mutate({ time });
							}}
						>
							<Input
								type="time"
								value={time ?? cfg.time}
								onChange={(e) => setTime(e.target.value)}
								onBlur={() => time && time !== cfg.time && configure.mutate({ time })}
								aria-label="Digest time"
								className="w-36"
							/>
						</form>
					</SettingsRow>
					<SettingsRow
						icon={<MessageSquareText />}
						title="How it reads"
						description={
							cfg.style === "bot"
								? `${bot?.name ?? "Your primary bot"} writes it up in its own voice (one small model call).`
								: "Just the facts, as a list."
						}
					>
						<Segmented
							value={cfg.style}
							onValueChange={(style) => configure.mutate({ style })}
							options={[
								{ value: "bot", label: bot ? `${bot.name}'s voice` : "Bot's voice" },
								{ value: "plain", label: "Plain list" },
							]}
						/>
					</SettingsRow>
					<SettingsRow
						icon={<BellOff />}
						title="Skip quiet days"
						description="No digest when nothing happened, nothing is waiting and nothing is planned."
					>
						<Switch
							checked={cfg.skipQuiet}
							label="Skip quiet days"
							onCheckedChange={(skipQuiet) => configure.mutate({ skipQuiet })}
						/>
					</SettingsRow>
				</>
			)}
			<SettingsRow
				title="See one now"
				description={
					status.lastSentAt
						? `The last one was ${new Date(status.lastSentAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}.`
						: "It covers the last day."
				}
			>
				<Button variant="secondary" size="sm" onClick={() => send.mutate()} disabled={send.isPending}>
					{send.isPending ? <Spinner /> : null} Send now
				</Button>
			</SettingsRow>
		</SettingsGroup>
	);
}

/** Push needs https: point to Sekai's address on the tailnet when it has one. */
function HttpsHint() {
	const { data } = useQuery({
		queryKey: ["tailscale"],
		queryFn: api.tailscale.overview,
		staleTime: 60_000,
		retry: false,
	});
	const url = data?.https.on ? data.https.url : null;
	return (
		<SettingsRow
			icon={<Smartphone />}
			title="Even when Sekai is closed"
			description={
				url
					? "Push notifications need a secure address. Open Sekai at its HTTPS address on your tailnet and turn them on there."
					: "Push notifications need a secure (https) address. Turn on Sekai's HTTPS address in Admin → Tailscale."
			}
		>
			{url ? (
				<Button
					variant="secondary"
					size="sm"
					onClick={() => location.assign(`${url}/settings?tab=notifications`)}
				>
					Open
				</Button>
			) : (
				<Button variant="ghost" size="sm" onClick={() => location.assign(adminUrl("tailscale"))}>
					Set up
				</Button>
			)}
		</SettingsRow>
	);
}

/** The admin app, and signing out. */
function MoreLinks() {
	const { data: auth } = useAuth();
	return (
		<div className="flex flex-col gap-2">
			<a
				href={adminUrl()}
				className="group flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-3 transition-colors hover:bg-muted/60"
			>
				<IconTile tone="brand" size="sm">
					<ShieldCheck />
				</IconTile>
				<span className="min-w-0 flex-1">
					<span className="block text-sm font-medium">Admin</span>
					<span className="block truncate text-xs text-fg-subtle">Models, apps, computers, security</span>
				</span>
				<ChevronRight className="size-4 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
			</a>
			<a
				href={adminUrl("voice")}
				className="group flex items-center gap-3 rounded-2xl border border-border bg-card px-3 py-3 transition-colors hover:bg-muted/60"
			>
				<IconTile tone="info" size="sm">
					<AudioLines />
				</IconTile>
				<span className="min-w-0 flex-1">
					<span className="block text-sm font-medium">Voice</span>
					<span className="block truncate text-xs text-fg-subtle">
						Voices for calls, reading aloud and dictation
					</span>
				</span>
				<ChevronRight className="size-4 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
			</a>
			{auth?.via === "session" && (
				<Button variant="ghost" className="justify-start px-3" onClick={() => void signOut()}>
					<LogOut /> Sign out
				</Button>
			)}
		</div>
	);
}

const TABS = [
	{ value: "profile", label: "Profile", icon: <UserRound /> },
	{ value: "appearance", label: "Appearance", icon: <Palette /> },
	{ value: "notifications", label: "Notifications", icon: <Bell /> },
	...(desktop?.localComputer ? [{ value: "computer", label: "This computer", icon: <Laptop /> }] : []),
];

export function SettingsPage() {
	const [params, setParams] = useSearchParams();
	const asked = params.get("tab");
	const tab = TABS.some((t) => t.value === asked) ? (asked as string) : "profile";
	return (
		<Page title="Settings" wide>
			<SettingsTabs
				tabs={TABS}
				value={tab}
				onValueChange={(t) => setParams(t === "profile" ? {} : { tab: t }, { replace: true })}
				railFooter={<MoreLinks />}
			>
				<SettingsPanel value="profile" title="Profile" description="How your bots know you.">
					<ProfileTab />
				</SettingsPanel>
				<SettingsPanel value="appearance" title="Appearance">
					<AppearanceTab />
				</SettingsPanel>
				<SettingsPanel
					value="notifications"
					title="Notifications"
					description="Reminders, routine results, handoffs, approval requests and your morning digest."
				>
					<NotificationsTab />
					<DigestSettings />
				</SettingsPanel>
				{desktop?.localComputer && (
					<SettingsPanel
						value="computer"
						title="This computer"
						description="Let your bots work on the computer this app runs on, like on their own computer."
					>
						<ThisComputerSettings />
					</SettingsPanel>
				)}
			</SettingsTabs>
			<div className="mt-10 lg:hidden">
				<MoreLinks />
			</div>
		</Page>
	);
}
