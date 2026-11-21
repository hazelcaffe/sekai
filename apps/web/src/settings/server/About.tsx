import { api, formatBytes, useAccess, useInfo } from "@sekai/client";
import { ErrorState, List, Page, Row, Section, SekaiMark, SkeletonRows } from "@sekai/ui";
import { useQuery } from "@tanstack/react-query";
import { Activity, Clock, Database, Images, Package } from "lucide-react";
import type { SettingsSectionProps } from "../section.ts";

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
	const { data: info, isLoading, isError, error, refetch } = useInfo();
	const { admin } = useAccess();
	const { data: health } = useQuery({
		queryKey: ["health"],
		queryFn: () => api.health(),
		staleTime: 60_000,
		enabled: admin,
	});

	if (isLoading) return <SkeletonRows count={4} />;
	if (isError || !info) {
		return <ErrorState title="Server info didn't load" error={error} onRetry={() => void refetch()} />;
	}

	return (
		<>
			<div className="flex items-center gap-4 rounded-lg border border-border bg-surface p-5">
				<SekaiMark size={48} />
				<div className="min-w-0">
					<div className="text-heading font-semibold tracking-tight text-fg">
						{info.name} <span className="font-normal text-fg-subtle">{info.version}</span>
					</div>
					<div className="text-small text-fg-muted">Your own team of AI bots, on your own server.</div>
				</div>
			</div>

			<Section title="This server">
				<List label="This server">
					{info.dataDir ? (
						<Row
							icon={<Database />}
							title="Data folder"
							subtitle={<code className="font-mono text-caption">{info.dataDir}</code>}
						/>
					) : null}
					{health ? (
						<Row
							icon={<Activity />}
							title="Running"
							subtitle={`Up ${uptime(health.server.uptime)} · ${formatBytes(health.server.memory)} memory${health.database ? ` · database ${formatBytes(health.database.size)}` : ""}`}
						/>
					) : null}
					<Row icon={<Clock />} title="Server time zone" value={info.timezone} />
				</List>
			</Section>

			<Section title="Credits">
				<List label="Credits">
					<Row
						icon={<Package />}
						title="Built with"
						subtitle="Bun, Hono, Postgres, React, Tailwind CSS and shadcn/ui."
					/>
					<Row
						icon={<Images />}
						title="Logos"
						subtitle="Brand marks from LobeHub Icons (MIT) and Simple Icons (CC0). They belong to their owners."
					/>
					<Row
						icon={<Images />}
						title="Avatar art"
						subtitle="Sekai's logo and the character icons are from HATSUNE MIKU: COLORFUL STAGE!'s media kit, shown unmodified. © SEGA / © Colorful Palette / © Crypton Future Media, INC."
					/>
				</List>
			</Section>
		</>
	);
}

export function AboutSection({ back }: SettingsSectionProps) {
	return (
		<Page back={back} title="About" description="Version, server details and credits.">
			<AboutBody />
		</Page>
	);
}
