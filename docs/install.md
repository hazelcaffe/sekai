# Installing and hosting Sekai

- [What you need](#what-you-need)
- [With Docker](#with-docker)
- [From source](#from-source)
- [As a service (Linux)](#as-a-service-linux)
- [The first visit](#the-first-visit)
- [On your devices](#on-your-devices)
- [On the internet](#on-the-internet)
- [Configuration](#configuration)
- [Backups](#backups)
- [Updating](#updating)
- [Troubleshooting](#troubleshooting)

## What you need

- **Docker** (with Compose), or **[Bun](https://bun.sh) 1.4+** and Docker for Postgres if you run from source.
- **Models.** Any of these, added in **Settings → Bots → Models** after the first sign-in (or with `GATEWAY_URL` in
  `.env`):
  - an OpenAI-compatible **gateway**: [LiteLLM](https://github.com/BerriAI/litellm), [OpenRouter](https://openrouter.ai),
    [Ollama](https://ollama.com), [LM Studio](https://lmstudio.ai), vLLM…;
  - **API providers**: OpenAI-, Anthropic- and Gemini-compatible APIs with your key (OpenAI, Anthropic, Google,
    xAI, Groq, Mistral, DeepSeek, Together, OpenRouter…);
  - **subscriptions** you're signed in to on the server: Codex, Claude Code, Grok, OpenCode, Pi and other
    [Agent Client Protocol](https://agentclientprotocol.com) agents (see the
    [user guide](guide.md#subscriptions-as-models)).
- **Optional:** [ElevenLabs](https://elevenlabs.io) or [Fish Audio](https://fish.audio) for voice, a
  [Proxmox VE](https://www.proxmox.com) server for bots' computers, [Tailscale](https://tailscale.com) for reaching your
  devices, an SMTP server for email, and Twilio (or a webhook) for text messages.

About 1 GB of RAM is plenty for Sekai itself; bots' browsers and computers need more.

## With Docker

```bash
git clone https://github.com/hazelcaffe/sekai.git && cd sekai
cp .env.example .env              # optional: GATEWAY_URL and GATEWAY_API_KEY, POSTGRES_PASSWORD
docker compose up -d --build
docker compose logs app | grep "setup code"
```

Sekai is now on http://127.0.0.1:7420 (only this machine: set `SEKAI_BIND=0.0.0.0` to reach it from your network).
Data lives in two Docker volumes: `pgdata` (Postgres) and `appdata` (files, keys and bots' workspaces).

The image includes Chromium (bots browse on the server), Node and npx (for MCP apps and subscription agents) and the
SSH client (bots' computers). Subscription agents keep their sign-in in the container: sign in with
`docker compose exec app <agent> login`, or uncomment the mounts in `docker-compose.yml` to share yours.

## From source

```bash
bun install
cp .env.example .env
bun run dev                       # Postgres (Docker) + the API on :7420 in watch mode + the web app on :5173
```

Open http://localhost:5173. To serve the built app from the API instead, as in production:

```bash
bun run db:up                     # just Postgres, on 127.0.0.1:5433
bun run start                     # builds the web app, then serves everything on :7420
```

## As a service (Linux)

On Linux (and WSL with systemd), run Sekai as a systemd user service, with Postgres in Docker:

```bash
bun run service:install           # once: installs and starts it (asks for sudo once, to run without a login)
bun run deploy                    # after pulling code: checks, builds the app, restarts, waits until it's up
bun run deploy --fast             # the same without lint, typecheck and tests
bun run logs                      # follow the log
systemctl --user restart sekai    # or stop / start / status
```

The service starts with the machine, restarts if it crashes, and a watchdog restarts it if it stops answering. With
`SEKAI_DEPLOY_HOST=user@host` in `.env`, `bun run deploy` copies the code to `~/sekai` on that machine and deploys it
there: develop on one computer, run Sekai on a server. Once a day, housekeeping clears what would pile up (unplayed
read-aloud audio, deleted bots' folders, old desktop builds, interrupted backups, expired sign-ins and links).

## The first visit

The first person to open Sekai creates the first account, which is an admin. To prove it's you, Sekai prints a
**setup code** in its log when it starts (`docker compose logs app`, or the terminal). Then:

1. **Settings → Bots → Models:** add a gateway or API providers, and pick the default models for new bots and
   background work.
2. Make your first bot (**Your first bot** walks you through it: what bots should call you, the bot's name, look and
   model).
3. **Settings → People:** add the people who'll use your Sekai, and in **Settings → People → Roles** decide what they
   may use.
4. Optional: **Settings → Bots → Voice**, **Settings → People → Sign-in options** (single sign-on, email, text
   messages), **Settings → Server → Computers** (Proxmox), **Settings → Server → Network & devices** (Tailscale),
   **Settings → Server → Backups**.

**Settings → Server → Status** lists what still needs setting up or fixing, with a button for each.

Locked out? On the server, `bun run reset-password` resets the first admin's password (or
`bun run reset-password <username>`; add `--no-2fa` to remove two-factor sign-in and stop requiring a passkey). With
Docker: `docker compose exec app bun run reset-password`.

## On your devices

- **Phone, tablet, another computer:** open Sekai's address and sign in. **Install as an app** (Settings → You →
  Appearance, or the browser's menu) adds it to your home screen; it opens even offline and connects when you're back.
  On a phone, a tab bar holds Chats, Needs you, Activity and Library.
- **Push notifications** (Settings → You → Notifications) bring calls, approval requests, messages from bots and routine
  results to that device, even when Sekai is closed. Browsers only allow push and passkeys on HTTPS (or localhost): host
  Sekai on the internet with a domain, or use your tailnet's HTTPS address (**Private HTTPS address** in **Settings →
  Server → Network & devices** runs `tailscale serve` for you). On iPhone and iPad, add Sekai to the Home Screen first.
- **Get the apps** (your menu at the bottom of the sidebar, and Settings → You) lists the desktop installers (Mac,
  Windows, Linux), the Android APK, the iPhone and iPad app (unsigned, so it needs a sideloading tool) and the browser
  extensions from your server's [GitHub release](https://github.com/hazelcaffe/sekai/releases), with the download for
  the device you're on first. If there's no release for your server's version it shows the latest one, and if GitHub
  can't be reached it links to the releases page. The phone and desktop apps don't offer themselves.
- **Desktop app** (Windows, macOS, Linux): `bun run --cwd apps/desktop package:win|mac|linux` builds installers. It
  connects to `http://127.0.0.1:7420` by default (change it from the tray, the app menu, **About Sekai** or the connect
  screen), lives in the tray, shows native notifications, opens `sekai://c/<chat>` links, and can [lend the computer
to your bots](guide.md#your-own-computer). Installed apps update themselves from your Sekai server: publish a build
  with `bun run --cwd apps/desktop publish:local` after bumping its version; **Help → Check for updates** (**Sekai →
  Check for updates** on a Mac) or **About Sekai** checks now.

## On the internet

Sekai can face the internet behind its own sign-in.

### With the bundled Caddy (HTTPS from Let's Encrypt)

1. Point a domain's DNS at your server (an `A` and/or `AAAA` record), and open ports 80 and 443.
2. In `.env`:

   ```bash
   SEKAI_DOMAIN=sekai.example.com
   SEKAI_PUBLIC_URL=https://sekai.example.com
   SEKAI_TRUST_PROXY=172.16.0.0/12      # Docker's networks: believe Caddy's X-Forwarded-For
   POSTGRES_PASSWORD=<a long random password>
   ```
3. Start it, and find the setup code:

   ```bash
   docker compose --profile public up -d --build
   docker compose logs app | grep "setup code"
   ```
4. Open `https://sekai.example.com`.

### Behind your own proxy

nginx, Traefik, Cloudflare Tunnel and the like work too. Keep `SEKAI_BIND=127.0.0.1`, and make the proxy:

- forward `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host`;
- allow WebSockets (calls, dictation, bots' screens) and long-lived responses (the live event stream: turn off
  response buffering);
- accept request bodies up to 30 MB (uploads).

Then set `SEKAI_PUBLIC_URL`, and `SEKAI_TRUST_PROXY` to the proxy's address when it isn't on the same machine.

### Keeping it safe

- **Require two-factor sign-in** in your roles (at least Admin), and give people only the features they need. Some
  features reach far: **Computers** puts VMs and containers on your Proxmox network, **Subscriptions** run agent
  programs on the server that can run commands there, and admins' bots may reach your own network. Bots of people
  who aren't admins can't open addresses on your network or the server itself.
- **Set up email** (Settings → People → Sign-in options), so invites and "Forgot your password?" work.
- **Back up** somewhere off the server (Settings → Server → Backups can copy each backup to another machine).
- **Keep Sekai up to date**, and see [SECURITY.md](../SECURITY.md) for reporting problems.

What Sekai does for you: rate limits on sign-in, sessions in `__Host-` cookies on HTTPS, a strict content security
policy and other security headers, CSRF checks on every change, sudo-style "confirm it's you" before sensitive
changes, secrets encrypted at rest, and every person's things kept apart (checked by tests).

## Configuration

Everything is read from the environment, or from `.env` at the repository root. Most things are set in the app
instead (Settings).

| Variable                                                                                                                                | Default                                       | What it's for                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GATEWAY_URL`                                                                                                                           | unset                                         | An OpenAI-compatible endpoint ending in `/v1`. Also settable in Settings → Bots → Models.                                           |
| `GATEWAY_API_KEY`                                                                                                                       | unset                                         | Its key.                                                                                                                            |
| `DATABASE_URL`                                                                                                                          | `postgres://sekai:sekai@127.0.0.1:5433/sekai` | Postgres with pgvector. Migrations run when Sekai starts.                                                                           |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`                                                                                   | `sekai`                                       | (Docker) the database's account. Change the password on a server.                                                                   |
| `SEKAI_HOST` / `SEKAI_PORT`                                                                                                             | `127.0.0.1` / `7420`                          | Where the server listens.                                                                                                           |
| `SEKAI_BIND`                                                                                                                            | `127.0.0.1`                                   | (Docker) the host address the app is published on; `0.0.0.0` for your network.                                                      |
| `SEKAI_PUBLIC_URL`                                                                                                                      | unset                                         | The address people use (`https://sekai.example.com`): single sign-on callbacks, invite and reset links. **Set it on the internet.** |
| `SEKAI_DOMAIN`                                                                                                                          | unset                                         | (Docker, `public` profile) the domain Caddy gets a certificate for.                                                                 |
| `SEKAI_TRUST_PROXY`                                                                                                                     | unset                                         | Proxies (besides this machine) whose `X-Forwarded-*` headers count: addresses or ranges, comma-separated.                           |
| `SEKAI_CORS_ORIGINS`                                                                                                                    | unset                                         | Other sites allowed to call the API with a token (sign-in cookies never work across sites).                                         |
| `SEKAI_AUTH_TOKEN`                                                                                                                      | unset                                         | A token for scripts (`Authorization: Bearer <token>`) that acts as the first admin.                                                 |
| `SEKAI_DATA_DIR`                                                                                                                        | `./data`                                      | Files, keys and bots' workspaces.                                                                                                   |
| `SEKAI_SECRET_KEY`                                                                                                                      | a generated `data/secret.key`                 | Encrypts saved secrets (SSH keys, passwords, tokens, sign-in secrets).                                                              |
| `SEKAI_LOG_LEVEL`                                                                                                                       | `info`                                        | `debug`, `info`, `warn` or `error`.                                                                                                 |
| `SEKAI_BROWSER_PATH`                                                                                                                    | Chrome or Chromium, if installed              | The browser for bots without a computer.                                                                                            |
| `SEKAI_FIRECRAWL_PATH`                                                                                                                  | `~/.cargo/bin/firecrawl-local`, or `$PATH`    | The Firecrawl Local binary for [web reading](guide.md#web-reading).                                                                 |
| `SEKAI_DEPLOY_HOST`                                                                                                                     | unset                                         | `user@host` that `bun run deploy` deploys to.                                                                                       |
| `PROXMOX_URL`, `PROXMOX_TOKEN_ID`, `PROXMOX_TOKEN_SECRET`, `PROXMOX_NODE`, `PROXMOX_STORAGE`, `PROXMOX_IMAGE_STORAGE`, `PROXMOX_BRIDGE` | unset                                         | Defaults for Settings → Server → Computers.                                                                                         |
| `TAILSCALE_AUTH_KEY`                                                                                                                    | unset                                         | Default Tailscale key for bots' new machines.                                                                                       |
| `TZ`                                                                                                                                    | `UTC`                                         | (Docker) the server's time zone. Each person picks their own in Settings.                                                           |

## Backups

**Settings → Server → Backups** keeps everything Sekai can't get back by itself in one `.tar.gz`: the database (people,
bots, chats, memory, routines, settings, usage, sign-ins) and the data folder (the secret key, SSH keys, uploads and
bots' workspaces). Caches and browser profiles are left out: they come back by themselves.

- **Automatic backups** run every night or every Sunday at 3:30. The newest 7 are kept (you choose how many), and the
  ones you make stay until you delete them.
- **Copy to a device:** each backup can also go to one of your machines over SSH.
- **Download** a backup, or **upload** one made elsewhere (up to 30 MB from the browser; bigger ones: copy the file
  into `data/backups`).
- **Restore** happens the next time Sekai starts, before anything else runs. What's there first is backed up, so a
  restore can be undone; if a restore fails, the Backups page says why. A backup from an older Sekai works; one from a
  newer Sekai is refused.

A backup holds every password and key Sekai keeps: treat downloaded copies like a password manager's export. If you
set `SEKAI_SECRET_KEY` yourself, it isn't in the backup: set the same one where you restore.

To move Sekai to a new server: set it up, upload your backup there, restore it, and restart.

## Updating

```bash
git pull
docker compose up -d --build            # Docker (add --profile public if you use it)
bun run deploy                          # or, as a service
```

Migrations run by themselves when Sekai starts. Take a backup first (Settings → Server → Backups → **Back up now**).

## Troubleshooting

- **"Can't reach the Sekai server":** the server isn't running, or the desktop app points elsewhere. Check
  `http://<host>:7420/api/health`, and the log (`docker compose logs app`, or `bun run logs`).
- **No models to pick:** add a gateway or API provider in Settings → Bots → Models, and use **Test connection**.
- **Signed out right after signing in, or "Blocked a request from another site":** behind a proxy, Sekai needs
  `X-Forwarded-Host` and `X-Forwarded-Proto`, and `SEKAI_TRUST_PROXY` unless the proxy is on the same machine.
- **"Forgot your password?" doesn't show:** it needs email set up (Settings → People → Sign-in options) and
  `SEKAI_PUBLIC_URL`.
- **Passkeys or push can't be turned on:** they need HTTPS on a domain name (or localhost). On iPhone, open Sekai from
  the Home Screen. Brave and private windows often block push.
- **A Discord channel shows an error:** it says whether the token was rejected (fix it and save) or the network
  failed (it retries on its own).
- **A subscription says "Problem" or "Needs sign-in":** open its page for the agent's own output and sign-in steps,
  then **Check again**.
- **A bot can't use one of your devices:** its row in Settings → Server → Network & devices says why, with the
  command that fixes it.
