# Security

Sekai holds people's chats, memories, passwords for bots' computers and keys to their devices, and it can run on the
internet. We take security reports seriously.

## Reporting a problem

Please **don't open a public issue**. Use GitHub's private vulnerability reporting (the repository's **Security** tab
→ **Report a vulnerability**). Include what's affected, how to reproduce it, and what someone could do with it. We'll
answer within a few days, keep you posted while we fix it, and credit you if you'd like.

## What counts

Anything that lets someone:

- sign in without the right password, code or passkey, or get around two-factor sign-in or rate limits;
- see or change another person's bots, chats, memory, files, routines, usage or settings, or use a feature or model
  their role doesn't include;
- reach the server's own network, the server itself or cloud metadata through a bot (web pages, apps, the browser)
  when they aren't an admin;
- run code on the server, read its secrets, or make a signed-in person's browser act for them (CSRF, XSS,
  clickjacking);
- read or keep sessions, tokens or links that should have expired.

Admins are trusted with the server: features only admins can use (subscriptions, stdio apps, devices, computers,
backups) can run commands or reach the network by design.

## Running it safely

See "On the internet" in [docs/install.md](docs/install.md#on-the-internet): use HTTPS, set `SEKAI_PUBLIC_URL`, require two-factor
sign-in in roles, give people only the features they need, back up off the server, and keep Sekai up to date.
