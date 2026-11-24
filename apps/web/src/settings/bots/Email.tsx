import { api, qk } from "@sekai/client";
import type { MailcowSettings } from "@sekai/shared";
import {
	Button,
	Callout,
	Confirm,
	ErrorState,
	Field,
	FormGroup,
	Input,
	List,
	Page,
	PasswordInput,
	Section,
	SkeletonRows,
	ToggleRow,
	useFormValues,
} from "@sekai/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { actionError, saveForm } from "../../lib/forms.ts";
import type { SettingsSectionProps } from "../section.ts";

const editable = (s: MailcowSettings) => ({
	url: s.url,
	apiKey: s.apiKey,
	domains: s.domains,
	defaultQuotaMb: s.defaultQuotaMb,
});
function Connection({ saved }: { saved: MailcowSettings }) {
	const qc = useQueryClient();
	const form = useFormValues(editable(saved));
	const v = form.values;
	const [forget, setForget] = useState(false);
	const check = useMutation({ mutationFn: api.email.check, onError: actionError });
	const checked = check.variables?.url === v.url && check.variables?.apiKey === v.apiKey ? check.data : null;
	const domains = checked?.ok ? checked.domains.filter((d) => d.active).map((d) => d.name) : v.domains;
	const apply = (s: MailcowSettings) => {
		qc.setQueryData(qk.mailcow, s);
		void qc.invalidateQueries({ queryKey: qk.emailOptions });
		form.reset(editable(s));
		check.reset();
	};
	const remove = useMutation({
		mutationFn: api.email.forgetMailcow,
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: qk.mailcow });
			void qc.invalidateQueries({ queryKey: qk.emailOptions });
			check.reset();
		},
		onError: actionError,
	});
	return (
		<>
			<Section
				title="Mail server"
				description="Connect mailcow once, then choose where bots can have an address."
			>
				<FormGroup
					dirty={form.dirty}
					onCancel={() => {
						form.reset();
						check.reset();
					}}
					onSubmit={() => saveForm(async () => apply(await api.email.saveMailcow(v)))}
					disabled={!v.url.trim() || !v.apiKey.trim()}
					extra={
						<Button
							variant="secondary"
							disabled={!v.url || !v.apiKey}
							loading={check.isPending}
							onClick={() => check.mutate({ url: v.url, apiKey: v.apiKey })}
						>
							Check
						</Button>
					}
				>
					<Field label="Server address">
						<Input
							value={v.url}
							placeholder="https://mail.example.com"
							onChange={(e) => {
								form.set("url", e.target.value);
								if (v.url === saved.url) {
									form.set("apiKey", "");
									form.set("domains", []);
								}
							}}
						/>
					</Field>
					<Field
						label="API key"
						hint="Use a read-write key from mailcow. A read-only key can't create mailboxes."
					>
						<PasswordInput
							value={v.apiKey}
							autoComplete="new-password"
							onChange={(e) => form.set("apiKey", e.target.value)}
						/>
					</Field>
					{checked && (
						<Callout tone={checked.ok && checked.readWrite ? "success" : "warning"}>
							{checked.error ?? "Connected. Choose the domains bots can use below."}
						</Callout>
					)}
					<Section
						title="Domains for bots"
						description={
							domains.length
								? "Only selected domains can be used for new addresses."
								: "Check the connection to see the domains on your server."
						}
					>
						{domains.length > 0 && (
							<List>
								{domains.map((d) => (
									<ToggleRow
										key={d}
										title={d}
										checked={v.domains.includes(d)}
										onCheckedChange={(on) =>
											form.set(
												"domains",
												on ? [...v.domains, d] : v.domains.filter((x) => x !== d),
											)
										}
									/>
								))}
							</List>
						)}
					</Section>
					<Field label="Size of a new mailbox (MB)">
						<Input
							type="number"
							min={16}
							max={1048576}
							value={v.defaultQuotaMb || ""}
							onChange={(e) => form.set("defaultQuotaMb", Number(e.target.value))}
						/>
					</Field>
				</FormGroup>
			</Section>
			{saved.configured && (
				<Section title="Disconnect">
					<Button variant="danger-ghost" onClick={() => setForget(true)}>
						Disconnect mailcow
					</Button>
				</Section>
			)}
			<Confirm
				open={forget}
				onOpenChange={setForget}
				title="Disconnect mailcow?"
				description="Existing mailboxes and mail are kept. Bots can't get new addresses until you connect a server again."
				confirmLabel="Disconnect"
				danger
				onConfirm={() => remove.mutate()}
			/>
		</>
	);
}
export function EmailSection({ back }: SettingsSectionProps) {
	const q = useQuery({ queryKey: qk.mailcow, queryFn: api.email.mailcow });
	return (
		<Page back={back} title="Email" description="Give bots their own addresses on your mail server.">
			{q.isPending ? (
				<SkeletonRows count={4} />
			) : q.isError ? (
				<ErrorState error={q.error} onRetry={() => void q.refetch()} />
			) : (
				<Connection saved={q.data} />
			)}
		</Page>
	);
}
