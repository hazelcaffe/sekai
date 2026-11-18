import type { MfaStatus, TotpSetup } from "@sekai/shared";
import { Badge, Button, Callout, Confirm, Dialog, Field, Input, Spinner } from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Copy, Download, KeyRound, Mail, MessageSquareText, Smartphone } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { api } from "../api.ts";

const MFA_KEY = ["auth", "mfa"] as const;

/** Your two-factor sign-in methods (what Account shows). */
export function useMfaStatus() {
	return useQuery({ queryKey: MFA_KEY, queryFn: () => api.auth.mfa() });
}

function copy(text: string, what = "Copied") {
	void navigator.clipboard.writeText(text).then(() => toast.success(what, { duration: 1200 }));
}

/** Recovery codes, shown once: copy or download them. */
export function RecoveryCodes({ codes, onDone }: { codes: string[] | null; onDone: () => void }) {
	const text = codes?.join("\n") ?? "";
	const download = () => {
		const url = URL.createObjectURL(new Blob([`Sekai recovery codes\n\n${text}\n`], { type: "text/plain" }));
		const a = document.createElement("a");
		a.href = url;
		a.download = "sekai-recovery-codes.txt";
		a.click();
		URL.revokeObjectURL(url);
	};
	return (
		<Dialog
			open={Boolean(codes)}
			onOpenChange={(o) => !o && onDone()}
			size="sm"
			icon={<KeyRound />}
			title="Save your recovery codes"
			description="If you lose your phone, each code signs you in once. Keep them somewhere safe: they won't be shown again."
			footer={
				<Button variant="primary" onClick={onDone}>
					I saved them
				</Button>
			}
		>
			<div className="grid grid-cols-2 gap-2 rounded-2xl bg-surface-2 p-4 font-mono text-sm tabular-nums">
				{codes?.map((c) => (
					<span key={c}>{c}</span>
				))}
			</div>
			<div className="mt-3 flex gap-2">
				<Button variant="secondary" onClick={() => copy(text, "Codes copied")}>
					<Copy /> Copy
				</Button>
				<Button variant="secondary" onClick={download}>
					<Download /> Download
				</Button>
			</div>
		</Dialog>
	);
}

function TotpDialog({
	open,
	onOpenChange,
	onDone,
}: {
	open: boolean;
	onOpenChange: (o: boolean) => void;
	onDone: (codes?: string[]) => void;
}) {
	const [setup, setSetup] = useState<TotpSetup | null>(null);
	const [code, setCode] = useState("");
	const start = useMutation({ mutationFn: () => api.auth.totpSetup(), onSuccess: setSetup });
	const confirm = useMutation({
		mutationFn: () => api.auth.totpConfirm(code.replace(/\s/g, "")),
		onSuccess: (r) => {
			setSetup(null);
			setCode("");
			onDone(r.recoveryCodes);
		},
	});
	if (open && !setup && !start.isPending && !start.isError) start.mutate();
	return (
		<Dialog
			open={open}
			onOpenChange={(o) => {
				if (!o) {
					setSetup(null);
					setCode("");
					start.reset();
					confirm.reset();
				}
				onOpenChange(o);
			}}
			size="sm"
			icon={<Smartphone />}
			title="Add an authenticator app"
			description="Scan the code with Google Authenticator, 1Password, Authy, Bitwarden or any authenticator app, then enter the 6 digits it shows."
			footer={
				<Button
					variant="primary"
					disabled={code.replace(/\s/g, "").length !== 6 || confirm.isPending}
					onClick={() => confirm.mutate()}
				>
					{confirm.isPending && <Spinner className="text-primary-foreground" />}
					Turn on
				</Button>
			}
		>
			<div className="flex flex-col items-center gap-4">
				{setup ? (
					<>
						<div
							className="size-48 rounded-2xl bg-white p-2 [&_svg]:size-full"
							// The server draws the QR code (an SVG of rectangles, no scripts).
							// biome-ignore lint/security/noDangerouslySetInnerHtml: trusted SVG from Sekai's own server
							dangerouslySetInnerHTML={{ __html: setup.qrSvg }}
						/>
						<button
							type="button"
							className="max-w-full rounded-xl bg-surface-2 px-3 py-2 text-center font-mono text-xs break-all text-fg-muted coarse:py-3"
							onClick={() => copy(setup.secret.replace(/\s/g, ""), "Key copied")}
							title="Can't scan? Type this key into the app (tap to copy)."
						>
							{setup.secret}
						</button>
					</>
				) : (
					<div className="flex size-48 items-center justify-center rounded-2xl bg-surface-2">
						<Spinner />
					</div>
				)}
				<Field label="6-digit code" className="w-full">
					<Input
						inputMode="numeric"
						autoComplete="one-time-code"
						value={code}
						onChange={(e) => setCode(e.target.value)}
						className="text-center text-lg tracking-[0.3em] tabular-nums"
						onKeyDown={(e) => {
							if (e.key === "Enter" && code.replace(/\s/g, "").length === 6) confirm.mutate();
						}}
					/>
				</Field>
				{(start.error || confirm.error) && (
					<Callout tone="danger" icon={<CircleAlert />} className="w-full">
						{(start.error ?? confirm.error)?.message}
					</Callout>
				)}
			</div>
		</Dialog>
	);
}

