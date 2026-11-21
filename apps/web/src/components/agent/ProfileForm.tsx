import type { Agent } from "@sekai/shared";
import { Field, FormGroup, Input, Textarea, useFormValues } from "@sekai/ui";
import { useAgentUpdate } from "../../bots/useAgentUpdate.ts";

const savedOf = (agent: Agent) => ({
	name: agent.name,
	label: agent.label,
	job: agent.job,
	personality: agent.personality,
	instructions: agent.instructions,
});

/** The bot's name, label, job, personality and standing instructions: one form, one Save. */
export function ProfileForm({ agent }: { agent: Agent }) {
	const update = useAgentUpdate(agent);
	const form = useFormValues(savedOf(agent));
	const { values } = form;

	return (
		<FormGroup
			dirty={form.dirty}
			disabled={!values.name.trim()}
			onCancel={() => form.reset()}
			onSubmit={async () => {
				const name = values.name.trim();
				await update({ ...values, name });
				form.reset({ ...values, name });
			}}
		>
			<div className="grid gap-4 xs:grid-cols-2">
				<Field
					label="Name"
					hint="What you call it, in chats and lists."
					error={values.name.trim() ? null : "Give it a name."}
				>
					<Input value={values.name} maxLength={60} onChange={(e) => form.set("name", e.target.value)} />
				</Field>
				<Field label="Label" optional>
					<Input
						value={values.label}
						maxLength={80}
						placeholder="e.g. Research lead"
						onChange={(e) => form.set("label", e.target.value)}
					/>
				</Field>
			</div>
			<Field label="Job" hint="What it owns, where it looks and what “done” means.">
				<Textarea
					value={values.job}
					onChange={(e) => form.set("job", e.target.value)}
					placeholder="e.g. Tracks my reading list and sends a Friday digest of what's worth my time."
				/>
			</Field>
			<Field label="Personality" hint="How it talks to you.">
				<Textarea
					value={values.personality}
					onChange={(e) => form.set("personality", e.target.value)}
					placeholder="e.g. Dry wit, very concise, never uses emoji."
				/>
			</Field>
			<Field label="Standing instructions" hint="Rules that always hold. It also learns rules into its memory.">
				<Textarea
					value={values.instructions}
					onChange={(e) => form.set("instructions", e.target.value)}
					placeholder={"e.g. Always ask before messaging anyone else.\nUse metric units."}
				/>
			</Field>
		</FormGroup>
	);
}
