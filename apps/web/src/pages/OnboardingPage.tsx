import { AgentAvatar, api, ModelRefPicker, useSettings } from "@sekai/client";
import { Button, Field, IconButton, Input } from "@sekai/ui";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, Menu } from "lucide-react";
import { useState } from "react";
import { freshLook, NewBotLook } from "../components/avatar/AvatarEditor.tsx";
import { useLayout } from "../lib/hooks.ts";
import { useOpenAgent } from "../lib/navigation.ts";
import { useUi } from "../stores/ui.ts";

/** "Introducing your primary bot": your name, then a name and look for the first bot. */
export function OnboardingPage() {
	const { data: settings } = useSettings();
	const { phone } = useLayout();
	const openAgent = useOpenAgent();
	const [userName, setUserName] = useState("");
	const [name, setName] = useState("");
	const [avatar, setAvatar] = useState(freshLook);
	const [model, setModel] = useState(settings?.defaultModel ?? null);

	const create = useMutation({
		mutationFn: async () => {
			const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
			await api.settings.update({
				userName: userName.trim(),
				...(settings?.timezone === "auto" ? { timezone } : {}),
				...(model ? { defaultModel: model } : {}),
			});
			return api.agents.create({
				name: name.trim(),
				label: "Primary bot",
				avatar,
				isPrimary: true,
				...(model ? { models: { primary: model, fast: settings?.defaultFastModel ?? null } } : {}),
			});
		},
		onSuccess: (agent) => void openAgent(agent.id),
	});

	return (
		<div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-safe pb-safe">
			{phone && (
				<div className="p-2">
					<IconButton label="Menu" onClick={() => useUi.getState().setSidebarOpen(true)}>
						<Menu />
					</IconButton>
				</div>
			)}
			<div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-6 py-10">
				<div className="flex flex-col items-center text-center">
					<AgentAvatar avatar={avatar} size={112} working={create.isPending} />
					<h1 className="mt-6 text-2xl font-semibold tracking-tight">Introducing your primary bot</h1>
					<p className="mt-2 text-sm leading-6 text-fg-muted">
						Your main point of contact. It remembers you, runs routines, and coordinates the other bots you
						add later.
					</p>
				</div>
				<form
					className="flex flex-col gap-5"
					onSubmit={(e) => {
						e.preventDefault();
						if (name.trim()) create.mutate();
					}}
				>
					<Field label="What should your bots call you?">
						<Input
							value={userName}
							onChange={(e) => setUserName(e.target.value)}
							placeholder="Sam"
							autoComplete="given-name"
						/>
					</Field>
					<Field label="Name your bot">
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Juniper"
							maxLength={60}
							autoFocus
						/>
					</Field>
					<NewBotLook value={avatar} onChange={setAvatar} />
					<Field label="Model" hint="You can swap it, or combine several, at any time.">
						<ModelRefPicker value={model ?? settings?.defaultModel ?? null} onChange={setModel} />
					</Field>
					<Button type="submit" variant="primary" size="lg" disabled={!name.trim() || create.isPending}>
						Create {name.trim() || "bot"} <ArrowRight />
					</Button>
				</form>
			</div>
		</div>
	);
}
