import { api, mobile, queryClient, useAccess, useAgents } from "@sekai/client";
import {
	Button,
	Callout,
	errorMessage,
	Input,
	List,
	Page,
	Row,
	SaveState,
	Section,
	Segmented,
	SkeletonRows,
	Switch,
	ToggleRow,
	useAutosave,
} from "@sekai/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";
import {
	disablePush,
	enablePush,
	notificationPermission,
	pushSubscribed,
	pushSupported,
	refreshMobilePermission,
	requestNotificationPermission,
} from "../../lib/notifications.ts";
import type { SettingsSectionProps } from "../section.ts";

function ThisDevice() {
	const [perm, setPerm] = useState(notificationPermission());
	const [push, setPush] = useState<boolean | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	useEffect(() => {
		if (mobile) void refreshMobilePermission().then(setPerm);
		if (pushSupported()) void pushSubscribed().then(setPush);
	}, []);
	const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
	const standalone = window.matchMedia("(display-mode: standalone)").matches;
	const text =
		perm === "granted"
			? mobile
				? "On while the app is open or in the background."
				: "On while Sekai is open, even in the background."
			: perm === "denied"
				? mobile
					? "Blocked for Sekai in your phone's settings."
					: "Blocked in your browser's site settings."
				: perm === "unsupported"
					? ios && !standalone
						? "On iPhone and iPad, add Sekai to your Home Screen first, then open it from there."
						: "This browser can't show notifications."
					: "Off. Turn them on to hear from bots while Sekai is in the background.";
	const toggle = async (on: boolean) => {
		setBusy(true);
		setError(null);
		try {
			if (on) await enablePush();
			else await disablePush();
			setPush(on);
			setPerm(notificationPermission());
		} catch (err) {
			setError(errorMessage(err));
			setPerm(notificationPermission());
		} finally {
			setBusy(false);
		}
	};
	const test = useMutation({
		mutationFn: api.push.test,
		onSuccess: (r) => {
			if (r.sent === 0) toast.error("No device has push turned on");
			else toast.success("Sent a test");
		},
		onError: (e) => toast.error(errorMessage(e)),
	});
	const rows =
		perm === "default" ||
		(perm === "denied" && mobile?.openNotificationSettings) ||
		(!window.isSecureContext && !mobile) ||
		(pushSupported() && perm !== "denied" && perm !== "unsupported");
	return (
		<Section title="This device" description={text}>
			{rows && (
				<List>
					{perm === "default" && (
						<Row
							title="Notifications"
							subtitle="Hear from bots while Sekai is in the background."
							trailing={
								<Button
									variant="primary"
									size="sm"
									onClick={async () =>
										setPerm(
											(await requestNotificationPermission())
												? "granted"
												: notificationPermission(),
										)
									}
								>
									Turn on
								</Button>
							}
						/>
					)}
					{perm === "denied" && mobile?.openNotificationSettings && (
						<Row
							title="Notifications are blocked"
							subtitle="Allow them in your phone's settings."
							trailing={
								<Button
									variant="secondary"
									size="sm"
									onClick={() => mobile?.openNotificationSettings?.()}
								>
									Open settings
								</Button>
							}
						/>
					)}
					{!window.isSecureContext && !mobile && <HttpsHint />}
					{pushSupported() && perm !== "denied" && perm !== "unsupported" && (
						<Row
							title="Even when Sekai is closed"
							subtitle="Calls, approvals and finished routines reach this device."
							wrap
							trailing={
								<div className="flex items-center gap-2">
									{push && (
										<Button
											variant="ghost"
											size="sm"
											loading={test.isPending}
											onClick={() => test.mutate()}
										>
											Send a test
										</Button>
									)}
									<Switch
										checked={Boolean(push)}
										disabled={busy || push === null}
										label="Push notifications"
										onCheckedChange={(on) => void toggle(on)}
									/>
								</div>
							}
						/>
					)}
				</List>
			)}
			{error && <Callout tone="danger">{error}</Callout>}
		</Section>
	);
}

