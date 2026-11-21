import { api, qk, queryClient, useAuth, useInfo, useSettings } from "@sekai/client";
import { Field, Page, SaveState, Section, Select, SkeletonRows, useAutosave } from "@sekai/ui";
import { useMemo, useState } from "react";
import type { SettingsSectionProps } from "../section.ts";
import { Profile } from "./account.tsx";

/** Routines and reminders run in your time zone. */
function TimeZone() {
	const { data: settings } = useSettings();
	const { data: info } = useInfo();
	const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const zones = useMemo(() => {
		try {
			return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
		} catch {
			return [browserTz];
		}
	}, [browserTz]);
	// What you picked shows at once, and stays if saving it fails (Try again sends it again).
	const [picked, setPicked] = useState<string | null>(null);
	const save = useAutosave((timezone: string) =>
		api.settings.update({ timezone }).then((s) => {
			queryClient.setQueryData(qk.settings, s);
			setPicked((p) => (p === timezone ? null : p));
		}),
	);
	const choose = (tz: string) => {
		setPicked(tz);
		save.save(tz);
	};
	if (!settings) return <SkeletonRows count={1} leading={false} />;
	const value = picked ?? settings.timezone;
	return (
		<Section
			title="Time zone"
			description="Routines and reminders run in this zone."
			saveState={<SaveState state={save} />}
		>
			<Field
				label="Time zone"
				hint={`This device is in ${browserTz.replace(/_/g, " ")}.`}
				action={
					value !== browserTz ? (
						<button
							type="button"
							onClick={() => choose(browserTz)}
							className="text-small font-medium text-brand-ink hover:underline coarse:py-1"
						>
							Use this device's
						</button>
					) : undefined
				}
			>
				<Select
					value={value}
					onValueChange={choose}
					options={[
						{ value: "auto", label: `Server default (${info?.timezone ?? "…"})` },
						...zones.map((z) => ({ value: z, label: z.replace(/_/g, " ") })),
					]}
				/>
			</Field>
		</Section>
	);
}

export function ProfileSection({ back }: SettingsSectionProps) {
	const { data: status } = useAuth();
	const role = status?.access?.roleName;
	return (
		<Page back={back} title="Profile" description={role ? `Your role here: ${role}.` : "How your bots know you."}>
			{status?.user ? <Profile user={status.user} /> : <SkeletonRows count={3} leading={false} />}
			<TimeZone />
		</Page>
	);
}
