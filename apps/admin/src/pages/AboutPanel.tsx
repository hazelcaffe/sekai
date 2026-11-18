import { api, formatBytes, useAccess, useInfo } from "@sekai/client";
import { SekaiMark, SettingsGroup, SettingsPanel, SettingsRow, Spinner } from "@sekai/ui";
import { useQuery } from "@tanstack/react-query";
import { Activity, Clock, Database, Images, Package, ShieldCheck } from "lucide-react";

/** "3 days, 4 hours" / "2 hours" / "5 minutes". */
function uptime(ms: number): string {
	const m = Math.floor(ms / 60_000);
	const h = Math.floor(m / 60);
	const d = Math.floor(h / 24);
	if (d) return `${d} ${d === 1 ? "day" : "days"}${h % 24 ? `, ${h % 24} ${h % 24 === 1 ? "hour" : "hours"}` : ""}`;
	if (h) return `${h} ${h === 1 ? "hour" : "hours"}`;
	return `${m} ${m === 1 ? "minute" : "minutes"}`;
}

function AboutBody() {
	const { data: info } = useInfo();
	const { admin } = useAccess();
	// How the server is doing is for admins.
	const { data: health } = useQuery({
		queryKey: ["health"],
		queryFn: () => api.health(),
		staleTime: 60_000,
		enabled: admin,
	});
	if (!info) return <Spinner />;
	return (
		<>
			<div className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5">
				<SekaiMark size={48} />
				<div>
					<div className="text-lg font-semibold tracking-tight">
						{info.name} <span className="font-normal text-fg-subtle">{info.version}</span>
					</div>
					<div className="text-[13px] text-muted-foreground">
						Your own team of AI agents, on your own server.
					</div>
				</div>
			</div>
			<SettingsGroup>
				<SettingsRow
					icon={<Database />}
					title="Data"
					description={<code className="font-mono">{info.dataDir}</code>}
				/>
				{health && (
					<SettingsRow
						icon={<Activity />}
						title="Running"
						description={`For ${uptime(health.server.uptime)}, using ${formatBytes(health.server.memory)} of memory${health.database ? ` · database ${formatBytes(health.database.size)}` : ""}`}
					/>
				)}
				<SettingsRow icon={<Clock />} title="Server time zone" description={info.timezone} />
				<SettingsRow
					icon={<ShieldCheck />}
					title="Sign-in"
					description="One owner account, with a password and passkeys. Scripts use API tokens."
				/>
				<SettingsRow
					icon={<Package />}
					title="Built with"
					description="Bun, Hono, Postgres, React, Tailwind CSS and shadcn/ui (restyled as Sekai's design system)."
				/>
				<SettingsRow
					icon={<Images />}
					title="Logos"
					description="Brand marks for subscriptions, API providers and model makers from LobeHub Icons (MIT). They belong to their owners and only show which service is which."
				/>
				<SettingsRow
					icon={<Images />}
					title="Avatar art"
					description="Sekai's logo and the character icons are from HATSUNE MIKU: COLORFUL STAGE!'s media kit, shown unmodified. © SEGA / © Colorful Palette / © Crypton Future Media, INC."
				/>
			</SettingsGroup>
		</>
	);
}

export function AboutPanel() {
	return (
		<SettingsPanel value="about" title="About">
			<AboutBody />
		</SettingsPanel>
	);
}
