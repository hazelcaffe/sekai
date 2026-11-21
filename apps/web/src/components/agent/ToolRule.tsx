import type { ToolPermission } from "@sekai/shared";
import { Select } from "@sekai/ui";

/** A rule for a tool, a kind of tool or an app: follow the approvals rule (default), or allow, ask, or turn it off. */
export type RuleValue = ToolPermission | "default";

export function RuleSelect({
	value,
	onChange,
	inherited = "By approvals",
	label,
	className,
}: {
	value: RuleValue;
	onChange: (v: RuleValue) => void;
	/** What "no rule" is called here ("As its kind" for a tool whose kind has a rule). */
	inherited?: string;
	label: string;
	className?: string;
}) {
	return (
		<Select
			size="sm"
			label={label}
			value={value}
			onValueChange={(v) => onChange(v as RuleValue)}
			className={className ?? "w-36 shrink-0"}
			options={[
				{ value: "default", label: inherited },
				{ value: "allow", label: "Allow" },
				{ value: "ask", label: "Ask" },
				{ value: "off", label: "Off" },
			]}
		/>
	);
}