function CodeDialog({
	kind,
	onOpenChange,
	onDone,
}: {
	kind: "email" | "sms" | null;
	onOpenChange: (o: boolean) => void;
	onDone: (codes?: string[]) => void;
}) {
	const [hint, setHint] = useState<string | null>(null);
	const [code, setCode] = useState("");
	const send = useMutation({
		mutationFn: () => api.auth.codeFactorSetup(kind ?? "email"),
		onSuccess: (r) => setHint(r.hint),
	});
	const confirm = useMutation({
		mutationFn: () => api.auth.codeFactorConfirm(kind ?? "email", code.trim()),
		onSuccess: (r) => {
			setHint(null);
			setCode("");
			onDone(r.recoveryCodes);
		},
	});
	const label = kind === "sms" ? "text message" : "email";
	return (
		<Dialog
			open={kind !== null}
			onOpenChange={(o) => {
				if (!o) {
					setHint(null);
					setCode("");
					send.reset();
					confirm.reset();
				}
				onOpenChange(o);
			}}
			size="sm"
			icon={kind === "sms" ? <MessageSquareText /> : <Mail />}
			title={kind === "sms" ? "Codes by text message" : "Codes by email"}
			description={`When you sign in, Sekai sends a code by ${label}. First, let's check it arrives.`}
			footer={
				hint ? (
					<Button
						variant="primary"
						disabled={code.trim().length !== 6 || confirm.isPending}
						onClick={() => confirm.mutate()}
					>
						{confirm.isPending && <Spinner className="text-primary-foreground" />}
						Turn on
					</Button>
				) : (
					<Button variant="primary" disabled={send.isPending} onClick={() => send.mutate()}>
						{send.isPending && <Spinner className="text-primary-foreground" />}
						Send a code
					</Button>
				)
			}
		>
			{hint && (
				<div className="flex flex-col gap-3">
					<p className="text-sm text-fg-muted">
						Sent to {hint}.{" "}
						<button type="button" className="text-brand-ink underline" onClick={() => send.mutate()}>
							Send another
						</button>
					</p>
					<Field label="Code">
						<Input
							autoFocus
							inputMode="numeric"
							autoComplete="one-time-code"
							value={code}
							onChange={(e) => setCode(e.target.value)}
							className="text-center text-lg tracking-[0.3em] tabular-nums"
						/>
					</Field>
				</div>
			)}
			{(send.error || confirm.error) && (
				<Callout tone="danger" icon={<CircleAlert />} className="mt-3">
					{(send.error ?? confirm.error)?.message}
				</Callout>
			)}
		</Dialog>
	);
}

function MethodRow({
	icon,
	title,
	detail,
	on,
	action,
}: {
	icon: ReactNode;
	title: string;
	detail: ReactNode;
	on: boolean;
	action: ReactNode;
}) {
	return (
		<div className="flex items-center gap-3 px-4 py-3">
			<span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-fg-muted [&_svg]:size-4.5">
				{icon}
			</span>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2 text-sm font-medium">
					{title}
					{on && <Badge tone="success">On</Badge>}
				</div>
				<div className="truncate text-xs text-fg-muted">{detail}</div>
			</div>
			{action}
		</div>
	);
}

/**
 * Two-factor sign-in: an authenticator app, codes by email or text, and recovery codes. onChange runs after a
 * method was added or removed (a forced setup moves on).
 */
