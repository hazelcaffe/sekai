# Sekai: notes for coding agents

Sekai is a self-hosted team of personal AI agents ("bots"). One Bun server runs everything: chats, memory,
routines, approvals, tools, bots' own computers (Proxmox), your devices over Tailscale, voice calls, Discord /
X / Instagram / TikTok accounts, and subscription agents (Codex, Claude Code…) as models. Users reach it from
the web app (PWA; its Settings hold the server's setup for admins), the phone apps and an Electron desktop app.

Read this file first, then the one next to the code you're changing:

| Area                                                            | Doc                                                  |
| --------------------------------------------------------------- | ---------------------------------------------------- |
| API server (Bun, Hono, Postgres)                                | [apps/server/AGENTS.md](apps/server/AGENTS.md)       |
| Web app (chats, bots' pages, Settings)                          | [apps/web/AGENTS.md](apps/web/AGENTS.md)             |
| Desktop app (Electron)                                          | [apps/desktop/AGENTS.md](apps/desktop/AGENTS.md)     |
| Browser extension (Chromium, Firefox, Safari)                   | [apps/extension/AGENTS.md](apps/extension/AGENTS.md) |
| Shared packages (`@sekai/shared`, `@sekai/client`, `@sekai/ui`) | [packages/AGENTS.md](packages/AGENTS.md)             |

The user-facing docs are [README.md](README.md) (overview, quick start) and [docs/](docs/): `install.md` (installing,
hosting, configuration), `guide.md` (every feature) and `architecture.md`. Keep them in step with what you add or
change.

## Commands

```sh
bun install
bun run db:up            # Postgres 17 + pgvector in Docker, on 127.0.0.1:5433
bun run dev              # server (watch) + the web app's dev server
bun run check            # lint + typecheck + tests: run before you finish
bun run lint             # Biome (bun run format fixes what it can)
bun run typecheck        # every package, in dependency order
bun test                 # unit tests (apps/server/test/*.test.ts); only auth.test.ts uses Postgres (skips without it)
bun run build:web        # the server serves apps/web/dist at /
bun run db:generate      # after editing apps/server/src/db/schema.ts (writes apps/server/drizzle/*.sql)
```

The server listens on `127.0.0.1:7420` by default (`SEKAI_HOST`, `SEKAI_PORT`). Migrations run on start.

**If `AGENTS.local.md` exists (it's gitignored), read it too:** it says where the maintainer's own Sekai runs and
how to deploy to it. Never start a second server against a database another Sekai is using (routines and Discord
would run twice). `bun run deploy` puts the code live on this machine, or on `SEKAI_DEPLOY_HOST` when that's set in
`.env` (it copies the code there and deploys). A restart interrupts running replies and calls, so batch changes and
deploy once. Units and scripts: `scripts/service/`.
Live end-to-end checks that need real accounts: `bun run test:discord`, `bun run test:proxmox`.

## Repository map

```
apps/server     API + SSE event bus + WebSockets (VNC, voice, desktop bridge); serves the built web app
apps/web        React 19 + Vite app: chats, bots' pages, Settings (the server's setup too), PWA service worker
apps/desktop    Electron shell; src/local lends the user's computer to bots
apps/extension  WebExtension sidebar/popover, local per-tab sharing and a scoped server bridge
packages/shared zod schemas, TypeScript types, ServerEvent union, and the typed API client (createApiClient)
packages/client React hooks/components for the apps (TanStack Query data hooks, ModelPicker, voice, the bridges)
packages/ui     design system (shadcn/ui restyled) + Sekai building blocks (Page, SectionLayout, List/Row, ContextMenu…)
scripts/dev.ts  starts the dev servers
```

## How a feature usually flows

1. **Types and validation** in `packages/shared/src/<area>.ts`: a zod schema for input, a TS interface for
   output, and `patchOf(schema)` for PATCH bodies (zod's `.partial()` would re-apply defaults).
2. **API client method** in `packages/shared/src/client.ts` (`api.<area>.<verb>`), matching the server route.
3. **Server**: logic in `apps/server/src/services/` (or the feature's folder), a Hono route in
   `apps/server/src/routes/` mounted in `app.ts`, DB tables in `src/db/schema.ts`.
4. **Live updates**: emit a `ServerEvent` on the bus (`bus.emit`); clients get it over `/api/events` (SSE) and
   update the TanStack Query cache (`apps/web/src/lib/events.ts`). Changes to settings-like state usually emit
   `{ type: "settings.changed" }`, which refetches.
5. **UI**: a data hook in `packages/client/src/data.ts` (query key in `query.ts`), components in the app.
6. **Bot ability**: a tool with `defineTool()` in `apps/server/src/agent/tools/` (see the server doc), and a
   line in the system prompt (`src/agent/prompt.ts`) if the bot needs to know when to use it.
7. **Docs**: `docs/guide.md` (and `docs/install.md` for settings) for users; these AGENTS.md files for structure changes.

## Code style

- TypeScript strict everywhere, ESM, Bun APIs on the server. Biome: tabs (width 4), double quotes, semicolons,
  line width 120. Imports are sorted by Biome (`bun run format`).
- No `any` unless unavoidable; no non-null assertions (`!`) in shipped code (Biome flags them).
- Comments: short JSDoc on exported functions and anything non-obvious; explain _why_, in plain words. Match
  the surrounding density; don't narrate code.
- Errors: throw `badRequest()` / `notFound()` / `new HttpError()` from `apps/server/src/lib/errors.ts`; the app
  turns them into JSON `{ error }` responses. User-facing messages are full sentences a non-developer
  understands ("Tailscale wants permission first: run … once").
- Secrets (tokens, keys, passwords) are stored with `seal()` / `unseal()` (`src/lib/secrets.ts`) and are never
  returned to clients unmasked or logged.

## UI writing and design rules

- Sentence case everywhere. **No forced uppercase** titles or labels (no `uppercase` class on headings).
- Short, friendly, concrete copy addressed to the user ("Bots ask when they need it, or let one in now.").
- Every screen must work on phones (390px), tablets, desktops and in dark mode; touch targets use the
  `coarse:` variant for bigger hit areas. Check with Playwright screenshots when you change layout.
- Use `@sekai/ui` components and tokens (`bg-surface-2`, `text-fg-muted`, `text-brand-ink`…), not raw colours.

## People, ownership and security (read before touching data access)

Sekai is multi-user: admins make accounts (no public sign-up), roles carry permissions and limits, and each person
has their own workspace. The rules every change must keep:

- **Everything personal has an owner** (`userId`): bots, chats, memories, notes, routines, runs, documents, apps (MCP
  servers), skills (null = built in), uploads (null = the server's), usage and activity. Child rows (messages,
  machines, channels, code indexes, saved logins) belong to their bot's or chat's owner.
- **The actor** (`apps/server/src/auth/actor.ts`): every request runs as its person (`requireAuth` → `runAs`). Services
  scope their queries with `currentActor()` (helpers in `services/visibility.ts`: `ownWhere`, `isMine`, `newOwner`,
  `canSeeAgent`). No actor means Sekai's own work, which sees everything, so **every background entry point must
  `runAs(owner)` first**: runs (`enqueueRun` acts as the chat's owner), routines, channels, X mentions, the tools bridge,
  digests, check-ups, WebSockets. Someone else's row is "not found", never "forbidden".
- **Sharing**: a bot can be shared (`agent_shares`) with a person, a role or everyone. Others chat with it in their own
  chats, with their own memory of it; they never get its owner's computer, browser sign-ins, accounts, apps or private
  setup (`forViewer`, `toolAllowed` in `agent/tools/index.ts`). Machines and browsers shared between bots
  (`machine_members`, `shared_browsers`) follow one rule, `mayUseShared` in `services/visibility.ts`: in the owner's
  runs their bots and bots shared with them; for others only the owner's own bots, and only with the resource's
  "also for people these bots are shared with" switch on.
- **Permissions and limits**: check features with `requirePermission()` / `can()` (`PERMISSIONS` in
  `packages/shared/src/access.ts`), server setup with `adminOnly`. Token, cost and model limits are enforced in
  `services/limits.ts` (at every model call) and storage on upload.
- **Live events** (`bus.emit(ev, { to })`) reach only their audience, and the SSE stream and push re-check ownership
  (`events/scope.ts`): chat events go to the chat's owner only.
- **Sensitive changes** call `requireRecentAuth(c)` (sudo mode: the app shows "Confirm it's you").
- Outbound fetches of addresses a bot or person chose use `guardedFetch` (no private network for non-admins).
- `apps/server/test/access.test.ts` checks isolation end to end; extend it when you add personal data.

## Product rules (don't break them)

- Voice providers: ElevenLabs and Fish Audio (as API providers). Add others only as API providers of the same kind.
- X/Twitter goes through `emusks` (https://emusks.tiago.zip/). Mentions are answered only from the handles on the
  bot's X allowlist, checked in code by account id (`x/mentions.ts`), never by the model.
- Colorful Stage art (the character icons, and the logo: the Virtual Singer Miku icon) ships with Sekai and is shown
  unmodified: resize it, never crop, recolor, redraw or overlay it. Keep its © line, and the credit in Settings → Server → About.
- Brand logos (subscriptions, providers, sign-in providers) come from LobeHub Icons (MIT) in
  `packages/client/src/components/logos.ts` (Discord's and Slack's, which LobeHub lacks, from Simple Icons, CC0).
- Root on a user's device always asks the user, whatever the approval mode (`askFirst` in `agent/tools/hosts.ts`).

## Working in this repo

- Several agent sessions may work in this tree at once. Before committing, run `git status`, commit only your
  own files with explicit paths (`git add <paths>`), and don't revert or reformat changes you didn't make.
- Temporary scripts that need the server's modules go in `apps/server/scripts/.<name>.tmp.ts` (they can
  `import { initDb } from "../src/db/index.ts"`); delete them when done and never commit them.
- Never commit secrets, `.env`, the `data/` folder, or test tokens.
- A running dev server doesn't pick up server changes unless started with `bun run dev` (watch mode); after
  changing apps/web, rebuild it if the server is serving the built files.
