import type { Channel } from "@sekai/shared";
import {
	ActionRowBuilder,
	AttachmentBuilder,
	ButtonBuilder,
	ButtonStyle,
	Client,
	ChannelType as DiscordChannelType,
	type Message as DiscordMessage,
	Events,
	GatewayIntentBits,
	type Interaction,
	type MessageCreateOptions,
	type MessageEditOptions,
	MessageFlags,
	type MessageMentionOptions,
	Partials,
	PermissionFlagsBits,
	REST,
	Routes,
	StringSelectMenuBuilder,
} from "discord.js";
import { errorMessage } from "../lib/errors.ts";
import { truncate } from "../lib/text.ts";
import { channelSecret } from "./state.ts";
import {
	type ChannelAdapter,
	type ChannelHandlers,
	type ChatRef,
	type CommandInvocation,
	type CommandOptionSpec,
	type CommandOptions,
	type CommandSpec,
	download,
	type InboundMention,
	MAX_INBOUND_BYTES,
	type Reply,
} from "./types.ts";

/** What the bot needs in a server: see and post in channels and threads, read history, react, embed links. */
const PERMISSIONS =
	PermissionFlagsBits.ViewChannel |
	PermissionFlagsBits.SendMessages |
	PermissionFlagsBits.SendMessagesInThreads |
	PermissionFlagsBits.EmbedLinks |
	PermissionFlagsBits.AttachFiles |
	PermissionFlagsBits.ReadMessageHistory |
	PermissionFlagsBits.AddReactions;

/** Application flags: the Message Content intent is enabled (verified or not). */
const MESSAGE_CONTENT_FLAGS = (1 << 18) | (1 << 19);

const NO_PINGS: MessageMentionOptions = { parse: [] };

const BUTTON_STYLE = {
	primary: ButtonStyle.Primary,
	secondary: ButtonStyle.Secondary,
	success: ButtonStyle.Success,
	danger: ButtonStyle.Danger,
} as const;

// ---------------------------------------------------------------- commands

const OPTION_TYPE = { string: 3, integer: 4, boolean: 5 } as const;
/** Guild text channels and DMs with the bot. */
const CONTEXTS = [0, 1];

function optionJson(o: CommandOptionSpec) {
	return {
		type: OPTION_TYPE[o.type],
		name: o.name,
		description: truncate(o.description, 100),
		required: o.required ?? false,
		...(o.choices ? { choices: o.choices.slice(0, 25).map((c) => ({ name: c.name, value: c.value })) } : {}),
		...(o.autocomplete ? { autocomplete: true } : {}),
	};
}

/** A command as Discord's API wants it (slash commands, and message commands in the Apps menu). */
export function commandJson(spec: CommandSpec) {
	if (spec.kind === "message") return { type: 3, name: spec.name, contexts: CONTEXTS, integration_types: [0] };
	return {
		type: 1,
		name: spec.name,
		description: truncate(spec.description, 100),
		contexts: CONTEXTS,
		integration_types: [0],
		options: spec.subcommands?.length
			? spec.subcommands.map((s) => ({
					type: 1,
					name: s.name,
					description: truncate(s.description, 100),
					options: (s.options ?? []).map(optionJson),
				}))
			: (spec.options ?? []).map(optionJson),
	};
}

/** Just the parts that matter, so unchanged commands aren't published again on every start. */
function signature(cmds: unknown[]): string {
	const norm = (x: unknown): unknown => {
		if (Array.isArray(x)) return x.map(norm);
		if (!x || typeof x !== "object") return x;
		const o = x as Record<string, unknown>;
		return {
			type: o.type ?? 1,
			name: o.name,
			description: o.description ?? "",
			required: o.required ?? false,
			autocomplete: o.autocomplete ?? false,
			choices: norm(o.choices ?? []),
			options: norm(o.options ?? []),
			value: o.value,
		};
	};
	return JSON.stringify(
		(norm(cmds) as { name: string }[]).sort((a, b) => String(a.name).localeCompare(String(b.name))),
	);
}

// ---------------------------------------------------------------- messages

