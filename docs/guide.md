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
- [A bot's own Signal account](#a-bots-own-signal-account)
- [Email](#email)
- [X (Twitter)](#x-twitter)
- [Apps (MCP) and skills](#apps-mcp-and-skills)
- [Settings and server setup](#settings-and-server-setup)
- [Network and devices](#network-and-devices)
- [Code search](#code-search)
- [Computers, devboxes and the web](#computers-devboxes-and-the-web) and [your own computer](#your-own-computer)
- [Your browser extension](#your-browser-extension)
- [Subscriptions as models](#subscriptions-as-models) and [coding jobs](#coding-jobs)

## Bots and chats

- **Bots.** Each bot has a name, a label, a job, a personality, standing instructions and a picture (a character, an
  emoji, one it draws itself, or an upload). Your primary bot is your main point of contact and coordinates the others.
- **Models.** Pick any model and thinking level per bot, from the composer or the bot's **Model & voice** page.
  Strategies combine models: _planner and executor_, a _council_ of advisors, or a _fallback_ chain.
- **Context and memory you can see.** A chat's details show exactly what the bot reads on its next turn: its
  instructions, memory, notes, history, tools and token counts, and let you compact or reset it. On the bot's
  **Memory** page you can edit or forget any memory, keep notes, and turn **Learns as it goes** on or off.
- **Self-management.** Bots run Sekai with their own tools: memory, notes, reminders, routines, skills, and creating or
  updating other bots. Built-in skills teach them good habits.
- **Group chats.** Bots answer when @mentioned or picked by a router, hand work to each other with @mentions, and ask
  each other questions in a "team chat" you can read.
- **Finding things.** Ctrl/⌘K finds bots, chats, Settings sections, actions and words in any message (names that match
  come first), and opens the chat at that message.
- **Presence.** Each avatar shows what its bot is doing (thinking, working, waiting for you, stuck, done); hovering it
  shows the current step.
- **A bot's settings.** Everything about a bot is in sections: Profile, Model & voice, Memory, Tools & access,
  Accounts, Routines and Computer, with rarely changed settings folded away.
- **On a phone.** A tab bar holds Chats, Needs you, Activity and Library; everything else opens full screen with a
  back button (and the system's back gesture in the phone apps).
- **Themes.** Six, one per Project Sekai group: Virtual Singers, MORE MORE JUMP! and Wonderlands×Showtime are light;
  Leo/need, Vivid BAD SQUAD and Nightcord at 25:00 are dark. **Automatic** follows your device. Pick one in
  **Settings → You → Appearance**.

## People, roles and sign-in

The first account (made at the first visit, with the setup code from the server's log) is an admin. There's no public sign-up: admins add everyone else in **Settings → People** with a temporary password (they choose their own at first sign-in), a one-time invite link (emailed when email is set up, valid 7 days), or single sign-on only (with their email, once a sign-in provider matches verified emails, so their first sign-in finds the account). Admins can change someone's role, turn an account off (it's signed out at once and its bots and routines stop), reset a password or two-step sign-in, sign someone out everywhere, or delete an account with everything in it. Sekai always keeps at least one admin.

At first, someone whose role lets them make bots gets **Your first bot**: what bots should call them, the bot's name, look and model (for that bot only; the server's default model stays as it is). **Skip for now** opens the app instead. Someone whose role doesn't include making bots goes straight to Chats, where the bots shared with them show up.

- **Everyone has their own workspace.** Bots, chats, memory, notes, routines, files, documents, apps and usage are each person's own; nobody else sees them, admins included (admins manage accounts, not people's chats).
- **Roles** (**Settings → People → Roles**) decide what people may use: making bots, the web, the server's browser, routines, the library, voice, apps, accounts on other apps, computers, code search, subscriptions, comparing models and sharing. They also set limits: which models, how many bots, tokens a day and a month, money a month (at the prices under Usage → By model) and storage. Admin and Member come with Sekai; make your own. A role can require two-step sign-in. Server setup (models, subscriptions, voice services, computers, network, devices, backups, people) is for admins only.
- **Sharing a bot.** In a bot's **Profile → Sharing** you let it chat with someone else (admins can also share with everyone who has a role, or everyone). They talk to it in their own chats and it remembers each person separately. Its computer, browser sign-ins, accounts, apps, your chats and its standing instructions stay yours, and only you change it.
- **Signing in:** a username or email and password, a passkey (Face ID, Touch ID, Windows Hello, a password manager), or single sign-on. Wrong passwords and codes are limited per address and per account.
- **Single sign-on** (**Settings → People → Sign-in options**): Google, GitHub, Discord, or your own OpenID Connect provider (Authentik, Keycloak, Okta, Entra…) by its address. Paste the redirect URL Sekai shows into the provider's app. It never makes accounts: it signs in people who already have one, by an account linked in **Settings → You → Sign-in & security**, or (if you allow it) by a verified email that matches theirs.
- **Two-step sign-in** (**Settings → You → Sign-in & security**): codes from an authenticator app, by email or by text message, plus ten one-time recovery codes. A passkey that checks your face, fingerprint or PIN counts as both steps, and when a sign-in asks for a second step, **Use your passkey** comes first if you have one for that address.
- **Require a passkey to sign in** (**Settings → You → Sign-in & security**): sign-ins need your passkey too, not just your password. Any other way in (password, single sign-on, an invite or reset link) then ends with your passkey; authenticator, email and text codes don't count, and signing in with the passkey itself stays one step. Turning it on needs a passkey, both ways ask you to confirm it's you, and your last passkey stays while it's on. Lost your passkeys? A recovery code replaces the passkey once (you get ten if you had none). Passkeys work only on the address they were made on (the list shows it): elsewhere the second step says which address yours are for. Admins can turn it off for someone (**Settings → People**, **Stop requiring a passkey**; **Reset two-step** does too), and so does `bun run reset-password --no-2fa`. Browsers already signed in stay signed in (**Sign-in & security** signs them out), and API tokens aren't affected.
- **Email and text messages** (**Settings → People → Sign-in options**): an outgoing mail server for codes, invites and "Forgot your password?" (that also needs `SEKAI_PUBLIC_URL`), and Twilio or a service of your own for texts. Your service gets `{"to", "message"}` with an `X-Sekai-Signature` header: the hex HMAC-SHA256 of the body with your secret.
- **Confirm it's you.** Changing your email or phone, removing a sign-in method, making API tokens, seeing a computer's passwords, and admin changes (people, roles, sign-in options, backups, models, subscriptions, network and devices) ask for your password, a code or a passkey again when you last proved it more than 15 minutes ago.
- **Locked out?** On the server, `bun run reset-password` resets the first admin's password (or `bun run reset-password <username>`; add `--no-2fa` to remove its two-factor sign-in and stop requiring a passkey). With Docker: `docker compose exec app bun run reset-password`.

## Approvals

Every tool has a risk level:

- **read**: looks something up.
- **write**: changes the bot's own workspace.
- **external**: reaches beyond the bot.
- **destructive**: deletes or overwrites something.

Precedence:

1. **Rules.** A rule set in a chat beats one set on the bot, which beats a global rule. Within each, a rule for a tool by name beats a rule for its kind (`category:<kind>`). An `off` rule hides the tool, `allow` runs it (except in read-only mode), and `ask` always asks, even in _Don't ask_.
2. **Mode.** The first mode set, checking the chat, then the bot, then global, decides by risk. In _Reviewer checks risky actions_, external and destructive calls go to a reviewer model first, and it asks you if it isn't sure. In _Primary bot decides_, your primary bot reviews them instead, in its own voice and with what it remembers about you; the primary's own risky actions go to the reviewer model.

Unanswered requests are denied after a timeout (Settings → Bots → Approvals), so routines never hang. Requests show up in the chat, in **Needs you**, on the desktop badge, and on any linked chat app (buttons or reactions). With push notifications on, a request's notification has **Approve** and **Deny** buttons, so you can answer from your lock screen or notification center without opening Sekai. Requests that always need you (root on a device, a new computer) have no buttons: tapping opens the chat.

**Activity → Log** lists everything your bots did (every tool call, from every chat, Discord and routines), how it ended, and who allowed or refused it: a tool's rule, the approvals rule, the reviewer, the primary bot, you, or a timeout. Search it, filter by bot, outcome, risk or who decided, open the chat at that moment, and export it as CSV or JSON lines. Deleting a chat doesn't erase its entries. Admins can switch it between **Just me**, **Everyone** and one person, as in Usage. Other people's entries show only what happened: when, whose, which bot, the tool's plain name ("Wrote a note"), how it ended, who decided and the risk. What the bot was asked and got back stays with that person, and there are no links into their chats; search and both exports follow the same rule.

Some requests always ask you, whatever the mode or rules: root on one of your devices, for example. They're answered one at a time and never become a rule.

## Routines and events

Routines are listed in **Activity → Scheduled** and in each bot's **Routines** section. A routine runs on a schedule (every day, weekdays, every few hours, once, or cron) or **when something happens**:

- **A webhook is called.** The routine gets its own address (`/api/hooks/…`, shown under the routine); POST to it from GitHub, Home Assistant, IFTTT, Zapier or a script, and the bot gets what was sent along with its instruction (as data, never as instructions). One run per 10 seconds at most. Anyone with the address can start the routine, so keep it private; it's reachable wherever Sekai is (your tailnet, or the internet if you expose it).
- **A device changes.** A device on your tailnet goes offline, comes back online, or either. Pick one device or any device bots can use. Sekai checks every minute, and a change counts once it has lasted two checks.

"Bot does the work" runs the instruction; "Just remind me" posts it with what happened.

## Memory check-ups

Every Sunday (or the first Sunday of the month, or never: Settings → Bots → Memory) each bot with a few memories reads everything it remembers:

- It **merges** memories that say the same thing.
- It **drops** ones a newer memory replaced (an old job, say).
- It **asks you** about older facts that may have changed (a trip that was planned, where you work), at most three questions.

The bot posts what it changed and its questions in its chat. Answer there and it updates its memory. Pinned memories and the ones you wrote are never changed on their own, only asked about. Your primary bot also looks after the memories every bot shares. Run one any time from a bot's **Memory** page (its ⋯ menu → **Check up**).

## Moving and sharing bots

**Export** at the bottom of a bot's **Profile** saves it as one `.sekai-bot.json` file. The file holds:

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

**Library** (in the sidebar or the phone's tab bar, or Ctrl/⌘K) holds documents every bot can search: manuals, papers, notes, contracts. Add files, a whole folder (its name becomes a group), or drop files on the page. Sekai reads PDF, Word (.docx), Markdown, text, HTML, CSV and JSON, up to 25 MB each. Scanned PDFs need OCR first.

Each document is split into passages that keep their page and section, and embedded with your gateway's `text-embedding-3-small`. Bots use `library_search` (by meaning and by words) and `library_read` (around a result, or a page), and cite the title and page. If the embedding model can't be reached, a document is still found by its words, and **Read it again** fixes it later. **Search the library** on the Library page shows what bots would find. Documents are part of backups.

## Morning digest

Every morning (8:00 by default, in your time zone) your primary bot posts a digest in its chat, with a notification:

- **What your bots did:** replies, routine runs and actions, per bot.
- **Didn't work:** failed routines, replies that ended with an error, failed or denied actions.
- **Waiting for you:** approval requests and sign-ins.
- **Today:** routines and reminders still to come today.
- **This server:** health problems, and the tokens used (with the cost, if you set prices).

Your primary bot writes it up in its own voice (one small model call, keeping every fact), or choose a plain list. Quiet days are skipped unless you turn that off. Change it in **Settings → You → Notifications**, where **See one now** sends one covering the last day.

## Retrying answers and refusals

The ↺ button under a bot's answer (or a long press on touch screens) has two choices:

- **Try again**, with the same model or one you pick. The old answer stays as a previous version, and `‹ 2/3 ›` switches between versions. The version shown is the one the bot sees from then on. A new attempt only sees the conversation up to that answer, never its earlier versions.
- **Erase this answer** first. The answer is removed from the chat and from the bot's context, then the bot answers again.

**Refusals.** When a model declines a task or a provider's safety filter stops it, Sekai blanks the refused text and another model carries on with the same turn, keeping any tool results so far. A short note shows who declined and who answered; the refusal itself never reaches the next model or later turns. Sekai detects refusals three ways:

- A safety finish reason (`content_filter`, `refusal`, `SAFETY`, …).
- A provider error that names a policy or filter.
- A short "I can't help with that" style reply, confirmed by the background model.

Under **Settings → Bots → Models → Advanced** you can turn this off or choose the models to try, in order. By default Sekai picks a strong model from a different provider (from your fallback chain first) and tries at most two others. Subscription bots that refuse have their session started over, and a gateway model takes the turn with a note of what was already done.

## Voice

Voice uses [ElevenLabs](https://elevenlabs.io) or [Fish Audio](https://fish.audio): in **Settings → Bots → Voice**
(admins), add one under **Voice services** with your API key, then pick the default speaking voice, speech-to-text model
and language there. Each bot can have its own voices on its **Model & voice** page; anything left on default follows
Settings → Bots → Voice.

- **Calls.** Call a bot from the app (the phone button in a chat) or bring it into a Discord voice channel. What you
  say is written down, the bot answers with its own model and tools, and the answer is spoken in its voice sentence by
  sentence, so it starts talking quickly. You can type during a call too.
- **Reading aloud and voice messages.** ▶ on a reply reads it in the bot's voice. The waveform button in the message
  box records a voice message: it's written down for the bot, and the bot answers with a voice message. Messages are
  Ogg Opus, the same format as Discord voice messages.
- **Dictation** writes down what you say in the message box, with your speech-to-text model.
- **Make a voice.** In a voice picker (**Change → Make a voice**) or **Settings → Bots → Voice → Your voices**: describe
  a voice and keep one of the takes Fish Audio makes, or record 10–30 seconds of someone who agrees to it. Fish Audio
  voices are kept by Sekai and sent with each line, so they work on any Fish plan. ElevenLabs saves them to your account
  (paid plans only).

## Bots reach you

- **`message_user`** sends you a message on the bot's own initiative: a Slack, Discord or Signal DM from its account there when it has one, otherwise in its chat in the app, optionally as audio. Choose `via: "slack"`, `"discord"`, `"signal"`, `"app"` or `"auto"`. Reminders and routines use it when you asked to be told.
- **`call_user`** rings the app (a full-screen ring on phones). If you're in a Discord voice channel its bot can see, it joins you there. No answer in 40 seconds (or Decline) sends its message as a voice message instead.
- **Notifications** for approvals, calls, outreach and finished routines show in the browser, the desktop app and the phone apps, and as [push notifications](install.md#on-your-devices) on devices that turned them on. Approval requests can be answered right from the notification.

## Bots on Slack

Each Sekai bot gets its **own Slack app and real bot user**: its own name, avatar, mentions, DMs and Messages tab. Nothing impersonates another bot through a shared webhook. Sekai connects out using **Socket Mode**, so a server behind a home router or on a tailnet needs no public URL or signing endpoint.

### Set up a bot

1. Open the bot's **Accounts → Slack**, choose **Connect Slack**, and click **Create the app in Slack**. Pick your workspace and review the generated manifest. If the link doesn't prefill it, use **Copy manifest** and Slack's **From a manifest** flow instead. The manifest enables messages, mentions, files, interactivity, Socket Mode and Slack's agent messaging view.
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

**Setup.** In the bot's settings, open **Accounts → Discord** and choose **Connect Discord**. Create an application in the [Developer Portal](https://discord.com/developers/applications), give it the bot's name and picture, copy its token from **Bot → Reset Token**, and paste it in Sekai. Once it's connected, **Add to a server** invites it with the permissions and commands it needs; **Message it** opens a DM. Turn on **Message Content Intent** (Bot → Privileged Gateway Intents) if you want `/listen`; Sekai notices it and uses it.

**Who can use it.** Only you. Strangers who DM the bot get a **pairing code** that you approve in Sekai, or you can add Discord user IDs to the allowlist. Add another bot's ID to let it drive this one (handy for testing). In servers the bot answers allowed people when they mention it, reply to it, or anywhere you've used `/listen on`.

**Chats.** Every DM, server channel and thread gets its own chat in Sekai (listed under Discord in the sidebar). The bot shows as typing while it works, and each reply is posted once it's finished, so it arrives whole instead of being edited as it's written. Long answers continue in more messages. Sekai's own notes (saved to memory, a fallback model answered) stay in Sekai; warnings and errors are shown in small print. Messages deleted in Sekai disappear from Discord too.

**Commands.** Type `/` in Discord; the same commands also work typed as plain text (`@Bot /retry gpt-6.1-sol erase`):

| Command                                                      | What it does                                                                                      |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `/new` `/stop` `/compact` `/context`                         | Fresh chat (memory stays); stop; summarize older messages; what the bot sees next turn            |
| `/retry [model] [erase]`                                     | Answer the last reply again, keeping it as a version or erasing it, optionally with another model |
| `/status` `/profile`                                         | How the bot is set up here; who it is                                                             |
| `/model [model] [thinking]`                                  | See or change the bot's model (with autocomplete)                                                 |
| `/mode [mode]`                                               | This chat's approvals: read-only, ask, reviewer, primary bot, don't ask, or the bot's own         |
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

For group chats, servers and voice where a bot application can't go, give the bot a normal Discord account instead (one you make for it, not your own). In its settings, open **Accounts → Discord → Connect Discord**, pick **A normal account** and add its token (DevTools → Network → any request to discord.com → the `Authorization` header).

The account's DMs and group chats arrive in Sekai and the bot's answers are sent as the account — add it to a group chat with friends and it talks there. Ping or DM the account and it answers and does things, like the X bot. You manage who else it answers right in Discord: **@bot trust @fern** lets fern talk to it anywhere it can see them, **@bot trust everyone in this GC** trusts the whole group chat, and **untrust @fern** stops them (also as `/trust`).

The bot can use the account for anything you'd do in Discord, through one `discord` tool (REST with the token): list servers, read a server's channels and members and history, send to a server channel or group chat or DM, open a DM by user id, react, and change the account's display name and bio. For the interactive things — joining a server from an invite, voice channels, anything with a captcha — it opens Discord **in its own browser, signed in as the account** (`browser_account`) and clicks like a person. Joins and captchas are why it's a real browser: the agent ticks the check itself, or you take over its computer in the app and tick it. If a check rotates the account's token, Sekai picks up the fresh one the app is holding and keeps going.

Discord doesn't allow accounts to be used like this, so the account could get limited. Only you (and whoever you trust) can talk to it.

## A bot's own Signal account

Signal has no bot API, so a bot gets a **real Signal account**, run by [signal-cli](https://github.com/AsamK/signal-cli) (a third-party, open-source Signal client) on your server. The bot speaks as that account: **use a number made for the bot, never your own.** Its DMs and groups show up as chats in Sekai (with Signal's mark in the sidebar), and it answers, asks for approvals and sends and receives files there.

**Setting up Signal on the server.** One signal-cli daemon runs every bot's account, started when a bot has one. On Linux (x86_64) an admin installs it from a bot's **Accounts → Signal → Connect Signal** with **Install it**: Sekai downloads signal-cli 0.14.10's native build (no Java needed), checks it against the SHA-256 pinned in Sekai, and unpacks it into `data/tools/signal-cli/`. Elsewhere (ARM, macOS), install Java 21 or newer and signal-cli 0.14.10's JVM build yourself, and put `signal-cli` on the server's `PATH` or set `SIGNAL_CLI` to its path. The Docker image gets it with `docker compose build --build-arg WITH_SIGNAL=1` (x86_64). People who may connect accounts but aren't admins are told to ask an admin.

**Connecting a bot**, in **Accounts → Signal → Connect Signal**, one of two ways:

1. **Link to a phone (recommended).** Get a phone (or a spare one) with Signal on a number made for the bot. Choose **Show the code**, then in Signal on that phone: **Settings → Linked devices → Link new device**, and scan it. Sekai becomes a linked device of that account, like Signal Desktop; the phone keeps the account. The code works for two minutes (**Show a new code** after that).
2. **Register a number.** No phone needed afterwards: a number that can get a text or a call becomes the bot's own Signal account. Signal asks for a captcha first: solve it at [signalcaptchas.org](https://signalcaptchas.org/registration/generate.html), copy the **Open Signal** link (right-click it, or touch and hold) and paste it. Signal texts a six-digit code (or calls, after a text was tried); enter it. A registration lock PIN is optional: Signal asks for it if the number had one, and a new one stops others from registering the bot's number. The profile gets the bot's name and picture.

On the account's page, **Name and picture on Signal** gives the account the bot's name and picture (Colorful Stage pictures are made smaller to fit Signal's circle whole, never cropped). Then message the bot from your own Signal: you get a pairing code to approve in **Needs you**, and the first person approved is its owner.

**What works.**

- **DMs and groups.** In a DM it answers everything; in a group it answers when it's @-mentioned or someone replies to (quotes) one of its messages, or every message after `/listen on`. It joins a group only when someone it answers added it, and declines or leaves the others.
- **Who can use it** works as on Discord and Slack: an allowlist and pairing codes, by each person's Signal account ID (their ACI), never by a name or a number someone could claim. `trust @someone`, `/trust` and the owner-only commands are the same.
- **Replies** are posted once they're finished, with the typing indicator meanwhile. Markdown becomes Signal's own styles (bold, italic, strikethrough, monospace, spoilers); links show as their address so Signal makes them tappable; headings become bold lines and tables monospace. Long answers are split at paragraphs into messages of at most 2,000 bytes (Signal's limit for one message). A retry edits the same Signal message (Signal allows that for a day, ten times); older ones are sent again. In groups a reply quotes the message it answers. Messages deleted in Sekai are deleted for everyone on Signal too.
- **Files:** images, files and voice notes both ways (as files; voice notes aren't transcribed), with Sekai's size limits (20 MB in, 25 MB out). Images get their real type.
- **Approvals and commands** are text, since Signal has no buttons: a request says what the bot wants to do; react 👍 to approve or 👎 to deny, or type `/approve CODE` / `/deny CODE`. Only the owner decides. Every command works typed (`/help` lists them). Reactions, typing indicators and quotes work both ways.
- **Safety numbers.** signal-cli trusts a contact's first safety number. When one changes (a new phone, Signal reinstalled, or someone else took over their number), their messages wait until you trust the new one on the account's page (it lists them, and the log notes it). A changed safety number never makes anyone allowed.
- **When something breaks** the account's page says so: Signal's helper isn't running (Sekai restarts it by itself; admins can **Restart** it), or the account was **signed out** (its link was removed on the phone, or the number was registered elsewhere): **Link it again** or **Register it again** right there keeps its chats and settings.
- **Removing it** forgets the account's keys here. A number registered here is unregistered from Signal first; a linked phone's account is never touched (remove Sekai from **Linked devices** on the phone too).

**Limits.** No calls, stories, stickers or polls. The daemon listens on `127.0.0.1` only, but its HTTP interface has no password, so anything running on the server itself could use the accounts: run Sekai on a machine you trust. Signal's own limits apply (rate limits, captchas when it's suspicious of a new account). Backups keep the accounts' keys (`data/signal/data`), not the files signal-cli downloaded; restoring a backup on a second server while the first still runs puts the same account in two places, which Signal won't like.

**Testing.** `bun test apps/server/test/signal.test.ts` and `signal-format.test.ts` cover the events, the formatting, the installer's checksum and the adapter against a fake signal-cli; `signal-routing.test.ts` runs a DM, pairing, approvals and groups through the channel manager (with Postgres).

## Email

Open a bot's **Accounts → Email** to give it an address. Only the owner can do this, and their role needs the
**Accounts** permission.

- **Create an address:** first, an admin opens **Settings → Bots → Email**, enters mailcow's HTTPS address and a
  **read-write** API key, and chooses **Check**. Select just the domains bots may use (none are selected by
  default), choose a mailbox size and save. On the bot's page, pick the name and domain. Sekai creates the mailbox
  with the bot's display name and a random password. The key and mailbox passwords are encrypted at rest.
- **Use an email account:** enter its address. **Find servers** looks up the incoming (IMAP) and outgoing (SMTP)
  settings; check the names, ports and encryption against your provider's instructions. Enter the username and
  password (often an app password), then **Test** and **Connect**. Both sign-ins must work before Sekai saves it.

**Who can email it** lists the people who may ask this bot to do things. Your address is added initially if it's
on your Sekai profile. Only add people you trust with the bot's tools and memory. A From line isn't proof: Sekai
checks the receiving server's authentication report for a DMARC pass or an aligned SPF or DKIM pass. For local
mail on mailcow, which can omit that report, Sekai can verify the domain's signature over the message itself.
Unknown, unverified and automated mail stays in the inbox. Its contents are data, not instructions to the bot.
If you turn on notes for new senders, **Needs you** lets you allow a verified address for _future_ messages.

New verified mail from those people opens an email-marked chat. Replies keep the subject and threading headers,
and attachments appear in the chat. Messages you type in Sekai stay there; an answer to an incoming email goes
back to its sender. Approvals happen in Sekai, never by replying to an email. Bots can also send formatted mail
and files, reply, search, read, flag, archive or delete mail. Sending outside the list follows the bot's outward
action approval rule. The **daily send limit** defaults to 50 messages per rolling 24 hours, including replies.

One mailbox per bot. Watching starts with new mail, not the old inbox; older mail can still be searched and read.
Sekai uses IMAP IDLE when available and checks periodically otherwise. Incoming messages over 40 MB are skipped;
individual uploads are limited to 25 MB, and outgoing attachments to 20 MB together. **Disconnect** keeps the
mailbox. For a mailbox Sekai created, **Delete the mailbox too** permanently removes its mail on mailcow. Neither
choice deletes existing Sekai chats. Sign-in and password-reset emails use the separate settings under **People →
Sign-in options**.

## X (Twitter)

A bot's settings → **Accounts → X** signs it in to an X account with that account's `auth_token` cookie (stored encrypted). The bot can then post, reply, quote, delete, search, read threads and profiles, like, repost, bookmark and follow, using [emusks](https://emusks.tiago.zip/). It answers posts that mention it only from the handles you list, checked by account id in code before the bot sees anything, and replies in one post. Use an account made for the bot: automating X is against X's rules, so the account could be locked. emusks is AGPL-licensed and loaded only when a bot has an X account.

## Apps (MCP) and skills

**Settings → Bots → Apps & skills** (or a bot's **Tools & access → Add an app**) lists popular apps with their sign-in already worked out: one-click OAuth (with your own OAuth client for Google, GitHub, Slack, HubSpot and Asana), an API key, or nothing. Give an app to every bot or to chosen ones, pick which of its tools a bot gets, and set rules for them like built-in tools. **Custom app** connects any other MCP server by its address (admins can also run one as a command on the server); started from a bot, it's added for that bot and brings you back to it.

People who aren't admins can add apps on the internet (with the **Apps** permission); apps that run as a program on
the server (stdio) or live on your own network are for admins. An admin can let everyone's bots use one of theirs.

**Skills** are instructions bots load when they need them. The **Skills** tab of **Settings → Bots → Apps & skills**
lists them: create, edit (with a preview), import a `SKILL.md`, export, or turn one off; built-in skills are read
only for everyone but admins. Bots can write their own too.

## Settings and server setup

**Settings** holds everything you can set, in four groups: **You** (your profile, sign-in and security, appearance, notifications, the browser extension, this computer, get the apps), **Bots** (approvals, models, subscriptions, apps & skills, voice, web reading, memory check-ups, usage), **People** (people, roles, sign-in options) and **Server** (status, computers, network & devices, backups, about). Open it from the **Settings** button at the bottom of the sidebar or the person menu, or find a section with Ctrl/⌘K. Each person sees the sections their role allows. A section you can open but not change is read only, and says so. On a phone, Settings is a list that opens each section as its own page, with **Search settings** at the top.

**Status** (**Settings → Server → Status**) is where admins start: what needs setting up or fixing (a model server that's down, a subscription to sign in to again, a device bots can't reach, an expiring Tailscale key…), with a button to fix each, then everything at a glance. Requests (approvals, pairings, sign-ins) stay in **Needs you**, which Status links to with a count. A problem also shows as a dot on Settings and on its section.

**Compare models** (Settings → Bots → Models → Compare models, or on its own in Settings for people whose role has it) sends one prompt, with an optional system prompt, to up to four models at once. Their answers stream in side by side, each with the time to its first word, its total time, tokens and cost (at the prices you set under **Usage → By model**). Recent prompts stay in your browser to run again. Subscription models only run as a bot's model, so they aren't offered.

**Usage** (**Settings → Bots → Usage**) charts tokens by hour, day or week, stacked by model or bot, with a cost line at
the prices you set, compared with the period before; a heatmap of busy hours; and breakdowns by bot, model and (for
admins) person, with CSV export. People see their own usage and their role's limits; admins can look at everyone's or
one person's.

## Network and devices

**Settings → Server → Network & devices** is where your tailnet and Sekai meet:

- **This server:** its name and address on the tailnet, and a switch for its **Private HTTPS address** (`tailscale serve`), which phones need for push notifications and passkeys. If Tailscale asks for permission the first time, run `sudo tailscale set --operator=$USER` once on the server.
- **Devices bots can use:** every device on your tailnet (**In use** or **All**, with a search), each with a **Bots can use** switch. Bots get keys to your account there by default (set once, change it per device). **Add an account** lets bots in as another one too, like `root`: Sekai puts its master key there with sudo when your account may use sudo without a password, and otherwise shows the command to run. Bots are let in per account, and a bot asking for root always asks you, whatever the approval mode. Your bots' own computers are labelled and managed in **Settings → Server → Computers**. Servers that aren't on your tailnet can be added by address.
- **Tailscale API:** an access token (`tskey-api-…`) or an OAuth client lets Sekai list the whole tailnet with owners, tags and key expiry, warn before the auth key for bots' new machines expires, and make a new one. Without it, Sekai sees devices through the server's own Tailscale. The auth key under **New computers** on this page (`tskey-auth-…`) is a different kind of key: machines join the tailnet with it, but it can't read the tailnet.

To let bots work on a device:

1. Turn it on. If Sekai's master key isn't on it yet, the row shows the command to run there once (PowerShell as administrator on Windows, which also turns on Windows' SSH server).
2. Bots ask with `host_request_access` and a reason (and `as: root` for another account). Your approval mode decides (or the primary bot, with _Primary bot decides_), and the primary bot can grant teammates access with `host_grant`. Sekai then adds that bot's own key to that account on the device, and the bot works there with `host_run` (PowerShell on Windows).

Bots never get the master key, access is listed per device (remove it with one click), and revoking takes the bot's key off the device. Bots can also be let onto each other's computers and devboxes this way.

## Code search

A bot that works in a codebase can index it: `code_index` on a folder on its computer, a devbox or your lent computer. Sekai reads the files on that machine (skipping dependencies, builds, binaries and lock files), splits them into pieces at natural boundaries, and embeds them through the gateway (`text-embedding-3-small` by default). `code_search` then finds code by what it does ("where are sessions checked") or by name, mixing meaning and keyword matches. Indexing again reads only files that changed. See and manage indexes in the bot's settings under **Memory → Code**.

## Web reading

Bots read the web with `web_fetch`, which fetches a page and strips it to text. Turn on **Enhanced reading** in **Settings → Bots → Web reading** and that gets much better: Sekai runs [Firecrawl Local](https://github.com/firecrawl/firecrawl/tree/main/apps/local), one small Rust binary that turns a page into clean Markdown (no navigation, adverts or cookie banners), reads PDFs, Word and other documents, and renders pages that need JavaScript in the Chrome your server already has. Bots also get:

- `web_search` — search the web and get the best pages with a snippet each.
- `web_map` — every page of a site, from its sitemaps and front page, optionally filtered ("pricing").
- `web_crawl` — follow links from a page and read up to 25 of them in one go, with `include`/`exclude` path patterns.

**Where it runs.** **On this server** lets Sekai start and watch it. **Install Firecrawl Local** builds it with Rust's cargo in the background (a few minutes; install Rust from [rustup.rs](https://rustup.rs) if the button says this server hasn't got it). Sekai then starts it on 127.0.0.1 with a fresh token and a free port, restarts it if it stops, clears away one a crash left behind, and says on the page when something is wrong. **Another server** points at a `firecrawl-local serve` you run yourself — another machine, or a container next to Sekai: give its address and its `--token`, if it has one. The Docker image can include the binary: `docker compose build --build-arg WITH_WEB_ENGINE=1`.

**Let Sekai set it up.** When Firecrawl Local isn't on your server yet, **Set it up for me** has your default model install it: it looks at the server, installs the build tools with the package manager (`sudo -n`, when the account Sekai runs as has passwordless sudo), installs Rust with its official installer, builds `firecrawl-local` with cargo, and Sekai turns it on and checks it answers (telling the model what went wrong if it doesn't). You watch every command and its output on the page and can stop it any time; it took about 8 minutes on a fresh Debian 13 server, most of it the build. It runs as Sekai's own account, and Sekai checks every command before it runs: never Sekai's own files or `.env`, no starting or stopping services or programs, no containers, Tailscale or other machines, no accounts, disks or schedules, `sudo` only for the package manager, and only Rust's installer may be piped into a shell. Only admins can start it, after confirming it's you.

**What leaves your server.** Reading, listing and crawling happen on your machine and send nothing to Firecrawl. Searching has to go to Firecrawl's cloud, because there's no search index on your machine, and a page that refuses your server can be fetched by them instead. Under **Cloud usage** you pick _Off_ (nothing leaves: bots have no `web_search`), _Search only_ (the default), or _Search & fallback_ (searches, and pages that refuse your server). Search works without an account, with low limits; a [Firecrawl key](https://www.firecrawl.dev/app/api-keys) raises them, and it's kept encrypted like every other secret.

**Safety.** The engine listens on loopback only and never gets `--allow-private`, so it refuses your own network, the Sekai server itself and cloud metadata by itself, after redirects and DNS too. Addresses on your network stay with `web_fetch`, which asks you first. It identifies itself as `FirecrawlLocal` and reads `robots.txt` when crawling. **Test a page** on the Web reading page reads one the way a bot would, so you can see it working.

## Computers, devboxes and the web

**A computer of its own.** Any bot can have its own computer on your Proxmox server, running Debian 13 with XFCE (plus xfce-goodies) and Google Chrome. You create it from the bot's **Computer** section (the monitor icon in the chat header, or the chat menu → **Give it a computer**), or the bot asks for one and you approve. Default size: 4 cores, 8 GB RAM with ballooning down to 2 GB, and a 64 GB disk; change it per computer (**Resize**), as the default in Settings → Server → Computers, or let the bot ask for more.

**Virtual machine or container.** Computers and devboxes run either as a virtual machine or as a container, with the same software and the same tools. Containers are much lighter and start faster; they share the Proxmox host's kernel. VMs are fully separate machines with their own kernel: pick one for Docker-heavy or kernel work. New computers are VMs and new devboxes containers unless you choose otherwise when you make one, or change the defaults in **Settings → Server → Computers**, under **Advanced** (_Computer type_, _Devbox type_). Bots can ask for either (`computer_request` and `devbox_create` take a `backend`), and the panel shows which each machine is.

A VM is set up by cloud-init from a seed Sekai writes itself; a container (which doesn't run cloud-init) gets the same setup as a script Sekai starts over SSH and follows until it's done. Either way:

- Two accounts: root, and one named after the bot (with sudo). Both get random passwords, which you can see in the Computer section and the bot can look up.
- The bot's own SSH key (one per bot, for all its machines). Sekai uses it to drive the computer.
- SSH, VNC on the desktop (x11vnc, port 5900) and RDP (xrdp, port 3389, a session of its own), ready to use.
- Tailscale, if you add an auth key in Settings, so the machine joins your tailnet (in a container it runs in userspace mode, since containers get no network device of their own).
- The desktop logs in by itself and never locks or blanks, and Chrome's own password manager is off (Sekai handles logins). On a VM it's the real screen; a container has no screen, so its desktop runs on a virtual one (Xvfb, 1440×900) that systemd starts at boot as the bot's account. Bots and you use both the same way.

The screen shows live in the chat's side panel and on the bot's **Computer** section. **Take over** opens it full screen in Sekai (VNC through the server) and the bot waits until you **Hand back**.

**Faster screen control (experimental).** In **Settings → Server → Computers**, under **Advanced**, turn on **Faster screen control** to have bots see and use their Linux computers' screens through [screen-relay](https://github.com/vercel-labs/screen-relay) (Vercel Labs, Apache-2.0, still experimental) instead of a command over SSH for each action. Through Sekai, a screenshot took about 45 ms instead of 1.7 s, and clicks and typing a few milliseconds. The first time a bot uses its screen, Sekai sets it up there in the background as the bot's account: Node 22, screen-relay 0.1.2 and a build of its engine (a minute or two, with the account's passwordless sudo for the packages). It attaches to the screen that's already there, listens on 127.0.0.1 only (port 7700 plus the display's number, so each seat on a shared computer has its own) with a token only that account can read, and Sekai reaches it through an SSH tunnel. Until it's ready, or whenever it fails, bots use the usual way, and the accessibility tree, windows, opening apps and the clipboard always do. Screenshots through it are full size (1440×900 on Sekai's computers), so screens wider than 1600 pixels keep the usual way; a bot's coordinates switch only when it takes a new screenshot, so a click always matches what it last saw. Switching it off goes back to the usual way at the next screenshot.

**Teach a bot by doing it once.** While you're in control of one of your own bots' computers, **Teach** (the cap in the takeover toolbar) asks what you'll show it, then records what you do: clicks (with the screen as it was, the spot marked), drags, scrolls, shortcuts and what you type, with the window each happened in and the field your text went into. Text typed into a password field is never kept: Sekai asks the computer which field has focus when you start typing, and that text never leaves your browser. **Done** shows the steps it saw: hide any other text you'd rather keep private, drop mistakes, add a note. **Write the skill** sends them, with up to 20 of the frames, to the first of the bot's models (then the server's defaults) that can see images, which writes a skill in Sekai's usual shape (when to use it, inputs, numbered steps, how to check, what needs your OK), describing targets by their labels and favouring the bot's browser and app tools over coordinates. Review and edit it, then **Save for** the bot: it becomes one of your skills, on for that bot (Settings → Bots → Apps & skills), and the bot loads it when you ask for that task. Recordings stop on their own after 20 minutes. Hand back finishes a recording first. Chrome on bots' computers now joins the accessibility layer, which the password check and the bot's `computer_ui` need: new computers get it machine-wide, and the Chrome Sekai starts gets it on older ones too.

**Checkpoints.** A checkpoint saves a computer's or devbox's disk as it is (a Proxmox snapshot, without memory, so it takes a second or two and the machine keeps running). Make one from the bot's **Computer** section (**Checkpoints → Save checkpoint**), and **Restore** it if something breaks: everything since is lost and a running machine restarts. Bots can make and restore their own (`machine_checkpoint`; restoring asks like any destructive action), and Sekai saves one by itself before risky commands (`sudo`, `apt`, `rm -r`, `curl … | sh` and the like), at most every 30 minutes per machine, keeping the latest 3. Snapshots need storage that supports them: qcow2 on a directory, LVM-thin, ZFS or Ceph. Where it doesn't (a container on plain directory storage, say), checkpoints are full Proxmox backups (vzdump, zstd) instead, kept on a storage that takes backups. They take longer (about 15 seconds for a fresh devbox), use disk space, and aren't made automatically. Restoring puts the machine back from the backup and restarts it. Deleting a machine deletes its backups.

**How bots use computers.** For websites, bots use their browser: Chrome on their computer, driven with Playwright over an SSH tunnel. They read pages as accessibility snapshots with element refs (the approach of the [Playwright MCP server](https://playwright.dev/docs/getting-started-mcp)), which holds up on complex web apps: forms, menus, popups, new tabs, dialogs and iframes. For desktop apps they read the screen's accessibility tree (AT-SPI: buttons, menus and fields with positions) and click elements by id, fall back to screenshot coordinates, and use the terminal (`run_command`) for anything a shell does faster. Every action returns a fresh screenshot, so the model sees what happened; the screenshots show up in the chat too. Bots without a computer still browse, with a browser on the Sekai server.

**The server browser.** When a bot browses on the server, Sekai runs a real, installed Chrome (its preference) or Chromium on a virtual display — not a headless build — and hides the automation switch, so the browser reports itself the way a person's browser does and sites that block headless or automated browsers still work. This needs Chrome/Chromium, `Xvfb` and `bubblewrap` on the server (the Docker image has them); without them Sekai falls back to the usual headless Chromium. Clicks move the mouse rather than teleporting it, and `slowly` types at a human pace, for the same reason.

**Signing in.** When a site needs a login, the bot calls `browser_login` and Sekai asks you in a popup (also under **Needs you**). What you type goes straight into the page, so the bot and its model never see it. Tick **Remember** to keep the login encrypted on your server for that bot and site; manage saved logins in the bot's **Computer** section.

**Devboxes.** Temporary Debian 13 machines on Proxmox for development work (containers unless you or the bot choose a VM): same SSH key, sudo account, passwords and Tailscale, no desktop. Bots create them on their own (up to 3 each by default) and they're deleted after 24 hours unless extended. You can create and delete them in the bot's **Computer** section too.

**Web apps on a machine.** A dev server, an API or a preview a bot runs on its computer or a devbox opens from your devices on your tailnet, never the internet. **Web apps** in the machine's settings list what's listening (checked every few seconds while it's open), each with its link at the machine's Tailscale IP and the app's port (`http://100.x.y.z:5173`), and **HTTPS link** adds one at its tailnet name (`https://<machine>.<tailnet>.ts.net`, through `tailscale serve`) for apps that need HTTPS or only listen on 127.0.0.1. A VM reaches only apps that listen on 0.0.0.0 by IP; a container also reaches ones on 127.0.0.1, since its Tailscale runs in userspace. The first HTTPS link takes port 443 (a link without a port), later ones 8443 and up, and HTTPS links need MagicDNS and HTTPS certificates turned on for your tailnet. Bots get the same with `machine_ports` and hand you the link after starting a server. SSH, the screen, RDP and Chrome's debugging ports are never listed. A machine that isn't on your tailnet gets links at its home network address instead.

**A machine you already have.** In the bot's **Computer** section, **Use an existing computer** adds any Linux desktop reachable over SSH; add the bot's public key there (Sekai shows it) and **Try again**.

**Sharing a computer or devbox with other bots.** Under **Share with bots** in a machine's settings, add any of your bots, or a bot someone shared with you (the list says whose). Each gets a seat of its own there, set up over SSH in a minute or so:

- its own account (named after it) and home folder, with sudo like the machine's own bot, and its SSH key (a bot shared with you gets a key of the seat's own instead of its usual one, so its owner never holds a key to your machine);
- on a computer, its own screen too: a desktop on a virtual display (`:10`, `:11`…) with its own VNC port (5900 + the display) and password, and its own Chrome profile and debugging port. Whatever a VM or container needs for that (Xvfb and friends) is installed the first time, also on computers made before this existed.

A member bot's **Computer** section shows its seat: the live screen, **Take over** (its own screen, not the others'), and its own passwords and key. Its computer_, browser_ and file tools and `run_command` work there in its own account (`on: "<machine name>"`, or by default when it has no computer of its own). Turning the machine on and off, resizing it, checkpoints and deleting it stay with the machine's own bot and you, and they affect every bot on it. Removing a bot from a machine deletes its account, home, screen and files there; deleting a bot removes its seats everywhere (and deleting a machine, or the bot it belongs to, removes everyone's: the panel warns you when other bots use it).

**Shared browsers.** In a bot's **Computer** section, open **Shared browsers** and choose **New browser** to make one several bots use. It runs on the Sekai server or on one of your computers (Chrome on that computer's own screen, so you can watch it there; the bots don't need a seat on that computer). Its sign-ins are either **shared** (one profile: a site one bot signs in to is signed in for the others; each works in its own tabs) or **separate** (each bot gets its own profile in it). Bots open pages in it with `on: "<its name>"`; their other browser tools then act there until they open a page elsewhere. The server's network rules apply to it as to bots' own server browsers.

**Who may use what's shared.** In your own chats, your bots and bots others shared with you use what you put them on. A bot someone shared with you never uses your machines or browsers in its owner's chats (or anyone else's), and its owner's computer, browser and accounts never come into yours. **Also for people these bots are shared with** (on each machine and shared browser, off unless you turn it on) lets your own bots there use it when people you've shared them with chat with them; bots others shared with you still don't. A bot's saved logins are only used and saved in its owner's chats; elsewhere Sekai asks. In the chat of a bot someone shared with you, **Your shared access** (in the chat's menu, or its Computer button when one of your computers it has an account on is running) shows only what you lend it: those computers, with the live screen and Take over, and your browsers it may use.

**Setting up Proxmox** (Settings → Server → Computers; Proxmox VE 8.4 or newer):

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

In Sekai, go to **Settings → You → Browser extension**, make a browser token, and paste it and your server address into
the extension. Choose your own bot and a direct chat, then **Choose tabs to share**. Only shared tabs are visible
to the bot, and host permission alone never shares a tab. Mutations always ask, even in _Don't ask_. Opening and sharing
a new tab also asks locally in the extension. Switching sites requires sharing again.

**Stop sharing**, unshare the tab, change bot/chat, disconnect, or close the panel to stop control. Grants aren't
saved or restored. Revoke saved browser tokens on the same Settings page. The browser tools are `extension_browsers`
and `extension_browser`, with the **Using the user's browser** built-in skill; they remain separate from the bot's
own browser tools and sign-ins. Screenshots require selecting the shared tab and invoking Sekai's toolbar icon there.
The extension doesn't expose cookies, arbitrary JavaScript, browser settings, private windows or file access.

## Your own computer

The desktop app can lend the computer it runs on to bots, so they can work there the way they do on their own computers. Open **Settings → You → This computer** in the desktop app, turn on **Lend this computer**, and tick the bots that may use it under **Allowed bots**. A bot you lend it to can:

- **See and use the screen.** It reads the accessibility tree (buttons, menus and fields with positions; UI Automation on Windows, the macOS accessibility API, AT-SPI on Linux), takes screenshots, and uses the mouse and keyboard. It sees the main display only.
- **Browse.** Your Chrome, Edge or Chromium opens with a separate Sekai profile, so your own tabs, history and logins stay out of it. Bots drive it like their own browser, and sign in through the same popup.
- **Do developer work.** It runs commands in your shell (PowerShell on Windows, your login shell elsewhere), and reads, writes and edits files with exact replacements. It starts in a folder you choose.

In Sekai the computer shows up in the bot's **Computer** section under **Your devices**, and its prompt tells it that it's your real machine and to ask before deleting, sending, buying or installing anything. Every action there that changes something counts as **external** for [approvals](#approvals), and **Approve every action** makes each one wait for your OK whatever the approval mode.

The choice lives on your computer, not the server:

- Anything that gives bots more access opens a confirmation dialog from the app itself, which a web page can't click: lending at all, another bot, or turning off per-action approval.
- **Stop lending** in Sekai revokes access on the computer too.
- The app only answers bots you allowed. It only lets the server reach the browser it started, not other ports. The server refuses bridge connections from web pages.

While a bot works, a badge in the corner names it. On Windows and macOS the badge is left out of screenshots, so the bot doesn't see it. **Ctrl+Alt+Esc** (**⌘⇧Esc** on a Mac) or **Stop bots now** in the tray menu stops everything the bots are doing there at once.

Requirements:

- **Windows 10 or 11.** Nothing to install; Sekai uses the built-in Windows PowerShell. Apps running as administrator, and the lock and UAC screens, can't be controlled.
- **macOS.** Allow Sekai under System Settings → Privacy & Security → **Accessibility** and **Screen Recording**, and let it control **System Events** when asked.
- **Linux.** An X11 session with `xdotool`, `imagemagick`, `wmctrl`, `python3-gi` and `gir1.2-atspi-2.0` (for example `sudo apt install xdotool imagemagick wmctrl python3-gi gir1.2-atspi-2.0`). In a Wayland session bots can only use X11 apps (the ones they open run that way).

`bun run test:proxmox` checks the whole setup against a running Sekai: it creates a test bot with a computer and a devbox, checks the screen, VNC, SSH and the browser, then deletes them.

Sekai reaches machines over Tailscale when they have it, or the LAN otherwise, so the computer running Sekai must be on one of them. Deleting a bot deletes its machines. Secrets (SSH keys, passwords, saved logins) are encrypted with `SEKAI_SECRET_KEY`, or a key Sekai creates in the data folder (`secret.key`): back it up with the database.

## Subscriptions as models

**Settings → Bots → Subscriptions** (admins) lets a bot use an agent CLI you pay for as its model, instead of a gateway model — **installed and signed in right from your browser**, without SSHing into the server:

| Preset      | Runs                                                       | Install from Sekai                                         | Sign in (browser terminal)                                         |
| ----------- | ---------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ |
| Codex       | `codex-acp`                                                | `@agentclientprotocol/codex-acp` + `@openai/codex`         | `codex login --device-auth` (ChatGPT) or `OPENAI_API_KEY`          |
| Claude      | Claude Agent SDK (bundled Claude Code, or your own binary) | Bundled with Sekai                                         | `claude auth login` or `ANTHROPIC_API_KEY` (see below)             |
| Grok Build  | `grok agent stdio`                                         | `@xai-official/grok`                                       | `grok login --device-auth` or `XAI_API_KEY`                        |
| OpenCode    | `opencode acp`                                             | Official OpenCode v2 installer                             | `opencode auth login`                                              |
| Pi          | `pi-acp` (chat only)                                       | `pi-acp` + `@earendil-works/pi-coding-agent` (Node 22.19+) | `pi auth login <provider> --no-browser`                            |
| Devin       | `devin acp`                                                | Official Devin CLI installer                               | `devin auth login --force-manual-token-flow` or `WINDSURF_API_KEY` |
| Antigravity | `agy_acp_server.par`                                       | Manual download (set path under Advanced)                  | Google sign-in / ACP auth method when asked                        |
| Muse Code   | `muse acp` (`MUSE_EXPERIMENTAL_ACP=on`)                    | Official Muse Code installer                               | `muse login` or `META_API_KEY`                                     |
| Custom      | any ACP agent over stdio                                   | Manual                                                     | Your own sign-in command under Advanced (no shell)                 |

**Setting one up from the browser**

1. Open **Settings → Bots → Subscriptions → Add** and pick a plan (admins only; asks to confirm it's you).
2. On the subscription's page, follow the top action:
   - **Install** downloads the CLI into Sekai's own tools folder (`<data>/tools/`, first on agents' `PATH`) and shows live progress and the installed version. Sekai-managed tools can also be updated from the same page.
   - **Sign in** opens an interactive terminal right in the browser (a sheet on phones) running only that subscription's sign-in command (never a general shell). Any sign-in link or one-time device code it prints appears as big **Open the sign-in page** and **Copy code** buttons above the terminal; when a CLI asks you to paste a code back, a paste bar appears too. Nothing typed or printed in the sign-in terminal is logged or stored.
   - Once the command exits, Sekai checks the subscription again and lists its models and thinking levels.
3. **Separate sign-ins per subscription.** Every new subscription keeps its sign-in in its own private (`0700`) folder under `<data>/providers/<id>/` (included in Sekai backups, so sign-ins survive Docker restarts and you can connect two different accounts of the same plan). Older subscriptions keep using the server's default CLI folder unless you turn on **Use its own sign-in** on their page.
4. **API keys** work too: set `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `XAI_API_KEY`, `WINDSURF_API_KEY` or `META_API_KEY` under **Advanced → Environment**. Secret-looking values are encrypted at rest and masked in the UI.

Pick any ready subscription's model for a bot from its **Model & voice** page or the composer pill; subscription models appear under _your subscription_.

- **[OpenCode v2](https://opencode.ai/v2/docs/):** Click **Install** on its subscription page, then **Sign in** to pick a provider with `opencode auth login`. Sekai offers the models OpenCode reports; its default comes from `model` in `opencode.json`.
- **[Pi](https://docs.pi.dev/latest/models):** Needs Node.js 22.19 or later on the server (Linux or macOS). Click **Install** for `pi-acp` and `pi`, pick a provider on the subscription's page, and click **Sign in** (`pi auth login <provider> --no-browser`). Pi's ACP adapter doesn't pass Sekai's MCP tools through or ask before running Pi's native tools, so the Pi preset runs without tools or extensions.
- **Existing Gemini CLI subscriptions** become custom ACP subscriptions on startup. Their names, launch settings, bot model selections and sessions stay the same. Antigravity and Gemini API models are unchanged.

**How a turn works**

- **Sessions.** Each bot and chat gets its own session in the agent, which keeps its own transcript. Sessions are reloaded after a restart when the agent supports it (Claude Code always does).
- **What's sent.** A new session gets the bot's full instructions and the conversation so far. After that, each turn sends only what changed: updated instruction sections, the current time and situation, messages the bot missed (for example in a group), and the new message.
- **Attachments** are copied into the bot's workspace folder (`data/workspaces/<bot>/inbox`). Images are also sent inline when the agent accepts them.
- **Sekai's tools** reach agents that support MCP as a server called `sekai`, with a private URL per session. That gives the agent the bot's memory, notes, routines, skills, team and connected apps, through the same approval gate as every other bot.
- **The agent's own tools** (shell, file edits, web) work in the bot's workspace. When the agent sends a permission request, Sekai handles it by kind: `external_execute`, `external_edit`, `external_delete` and so on. In read-only mode Sekai also switches the agent to its own read-only mode when it has one.
- **Background work** (titles, memory reflection, group routing, approval reviews) still uses the gateway's background model. With the _fallback_ strategy, a subscription failure before anything ran (a limit hit, or signed out) hands the reply to a gateway model. Planner and council need gateway models.

> **Claude and Anthropic's terms.** Anthropic doesn't allow third-party apps to offer claude.ai login, and Sekai doesn't. Sekai never asks for your Claude account. It drives the Claude Code that's already signed in on the computer running Sekai (`claude auth login`), or uses an `ANTHROPIC_API_KEY` you add in the subscription's settings. If anyone else uses your Sekai, use an API key.

**In Docker**, subscriptions installed and signed in from the browser keep their sign-in in Sekai's data volume (each in its own folder). Older ones keep it in the container's home: either sign in inside it (`docker compose exec app …`), or uncomment the sign-in mounts in `docker-compose.yml`. The image includes Node and npx for the npx-based agents, and Claude Code ships with the Agent SDK.

**Limitations**

- ACP agents report token usage only if they implement the v2 usage field; codex-acp does.
- Deleting a message doesn't erase it from the agent's own session. Retrying an answer starts the session over from the messages before it, so the agent never sees the old answer. **Reset chat** starts the agent over.
- Codex sends MCP tools to the model as a Responses-API namespace. An endpoint that drops namespaced tools (some OpenAI-compatible gateways do) hides Sekai's tools from Codex; signing in with ChatGPT doesn't have this problem.
