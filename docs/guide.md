# User guide

- [Bots and chats](#bots-and-chats)
- [People, roles and sign-in](#people-roles-and-sign-in)
- [Approvals](#approvals)
- [Routines and events](#routines-and-events)
- [Memory check-ups](#memory-check-ups)
- [Moving and sharing bots](#moving-and-sharing-bots)
- [Library](#library)
- [Morning digest](#morning-digest)
- [Retrying answers and refusals](#retrying-answers-and-refusals)
- [Voice](#voice)
- [Bots reach you](#bots-reach-you)
- [Bots on Discord](#bots-on-discord) and [a bot's own Discord account](#a-bots-own-discord-account)
- [X (Twitter)](#x-twitter)
- [Apps (MCP) and skills](#apps-mcp-and-skills)
- [Admin](#admin)
- [Tailscale, and your servers and devices](#tailscale-and-your-servers-and-devices)
- [Code search](#code-search)
- [Computers, devboxes and the web](#computers-devboxes-and-the-web) and [your own computer](#your-own-computer)
- [Your browser extension](#your-browser-extension)
- [Subscriptions as brains](#subscriptions-as-brains)

## Bots and chats

- **Bots.** Each bot has a name, a label, a job, a personality, standing instructions and a picture (a character, an
  emoji, one it draws itself, or an upload). Your primary bot is your main point of contact and coordinates the others.
- **Models.** Pick any model and thinking level per bot, from the composer or the bot's Model tab. Strategies combine
  models: _planner and executor_, a _council_ of advisors, or a _fallback_ chain.
- **The brain.** A bot's panel (**Memory → Brain**) shows exactly what it reads on its next turn: its instructions,
  memory, notes, history, tools and token counts. Edit or remove any memory, compact or reset a chat, and turn
  auto-learning on or off.
- **Self-management.** Bots run Sekai with their own tools: memory, notes, reminders, routines, skills, and creating or
  updating other bots. Built-in skills teach them good habits.
- **Group chats.** Bots answer when @mentioned or picked by a router, hand work to each other with @mentions, and ask
  each other questions in a "team chat" you can read.
- **Finding things.** Ctrl/⌘K finds bots, chats, actions and words in any message, and opens the chat at that message.
- **Presence.** Each avatar shows what its bot is doing (thinking, working, waiting for you, stuck, done); hovering it
  shows the current step.
- **Themes.** Six, one per Project Sekai group: Virtual Singers, MORE MORE JUMP! and Wonderlands×Showtime are light;
  Leo/need, Vivid BAD SQUAD and Nightcord at 25:00 are dark. **Automatic** follows your device. Pick one in Settings →
  Appearance.

## People, roles and sign-in

The first account (made at the first visit, with the setup code from the server's log) is an admin. There's no public sign-up: admins add everyone else in **Admin → People** with a temporary password (they choose their own at first sign-in), a one-time invite link (emailed when email is set up, valid 7 days), or single sign-on only. Admins can change someone's role, turn an account off (it's signed out at once and its bots and routines stop), reset a password or two-factor sign-in, sign someone out everywhere, or delete an account with everything in it. Sekai always keeps at least one admin.

- **Everyone has their own workspace.** Bots, chats, memory, notes, routines, files, documents, apps and usage are each person's own; nobody else sees them, admins included (admins manage accounts, not people's chats).
- **Roles** (**Admin → Roles**) decide what people may use: making bots, the web, the server's browser, routines, the library, voice, apps (MCP), accounts on other apps, computers, code search, subscriptions, comparing models and sharing. They also set limits: which models, how many bots, tokens a day and a month, money a month (at the prices in Usage) and storage. Admin and Member come with Sekai; make your own. A role can require two-factor sign-in. Server setup (models, subscriptions, voice services, computers, Tailscale, devices, backups, people) is for admins only.
- **Sharing a bot.** In a bot's Profile tab, **Sharing** lets it chat with someone else (admins can also share with everyone who has a role, or everyone). They talk to it in their own chats and it remembers each person separately. Its computer, browser sign-ins, accounts, apps, your chats and its standing instructions stay yours, and only you change it.
- **Signing in:** a username or email and password, a passkey (Face ID, Touch ID, Windows Hello, a password manager), or single sign-on. Wrong passwords and codes are limited per address and per account.
- **Single sign-on** (**Admin → Sign-in options**): Google, GitHub, Discord, or any OpenID Connect provider (Authentik, Keycloak, Okta, Entra…) by its issuer URL. Paste the redirect URL Sekai shows into the provider's app. It never makes accounts: it signs in people who already have one, by an account linked in **Account → Linked sign-ins**, or (if you allow it) by a verified email that matches theirs.
- **Two-factor sign-in** (**Account**): codes from an authenticator app, by email or by text message, plus ten one-time recovery codes. A passkey that checks your face, fingerprint or PIN counts as both steps.
- **Email and text messages** (**Admin → Sign-in options**): an SMTP server for codes, invites and "Forgot your password?" (that also needs `SEKAI_PUBLIC_URL`), and Twilio or a webhook of your own for texts. The webhook gets `{"to", "message"}` with an `X-Sekai-Signature` header: the hex HMAC-SHA256 of the body with your secret.
- **Confirm it's you.** Changing your email or phone, removing a sign-in method, making API tokens, seeing a computer's passwords, and admin changes (people, roles, sign-in options, backups, models, subscriptions, Tailscale) ask for your password, a code or a passkey again when you last proved it more than 15 minutes ago.
- **Locked out?** On the server, `bun run reset-password` resets the first admin's password (or `bun run reset-password <username>`; add `--no-2fa` to remove its two-factor sign-in). With Docker: `docker compose exec app bun run reset-password`.

## Approvals

Every tool has a risk level:

- **read**: looks something up.
- **write**: changes the bot's own workspace.
- **external**: reaches beyond the bot.
- **destructive**: deletes or overwrites something.

Precedence:

1. **Rules.** A rule set in a chat beats one set on the bot, which beats a global rule. Within each, a rule for a tool by name beats a rule for its kind (`category:<kind>`). An `off` rule hides the tool, `allow` runs it (except in read-only mode), and `ask` always asks, even in YOLO.
2. **Mode.** The first mode set, checking the chat, then the bot, then global, decides by risk. In Auto, external and destructive calls go to a reviewer model first, and it asks you if it isn't sure. In _Primary bot decides_, your primary bot reviews them instead, in its own voice and with what it remembers about you; the primary's own risky actions go to the reviewer model.

Unanswered requests are denied after a timeout (Admin → Approvals), so routines never hang. Requests show up in the chat, in **Needs you**, on the desktop badge, and on any linked chat app (buttons or reactions). With push notifications on, a request's notification has **Approve** and **Deny** buttons, so you can answer from your lock screen or notification center without opening Sekai. Requests that always need you (root on a device, a new computer) have no buttons: tapping opens the chat.

**Admin → Activity log** lists everything bots did (every tool call, from every chat, Discord and routines), how it ended, and who allowed or refused it: a rule, the approval mode, the reviewer model, your primary bot, you, or a timeout. Search it, filter by bot, outcome or who decided, open the chat at that moment, and export it as CSV or JSON lines. Deleting a chat doesn't erase its entries.

Some requests always ask you, whatever the mode or rules: root on one of your devices, for example. They're answered one at a time and never become a rule.

## Routines and events

A routine runs on a schedule (every day, weekdays, every few hours, once, or cron) or **when something happens**:

- **A webhook is called.** The routine gets its own address (`/api/hooks/…`, shown under the routine); POST to it from GitHub, Home Assistant, IFTTT, Zapier or a script, and the bot gets what was sent along with its instruction (as data, never as instructions). One run per 10 seconds at most. Anyone with the address can start the routine, so keep it private; it's reachable wherever Sekai is (your tailnet, or the internet if you expose it).
- **A device changes.** A device on your tailnet goes offline, comes back online, or either. Pick one device or any device bots can use. Sekai checks every minute, and a change counts once it has lasted two checks.

"Bot does the work" runs the instruction; "Just remind me" posts it with what happened.

## Memory check-ups

Every Sunday (or the first Sunday of the month, or never: Admin → Memory) each bot with a few memories reads everything it remembers:

- It **merges** memories that say the same thing.
- It **drops** ones a newer memory replaced (an old job, say).
- It **asks you** about older facts that may have changed (a trip that was planned, where you work), at most three questions.

The bot posts what it changed and its questions in its chat. Answer there and it updates its memory. Pinned memories and the ones you wrote are never changed on their own, only asked about. Your primary bot also looks after the memories every bot shares. Run one any time from a bot's Brain tab (**Check up**).

## Moving and sharing bots

**Export** on a bot's profile saves it as one `.sekai-bot.json` file. The file holds:

- Its profile, personality, instructions and picture.
- Its models and voice, tool rules and skills.
- The apps it uses (by name) and its routines.
- Its memory and notes, if you tick them.

Chats, accounts (Discord, X), computers and passwords never go in it.

**Import a bot** (the **+** menu, or Ctrl/⌘K) makes a new bot from such a file, on this Sekai or another:

- A name that's taken gets a number.
- Skills it brings are added, or reused when an identical one is already there.
- Apps connect again when one with the same name is set up (Sekai lists the ones that aren't).
- Routines start paused, and webhook routines get a new address.

## Library

**Library** (in the sidebar, or Ctrl/⌘K) holds documents every bot can search: manuals, papers, notes, contracts. Add files, a whole folder (its name becomes a group), or drop files on the page. Sekai reads PDF, Word (.docx), Markdown, text, HTML, CSV and JSON, up to 25 MB each. Scanned PDFs need OCR first.

Each document is split into passages that keep their page and section, and embedded with your gateway's `text-embedding-3-small`. Bots use `library_search` (by meaning and by words) and `library_read` (around a result, or a page), and cite the title and page. If the embedding model can't be reached, a document is still found by its words, and **Read it again** fixes it later. **Try a search** on the Library page shows what bots would find. Documents are part of backups.

## Morning digest

Every morning (8:00 by default, in your time zone) your primary bot posts a digest in its chat, with a notification:

- **What your bots did:** replies, routine runs and actions, per bot.
- **Didn't work:** failed routines, replies that ended with an error, failed or denied actions.
- **Waiting for you:** approval requests and sign-ins.
- **Today:** routines and reminders still to come today.
- **This server:** health problems, and the tokens used (with the cost, if you set prices).

Your primary bot writes it up in its own voice (one small model call, keeping every fact), or choose a plain list. Quiet days are skipped unless you turn that off. Change it in Settings → Notifications, where **Send now** shows one covering the last day.

## Retrying answers and refusals

The ↻ button under a bot's answer (or a long press on touch screens) has two choices:

- **Try again**, with the same model or one you pick. The old answer stays as a previous version, and `‹ 2/3 ›` switches between versions. The version shown is the one the bot sees from then on. A new attempt only sees the conversation up to that answer, never its earlier versions.
- **Erase this answer** first. The answer is removed from the chat and from the bot's context, then the bot answers again.

**Refusals.** When a model declines a task or a provider's safety filter stops it, Sekai blanks the refused text and another model carries on with the same turn, keeping any tool results so far. A short note shows who declined and who answered; the refusal itself never reaches the next model or later turns. Sekai detects refusals three ways:

- A safety finish reason (`content_filter`, `refusal`, `SAFETY`, …).
- A provider error that names a policy or filter.
- A short "I can't help with that" style reply, confirmed by the background model.

Under **Admin → Models** you can turn this off or choose the models to try, in order. By default Sekai picks a strong model from a different provider (from your fallback chain first) and tries at most two others. Subscription bots that refuse have their session started over, and a gateway model takes the turn with a note of what was already done.

## Voice

Voice uses [ElevenLabs](https://elevenlabs.io) or [Fish Audio](https://fish.audio): add one in **Admin → Models →
API providers** with your API key, then pick the default speaking voice, speech-to-text model and language in **Admin
→ Voice**. Each bot can have its own voices (**Profile → Voice** in its panel); anything left on default follows
Admin.

- **Calls.** Call a bot from the app (the phone button in a chat) or bring it into a Discord voice channel. What you
  say is written down, the bot answers with its own model and tools, and the answer is spoken in its voice sentence by
  sentence, so it starts talking quickly. You can type during a call too.
- **Reading aloud and voice messages.** ▶ on a reply reads it in the bot's voice. The waveform button in the message
  box records a voice message: it's written down for the bot, and the bot answers with a voice message. Messages are
  Ogg Opus, the same format as Discord voice messages.
- **Dictation** writes down what you say in the message box, with your speech-to-text model.
- **Make a voice.** In a voice picker (**Change → Make a voice**) or **Admin → Voice → Your voices**: describe a voice
  and keep one of the takes Fish Audio makes, or record 10–30 seconds of someone who agrees to it. Fish Audio voices
  are kept by Sekai and sent with each line, so they work on any Fish plan. ElevenLabs saves them to your account
  (paid plans only).

## Bots reach you

- **`message_user`** sends you a message on the bot's own initiative: a Slack or Discord DM from its bot when it has one, otherwise in its chat in the app, optionally as audio. Choose `via: "slack"`, `"discord"`, `"app"` or `"auto"`. Reminders and routines use it when you asked to be told.
- **`call_user`** rings the app (a full-screen ring on phones). If you're in a Discord voice channel its bot can see, it joins you there. No answer in 40 seconds (or Decline) sends its message as a voice message instead.
- **Notifications** for approvals, calls, outreach and finished routines show in the browser, the desktop app and the phone apps, and as [push notifications](install.md#on-your-devices) on devices that turned them on. Approval requests can be answered right from the notification.

## Bots on Slack

Each Sekai bot gets its **own Slack app and real bot user**: its own name, avatar, mentions, DMs and Messages tab. Nothing impersonates another bot through a shared webhook. Sekai connects out using **Socket Mode**, so a server behind a home router or on a tailnet needs no public URL or signing endpoint.

### Set up a bot

1. Open the bot's **Tools → Accounts → Slack**, choose **Add → Slack**, and click **Create the app in Slack**. Pick your workspace and review the generated manifest. If the link doesn't prefill it, use **Copy manifest** and Slack's **From a manifest** flow instead. The manifest enables messages, mentions, files, interactivity, Socket Mode and Slack's agent messaging view.
2. In the new app's **OAuth & permissions**, choose **Install to workspace**. Some workspaces require an admin's approval. Copy the **Bot user OAuth token** (`xoxb-…`).
3. In **Basic information → App-level tokens**, generate a token with **connections:write**. Copy this **app-level token** (`xapp-…`). Both tokens must come from the same app.
4. Paste both tokens into Sekai and connect (Sekai asks you to confirm it's you first, as for any new credentials). Sekai checks the bot identity and opens its socket, then shows the workspace and bot user. Tokens are encrypted at rest and masked when read back. Keep Socket Mode on and token rotation off; replace revoked tokens here and reconnect. If Slack stops answering, Sekai notices within a couple of minutes and connects again.
5. Use **Save its picture** and set it under **Basic information → Display information → App icon**. Slack has no API for app icons, and your Sekai picture need not be public. Colorful Stage pictures are exported whole, with their credit shown in Sekai.
6. Open the app's **Messages** tab in Slack and say hi. Approve the pairing code in Sekai, or enter your Slack member ID when connecting (profile → More → Copy member ID). Invite the app into each channel where you want to talk to it.

Repeat for each bot. Only one running Sekai should connect to an app: Slack distributes events between concurrent Socket Mode connections rather than broadcasting to them. Sekai warns when Slack reports another connection.

### Chat, controls and groups

- **Access:** unknown DM senders get pairing codes, not access to your tools or memory. In channels, only allowlisted people are answered. The first allowlisted person is the owner; model, memory, routines, group links, trust and approval controls are theirs alone. Trusting someone lets them chat, not change the bot or decide its approvals. Attachments are downloaded only after access checks.
- **Threads:** each top-level message starts its own threaded conversation, including in DMs. Replies stay under that root, and each thread has its own Sekai history (named after its first words), isolated from other threads. Threads are handled side by side: a long download in one doesn't hold up another. Once the bot has a binding there, allowed people can continue without mentioning it again. A channel-wide `listen on` also applies to new threads. Proactive DMs reuse your most recent DM thread; if none exists, the bot opens a DM and its first threaded reply continues that conversation.
- **One ongoing DM instead:** in the Slack account's **Chats** section, set **Your DMs with it** to **One ongoing chat**. The bot then answers right in the DM rather than in a thread, everything you send there is one Sekai chat (`new` starts a fresh one), and its own messages to you (reminders, `message_user`) land there too. A thread you start in the DM is still a chat of its own, and channels keep their threads either way.
- **Replies:** Sekai posts answers once finished, rather than repeatedly editing a partial answer. This keeps notifications quiet and stays within Slack's posting limits. Long replies split at sensible boundaries; Markdown becomes Slack mrkdwn, including links, emphasis, code, lists and quoted text. Tables use code blocks. In DM threads, a native “is thinking…” status is used when Slack permits it; otherwise (and in a DM kept as one chat) a temporary thinking reaction is used. Internal memory/model notices stay in Sekai.
- **Commands:** the setup screen shows this app's unique command, such as `/sekai-miku-abc1234`. Follow it with `help`, `status`, `new` (or `reset`), `stop`, `retry`, `model`, `mode`, `memory`, `notes`, `routines`, `remind`, `approvals`, `approve`, `deny`, `team`, `group`, `listen`, `trust`, `profile`, `context` or `compact`, with the same arguments as Discord. Commands reply privately. Slack's slash commands share a workspace-wide namespace and cannot be invoked in threads: inside a thread, send `@Miku /status` or `@Miku /model model-name` as ordinary text. Thread commands reply there, not privately. Menus work; slash-command autocomplete and Discord's right-click retry menu are not available.
- **Approvals:** requests have **Approve once / Allow in this chat / Deny** buttons. Only the owner may decide; the message records their name and removes the buttons. You can also answer in Sekai or type `@Miku /approve CODE`. Always-ask actions, including root on your device, still need individual approval, regardless of the button chosen.
- **Groups:** invite every bot's app to the channel. Inside a thread, `@Miku /group link Miku Kanade` makes one Sekai group conversation: Miku and Kanade each post through their own bot user. Mention either or both to choose responders, or ask for a discussion and let Sekai's group routing run it. A shared inbound message is taken once, not once per socket. Bots without an app in that channel are named in messages posted by the first bot. A group linked at channel level (the app's slash command followed by `group link Miku Kanade`) carries its membership into new threads, each with fresh history. `group unlink` restores separate chats without deleting history.
- **Files and outreach:** incoming files up to 20 MiB become Sekai attachments. Outgoing images and files use Slack's external upload flow in the same thread. `message_user` with `via: "slack"` opens a DM with the owner; `auto` chooses an available messaging account before falling back to Sekai. Audio is uploaded as a file, not a Slack huddle.

**Limits.** Slack huddles and voice calls are not supported. The app must be invited to private and public channels before it can read or post there. Workspace policies, retention and Slack's rate limits still apply. Apps using Socket Mode cannot be published in the Slack Marketplace; these are private apps you install yourself. Rename the app/update its icon in Slack manually when changing the Sekai bot, and reinstall after changing manifest scopes. This integration doesn't automatically import old Slack history.

**Testing.** `bun test apps/server/test/slack.test.ts` uses a local fake Web API and Socket Mode gateway. `bun run test:slack` is the optional live check: two agent apps and a third tester app in one test channel, against an already running Sekai. See `apps/server/scripts/slack-e2e.ts` for its environment variables and the human-only DM, slash-command and approval checklist. No real Slack workspace is needed for unit tests.

## Bots on Discord

Each bot can have its own Discord bot, and Discord becomes a full client for Sekai: chat in DMs and servers, get replies, retry answers, switch models, run group chats, answer approvals.

**Setup.** In a bot's panel, open **Tools → Accounts → Discord** and add one. Create an application in the [Developer Portal](https://discord.com/developers/applications), give it the bot's name and picture, copy its token from **Bot → Reset Token**, and paste it in Sekai. Once it's connected, **Add to a server** invites it with the permissions and commands it needs; **Message it** opens a DM. Turn on **Message Content Intent** (Bot → Privileged Gateway Intents) if you want `/listen`; Sekai notices it and uses it.

**Who can use it.** Only you. Strangers who DM the bot get a **pairing code** that you approve in Sekai, or you can add Discord user IDs to the allowlist. Add another bot's ID to let it drive this one (handy for testing). In servers the bot answers allowed people when they mention it, reply to it, or anywhere you've used `/listen on`.

**Chats.** Every DM, server channel and thread gets its own chat in Sekai (listed under Discord in the sidebar). The bot shows as typing while it works, and each reply is posted once it's finished, so it arrives whole instead of being edited as it's written. Long answers continue in more messages. Sekai's own notes (saved to memory, a fallback model answered) stay in Sekai; warnings and errors are shown in small print. Messages deleted in Sekai disappear from Discord too.

**Commands.** Type `/` in Discord; the same commands also work typed as plain text (`@Bot /retry gpt-6.1-sol erase`):

| Command                                                      | What it does                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `/new` `/stop` `/compact` `/context`                         | Fresh chat (memory stays); stop; summarize older messages; what the bot sees next turn            |
| `/retry [model] [erase]`                                     | Answer the last reply again, keeping it as a version or erasing it, optionally with another model |
| `/status` `/profile`                                         | How the bot is set up here; who it is                                                             |
| `/model [model] [thinking]`                                  | See or change the bot's model (with autocomplete)                                                 |
| `/mode [mode]`                                               | Approvals for this chat: read-only, ask every time, auto, YOLO, or the bot's default              |
| `/memory list\|add\|forget` `/notes`                         | What the bot remembers, and its notes                                                             |
| `/remind <when> <what>` `/routines list\|pause\|resume\|run` | Reminders and routines                                                                            |
| `/approvals` `/approve CODE` `/deny CODE`                    | Waiting actions; each request also has Approve / Allow in this chat / Deny buttons                |
| `/team` `/group link\|unlink\|show` `/listen on\|off`        | Other bots; group chats; answering without a mention                                              |
| `/join [channel]` `/leave`                                   | Join the voice channel you're in (or one by name) and talk; leave. "join vc" works too            |

Right-click one of the bot's messages → **Apps** for **Retry**, **Retry with another model** and **Erase and retry**. A retry rewrites the same Discord message.

Commands that change the bot are yours alone (its owner: the first person it answers): mode, model, trust, memory, notes, routines, reminders, approvals, group links and new chats. People you trust can chat, retry, stop a reply, check its status and bring it into voice.

**Group chats.** In a server channel, `/group link Echo Pip` turns the channel into one Sekai group chat with those bots. Each bot answers through its own Discord bot. Mentions work both ways: `@Echo` in a reply becomes a real Discord mention, and mentioning bots in Discord picks who answers. A message is taken once, even though every bot sees it. Bots without a Discord bot of their own are posted by the first bot under their name. What you write to the group in Sekai shows up in the channel too. `/group unlink` gives every bot its own chat again; the group chat stays in Sekai.

**Voice.** Send the bot a Discord voice message and it answers with one (its words are in Sekai too). Ask it for a voice message in any chat (a server channel too) and it posts one right there. In a voice channel, `/join` (or just "join vc", "hop in the call") brings the bot in for a live call, with the same call engine as the app. It only hears the people allowed to use it, and leaves a minute after they've all gone. While it's in, it knows it is, and ask it in text to say something and it says it out loud there. A bot can also join on its own when it calls you and you're in a voice channel.

**Testing with real bots.** `bun run test:discord` drives two agent bots with a third tester bot in a server channel, using a running Sekai. It needs `DISCORD_BOT_A_TOKEN`, `DISCORD_BOT_B_TOKEN`, `DISCORD_TESTER_TOKEN` (with Message Content Intent on) and `DISCORD_CHANNEL_ID`; see the top of `apps/server/scripts/discord-e2e.ts`.

## A bot's own Discord account

For group chats, servers and voice where a bot application can't go, give the bot a normal Discord account instead (one you make for it, not your own). In its panel, open **Tools → Accounts → Discord (personal account)** and add the account's token (DevTools → Network → any request to discord.com → the `Authorization` header).

The account's DMs and group chats arrive in Sekai and the bot's answers are sent as the account — add it to a group chat with friends and it talks there. Ping or DM the account and it answers and does things, like the X bot. You manage who else it answers right in Discord: **@bot trust @fern** lets fern talk to it anywhere it can see them, **@bot trust everyone in this GC** trusts the whole group chat, and **untrust @fern** stops them (also as `/trust`).

The bot can use the account for anything you'd do in Discord, through one `discord` tool (REST with the token): list servers, read a server's channels and members and history, send to a server channel or group chat or DM, open a DM by user id, react, and change the account's display name and bio. For the interactive things — joining a server from an invite, voice channels, anything with a captcha — it opens Discord **in its own browser, signed in as the account** (`browser_account`) and clicks like a person. Joins and captchas are why it's a real browser: the agent ticks the check itself, or you take over its computer in the app and tick it. If a check rotates the account's token, Sekai picks up the fresh one the app is holding and keeps going.

Discord doesn't allow accounts to be used like this, so the account could get limited. Only you (and whoever you trust) can talk to it.

## X (Twitter)

A bot's panel → **Tools → Accounts → X** signs it in to an X account with that account's `auth_token` cookie (stored encrypted). The bot can then post, reply, quote, delete, search, read threads and profiles, like, repost, bookmark and follow, using [emusks](https://emusks.tiago.zip/). It answers posts that mention it only from the handles you list, checked by account id in code before the bot sees anything, and replies in one post. Use an account made for the bot: automating X is against X's rules, so the account could be locked. emusks is AGPL-licensed and loaded only when a bot has an X account.

## Apps (MCP) and skills

**Admin → Apps** (or a bot's **Tools → Apps & skills → Browse apps**) lists popular apps with their sign-in already worked out: one-click OAuth (with your own OAuth client for Google, GitHub, Slack, HubSpot and Asana), an API key, or nothing. Give an app to every bot or to chosen ones, pick which of its tools a bot gets, and set rules for them like built-in tools. **Add your own** connects any other MCP server.

People who aren't admins can add apps on the internet (with the **Apps** permission); apps that run as a program on
the server (stdio) or live on your own network are for admins. An admin can let everyone's bots use one of theirs.

**Skills** are instructions bots load when they need them: write them in **Admin → Apps & skills**, import or export
`SKILL.md` files, or let bots write their own.

## Admin

Open **Admin** from the sidebar (or `/admin`). Pages are grouped in the side bar (Bots, Safety, People, Machines, You); people who aren't admins see only their own pages (usage, approvals, activity, account…), and **Search settings** (Ctrl/⌘K) finds a page by name or by what's on it ("proxmox", "passkey", "root"). The overview lists what needs you (a gateway that's down, a subscription to sign in to again, a device bots can't reach, an expiring Tailscale key…) with a button to fix each, plus everything at a glance. On a phone, the overview is also the list of pages, like a phone's Settings.

**Compare models** (Admin → Bots) sends one prompt, with an optional system prompt, to up to four models at once. Their answers stream in side by side, each with the time to its first word, its total time, tokens and cost (at the prices you set in Usage). Recent prompts stay in your browser to run again. Subscription models only run as a bot's brain, so they aren't offered.

**Usage** (Admin → Usage) charts tokens by hour or day, stacked by model or bot, with a cost line at the prices you set,
compared with the period before; a heatmap of busy hours; and breakdowns by bot, model and (for admins) person, with
CSV export. People see their own usage and their role's limits; admins can look at everyone's or one person's.

## Tailscale, and your servers and devices

**Admin → Tailscale** is where your tailnet and Sekai meet:

- **This server:** its name and address on the tailnet, and a switch for its private **HTTPS address** (`tailscale serve`), which phones need for push notifications and passkeys. If Tailscale asks for permission the first time, run `sudo tailscale set --operator=$USER` once on the server.
- **Devices bots can use:** every device on your tailnet (**In use** or **All**, with a search), each with a **Bots can use it** switch. Bots get keys to your account there by default (set once, change it per device). **Add an account** lets bots in as another one too, like `root`: Sekai puts its master key there with sudo when your account may use sudo without a password, and otherwise shows the command to run. Bots are let in per account, and a bot asking for root always asks you, whatever the approval mode. Your bots' own computers are labelled and managed in Computers. Servers that aren't on your tailnet can be added by address.
- **Tailscale API:** an access token (`tskey-api-…`) or an OAuth client lets Sekai list the whole tailnet with owners, tags and key expiry, warn before the auth key for bots' new machines expires, and make a new one. Without it, Sekai sees devices through the server's own Tailscale. The auth key under Computers (`tskey-auth-…`) is a different kind of key: machines join the tailnet with it, but it can't read the tailnet.

To let bots work on a device:

1. Turn it on. If Sekai's master key isn't on it yet, the row shows the command to run there once (PowerShell as administrator on Windows, which also turns on Windows' SSH server).
2. Bots ask with `host_request_access` and a reason (and `as: root` for another account). Your approval mode decides (or the primary bot, with _Primary bot decides_), and the primary bot can grant teammates access with `host_grant`. Sekai then adds that bot's own key to that account on the device, and the bot works there with `host_run` (PowerShell on Windows).

Bots never get the master key, access is listed per device (remove it with one click), and revoking takes the bot's key off the device. Bots can also be let onto each other's computers and devboxes this way.

## Code search

A bot that works in a codebase can index it: `code_index` on a folder on its computer, a devbox or your lent computer. Sekai reads the files on that machine (skipping dependencies, builds, binaries and lock files), splits them into pieces at natural boundaries, and embeds them through the gateway (`text-embedding-3-small` by default). `code_search` then finds code by what it does ("where are sessions checked") or by name, mixing meaning and keyword matches. Indexing again reads only files that changed. See and manage indexes in the bot's panel under **Memory → Code**.

## Web reading

Bots read the web with `web_fetch`, which fetches a page and strips it to text. Turn on **Admin → Web reading** and that gets much better: Sekai runs [Firecrawl Local](https://github.com/firecrawl/firecrawl/tree/main/apps/local), one small Rust binary that turns a page into clean Markdown (no navigation, adverts or cookie banners), reads PDFs, Word and other documents, and renders pages that need JavaScript in the Chrome your server already has. Bots also get:

- `web_search` — search the web and get the best pages with a snippet each.
- `web_map` — every page of a site, from its sitemaps and front page, optionally filtered ("pricing").
- `web_crawl` — follow links from a page and read up to 25 of them in one go, with `include`/`exclude` path patterns.

**Where it runs.** _On this server_ lets Sekai start and watch it. **Install it** builds it with Rust's cargo in the background (a few minutes; install Rust from [rustup.rs](https://rustup.rs) if the button says this server hasn't got it). Sekai then starts it on 127.0.0.1 with a fresh token and a free port, restarts it if it stops, clears away one a crash left behind, and says on the page when something is wrong. _Somewhere else_ points at a `firecrawl-local serve` you run yourself — another machine, or a container next to Sekai: give its address and its `--token`, if it has one. The Docker image can include the binary: `docker compose build --build-arg WITH_WEB_ENGINE=1`.

**What leaves your server.** Reading, listing and crawling happen on your machine and send nothing to Firecrawl. Searching has to go to Firecrawl's cloud, because there's no search index on your machine, and a page that refuses your server can be fetched by them instead. One setting decides: _nothing leaves_ (bots have no `web_search`), _searches only_ (the default), or _searches and refused pages_. Search works without an account, with low limits; a [Firecrawl key](https://www.firecrawl.dev/app/api-keys) raises them, and it's kept encrypted like every other secret.

**Safety.** The engine listens on loopback only and never gets `--allow-private`, so it refuses your own network, the Sekai server itself and cloud metadata by itself, after redirects and DNS too. Addresses on your network stay with `web_fetch`, which asks you first. It identifies itself as `FirecrawlLocal` and reads `robots.txt` when crawling. **Try a page** on the Admin page reads one page the way a bot would, so you can see it working.

## Computers, devboxes and the web

**A computer of its own.** Any bot can have its own computer on your Proxmox server, running Debian 13 with XFCE (plus xfce-goodies) and Google Chrome. You create it from the bot's computer panel (the monitor icon in the chat header, or **⋯ → Give it a computer**), or the bot asks for one and you approve. Default size: 4 cores, 8 GB RAM with ballooning down to 2 GB, and a 64 GB disk; change it per computer (**Resize**), as the default in Settings, or let the bot ask for more.

**Virtual machine or container.** Computers and devboxes run either as a virtual machine or as a container, with the same software and the same tools. Containers are much lighter and start faster; they share the Proxmox host's kernel. VMs are fully separate machines with their own kernel: pick one for Docker-heavy or kernel work. New computers are VMs and new devboxes containers unless you choose otherwise when you make one, or change the defaults in **Admin → Computers** (_New computers run as_, _New devboxes run as_). Bots can ask for either (`computer_request` and `devbox_create` take a `backend`), and the panel shows which each machine is.

A VM is set up by cloud-init from a seed Sekai writes itself; a container (which doesn't run cloud-init) gets the same setup as a script Sekai starts over SSH and follows until it's done. Either way:

- Two accounts: root, and one named after the bot (with sudo). Both get random passwords, which you can see in the panel and the bot can look up.
- The bot's own SSH key (one per bot, for all its machines). Sekai uses it to drive the computer.
- SSH, VNC on the desktop (x11vnc, port 5900) and RDP (xrdp, port 3389, a session of its own), ready to use.
- Tailscale, if you add an auth key in Settings, so the machine joins your tailnet (in a container it runs in userspace mode, since containers get no network device of their own).
- The desktop logs in by itself and never locks or blanks, and Chrome's own password manager is off (Sekai handles logins). On a VM it's the real screen; a container has no screen, so its desktop runs on a virtual one (Xvfb, 1440×900) that systemd starts at boot as the bot's account. Bots and you use both the same way.

The panel shows the screen live. **Take over** opens it full screen in Sekai (VNC through the server) and the bot waits until you **Hand back**.

**Checkpoints.** A checkpoint saves a computer's or devbox's disk as it is (a Proxmox snapshot, without memory, so it takes a second or two and the machine keeps running). Make one from the panel (**Checkpoints → Save**), and **Go back** to it if something breaks: everything since is lost and a running machine restarts. Bots can make and restore their own (`machine_checkpoint`; going back asks like any destructive action), and Sekai saves one by itself before risky commands (`sudo`, `apt`, `rm -r`, `curl … | sh` and the like), at most every 30 minutes per machine, keeping the latest 3. Snapshots need storage that supports them: qcow2 on a directory, LVM-thin, ZFS or Ceph. Where it doesn't (a container on plain directory storage, say), checkpoints are full Proxmox backups (vzdump, zstd) instead, kept on a storage that takes backups. They take longer (about 15 seconds for a fresh devbox), use disk space, and aren't made automatically. Going back restores the machine from the backup and restarts it. Deleting a machine deletes its backups.

**How bots use computers.** For websites, bots use their browser: Chrome on their computer, driven with Playwright over an SSH tunnel. They read pages as accessibility snapshots with element refs (the approach of the [Playwright MCP server](https://playwright.dev/docs/getting-started-mcp)), which holds up on complex web apps: forms, menus, popups, new tabs, dialogs and iframes. For desktop apps they read the screen's accessibility tree (AT-SPI: buttons, menus and fields with positions) and click elements by id, fall back to screenshot coordinates, and use the terminal (`run_command`) for anything a shell does faster. Every action returns a fresh screenshot, so the model sees what happened; the screenshots show up in the chat too. Bots without a computer still browse, with a browser on the Sekai server.

**The server browser.** When a bot browses on the server, Sekai runs a real, installed Chrome (its preference) or Chromium on a virtual display — not a headless build — and hides the automation switch, so the browser reports itself the way a person's browser does and sites that block headless or automated browsers still work. This needs Chrome/Chromium, `Xvfb` and `bubblewrap` on the server (the Docker image has them); without them Sekai falls back to the usual headless Chromium. Clicks move the mouse rather than teleporting it, and `slowly` types at a human pace, for the same reason.

**Signing in.** When a site needs a login, the bot calls `browser_login` and Sekai asks you in a popup (also under **Needs you**). What you type goes straight into the page, so the bot and its model never see it. Tick **Remember** to keep the login encrypted on your server for that bot and site; manage saved logins in the computer panel.

**Devboxes.** Temporary Debian 13 machines on Proxmox for development work (containers unless you or the bot choose a VM): same SSH key, sudo account, passwords and Tailscale, no desktop. Bots create them on their own (up to 3 each by default) and they're deleted after 24 hours unless extended. You can create and delete them in the computer panel too.

**A machine you already have.** In the computer panel, **Use a machine I already have** adds any Linux desktop reachable over SSH; add the bot's public key there (Sekai shows it) and **Try again**.

**Sharing a computer or devbox with other bots.** Under **Share with other bots** on a machine's card, add any of your bots, or a bot someone shared with you (the list says whose). Each gets a seat of its own there, set up over SSH in a minute or so:

- its own account (named after it) and home folder, with sudo like the machine's own bot, and its SSH key (a bot shared with you gets a key of the seat's own instead of its usual one, so its owner never holds a key to your machine);
- on a computer, its own screen too: a desktop on a virtual display (`:10`, `:11`…) with its own VNC port (5900 + the display) and password, and its own Chrome profile and debugging port. Whatever a VM or container needs for that (Xvfb and friends) is installed the first time, also on computers made before this existed.

A member bot's computer panel shows its seat: the live screen, **Take over** (its own screen, not the others'), and its own passwords and key. Its computer_, browser_ and file tools and `run_command` work there in its own account (`on: "<machine name>"`, or by default when it has no computer of its own). Turning the machine on and off, resizing it, checkpoints and deleting it stay with the machine's own bot and you, and they affect every bot on it. Removing a bot from a machine deletes its account, home, screen and files there; deleting a bot removes its seats everywhere (and deleting a machine, or the bot it belongs to, removes everyone's: the panel warns you when other bots use it).

**Shared browsers.** **Browsers → New** in a bot's computer panel makes a browser several bots use. It runs on the Sekai server or on one of your computers (Chrome on that computer's own screen, so you can watch it there; the bots don't need a seat on that computer). Its sign-ins are either **shared** (one profile: a site one bot signs in to is signed in for the others; each works in its own tabs) or **separate** (each bot gets its own profile in it). Bots open pages in it with `on: "<its name>"`; their other browser tools then act there until they open a page elsewhere. The server's network rules apply to it as to bots' own server browsers.

**Who may use what's shared.** In your own chats, your bots and bots others shared with you use what you put them on. A bot someone shared with you never uses your machines or browsers in its owner's chats (or anyone else's), and its owner's computer, browser and accounts never come into yours. **Also for people these bots are shared with** (on each machine and shared browser, off unless you turn it on) lets your own bots there use it when people you've shared them with chat with them; bots others shared with you still don't. A bot's saved logins are only used and saved in its owner's chats; elsewhere Sekai asks.

**Setting up Proxmox** (Admin → Computers; Proxmox VE 8.4 or newer):

1. Create a user and an API token, for example `sekai@pve` with token `bots` (untick _Privilege Separation_), and give it the PVEAdmin role on `/`, or a narrower role with VM, Datastore, SDN.Use and Sys.Audit/Modify privileges.
2. On the image storage (usually `local`), enable the content types **ISO image**, **Container template** and **Import**. Sekai downloads the official Debian 13 cloud image and container template there once, and keeps each VM's cloud-init seed there until the VM is ready.
3. Enter the URL (`https://<host>:8006`), node, token, disk storage and bridge, then **Test connection**.
4. Optional: a reusable, pre-approved Tailscale auth key.

## Your browser extension

The Sekai extension puts chats and approvals next to the page you're using. Chromium and Firefox use native
sidebars; Safari uses a toolbar popover or a companion window because it has no equivalent WebExtension sidebar API.

Download it from the [latest release](https://github.com/hazelcaffe/sekai/releases/latest), where every Sekai release
includes it, or build it with `bun run build:extension`. Load the Chromium folder unpacked or Firefox's manifest as a temporary add-on. Safari
needs signing with Xcode on macOS; downloads include source and a CI-built unsigned macOS host app, not a signed
installer or an iOS app. The source can be converted with Xcode too. Permanent Firefox
installs require Mozilla signing too. [Full installation and release instructions](../apps/extension/README.md).

In Sekai, go to **Settings → Browser extension**, make a browser token, and paste it and your server address into
the extension. Choose your own bot and a direct chat, then **Choose tabs to share**. Only shared tabs are visible
to the bot, and host permission alone never shares a tab. Mutations always ask, even in YOLO. Opening and sharing
a new tab also asks locally in the extension. Switching sites requires sharing again.

**Stop sharing**, unshare the tab, change bot/chat, disconnect, or close the panel to stop control. Grants aren't
saved or restored. Revoke saved browser tokens on the same Settings page. The browser tools are `extension_browsers`
and `extension_browser`, with the **Using the user's browser** built-in skill; they remain separate from the bot's
own browser tools and sign-ins. Screenshots require selecting the shared tab and invoking Sekai's toolbar icon there.
The extension doesn't expose cookies, arbitrary JavaScript, browser settings, private windows or file access.

## Your own computer

The desktop app can lend the computer it runs on to bots, so they can work there the way they do on their own computers. Open **Settings → This computer** in the desktop app, turn on **Lend this computer to bots** and tick the bots that may use it. A bot you lend it to can:

- **See and use the screen.** It reads the accessibility tree (buttons, menus and fields with positions; UI Automation on Windows, the macOS accessibility API, AT-SPI on Linux), takes screenshots, and uses the mouse and keyboard. It sees the main display only.
- **Browse.** Your Chrome, Edge or Chromium opens with a separate Sekai profile, so your own tabs, history and logins stay out of it. Bots drive it like their own browser, and sign in through the same popup.
- **Do developer work.** It runs commands in your shell (PowerShell on Windows, your login shell elsewhere), and reads, writes and edits files with exact replacements. It starts in a folder you choose.

In Sekai the computer shows up in the bot's computer panel under **Your computers**, and its prompt tells it that it's your real machine and to ask before deleting, sending, buying or installing anything. Every action there that changes something counts as **external** for [approvals](#approvals), and **Approve every action here** makes each one wait for your OK whatever the approval mode.

The choice lives on your computer, not the server:

- Anything that gives bots more access opens a confirmation dialog from the app itself, which a web page can't click: lending at all, another bot, or turning off per-action approval.
- **Stop lending** in Sekai revokes access on the computer too.
- The app only answers bots you allowed. It only lets the server reach the browser it started, not other ports. The server refuses bridge connections from web pages.

While a bot works, a badge in the corner names it. On Windows and macOS the badge is left out of screenshots, so the bot doesn't see it. **Ctrl+Alt+Esc** (**⌘⇧Esc** on a Mac) or **Stop** in the tray menu stops everything the bots are doing there at once.

Requirements:

- **Windows 10 or 11.** Nothing to install; Sekai uses the built-in Windows PowerShell. Apps running as administrator, and the lock and UAC screens, can't be controlled.
- **macOS.** Allow Sekai under System Settings → Privacy & Security → **Accessibility** and **Screen Recording**, and let it control **System Events** when asked.
- **Linux.** An X11 session with `xdotool`, `imagemagick`, `wmctrl`, `python3-gi` and `gir1.2-atspi-2.0` (for example `sudo apt install xdotool imagemagick wmctrl python3-gi gir1.2-atspi-2.0`). In a Wayland session bots can only use X11 apps (the ones they open run that way).

`bun run test:proxmox` checks the whole setup against a running Sekai: it creates a test bot with a computer and a devbox, checks the screen, VNC, SSH and the browser, then deletes them.

Sekai reaches machines over Tailscale when they have it, or the LAN otherwise, so the computer running Sekai must be on one of them. Deleting a bot deletes its machines. Secrets (SSH keys, passwords, saved logins) are encrypted with `SEKAI_SECRET_KEY`, or a key Sekai creates in the data folder (`secret.key`): back it up with the database.

## Subscriptions as brains

**Admin → Subscriptions** (admins) lets a bot use an agent CLI you've installed and signed in to on the computer running Sekai, instead of a gateway model:

| Preset      | Runs                                                       | Sign in                                                |
| ----------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| Codex       | `npx -y @agentclientprotocol/codex-acp@latest`             | `codex login` (ChatGPT) or `OPENAI_API_KEY`            |
| Claude      | Claude Agent SDK (bundled Claude Code, or your own binary) | `claude auth login` or `ANTHROPIC_API_KEY` (see below) |
| Grok Build  | `npx -y @xai-official/grok@latest agent stdio`             | `grok login`                                           |
| Gemini CLI  | `npx -y @google/gemini-cli@latest --acp`                   | Sign in with Google, or `GEMINI_API_KEY`               |
| Devin       | `devin acp`                                                | Devin CLI sign-in                                      |
| Antigravity | `agy_acp_server.par`                                       | Google sign-in when asked                              |
| Muse Code   | `muse acp` (`MUSE_EXPERIMENTAL_ACP=on`)                    | `muse login`                                           |
| Custom      | any ACP agent over stdio                                   | the agent's own                                        |

Sekai starts the agent and checks it: version, sign-in state, models and reasoning levels. When an agent offers sign-in methods, the card shows them. Pick one of its models for a bot from the Model tab or the composer pill; subscription models appear under _your subscription_.

**How a turn works**

- **Sessions.** Each bot and chat gets its own session in the agent, which keeps its own transcript. Sessions are reloaded after a restart when the agent supports it (Claude Code always does).
- **What's sent.** A new session gets the bot's full instructions and the conversation so far. After that, each turn sends only what changed: updated instruction sections, the current time and situation, messages the bot missed (for example in a group), and the new message.
- **Attachments** are copied into the bot's workspace folder (`data/workspaces/<bot>/inbox`). Images are also sent inline when the agent accepts them.
- **Sekai's tools** reach the agent as an MCP server called `sekai`, with a private URL per session. That gives the agent the bot's memory, notes, routines, skills, team and connected apps, through the same approval gate as every other bot.
- **The agent's own tools** (shell, file edits, web) work in the bot's workspace. Their permission requests go through Sekai's approvals by kind: `external_execute`, `external_edit`, `external_delete` and so on. A rule such as "always allow commands for this bot" therefore works on every provider. In read-only mode Sekai also switches the agent to its own read-only mode when it has one.
- **Background work** (titles, memory reflection, group routing, approval reviews) still uses the gateway's background model. With the _fallback_ strategy, a subscription failure before anything ran (a limit hit, or signed out) hands the reply to a gateway model. Planner and council need gateway models.

> **Claude and Anthropic's terms.** Anthropic doesn't allow third-party apps to offer claude.ai login, and Sekai doesn't. Sekai never asks for your Claude account. It drives the Claude Code that's already signed in on the computer running Sekai (`claude auth login`), or uses an `ANTHROPIC_API_KEY` you add in the subscription's settings. If anyone else uses your Sekai, use an API key.

**In Docker**, agent CLIs keep their sign-in in the container's home. Either sign in inside it (`docker compose exec app …`), or uncomment the sign-in mounts in `docker-compose.yml`. The image includes Node and npx for the npx-based agents, and Claude Code ships with the Agent SDK.

**Limitations**

- ACP agents report token usage only if they implement the v2 usage field; codex-acp does.
- Deleting a message doesn't erase it from the agent's own session. Retrying an answer starts the session over from the messages before it, so the agent never sees the old answer. **Reset chat** starts the agent over.
- Codex sends MCP tools to the model as a Responses-API namespace. An endpoint that drops namespaced tools (some OpenAI-compatible gateways do) hides Sekai's tools from Codex; signing in with ChatGPT doesn't have this problem.
