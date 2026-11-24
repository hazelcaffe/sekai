import { api } from "@sekai/client";
import { type Agent, type EmailAccount, type EmailServer, mailboxName } from "@sekai/shared";
import { Button, Callout, Field, FormGroup, Input, PasswordInput, Section, Select, useFormValues } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { actionError, saveForm } from "../../lib/forms.ts";

type Props = { agent: Agent; onSaved: (a: EmailAccount) => void };
export function CreateAddress({ agent, domains, onSaved }: Props & { domains: string[] }) {
	const form = useFormValues({ localPart: mailboxName(agent.name), domain: domains[0] ?? "" });
	return (
		<FormGroup
			dirty={form.dirty}
			submitWhenClean
			submitLabel="Create address"
			onCancel={() => form.reset()}
			onSubmit={() =>
				saveForm(async () => {
					const a = await api.email.create(agent.id, form.values);
					form.reset();
					onSaved(a);
				})
			}
		>
			<Field label="Name before the @">
				<Input value={form.values.localPart} onChange={(e) => form.set("localPart", e.target.value)} required />
			</Field>
			<Field label="Domain">
				<Select
					value={form.values.domain}
					onValueChange={(d) => form.set("domain", d)}
					options={domains.map((d) => ({ label: d, value: d }))}
				/>
			</Field>
		</FormGroup>
	);
}

function ServerFields({
	title,
	server,
	onChange,
}: {
	title: string;
	server: EmailServer;
	onChange: (s: EmailServer) => void;
}) {
	return (
		<Section title={title}>
			<Field label="Server name">
				<Input
					value={server.host}
					onChange={(e) => onChange({ ...server, host: e.target.value })}
					autoCapitalize="none"
					required
				/>
			</Field>
			<div className="grid grid-cols-2 gap-3">
				<Field label="Port">
					<Input
						type="number"
						min={1}
						max={65535}
						value={server.port || ""}
						onChange={(e) => onChange({ ...server, port: Number(e.target.value) })}
					/>
				</Field>
				<Field label="Encryption">
					<Select
						value={server.security}
						options={[
							{ value: "tls", label: "TLS" },
							{ value: "starttls", label: "STARTTLS" },
						]}
						onValueChange={(s) => onChange({ ...server, security: s === "tls" ? "tls" : "starttls" })}
					/>
				</Field>
			</div>
		</Section>
	);
}

export function UseEmailAccount({ agent, account, onSaved }: Props & { account: EmailAccount | null }) {
	const f = useFormValues({
		address: account?.address ?? "",
		username: account?.username ?? "",
		password: "",
		imap: account?.imap ?? { host: "", port: 993, security: "tls" as const },
		smtp: account?.smtp ?? { host: "", port: 465, security: "tls" as const },
	});
	const v = f.values;
	const guess = useMutation({
		mutationFn: api.email.guess,
		onError: actionError,
		onSuccess: (g, address) =>
			f.setValues((s) =>
				s.address === address ? { ...s, imap: g.imap, smtp: g.smtp, username: g.username } : s,
			),
	});
	const check = useMutation({ mutationFn: api.email.test, onError: actionError });
	const result = check.variables === v ? check.data : null;
	const submit = async () => {
		const a = account
			? await api.email.update(agent.id, {
					imap: v.imap,
					smtp: v.smtp,
					username: v.username,
					password: v.password,
				})
			: await api.email.connect(agent.id, v);
		f.reset();
		onSaved(a);
	};
	return (
		<FormGroup
			dirty={f.dirty}
			onCancel={() => f.reset()}
			submitLabel={account ? "Save" : "Connect"}
			disabled={!v.address || !v.password || !v.imap.host || !v.smtp.host}
			onSubmit={() => saveForm(submit)}
			extra={
				<Button
					variant="secondary"
					loading={check.isPending}
					disabled={!v.address || !v.password || !v.imap.host || !v.smtp.host}
					onClick={() => check.mutate(v)}
				>
					Test
				</Button>
			}
		>
			<Field
				label="Email address"
				action={
					!account && (
						<Button
							size="sm"
							variant="link"
							loading={guess.isPending}
							disabled={!v.address.includes("@")}
							onClick={() => guess.mutate(v.address)}
						>
							Find servers
						</Button>
					)
				}
			>
				<Input
					type="email"
					value={v.address}
					disabled={Boolean(account)}
					placeholder="mizuki@example.com"
					onChange={(e) => f.set("address", e.target.value)}
					onBlur={() => {
						if (
							!account &&
							!v.imap.host &&
							/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.address) &&
							!guess.isPending
						)
							guess.mutate(v.address);
					}}
				/>
			</Field>
			<Field label="Username" hint="Leave blank to sign in with the email address.">
				<Input autoComplete="off" value={v.username} onChange={(e) => f.set("username", e.target.value)} />
			</Field>
			<Field label="Password" hint="Some providers, including Gmail and Fastmail, need an app password.">
				<PasswordInput
					autoComplete="new-password"
					value={v.password}
					onChange={(e) => f.set("password", e.target.value)}
				/>
			</Field>
			<ServerFields title="Incoming mail (IMAP)" server={v.imap} onChange={(s) => f.set("imap", s)} />
			<ServerFields title="Outgoing mail (SMTP)" server={v.smtp} onChange={(s) => f.set("smtp", s)} />
			{result && (
				<Callout tone={result.imap.ok && result.smtp.ok ? "success" : "warning"}>
					{[result.imap.error ?? "Incoming mail works.", result.smtp.error ?? "Outgoing mail works."].join(
						" ",
					)}
				</Callout>
			)}
		</FormGroup>
	);
}
