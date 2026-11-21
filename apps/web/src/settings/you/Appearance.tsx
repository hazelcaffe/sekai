import { ThemePicker } from "@sekai/client";
import { Button, Fold, List, Page, Row, Section } from "@sekai/ui";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { useUi } from "../../stores/ui.ts";
import type { SettingsSectionProps } from "../section.ts";

type InstallPrompt = Event & { prompt: () => Promise<void> };

export function AppearanceSection({ back }: SettingsSectionProps) {
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
		<Page back={back} title="Appearance" description="A look for each group, light and dark.">
			<Section title="Theme">
				<ThemePicker value={theme} onChange={setTheme} />
				<Fold title="Learn more" variant="link">
					Automatic uses Virtual Singers when your device is light, and Nightcord at 25:00 when it's dark.
				</Fold>
			</Section>
			{install && (
				<List>
					<Row
						icon={<Download />}
						title="Install Sekai"
						subtitle="Its own window and icon, and notifications like an app."
						trailing={
							<Button variant="secondary" size="sm" onClick={() => void install.prompt()}>
								Install
							</Button>
						}
					/>
				</List>
			)}
		</Page>
	);
}
