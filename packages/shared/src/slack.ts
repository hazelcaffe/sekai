/** A unique command per bot: Slack commands share a workspace-wide namespace, even between apps. */
export function slackCommand(bot: { id: string; name: string }): string {
	const name =
		bot.name
			.toLowerCase()
			.replace(/[^a-z0-9-]/g, "")
			.slice(0, 15) || "bot";
	return `/sekai-${name}-${bot.id
		.replace(/[^a-z0-9]/gi, "")
		.slice(-7)
		.toLowerCase()}`;
}

/** A private, Socket Mode app for one Sekai bot. No credentials or public URLs go in the manifest. */
export function slackManifest(bot: { id: string; name: string; job: string }) {
	const name = bot.name.trim().slice(0, 35) || "Sekai bot";
	const description = (bot.job.trim() || `Chat with ${name}, your personal Sekai bot.`).replace(/\s+/g, " ");
	return {
		_metadata: { major_version: 1 },
		display_information: { name, description: description.slice(0, 140) },
		features: {
			bot_user: { display_name: name, always_online: true },
			app_home: { home_tab_enabled: false, messages_tab_enabled: true, messages_tab_read_only_enabled: false },
			agent_view: { agent_description: description.slice(0, 300) },
			slash_commands: [
				{
					command: slackCommand(bot),
					description: `Chat controls for ${name}`,
					usage_hint: "help · status · new · stop · model · group",
					should_escape: true,
				},
			],
		},
		oauth_config: {
			scopes: {
				bot: [
					"app_mentions:read",
					"chat:write",
					"commands",
					"channels:history",
					"channels:read",
					"groups:history",
					"groups:read",
					"im:history",
					"im:read",
					"im:write",
					"mpim:history",
					"mpim:read",
					"users:read",
					"files:read",
					"files:write",
					"reactions:write",
				],
			},
		},
		settings: {
			socket_mode_enabled: true,
			token_rotation_enabled: false,
			interactivity: { is_enabled: true },
			event_subscriptions: {
				bot_events: ["app_mention", "message.channels", "message.groups", "message.im", "message.mpim"],
			},
		},
	};
}
