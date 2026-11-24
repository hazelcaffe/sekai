# Architecture

Sekai is a Bun monorepo: one server (API, live events, WebSockets, background work) and web, desktop, mobile and
browser-extension clients that talk to it.
For the rules every change must keep (who owns what, how requests become a person, events, permissions), read
[AGENTS.md](../AGENTS.md) and the `AGENTS.md` next to the code.

## Layout

```
apps/server      Bun + Hono API, Postgres (Drizzle), SSE event bus
  src/agent        runtime (per-chat run queue), tool loop, strategies, approvals, context, prompt
  src/agent/tools  built-in tools; one defineTool() each
  src/channels     platform adapters (Discord, Slack Socket Mode, Signal), manager (access, routing, group links,
                   approvals), commands, streaming delivery
  src/signal       signal-cli for Signal accounts: the pinned install, one daemon on loopback, linking and registering
  src/email        bots' mailboxes: mailcow, IMAP/SMTP accounts, watching (IDLE), verified senders, threaded replies
  src/providers    BYOS: ACP client, Claude Agent SDK runner, Sekai tools bridge (MCP), turn composer, CLI installer
                   and browser sign-in terminal, coding job workers
  src/jobs         coding jobs: workers' lifetime, their gated workspace tools (local or over SSH), relays to the chat
  src/machines     computers and devboxes: Proxmox client, setup (cloud-init seed or SSH script), SSH, desktop helper,
                   VNC bridge;
                   your own servers and devices (master key, per-bot access, tailnet)
  src/voice        calls (speech to text → the bot → text to speech), dictation, read-aloud, voice messages (Ogg Opus),
                   custom voices; providers for ElevenLabs and Fish Audio
  src/outreach     bots messaging and calling you
  src/x            X accounts and the mention listener
  src/code         code index: chunking, incremental indexing, hybrid search (pgvector + full text)
  src/web          the web engine: Firecrawl Local started and watched here, or one you run elsewhere
  src/push.ts      Web Push (VAPID) for every notification
  src/mobile       push for the phone apps: Firebase (FCM HTTP v1) and Apple (APNs over HTTP/2), each person's phones
  src/browser      Playwright sessions (bot's computer or headless on the server) and sign-in requests
                   extension.ts: short-lived, owner/token/bot/chat-scoped grants and non-replayed command delivery
  src/mcp          MCP client manager, OAuth sign-in for apps
  src/auth         accounts, sessions, roles, two-factor sign-in, single sign-on, the actor (who a request runs as)
  src/events       the live event bus, and who gets each event
  src/scheduler    routines and reminders (croner)
apps/web         React 19, Vite, Tailwind 4, TanStack Query, Radix: chats, bots' pages, Settings (the server's setup
                 too, for admins); service worker for offline start and push
apps/desktop     Electron shell (sandboxed renderer, minimal preload bridge, auto-update from your server); src/local
                 lends the computer to bots (bridge client, Windows/macOS/Linux helpers, browser, commands, files)
apps/extension   Manifest V3, React panel, isolated DOM bridge; explicit per-tab and per-origin local grants;
                 native Chromium/Firefox sidebars, Safari popover or companion window; optional site permissions
apps/mobile      iOS (Swift, WKWebView, XcodeGen) and Android (Kotlin, WebView) shells around the web app, with a shared
                 bridge (push, sign-in through the browser, downloads, links) and connect screen
packages/shared  zod schemas, event types and the typed API client used by every app
packages/client  React hooks and components for the apps (data hooks, model and voice pickers, the bridges)
packages/ui      the design system (shadcn/ui based; packages/ui/DESIGN.md)
```

A message creates a **run** in its chat's queue, so replies never interleave. The runtime builds the bot's context, then either runs the gateway tool loop (with the chosen strategy) or hands the turn to the bot's subscription agent. Message parts (text, reasoning, tool calls, plans and notices) stream to every client over `/api/events`.

**People and their things.** Every request runs as the person who sent it (an `AsyncLocalStorage` "actor"), and so
does background work: a bot's reply runs as the owner of the chat, a routine as its owner, a Discord message as the
bot's owner. Services scope every query to that person, so someone else's bot, chat or file is simply "not found".
Live events go only to the people they're about, and roles' permissions and limits are checked on the server.

## Extending Sekai

**Browser extension.** The panel authenticates with a dedicated `extension` token, limited to `/api/extension/*`
(except token issuance). Server routes re-check ownership and the browser permission. `extension_browsers` and
`extension_browser` are normal approved tools, also available through BYOS. The panel heartbeats a 12-second
in-memory lease and executes commands only against its local allowlist. Closing it or losing contact ends control;
restart restores nothing. Commands aren't replayed, refs stay in an isolated world, and page URLs/origins are checked
again before acting. There is no externally callable page-to-extension channel or general JavaScript evaluator.

- **A built-in tool:** add a `defineTool({ name, category, description, parameters, risk, title, execute })` to a module in `apps/server/src/agent/tools/` and list it in `BUILTIN_TOOLS`. Approvals, the chat details, a bot's Tools & access and the BYOS bridge pick it up automatically.
- **A model strategy:** extend `ModelStrategy` in `packages/shared/src/agent.ts` and add a case to `apps/server/src/agent/strategies.ts`.
- **A chat platform:** implement `ChannelAdapter` in `apps/server/src/channels/` (connect, send/edit/remove messages, buttons and menus, typing, publishing commands), register it with `registerAdapter`, add its type to `CHANNEL_TYPES` and describe its setup in `CHANNEL_DEFINITIONS`. Access, pairing, commands, streaming, group links and approvals are shared, so a new platform gets all of them.
- **A subscription agent:** most need only a preset in `packages/shared/src/provider.ts` (any ACP agent works as _Custom_). A new protocol needs a runner with the `RunnerInput → RunnerResult` shape in `apps/server/src/providers/`.
- **Skills:** write them in the app, import `SKILL.md` files, or let the bots write their own.

## Development

```bash
bun run dev           # db + API (watch) + web
bun test              # unit tests, including BYOS checks against a scripted ACP agent
bun run typecheck     # all packages
bun run lint          # Biome (bun run format to fix)
```

Code style: Biome with tabs (width 4), double quotes and semicolons, under strict TypeScript. Database changes: edit `apps/server/src/db/schema.ts`, then run `bun run db:generate`, and check the generated SQL keeps existing data. Before a pull request: `bun run check`.