export function TwoFactorSettings({ onChange }: { onChange?: (status: MfaStatus) => void }) {
	const qc = useQueryClient();
	const status = useMfaStatus();
	const [totp, setTotp] = useState(false);
	const [codeKind, setCodeKind] = useState<"email" | "sms" | null>(null);
	const [codes, setCodes] = useState<string[] | null>(null);
	const [removing, setRemoving] = useState<"totp" | "email" | "sms" | null>(null);
	const refresh = async () => {
		const next = await qc.fetchQuery({ queryKey: MFA_KEY, queryFn: () => api.auth.mfa(), staleTime: 0 });
		void qc.invalidateQueries({ queryKey: ["auth"] });
		onChange?.(next);
	};
	const added = (recovery?: string[]) => {
		setTotp(false);
		setCodeKind(null);
		toast.success("Two-factor sign-in is on", { duration: 1500 });
		// New recovery codes are shown first (moving on would hide them).
		if (recovery?.length) setCodes(recovery);
		else void refresh();
	};
	const remove = useMutation({
		mutationFn: (kind: "totp" | "email" | "sms") => api.auth.removeFactor(kind),
		onSuccess: () => void refresh(),
		onError: (err) => toast.error(err.message),
	});
	const regenerate = useMutation({
		mutationFn: () => api.auth.newRecoveryCodes(),
		onSuccess: (r) => {
			setCodes(r.codes);
			void refresh();
		},
		onError: (err) => toast.error(err.message),
	});
	const s = status.data;
	if (!s) {
		return (
			<div className="flex justify-center rounded-2xl border border-border bg-card p-6">
				<Spinner />
			</div>
		);
	}
	const any = s.totp || Boolean(s.email) || Boolean(s.sms);
	return (
		<div className="flex flex-col gap-3">
			{s.required && !any && (
				<Callout tone="warning" icon={<CircleAlert />}>
					Your role asks for two-factor sign-in. Add a method below (or a passkey).
				</Callout>
			)}
			<div className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
				<MethodRow
					icon={<Smartphone />}
					title="Authenticator app"
					detail="6-digit codes from an app on your phone"
					on={s.totp}
					action={
						s.totp ? (
							<Button variant="ghost" size="sm" onClick={() => setRemoving("totp")}>
								Remove
							</Button>
						) : (
							<Button variant="secondary" size="sm" onClick={() => setTotp(true)}>
								Set up
							</Button>
						)
					}
				/>
				<MethodRow
					icon={<Mail />}
					title="Email codes"
					detail={s.email ?? (s.emailAvailable ? "A code to your email" : "This server can't send email yet")}
					on={Boolean(s.email)}
					action={
						s.email ? (
							<Button variant="ghost" size="sm" onClick={() => setRemoving("email")}>
								Remove
							</Button>
						) : (
							<Button
								variant="secondary"
								size="sm"
								disabled={!s.emailAvailable}
								onClick={() => setCodeKind("email")}
							>
								Set up
							</Button>
						)
					}
				/>
				<MethodRow
					icon={<MessageSquareText />}
					title="Text message codes"
					detail={
						s.sms ??
						(s.smsAvailable
							? "A code to your phone (add your number above)"
							: "This server can't send texts yet")
					}
					on={Boolean(s.sms)}
					action={
						s.sms ? (
							<Button variant="ghost" size="sm" onClick={() => setRemoving("sms")}>
								Remove
							</Button>
						) : (
							<Button
								variant="secondary"
								size="sm"
								disabled={!s.smsAvailable}
								onClick={() => setCodeKind("sms")}
							>
								Set up
							</Button>
						)
					}
				/>
				{any && (
					<MethodRow
						icon={<KeyRound />}
						title="Recovery codes"
						detail={`${s.recoveryCodesLeft} left. Each signs you in once if you lose your phone.`}
						on={false}
						action={
							<Button
								variant="ghost"
								size="sm"
								disabled={regenerate.isPending}
								onClick={() => regenerate.mutate()}
							>
								New codes
							</Button>
						}
					/>
				)}
			</div>
			<TotpDialog open={totp} onOpenChange={setTotp} onDone={added} />
			<CodeDialog kind={codeKind} onOpenChange={(o) => !o && setCodeKind(null)} onDone={added} />
			<RecoveryCodes
				codes={codes}
				onDone={() => {
					setCodes(null);
					void refresh();
				}}
			/>
			<Confirm
				open={removing !== null}
				onOpenChange={(o) => !o && setRemoving(null)}
				title="Remove this method?"
				description="You'll sign in without it. If it's your last one, your recovery codes stop working too."
				confirmLabel="Remove"
				danger
				onConfirm={() => {
					if (removing) remove.mutate(removing);
					setRemoving(null);
				}}
			/>
		</div>
	);
}