/** Every morning: what bots did, what didn't work, what waits for you and what's on today. */
function DigestSettings() {
	const {
		data: status,
		isLoading,
		isError,
		error,
		refetch,
	} = useQuery({
		queryKey: ["digest"],
		queryFn: api.digest.status,
	});
	const { data: agents = [] } = useAgents();
	const save = useAutosave(
		(patch: { enabled?: boolean; time?: string; style?: "bot" | "plain"; skipQuiet?: boolean }) =>
			api.digest.configure(patch).then((s) => {
				queryClient.setQueryData(["digest"], s);
			}),
	);
	const send = useMutation({
		mutationFn: api.digest.send,
		onSuccess: (r) => toast.success(r.sent ? "Sent. It's in the chat." : "There's no bot to send it yet."),
		onError: (e) => toast.error(errorMessage(e)),
	});
	if (isLoading) return <SkeletonRows count={2} />;
	if (isError || !status) {
		return (
			<Section title="Morning digest">
				<Callout
					tone="danger"
					action={
						<Button variant="secondary" size="sm" onClick={() => void refetch()}>
							Try again
						</Button>
					}
				>
					{errorMessage(error)}
				</Callout>
			</Section>
		);
	}
	const cfg = status.config;
	const bot = agents.find((a) => a.id === status.agentId);
	const who = bot?.name ?? "Your primary bot";
	return (
		<Section
			title="Morning digest"
			description={`${who} posts what happened, what's waiting and what's on today.`}
			saveState={<SaveState state={save} />}
		>
			<List>
				<ToggleRow
					title="Morning digest"
					description={`In ${bot ? `${bot.name}'s` : "its"} chat, every morning.`}
					checked={cfg.enabled}
					onCheckedChange={(enabled) => save.save({ enabled })}
				/>
				{cfg.enabled && (
					<>
						<Row
							title="When"
							subtitle="In your time zone."
							trailing={
								<Input
									type="time"
									defaultValue={cfg.time}
									key={cfg.time}
									aria-label="Digest time"
									className="w-36"
									onBlur={(e) =>
										e.target.value &&
										e.target.value !== cfg.time &&
										save.save({ time: e.target.value })
									}
									onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
								/>
							}
						/>
						<Row
							title="How it reads"
							subtitle={
								cfg.style === "bot"
									? `${who} writes it in its own voice.`
									: "Just the facts, as a list."
							}
							wrap
							trailing={
								<Segmented
									value={cfg.style}
									onValueChange={(style) => save.save({ style: style === "plain" ? "plain" : "bot" })}
									options={[
										{ value: "bot", label: "Bot's voice" },
										{ value: "plain", label: "Plain list" },
									]}
									label="How the digest reads"
								/>
							}
						/>
						<ToggleRow
							title="Skip quiet days"
							description="No digest when nothing happened and nothing is waiting."
							checked={cfg.skipQuiet}
							onCheckedChange={(skipQuiet) => save.save({ skipQuiet })}
						/>
					</>
				)}
				<Row
					title="See one now"
					subtitle={
						status.lastSentAt
							? `The last one was ${new Date(status.lastSentAt).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" })}.`
							: "It covers the last day."
					}
					trailing={
						<Button variant="secondary" size="sm" loading={send.isPending} onClick={() => send.mutate()}>
							Send now
						</Button>
					}
				/>
			</List>
		</Section>
	);
}

/** Push needs https: point at Sekai's secure address when it has one. */
function HttpsHint() {
	const { admin } = useAccess();
	const navigate = useNavigate();
	const { data } = useQuery({
		queryKey: ["tailscale"],
		queryFn: api.tailscale.overview,
		staleTime: 60_000,
		retry: false,
		enabled: admin,
	});
	const url = data?.https.on ? data.https.url : null;
	return (
		<Row
			title="Needs a secure address"
			subtitle={
				url
					? "Open Sekai at its https address, then turn push on there."
					: admin
						? "Turn on Sekai's https address in Network & devices."
						: "Ask an admin to turn on Sekai's https address."
			}
			trailing={
				url ? (
					<Button
						variant="secondary"
						size="sm"
						onClick={() => location.assign(`${url}/settings/notifications`)}
					>
						Open
					</Button>
				) : admin ? (
					<Button variant="ghost" size="sm" onClick={() => navigate("/settings/network")}>
						Set up
					</Button>
				) : undefined
			}
		/>
	);
}

export function NotificationsSection({ back }: SettingsSectionProps) {
	return (
		<Page back={back} title="Notifications" description="Reminders, finished routines and your morning digest.">
			<ThisDevice />
			<DigestSettings />
		</Page>
	);
}
