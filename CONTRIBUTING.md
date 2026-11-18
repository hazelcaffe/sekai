# Contributing to Sekai

Thanks for helping. Bug reports, ideas, docs and code are all welcome.

## Before you start

- **Bugs and ideas:** open an issue. Say what you did, what you expected and what happened (logs help:
  `bun run logs`, or `docker compose logs app`). Leave out tokens, passwords and private chats.
- **Security problems:** please don't open a public issue; see [SECURITY.md](SECURITY.md).
- **Bigger changes:** open an issue first, so we can agree on the approach before you spend time on it.

## Setting up

You need [Bun](https://bun.sh) 1.4+ and Docker (for Postgres with pgvector).

```bash
bun install
cp .env.example .env     # set GATEWAY_URL and GATEWAY_API_KEY (or add a provider later in Admin → Models)
bun run dev              # Postgres in Docker, the API (watch mode) on :7420, web on :5173, admin on /admin
```

Open http://localhost:5173 and create the first account with the setup code from the server's log.

## Making a change

Read [AGENTS.md](AGENTS.md) first, then the `AGENTS.md` next to the code you're changing. They explain how the
repo fits together, how a feature flows from shared types to the server to the apps, and the rules that keep
everyone's data apart (every query is scoped to the person Sekai acts for).

- **Style:** TypeScript strict, Biome (tabs, double quotes, semicolons, 120 columns). `bun run format` fixes most of it.
- **UI:** sentence case, short friendly copy addressed to the user, `@sekai/ui` components and tokens. Every screen
  must work on a 390px phone, a tablet and a desktop, in light and dark themes.
- **Database:** edit `apps/server/src/db/schema.ts`, run `bun run db:generate`, and check the generated SQL keeps
  existing data (fill new required columns before making them required).
- **Tests:** add or update tests in `apps/server/test`. Tests that need Postgres skip when it isn't running; with
  `bun run db:up` they run against scratch databases.
- **Docs:** user-facing changes go in [docs/guide.md](docs/guide.md) (settings in [docs/install.md](docs/install.md)); structural ones in the AGENTS.md files.

## Branches

- **`main`** is stable: it's what releases are tagged from and what the install docs point at.
- **`dev`** is where new work lands first, tested by CI but not yet tried out for long. Open pull requests against
  `dev`; it's merged into `main` once it has proven itself.

Before you open a pull request:

```bash
bun run check            # lint, typecheck and tests
bun run build:web && bun run build:admin
```

Keep pull requests focused, and describe what changed and why (screenshots for UI changes help a lot).

## License

Sekai is licensed under the GNU AGPL v3 (see [LICENSE](LICENSE)). By contributing, you agree that your contribution
is licensed under it too. The Colorful Stage artwork in the repo isn't yours or ours to relicense: don't modify it.
