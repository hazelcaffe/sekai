# apps/server

Bun + Hono API, Postgres (drizzle-orm), an in-process event bus streamed to clients over SSE, and WebSockets for
VNC takeover, voice calls and the desktop bridge. It also serves the built web app at `/` (with its page for any
other address, `/admin/…` too, so the app's router can send old links to Settings).

## Startup (src/index.ts)

`initDb()` (connects and runs migrations from `drizzle/`) → marks runs/messages interrupted by the last shutdown
as failed → seeds built-in skills → starts subscription providers → `Bun.serve()` (WebSocket upgrades first:
desktop bridge, VNC, voice; everything else goes to the Hono app from `app.ts`) → scheduler, channels (Discord
and other accounts), MCP servers, X mention poller, push, etc. SIGTERM shuts them down in reverse.
`process.on("unhandledRejection")` only logs, so a forgotten `await` shows up in the log rather than crashing.

## Requests (src/app.ts, src/auth/)

- Every `/api/*` route needs auth except the list in `isPublic()` (health, the public sign-in paths in
  `auth/paths.ts`, desktop update files, webhooks and the BYOS tools bridge whose URLs carry capability tokens).
- `authenticate()`: an API token (`Authorization: Bearer …`, or `?token=` on the few GET paths in
  `QUERY_TOKEN_PATHS`) or the session cookie (`__Host-sekai_session` on https). `denyReason()`: bridge-scoped tokens
  may only open the desktop bridge; cookie requests that change things must come from Sekai's own origin (CSRF guard).
  `requireAuth` then runs the request as its person (`runAs(actor)`) and keeps sessions that owe a step (a temporary
  password, required two-factor sign-in) to the pages for it.
- `auth/`: `service.ts` (accounts, sessions, tokens), `routes.ts` (sign-in, two-factor, SSO, invites, account),
  `admin-routes.ts` (`/api/admin`: people, roles, SSO providers, email and SMS, phone app push), `actor.ts`, `roles.ts`, `users.ts`,
  `mfa.ts` + `totp.ts`, `sso.ts`, `tickets.ts` (single-use hashed tokens), `passkeys.ts` (WebAuthn: signing in, the
  second step, "Require a passkey to sign in" with `owesPasskey` in mfa.ts), `request.ts` (cookies, origin,
  trusted proxies), `app-signin.ts` (the phone apps sign in through the system browser: a PKCE-style one-time code). Admin-only route groups and sudo mode (`requireRecentAuth`) are set up in `app.ts`.
- Ownership (see the root AGENTS.md): services scope by `currentActor()` with `services/visibility.ts`; background
  work must `runAs` the owner; events are filtered per person in `events/scope.ts`; limits in `services/limits.ts`;
  personal settings in `services/prefs.ts` (`getSettings()` merges the actor's name, time zone, approval mode and tool
  rules over the server's).
- Routes live in `src/routes/<area>.ts`, each a `new Hono()` mounted in `app.ts`. Read input with
  `body(c, zodSchema)` / `readJson(c)` from `routes/util.ts`; return `c.json(...)`; throw `badRequest()` /
  `notFound()` (`lib/errors.ts`) for client errors. `parse(schema, input)` validates inside services.

## Map

```
src/agent/        the agent runtime
  runtime.ts        run queue (one per conversation), sendUserMessage, retries, group turns, cancel
  context.ts        builds what the model sees (history, memory, notes, tools) — also feeds the chat details' Context
  prompt.ts         system prompt sections (identity, chat/channel/call context, machines, accounts, team…)
  strategies.ts     model strategies (single, planner/executor, helpers) → runToolLoop
  loop.ts           gateway tool loop: authorizeToolCall (approvals) → executeToolCall
  approvals.ts      pending approvals, decideApproval; permissions.ts: modes, rules, gateFor()
  writer.ts         MessageWriter: streams parts into a message and emits message.* events
  compaction.ts     summarizes old history; reflection.ts saves memories after a reply ("Saved to memory")
  refusal.ts        retries refused turns on another model; review.ts reviewer-model approvals
  teach.ts          teaching a bot by doing it once: a recorded demonstration written up as a skill by a model
                    that can see (draftSkill), then saved and turned on for the bot (saveTaughtSkill)
  tools/            built-in tools (one defineTool each), index.ts lists BUILTIN_TOOLS and MCP tool wiring
src/providers/    BYOS: ACP client (acp.ts), Claude Agent SDK (claude.ts), tools bridge over MCP for them
                   Pi runs chat-only (pi-chat.sh), with one ACP process per session: its adapter doesn't
                   gate native tools, forward MCP servers or keep multiple active sessions in one process.
src/llm/          gateway client (OpenAI-compatible), API providers (OpenAI/Anthropic/Gemini kinds), embeddings
src/channels/     messaging platforms: types.ts (ChannelAdapter), discord.ts, discord-user.ts, slack.ts (Socket Mode
                  and the Web API; each thread its own chat), slack-format.ts (mrkdwn), manager.ts
                  (access, routing, bindings, approvals), stream.ts (posts replies when finished), commands.ts,
                  voice.ts (Discord voice channels: join, hear allowed users, speak)
src/voice/        voice-call.ts (calls: speech to text → the bot's own model → text to speech), tts.ts, listen.ts
                  (STT, live or clip by clip), ogg.ts, settings.ts (voiceFor(agent) resolves defaults), custom.ts
                  (made voices), providers/ (ElevenLabs, Fish Audio: API providers added in Settings → Voice)
src/machines/     bots' computers and devboxes, each a Proxmox VM or container (backend): manager.ts (also
                  checkpoints = Proxmox snapshots or backups, auto before risky run_command), guest.ts (the calls
                  that differ between a VM and a container), setup.ts (each machine's setup described once, rendered
                  as cloud-init for VMs or a bash script Sekai runs over SSH in containers; their desktop is Xvfb
                  under the sekai-desktop@ unit), seats.ts (other bots sharing a machine: each a seat with its own
                  account, key, and on a computer its own screen :N, VNC and Chrome port; machinesForBot lists what a
                  bot may use in a run), ports.ts (web apps listening on a machine and their tailnet links: the
                  Tailscale IP and port, or HTTPS through tailscale serve), drivers.ts, proxmox.ts, ssh.ts, vnc.ts, keys.ts;
                  relay.ts (faster screen control, experimental: screen-relay on a seat's screen, set up there in
                  the background, reached through an SSH tunnel; Desktop uses it for screenshots and input, else the
                  helper), hosts.ts (your devices: master key, per-bot per-account grants), tailscale.ts (CLI + API)
src/browser/      Playwright sessions on a bot's computer (or its seat on a shared one) or on the server; shared.ts:
                  browsers several bots use (server or a computer, shared or separate sign-ins); sign-in requests
                  extension.ts: short-lived browser-extension grants and commands (routes/extension.ts);
                  separate extension_ tools, bound to person, token, bot and chat, no persisted control
src/mcp/          MCP client manager, OAuth for apps, app icons
src/web/          the web engine: Firecrawl Local started and watched here (engine.ts: loopback, own token,
                  no --allow-private) or one elsewhere; settings.ts (kv "web", sealed key and token); the web tools
                  (web_fetch, web_search, web_map, web_crawl) and routes/web.ts (Settings → Web reading) use it;
                  setup.ts ("Set it up for me": a model installs it here command by command, each checked by
                  guardCommand first)
src/code/         code index: chunking, incremental indexing, hybrid search (pgvector + tsvector, RRF)
src/x/, src/social/  X (emusks), Instagram, TikTok accounts; x/mentions.ts polls and answers
src/outreach/     message_user / call_user (bots reaching you), voice messages
src/scheduler/    routines and reminders (croner), schedule descriptions; events.ts (tailnet device changes);
                  webhook routines arrive at routes/hooks.ts (public, the token in the path is the key)
src/library/      document library: extract.ts (PDF via unpdf, .docx via fflate, HTML, text), chunk.ts (passages
                  with page and heading), index.ts (upload, indexing queue, hybrid search, read); routes/documents.ts
src/backups/      archive.ts (dump every public table as JSONL + kept data files into a tar.gz; restore in FK order in
                  one transaction), index.ts (list, schedule, copy to a device, restore staged for the next start)
src/services/     housekeeping.ts (daily pruning of caches, deleted bots' folders, old builds, expired sign-ins);
                  downloads.ts (the apps of this server's GitHub release for Get the apps: release file names →
                  platform and label, the version's release else the latest, kept in memory an hour, a failure a
                  minute; routes/downloads.ts serves it at /api/apps/downloads);
                  CRUD for agents, conversations, messages, memories, notes, routines, skills, settings, kv,
                  uploads
src/db/           schema.ts (all tables), index.ts (initDb, db, schema)
src/lib/          errors, log, ids (newId), secrets (seal/unseal), text helpers, time
src/push.ts       Web Push (VAPID), driven by bus notifications; also sends to phones (src/mobile)
src/mobile/       the phone apps' push: settings (PUT /api/admin/mobile), devices (each person's phones), fcm.ts, apns.ts
```

## Core patterns

- **IDs**: `ID.agent()`, `ID.message()`… or `newId("hst", 12)` from `lib/ids.ts` (prefixes `agt_`, `cnv_`,
  `msg_`, `run_`, `hst_`, `grt_`…). Timestamps are epoch milliseconds.
- **Events**: `bus.emit(event)` with a `ServerEvent` from `packages/shared/src/events.ts`. Clients patch their
  caches from `message.created/updated/delta/part/deleted`, `run.*`, `agent.*`, etc.; anything else that changes
  configuration emits `settings.changed`.
- **kv store** (`services/kv.ts`, table `kv`) for singletons: `app` (settings overrides), `voice`,
  `voice.custom`, `ssh.master`, `tailscale.api`, `tailscale.defaultUser`, `push.vapid`, `push.subscriptions`.
  Seal secret values before writing them.
- **Settings**: `getSettings()` merges kv overrides over env defaults; `updateSettings()` masks/keeps secrets.
- **Models**: the gateway is any OpenAI-compatible endpoint, so never assume a model id exists. `agent/models.ts`:
  `defaultModels()` (new bots), `fastModelFor()` (background work) and `resolveModel()` swap a default from Settings →
  Models that isn't on offer (`listModels()`) for the first chat model that is; a bot's own choices are kept.
- **Logging**: `log.info|warn|error` from `lib/log.ts`; never log tokens, passwords or cookies.

## Runs (how a reply happens)

`sendUserMessage()` saves your message → `enqueueRun()` puts a run on the conversation's queue → the runtime
loads the agent, settings and approval mode, `prepareContext()` + `buildSystemPrompt()`, then either
`runStrategy()` → `runToolLoop()` (gateway/API models) or a BYOS runner (`providers/`). A `MessageWriter` streams
text, reasoning, tool and notice parts into the reply message; every change is an event. Approvals pause the
loop until `decideApproval()` (from the app, a Discord button, or the reviewer/primary bot). Reflection may add
memories afterwards. On cancel/shutdown the run and message are marked so the UI never shows a stuck spinner.

## Tools (src/agent/tools/)

```ts
defineTool({
	name: "snake_case",            // unique; the model sees it
	category: "contact",           // TOOL_CATEGORIES in tools/types.ts
	description: "When and why to use it, in plain words.",
	parameters: z.object({ … }),   // zod; .describe() fields the model needs explained
	risk: "read" | "write" | "external" | "destructive",  // drives approvals
	riskFor?: (args, ctx) => risk, // when the risk depends on the arguments
	askFirst?: (args, ctx) => reason | null, // always ask the user, even in YOLO
	available?: (agent) => boolean,          // offer it only when it can work
	title: (args) => "Short past-tense label for the chat UI",
	async execute(args, ctx) { … return json-able result; throw new ToolError("message for the model") },
});
```

Add it to a module and to `BUILTIN_TOOLS` in `tools/index.ts`; approvals, the chat details, Tools & access and the BYOS
bridge pick it up. `ctx` has the agent, conversation, run and message ids, trigger, approval mode, abort signal.
Tell the bot about it in `prompt.ts` when it needs context to choose it.

## Database

Edit `src/db/schema.ts`, run `bun run db:generate` (from the repo root), commit the new `drizzle/NNNN_*.sql` and
`drizzle/meta/*`. Migrations apply on startup. JSON columns use `jsonb().$type<T>()`; add defaults so old rows
stay valid. Postgres runs in Docker on port 5433 (`bun run db:up`).

## Testing

- `bun test` runs `test/*.test.ts` (pure logic: parsing, permissions, rendering, schedules, adapters with fakes).
  Keep new tests database-free (pass fakes, e.g. `PostedStore` in channels tests, the fake Slack in `slack.test.ts`).
  `auth.test.ts`, `access.test.ts` and `slack-routing.test.ts` are the exceptions: they run sign-in, several people's
  isolation and the channel manager end to end against scratch databases when Postgres is up, and skip themselves
  otherwise. `test/fixtures/passkey-check.ts` has a software authenticator (`SoftPasskey`) that makes real WebAuthn
  answers, for passkey flows.
- Live checks: `scripts/discord-e2e.ts`, `scripts/slack-e2e.ts` (three Slack apps, existing server), `scripts/proxmox-e2e.ts`.
- For a one-off check against real data, write `scripts/.<name>.tmp.ts` that calls `initDb()` and the service
  functions directly, run it with `bun`, then delete it.

## Security rules (from the code audit; keep them)

- **Fetching a URL a bot or a page chose:** use `guardedFetch()` / `reachOf()` from `lib/net.ts` (checks every redirect;
  this server and cloud metadata are off limits; your own network needs approval via `riskFor`). The bot's browser
  opens http(s) only.
- **Approvals:** `askFirst` means always ask, even over allow rules and in YOLO; such requests are decided one by one
  and never become rules (`alwaysAsk` on the pending approval). Root on a device is detected from the account the
  request would actually get. A run's controller is aborted when it finishes, which releases its approvals.
- **Subscription agents (ACP):** only a call whose _label_ is exactly a Sekai tool skips Sekai's own gate
  (`sekaiToolIn` in `providers/bridge.ts`); never match on the call's input.
- **Messaging platforms:** only the owner (`allowFrom[0]`) may change the bot (anything not in `GUEST_COMMANDS` in
  `channels/manager.ts`); trust changes only on the explicit phrases. Attachments download after the access check.
- **Secrets:** sealed at rest, masked for the app, and a masked value sent back means "keep the stored one" (see
  `mcp/manager.ts` transports, `llm/api-providers.ts`). Agent processes and the browser get `agentEnv()`, not
  `process.env`.
- **Shell:** `shq()` for sh, `powershell()` for Windows; SSH destinations go through `dest()` (no option-like names);
  SSH control sockets are per key so bots never ride the master key's connection.
- **Machines:** ids come from `claimVmid()` (VMs and containers alike); deletes pass the machine's hostname (`Guest.remove`)
  so another guest is never destroyed. Anything done on a machine for a bot goes through its seat (`sshTarget(m, agentId)`,
  `driverFor(m, agentId)`, `desktopOf(m, agentId)`), and what a bot may use in a run comes from `machinesForBot` /
  `browsersForBot`, which apply `mayUseShared` (services/visibility.ts): never list machines for a bot another way.
  Seeds and setup scripts hold passwords: they're deleted once setup is done, and
  setup never prints a secret to its log.

## Gotchas

- Shell commands built from user or bot input must quote with `shq()` (`machines/ssh.ts`) or pass argument arrays
  to `Bun.spawn`; PowerShell scripts go through `powershell()` (base64-encoded) in `machines/hosts.ts`.
- Delivery to Discord: replies are posted once finished (`channels/stream.ts`); info-level notices stay in
  Sekai. Messages carry `meta.channel` (their origin) so replies go back to the right chat.
- `tailscale serve` needs `sudo tailscale set --operator=$USER` once; WSL doesn't use Tailscale DNS, so devices
  are addressed by their Tailscale IP.
- Long-lived things (intervals, sockets, child processes) must be cleaned up on stop/shutdown; follow the
  start/stop pairs in `index.ts`.
