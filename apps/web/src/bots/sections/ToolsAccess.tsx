import { Page } from "@sekai/ui";
import { AccessSettings } from "../../components/agent/AccessSettings.tsx";
import { AppsAccess } from "../../components/agent/AppsAccess.tsx";
import { SkillsAccess } from "../../components/agent/SkillsAccess.tsx";
import { ToolRules } from "../../components/agent/ToolRules.tsx";
import type { BotSectionProps } from "../section.ts";

/** Its approvals rule and web search, the apps and skills it may use, and (under a fold) what it may do. */
export function ToolsAccessSection({ agent, back }: BotSectionProps) {
	return (
		<Page back={back} title="Tools & access" description={`What ${agent.name} may use, and when it must ask you.`}>
			<AccessSettings agent={agent} />
			<AppsAccess agent={agent} />
			<SkillsAccess agent={agent} />
			<ToolRules agent={agent} />
		</Page>
	);
}
