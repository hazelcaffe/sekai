import { api } from "@sekai/client";
import type { MobilePushStatus } from "@sekai/shared";
import { Badge, Field, FormGroup, Input, List, Row, Section, SkeletonRows, Textarea, useFormValues } from "@sekai/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Smartphone } from "lucide-react";
import { LoadProblem } from "../../components/computer/LoadProblem.tsx";

const key = ["mobile-push-settings"] as const;
const fields = (s: MobilePushStatus, ios: boolean) =>
	ios
		? {
				apnsKeyId: s.settings.apnsKeyId,
				apnsTeamId: s.settings.apnsTeamId,
				apnsBundleId: s.settings.apnsBundleId,
				apnsKey: s.settings.apnsKey,
			}
		: { firebaseConfig: s.settings.firebaseConfig, firebaseServiceAccount: s.settings.firebaseServiceAccount };

function PhoneKeys({ status, ios }: { status: MobilePushStatus; ios: boolean }) {
	const qc = useQueryClient();
	const f = useFormValues(fields(status, ios));
	const data = ios ? status.ios : status.android;
	return (
		<Section
			title={ios ? "Apple push" : "Firebase messaging"}
			action={<Badge tone={data.ready ? "success" : "neutral"}>{data.ready ? "Ready" : "Not ready"}</Badge>}
		>
			<FormGroup
				dirty={f.dirty}
				onCancel={() => f.reset()}
				onSubmit={async () => {
					try {
						const next = await api.admin.saveMobile(f.values);
						qc.setQueryData(key, next);
						f.reset(fields(next, ios));
					} catch {
						throw new Error(
							ios
								? "Couldn’t save Apple push. Check the IDs and the contents of the .p8 file, then try again."
								: "Couldn’t save Firebase settings. Check both JSON files and try again.",
						);
					}
				}}
			>
				{ios ? (
					<>
						<Field label="Team ID">
							<Input
								value={f.values.apnsTeamId}
								maxLength={20}
								onChange={(e) => f.set("apnsTeamId", e.target.value)}
							/>
						</Field>
						<Field label="Key ID">
							<Input
								value={f.values.apnsKeyId}
								maxLength={20}
								onChange={(e) => f.set("apnsKeyId", e.target.value)}
							/>
						</Field>
						<Field label="App bundle ID">
							<Input
								value={f.values.apnsBundleId}
								maxLength={200}
								onChange={(e) => f.set("apnsBundleId", e.target.value)}
							/>
						</Field>
						<Field
							label="Apple push key"
							hint="Paste the whole .p8 file, including the first and last lines."
						>
							<Textarea
								spellCheck={false}
								autoComplete="off"
								value={f.values.apnsKey}
								onChange={(e) => f.set("apnsKey", e.target.value)}
							/>
						</Field>
					</>
				) : (
					<>
						<Field
							label="Android app settings"
							hint="Paste google-services.json from the Android app in your Firebase project."
						>
							<Textarea
								spellCheck={false}
								value={f.values.firebaseConfig}
								onChange={(e) => f.set("firebaseConfig", e.target.value)}
							/>
						</Field>
						<Field
							label="Service account key"
							hint="Paste the JSON key from the same project’s Service accounts page."
						>
							<Textarea
								spellCheck={false}
								autoComplete="off"
								value={f.values.firebaseServiceAccount}
								onChange={(e) => f.set("firebaseServiceAccount", e.target.value)}
							/>
						</Field>
					</>
				)}
				{data.problem && (
					<p role="status" className="text-small text-warning-ink">
						{data.problem}
					</p>
				)}
			</FormGroup>
		</Section>
	);
}

export function PhoneNotifications({ platform }: { platform?: string }) {
	const q = useQuery({ queryKey: key, queryFn: api.admin.mobile });
	if (q.isError) return <LoadProblem what="phone settings" retry={q.refetch} />;
	if (!q.data) return <SkeletonRows count={2} />;
	if (platform === "ios" || platform === "android")
		return <PhoneKeys key={platform} status={q.data} ios={platform === "ios"} />;
	return (
		<List>
			{(
				[
					["ios", "iPhone and iPad"],
					["android", "Android"],
				] as const
			).map(([id, title]) => (
				<Row
					key={id}
					icon={<Smartphone />}
					title={title}
					subtitle={`${q.data[id].ready ? "Ready" : "Not set up"} · ${q.data.devices[id]} registered devices`}
					href={`/settings/network/notifications/${id}`}
				/>
			))}
		</List>
	);
}