function components(reply: Reply) {
	const rows: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];
	if (reply.select && reply.select.options.length > 0) {
		const s = reply.select;
		const menu = new StringSelectMenuBuilder()
			.setCustomId(s.id.slice(0, 100))
			.setPlaceholder(truncate(s.placeholder, 150))
			.setMinValues(s.min ?? 1)
			.setMaxValues(Math.min(s.max ?? 1, s.options.length))
			.addOptions(
				s.options.slice(0, 25).map((o) => ({
					value: o.value.slice(0, 100),
					label: truncate(o.label || o.value, 100),
					...(o.description ? { description: truncate(o.description, 100) } : {}),
					default: o.selected ?? false,
				})),
			);
		rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu));
	}
	const buttons = reply.buttons ?? [];
	for (let i = 0; i < buttons.length && rows.length < 5; i += 5) {
		rows.push(
			new ActionRowBuilder<ButtonBuilder>().addComponents(
				buttons.slice(i, i + 5).map((b) => {
					const button = new ButtonBuilder().setLabel(truncate(b.label, 80));
					return b.url
						? button.setStyle(ButtonStyle.Link).setURL(b.url)
						: button.setCustomId(b.id.slice(0, 100)).setStyle(BUTTON_STYLE[b.style ?? "secondary"]);
				}),
			),
		);
	}
	return rows;
}

function render(content: string | Reply): MessageEditOptions & MessageCreateOptions {
	if (typeof content === "string") return { content: truncate(content, 2000), allowedMentions: NO_PINGS };
	// A voice message: just the audio (Discord doesn't allow text with it).
	const voice = content.files?.find((f) => f.voice);
	if (voice?.voice) {
		const file = new AttachmentBuilder(Buffer.from(voice.data), { name: "voice-message.ogg" })
			.setDuration(voice.voice.durationMs / 1000)
			.setWaveform(voice.voice.waveform);
		return {
			files: [file],
			flags: MessageFlags.IsVoiceMessage,
			allowedMentions: NO_PINGS,
		} as unknown as MessageEditOptions & MessageCreateOptions;
	}
	return {
		content: truncate(content.text || (content.files?.length ? "" : "\u200b"), 2000),
		components: components(content),
		allowedMentions: NO_PINGS,
		...(content.files?.length
			? { files: content.files.map((f) => ({ attachment: Buffer.from(f.data), name: f.name })) }
			: {}),
	};
}

function chatName(m: DiscordMessage): string {
	const ch = m.channel;
	if (ch.type === DiscordChannelType.DM) return `DM with ${m.author.username}`;
	const guild = m.guild ? ` (${m.guild.name})` : "";
	if (ch.isThread()) return `#${ch.name}${ch.parent ? ` in #${ch.parent.name}` : ""}${guild}`;
	return "name" in ch ? `#${ch.name}${guild}` : `Discord chat${guild}`;
}

function displayName(user: { globalName: string | null; username: string }, member?: { displayName: string } | null) {
	return member?.displayName ?? user.globalName ?? user.username;
}

/**
 * Discord bot via discord.js (official Gateway + REST APIs). Without the privileged Message Content intent
 * it sees DMs and messages that mention it; with it (turned on in the Developer Portal) it can /listen too.
 */
