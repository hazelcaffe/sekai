import { Page } from "@sekai/ui";
import { ThisComputerSettings } from "../../components/computer/ThisComputerSettings.tsx";
import type { SettingsSectionProps } from "../section.ts";

export function ThisComputerSection({ back }: SettingsSectionProps) {
	return (
		<Page
			back={back}
			title="This computer"
			description="Choose who can work here and when they need your approval."
		>
			<ThisComputerSettings />
		</Page>
	);
}
