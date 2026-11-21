import { AgentAvatar, api, ModelRefPicker, qk, useAccess, useAuth, useSettings } from "@sekai/client";
import type { AuthStatus, ModelRef } from "@sekai/shared";
import { Button, Callout, errorMessage, Field, Fold, Input } from "@sekai/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { freshLook, NewBotLook } from "../components/avatar/AvatarEditor.tsx";
import { useOpenAgent } from "../lib/navigation.ts";
import { signOut } from "../lib/session.ts";
import { useUi } from "../stores/ui.ts";

/**
 * /welcome, outside the app: your name, then your first bot's name, look and model. Only for people who may make
 * bots (everyone else goes to the app, where shared bots show up); Skip for now and Sign out are the ways out.
 */
export function OnboardingPage() {
	const { data: settings } = useSettings();
	const { data: auth } = useAuth();
	const { access, can } = useAccess();
	const qc = useQueryClient();
	const navigate = useNavigate();
	const openAgent = useOpenAgent();
	const accountName = auth?.user?.name ?? "";
	const [userName, setUserName] = useState<string | null>(null);
	const [name, setName] = useState("");
	const [avatar, setAvatar] = useState(freshLook);
	// Only a model you picked here: it goes to this bot alone, never to the server's default.
	const [model, setModel] = useState<ModelRef | null>(null);

	const create = useMutation({
		mutationFn: async () => {
			const callMe = (userName ?? accountName).trim();
			if (callMe && callMe !== accountName) {
				const user = await api.auth.updateAccount({ name: callMe });
				qc.setQueryData<AuthStatus>(qk.auth, (s) => (s ? { ...s, user } : s));
			}
			if (settings?.timezone === "auto") {
				await api.settings.update({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
			}
			return api.agents.create({
				name: name.trim(),
				label: "Primary bot",
				avatar,
				isPrimary: true,
				...(model ? { models: { primary: model, fast: settings?.defaultFastModel ?? null } } : {}),
			});
		},
		onSuccess: (agent) => void openAgent(agent.id, { replace: true }),
	});

	if (access && !can("bots")) return <Navigate to="/" replace />;
	const skip = () => {
		if (access) useUi.getState().skipWelcome(access.userId);
		navigate("/", { replace: true });
	};

	return (
		<div className="flex min-h-dvh flex-col items-center overflow-y-auto px-4 pt-safe pb-safe sm:px-6">
			<main className="flex w-full max-w-[440px] flex-1 flex-col justify-center py-10">
				<div className="mb-6 flex flex-col items-center text-center">
					<AgentAvatar avatar={avatar} size={88} working={create.isPending} />
					<h1 className="mt-5 font-heading text-title font-semibold tracking-tight">Your first bot</h1>
					<p className="mt-2 max-w-sm text-body text-balance text-fg-muted">
						Your main point of contact. It remembers you and runs routines.
					</p>
				</div>
				<form
					className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 sm:p-6"
					onSubmit={(e) => {
						e.preventDefault();
						if (name.trim() && !create.isPending) create.mutate();
					}}
				>
					<Field label="What should your bots call you?">
						<Input
							value={userName ?? accountName}
							onChange={(e) => setUserName(e.target.value)}
							placeholder="e.g. Sam"
							autoComplete="given-name"
						/>
					</Field>
					<Field label="Bot's name">
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="e.g. Juniper"
							maxLength={60}
							autoFocus
						/>
					</Field>
					{/* The look shows in the picture above; picking another is folded so the whole form fits a screen. */}
					<Fold title="Look" summary="Change">
						<NewBotLook value={avatar} onChange={setAvatar} />
					</Fold>
					<Field label="Model" hint="You can change it any time.">
						<ModelRefPicker value={model ?? settings?.defaultModel ?? null} onChange={setModel} />
					</Field>
					{create.isError && <Callout tone="danger">{errorMessage(create.error)}</Callout>}
					<Button
						type="submit"
						variant="primary"
						size="lg"
						loading={create.isPending}
						disabled={!name.trim()}
					>
						Create {name.trim() || "bot"}
					</Button>
				</form>
				<div className="mt-4 flex items-center justify-center gap-1">
					<Button variant="ghost" size="sm" onClick={skip}>
						Skip for now
					</Button>
					<span aria-hidden className="text-fg-subtle">
						·
					</span>
					<Button variant="ghost" size="sm" onClick={() => void signOut()}>
						Sign out
					</Button>
				</div>
			</main>
		</div>
	);
}