export function discordAdapter(channel: Channel): ChannelAdapter {
	const token = channelSecret(channel, "botToken");
	let client: Client | null = null;
	let rest: REST | null = null;
	let appId = "";
	let specs = new Map<string, CommandSpec>();

	async function textChannel(chatId: string) {
		if (!client) throw new Error("Discord bot is not running");
		const ch = await client.channels.fetch(chatId);
		if (!ch?.isTextBased() || !ch.isSendable()) throw new Error(`Can't post in Discord channel ${chatId}`);
		return ch;
	}

	function chatRef(i: Interaction): ChatRef {
		const ch = i.channel;
		const isGroup = Boolean(i.guildId) && ch?.type !== DiscordChannelType.DM;
		const guild = i.guild ? ` (${i.guild.name})` : "";
		const name = !ch
			? "Discord chat"
			: ch.type === DiscordChannelType.DM
				? `DM with ${i.user.username}`
				: ch.isThread()
					? `#${ch.name}${ch.parent ? ` in #${ch.parent.name}` : ""}${guild}`
					: "name" in ch && ch.name
						? `#${ch.name}${guild}`
						: `Discord chat${guild}`;
		return {
			chatId: i.channelId ?? "",
			chatName: name,
			isGroup,
			serverId: i.guildId,
			senderId: i.user.id,
			senderName: displayName(i.user, i.inCachedGuild() ? i.member : null),
		};
	}

	async function onMessage(h: ChannelHandlers, c: Client, m: DiscordMessage) {
		if (!c.user || m.author.id === c.user.id || m.system) return;
		const botId = c.user.id;
		const isGroup = m.channel.type !== DiscordChannelType.DM;
		const mentions: InboundMention[] = [];
		for (const u of m.mentions.users.values()) {
			mentions.push({
				id: u.id,
				name: displayName(u, m.mentions.members?.get(u.id)),
				bot: u.bot,
				tokens: [`<@${u.id}>`, `<@!${u.id}>`],
			});
		}
		// Typing @BotName in a server sometimes inserts the bot's own role instead of the bot.
		for (const r of m.mentions.roles.values()) {
			const roleBot = r.tags?.botId;
			if (roleBot) {
				const existing = mentions.find((x) => x.id === roleBot);
				if (existing) existing.tokens.push(`<@&${r.id}>`);
				else mentions.push({ id: roleBot, name: r.name, bot: true, tokens: [`<@&${r.id}>`] });
			}
		}
		// Fetched only after the manager has checked who's asking (strangers can't make the server download files).
		const files = [...m.attachments.values()]
			.filter((a) => a.size <= MAX_INBOUND_BYTES)
			.map((a) => ({
				name: a.name,
				mime: a.contentType ?? "application/octet-stream",
				load: () => download(a.url),
			}));
		await h.onMessage({
			chatId: m.channelId,
			chatName: chatName(m),
			isGroup,
			serverId: m.guildId,
			senderId: m.author.id,
			senderName: displayName(m.author, m.member),
			senderIsBot: m.author.bot,
			text: m.content,
			messageId: m.id,
			replyToId: m.reference?.messageId ?? null,
			addressed:
				!isGroup ||
				mentions.some((x) => x.id === botId) ||
				m.mentions.repliedUser?.id === botId ||
				m.mentions.everyone,
			everyone: m.mentions.everyone,
			mentions,
			attachments: files,
		});
	}

	function invocation(i: Interaction, name: string, sub: string | null, options: CommandOptions): CommandInvocation {
		return { ...chatRef(i), name, sub, options, targetMessageId: null };
	}

	async function onInteraction(h: ChannelHandlers, i: Interaction) {
		if (i.isAutocomplete()) {
			const focused = i.options.getFocused(true);
			const sub = i.options.getSubcommand(false);
			const choices = await h
				.onAutocomplete(invocation(i, i.commandName, sub, {}), focused.name, String(focused.value))
				.catch(() => []);
			await i.respond(choices.slice(0, 25)).catch(() => {});
			return;
		}
		if (i.isChatInputCommand()) {
			const spec = specs.get(i.commandName);
			await i.deferReply(spec?.public ? {} : { flags: MessageFlags.Ephemeral });
			const options: CommandOptions = {};
			for (const o of i.options.data.flatMap((d) => (d.options?.length ? d.options : [d]))) {
				if (o.value !== undefined) options[o.name] = o.value as string | number | boolean;
			}
			const reply = await h.onCommand(invocation(i, i.commandName, i.options.getSubcommand(false), options));
			await i.editReply(render(reply));
			return;
		}
		if (i.isMessageContextMenuCommand()) {
			await i.deferReply({ flags: MessageFlags.Ephemeral });
			const reply = await h.onCommand({ ...invocation(i, i.commandName, null, {}), targetMessageId: i.targetId });
			await i.editReply(render(reply));
			return;
		}
		if (i.isButton() || i.isStringSelectMenu()) {
			await i.deferUpdate();
			const result = await h.onAction({
				...chatRef(i),
				id: i.customId,
				values: i.isStringSelectMenu() ? i.values : [],
				messageId: i.message.id,
			});
			if (result.update) await i.editReply(render(result.update));
			if (result.whisper) await i.followUp({ content: result.whisper, flags: MessageFlags.Ephemeral });
		}
	}

	return {
		maxText: 1900,
		help: {
			tips: "Right-click one of my messages → Apps → **Retry**, **Retry with another model** or **Erase and retry**.",
		},
		mention: (userId) => `<@${userId}>`,
		subtext: (text) =>
			text
				.split("\n")
				.map((l) => (l.trim() ? `-# ${l}` : l))
				.join("\n"),

		async start(h: ChannelHandlers) {
			if (!token) throw new Error("Add the bot token from the Discord Developer Portal");
			rest = new REST({ version: "10" }).setToken(token);
			let app: { id: string; flags?: number };
			try {
				app = (await rest.get(Routes.currentApplication())) as { id: string; flags?: number };
			} catch (err) {
				const msg = errorMessage(err);
				throw new Error(/401|unauthorized/i.test(msg) ? "Discord rejected the bot token" : msg);
			}
			appId = app.id;
			const readsAll = ((app.flags ?? 0) & MESSAGE_CONTENT_FLAGS) !== 0;
			client = new Client({
				intents: [
					GatewayIntentBits.Guilds,
					GatewayIntentBits.GuildMessages,
					GatewayIntentBits.DirectMessages,
					GatewayIntentBits.GuildVoiceStates,
					...(readsAll ? [GatewayIntentBits.MessageContent] : []),
				],
				partials: [Partials.Channel, Partials.Message],
			});
			const c = client;

			c.on(Events.MessageCreate, (m) => {
				onMessage(h, c, m).catch((err: unknown) =>
					h.log("warn", `discord message handling failed: ${errorMessage(err)}`),
				);
			});
			c.on(Events.InteractionCreate, (i) => {
				onInteraction(h, i).catch(async (err: unknown) => {
					h.log("warn", `discord interaction failed: ${errorMessage(err)}`);
					if (i.isRepliable() && (i.deferred || i.replied)) {
						await i
							.followUp({
								content: `⚠️ ${truncate(errorMessage(err), 300)}`,
								flags: MessageFlags.Ephemeral,
							})
							.catch(() => {});
					}
				});
			});
			c.on(Events.Error, (err) => h.log("warn", `discord: ${errorMessage(err)}`));
			c.on(Events.ShardDisconnect, (ev) => {
				// 4004 = invalid token; 4014 = disallowed intents. Anything else reconnects on its own.
				if (ev.code === 4004 || ev.code === 4014)
					h.onFatal(new Error(`Discord closed the connection (${ev.code})`));
			});

			let readyTimer: ReturnType<typeof setTimeout> | undefined;
			const ready = new Promise<void>((resolve, reject) => {
				readyTimer = setTimeout(() => reject(new Error("Timed out connecting to Discord")), 30_000);
				c.once(Events.ClientReady, () => {
					clearTimeout(readyTimer);
					resolve();
				});
			});
			try {
				await c.login(token);
			} catch (err) {
				// Nobody waits for `ready` now: don't let its timer reject into the void.
				clearTimeout(readyTimer);
				ready.catch(() => {});
				throw new Error(
					/TOKEN_INVALID|invalid token/i.test(errorMessage(err))
						? "Discord rejected the bot token"
						: errorMessage(err),
				);
			}
			await ready;
			if (!c.user) throw new Error("Discord login returned no user");
			return {
				botId: c.user.id,
				botName: c.user.tag,
				inviteUrl: `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot+applications.commands&permissions=${PERMISSIONS}`,
				readsAll,
			};
		},

		async stop() {
			await client?.destroy().catch(() => {});
			client = null;
		},

		async registerCommands(commands) {
			if (!rest || !appId) return;
			specs = new Map(commands.map((s) => [s.name, s]));
			const body = commands.map(commandJson);
			const current = (await rest.get(Routes.applicationCommands(appId))) as unknown[];
			if (signature(current) === signature(body)) return;
			await rest.put(Routes.applicationCommands(appId), { body });
		},

		async send(chatId, content, opts) {
			const ch = await textChannel(chatId);
			const sent = await ch.send({
				...render(content),
				...(opts?.replyTo ? { reply: { messageReference: opts.replyTo, failIfNotExists: false } } : {}),
			});
			return sent.id;
		},

		async edit(chatId, messageId, content) {
			const ch = await textChannel(chatId);
			await ch.messages.edit(messageId, render(content));
		},

		async remove(chatId, messageId) {
			const ch = await textChannel(chatId);
			await ch.messages.delete(messageId);
		},

		async react(chatId, messageId, emoji) {
			const ch = await textChannel(chatId);
			await ch.messages.react(messageId, emoji);
		},

		async typing(chatId) {
			const ch = await textChannel(chatId).catch(() => null);
			await ch?.sendTyping().catch(() => {});
		},

		voice: {
			async userVoice(userId) {
				if (!client) return null;
				for (const guild of client.guilds.cache.values()) {
					const state = guild.voiceStates.cache.get(userId);
					if (state?.channelId) {
						return { guildId: guild.id, channelId: state.channelId, name: state.channel?.name ?? "voice" };
					}
				}
				return null;
			},
			async findChannel(ref, near) {
				if (!client) return null;
				const clean = ref
					.trim()
					.replace(/^<#(\d+)>$/, "$1")
					.replace(/^#/, "")
					.toLowerCase();
				const byId = /^\d{15,25}$/.test(clean) ? await client.channels.fetch(clean).catch(() => null) : null;
				if (byId?.isVoiceBased()) return { guildId: byId.guildId, channelId: byId.id, name: byId.name };
				let guildId = near.guildId ?? null;
				if (!guildId && near.chatId) {
					const ch = await client.channels.fetch(near.chatId).catch(() => null);
					guildId = ch && "guildId" in ch ? (ch.guildId ?? null) : null;
				}
				const guilds = guildId
					? [client.guilds.cache.get(guildId)].filter(Boolean)
					: [...client.guilds.cache.values()];
				for (const g of guilds) {
					const all = await g?.channels.fetch().catch(() => null);
					for (const c of all?.values() ?? []) {
						if (
							c?.isVoiceBased() &&
							(c.name.toLowerCase() === clean || !clean || /^(vc|voice|call)$/.test(clean))
						) {
							return { guildId: c.guildId, channelId: c.id, name: c.name };
						}
					}
				}
				return null;
			},
			membersIn(guildId, channelId) {
				const g = client?.guilds.cache.get(guildId);
				return g
					? [...g.voiceStates.cache.values()].filter((v) => v.channelId === channelId).map((v) => v.id)
					: [];
			},
			async guildOf(chatId) {
				const ch = await client?.channels.fetch(chatId).catch(() => null);
				return ch && "guildId" in ch ? (ch.guildId ?? null) : null;
			},
			adapterCreator(guildId) {
				const g = client?.guilds.cache.get(guildId);
				if (!g) throw new Error("The bot isn't in that server");
				return g.voiceAdapterCreator;
			},
		},

		async openDirect(userId) {
			if (!client?.user) throw new Error("The bot isn't connected");
			const user = await client.users.fetch(userId);
			const dm = await user.createDM();
			return { chatId: dm.id, name: `DM with ${user.username}` };
		},

		async canPost(chatId) {
			if (!client?.user) return false;
			const ch = await client.channels.fetch(chatId).catch(() => null);
			if (!ch?.isTextBased()) return false;
			if (ch.isDMBased()) return true;
			const perms = ch.permissionsFor(client.user);
			const send = ch.isThread() ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;
			return Boolean(perms?.has(PermissionFlagsBits.ViewChannel) && perms.has(send));
		},
	};
}
