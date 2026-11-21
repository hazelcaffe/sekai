# Sekai design

How Sekai looks, reads and behaves. Every screen follows this; when a screen needs something this doesn't cover,
add it here first. Components live in `@sekai/ui` (`packages/ui/src`); app code composes them and doesn't restyle
them.

## Principles

1. **Calm.** One primary action per view. Everything else is secondary (ghost buttons, an overflow menu). A section
   has at most one line of description; longer explanations go behind **Learn more** (a `Fold`) or nowhere.
2. **One way to do each thing.** The same job uses the same component everywhere: rows, lists, page headers,
   forms, saving, empty states, errors, menus, confirmations. No local `*Row`, `*Card`, `StatusBadge` copies.
3. **Content first.** Chats and bots' work are the product. Chrome recedes: neutral surfaces, hairline borders,
   one accent colour used sparingly (the selected item, the primary button, focus, links).
4. **Plain words.** A person who isn't a developer understands every primary screen. Implementation names
   (MCP, Proxmox, LXC, VM, tailnet, gateway, Firecrawl, ACP, OIDC, SMTP, seat, devbox TTL…) appear only where the
   user has to type or pick them, inside connection forms or **Advanced**, with a plain label next to them.
5. **Every state designed.** Loading (skeletons shaped like the content), empty (one sentence and one action),
   error (what happened and what to do, with **Try again**), success (quiet: no toast for an ordinary save).
6. **Phones are first-class.** Every screen works at 390px, on tablets, on desktops, in light and dark. Touch
   targets are at least 44pt on iOS and 48dp on Android and other touch screens; a control drawn smaller (a small
   button, select, switch or segment) gets an invisible hit area that size (`hit-area`, `hit-area-y` for segments
   side by side). Nothing depends on hover. In the iPhone and Android apps the web content follows the platform
   (see _Platforms_).
7. **Accessible.** Text contrast at least 4.5:1 (3:1 for large text and icons), visible focus, labels on every
   control, `prefers-reduced-motion` honoured everywhere.

## Words

Use these, everywhere, for the same thing:

| Say          | Means                                                                   | Don't say                                  |
| ------------ | ----------------------------------------------------------------------- | ------------------------------------------ |
| bot          | one of your AI teammates                                                | agent (in UI copy)                         |
| model        | what a bot thinks with (Claude, GPT…)                                   | brain                                      |
| subscription | a plan you already pay for, used as a bot's model (Codex, Claude Code…) |                                            |
| computer     | a bot's own computer with a screen                                      | machine, VM, container, seat               |
| devbox       | a temporary computer for coding, without a screen                       | sandbox                                    |
| your devices | computers of yours that bots may work on                                | hosts, nodes                               |
| app          | a connected tool a bot can use (Notion, GitHub…)                        | MCP server (except in the custom-app form) |
| skill        | know-how a bot can follow                                               |                                            |
| account      | a bot's own account on Discord, Slack, X, Instagram, TikTok             | channel, integration                       |
| memory       | what a bot remembers about you and its work                             | brain, facts store                         |
| notes        | a bot's notes                                                           |                                            |
| library      | documents every bot can search                                          |                                            |
| routine      | something a bot does on a schedule                                      | job, cron                                  |
| activity     | what bots are doing, will do, and did                                   | runs                                       |
| Needs you    | things waiting for you (approvals, sign-in and pairing requests)        | inbox, queue                               |
| approvals    | the rule for when bots must ask first                                   | permissions mode, YOLO                     |
| people       | everyone with an account here                                           | users                                      |
| role         | what a person may do and use                                            |                                            |

Verbs: **New …** creates content (New chat, New bot, New routine). **Add …** puts something into a list (Add
someone, Add an app, Add a provider). **Connect** links an outside account or service. **Save** commits a form.
**Remove** takes something out of a list; **Delete** destroys it. **Turn on / Turn off** for switches described in
prose.

Copy: sentence case, no forced uppercase. Titles are 1–3 words. A description is one sentence, at most about 90
characters, and says what the user gets, not how it works. Buttons say what happens ("Add someone", not "Submit").
Errors say what happened and what to do, in full sentences ("Couldn't reach Proxmox. Check the address and try
again."), never raw exception text.

## Information architecture

Sekai is one app. The admin pages are part of Settings, shown to admins (and to people whose role allows a page).

### Desktop and tablet (≥ 768px)

```
┌ Sidebar (260px, collapsible) ┐┌ Main ──────────────────────────────┐┌ Side panel (optional) ┐
│ Sekai            [+] [⇤]     ││                                    ││ a bot's computer      │
│ 🔍 Search          ⌘K        ││  the current page or chat          ││ or a group's details  │
│ ◎ Needs you            2     ││                                    ││                       │
│ ↯ Activity                   ││                                    ││                       │
│ ▤ Library                    ││                                    ││                       │
│                              ││                                    ││                       │
│ Pinned                       ││                                    ││                       │
│ Bots                         ││                                    ││                       │
│  (one row per bot)           ││                                    ││                       │
│ Groups                       ││                                    ││                       │
│                              ││                                    ││                       │
│ (H) Hazel            [⚙]     ││                                    ││                       │
└──────────────────────────────┘└────────────────────────────────────┘└───────────────────────┘
```

- **[+]** opens a menu: New chat (pick a bot), New bot, New group, Import a bot.
- **Needs you** is always there; its count shows only when something is waiting. It's the one queue of things
  waiting for you: approvals, pairing and sign-in requests. Chats, notifications and other pages link to the same
  request there; nothing else lists requests.
- The chat list: pinned chats first, then one row per bot (its latest chat), then groups and chats linked to
  Discord or Slack (with a small mark of where they're from). Hidden bots stay findable in search; a bot's older
  chats are in its chat's menu (**Past chats**) and in search.
- A bot row: avatar (with a small status dot when it's working or needs you), name, and one muted line (what it's
  doing, or the last message). No second badges.
- The footer is the person: avatar and name (menu: Settings, Appearance, Sign out) and a Settings button. No row of
  tiny icons.
- Tablet (768–1023px): the sidebar is collapsible and starts collapsed in a chat.

### Phones (< 768px)

List first, like Messages and Slack, instead of a drawer:

- A bottom tab bar with **Chats**, **Needs you**, **Activity**, **Library** (iOS tab bar; Material 3 navigation
  bar on Android). It's shown on these top-level screens only. Each tab keeps its own stack and scroll position, and
  a chat keeps its draft.
- **Chats** is the chat list as a full screen: your avatar on the left of its header opens Settings, **New** on the
  right (a FAB on Android), search on top. Opening a chat pushes it full screen with a back button; the tab bar
  hides. Swipe back (iOS) and the back gesture (Android) go back.
- Settings is a list of sections; a section pushes as its own page.
- A direct link (a notification, a shared URL) builds a sensible stack under it: a chat opens over Chats, a
  setting over Settings.

### Routes

| Route                                       | Screen                                                                                                                                                                                                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                         | Desktop: the last chat. Phone: Chats.                                                                                                                                                                                                                               |
| `/c/:conversationId`                        | A chat. Its details (side panel, or a sheet on phones): this chat's context, the full prompt, compact, reset; for a group, its name, purpose, members, reply limits and routing model.                                                                              |
| `/inbox`                                    | Needs you.                                                                                                                                                                                                                                                          |
| `/activity`                                 | Activity: **Working**, **Scheduled** (routines, reminders, webhook and device triggers, paused ones too), **Done**, and **Log** (every action bots took and every decision, searchable and exportable; what each person may see stays as today). Filterable by bot. |
| `/library`                                  | Library.                                                                                                                                                                                                                                                            |
| `/bots/:agentId/:section?`                  | A bot: its settings, in sections (below).                                                                                                                                                                                                                           |
| `/settings/:section?`                       | Settings (below).                                                                                                                                                                                                                                                   |
| `/admin/:tab`                               | Old admin links: redirect to the matching `/settings/:section`.                                                                                                                                                                                                     |
| `/welcome`, sign-in, setup, invites, resets | Before the app: one centred card each.                                                                                                                                                                                                                              |

### A bot (`/bots/:agentId/:section`)

Opened by tapping the bot's name in a chat's header (or **Bot settings** in its menu). Same layout as Settings:
sections on the left (desktop) or a list that pushes pages (phone). Its header links to **Activity** filtered to
this bot.

| Section        | What's in it                                                                                                                                                                                                                                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Profile        | Picture (the avatar editor), name, label, job, personality, standing instructions; on/off, primary bot; who else can chat with it (sharing). Duplicate, export, delete (at the bottom).                                                                                                                        |
| Model & voice  | The model and how hard it thinks, limits; planner, council, fallback, background and vision models under Advanced. How it listens and sounds on calls.                                                                                                                                                         |
| Memory         | What it remembers (with the one **Learns as it goes** switch; pin, edit, forget, clear, check-up), what it knows about you, its notes, and code it has indexed.                                                                                                                                                |
| Tools & access | Apps it may use (on/off per app; Add an app from here, and come back here after setting it up), skills, web search, what it may do (files, commands, devices…) and its approvals rule.                                                                                                                         |
| Accounts       | Its Discord (bot or personal), Slack, X, Instagram and TikTok accounts: a list, each opening its own page (chats, who can use it, how it speaks, reconnect).                                                                                                                                                   |
| Routines       | Its routines: the same list and editor as Activity → Scheduled, filtered to this bot.                                                                                                                                                                                                                          |
| Computer       | Its computer and devboxes: create it (always offered, even before it has one), power, size, checkpoints, passwords and keys, web apps, sharing it with other bots, shared browsers, lending your devices, saved sign-ins. The live screen, taking over and Teach open beside the chat (full screen on phones). |

Someone a bot is shared with sees its Profile (read only) and their own memory and notes of it, never the owner's
setup, accounts, computer or apps. When something needs setup first (an admin connecting Proxmox for computers, a
subscription for a model), people who may do it get a link to the exact form; others are told what to ask an admin
for.

### Settings (`/settings/:section`)

Grouped by who it's for. Each person sees the sections their role allows (today's permissions decide, so nobody
loses a page they have now); admins see all. A section someone can open but not change is read only.

| Group  | Sections                                                                                                                                                                                                                                                                                                         |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| You    | Profile · Sign-in & security (password, passkeys, two-step, linked sign-ins, sessions and tokens) · Appearance · Notifications (and the digest) · Browser extension · This computer (desktop app: lending it to bots) · Server address (phone apps: opens the app's own server screen) · Get the apps · Sign out |
| Bots   | Approvals (your default rule) · Models (defaults, the gateway and API providers, and Compare models) · Subscriptions · Apps & skills · Voice · Web reading · Memory (check-ups) · Usage (yours; admins can pick anyone)                                                                                          |
| People | People · Roles · Sign-in options (single sign-on, email, text messages: each its own part of the page)                                                                                                                                                                                                           |
| Server | Status · Computers (Proxmox and every machine) · Network & devices (this server's addresses, Tailscale, other servers, your devices bots can use) · Backups · About                                                                                                                                              |

**Status** is the admin's home: setup that's missing and things that are broken, then the state of things at a
glance. It doesn't list requests (it links to Needs you with a count).

### A chat

- **Header**: back (phones), the bot's avatar and name (opens the bot) with one muted line of what it's doing;
  **Call**, **Computer** (when it has one) and the chat's menu (see _Decisions on details_). A call in progress stays
  reachable as a small bar on every screen.
- **Messages**: yours in a soft bubble, the bot's as plain reading text (`text-message`, a comfortable measure of
  about 72 characters). Tool use collapses to one quiet line ("Read 2 pages, saved a note") that expands. Approvals
  appear inline as a card with the same actions as Needs you. Message actions (copy, read aloud, retry) show on
  hover with a mouse and are always visible (or on long press, as a menu) on touch.
- **Composer**: attach (files, photos, folder on desktop), the text field, the model pill, dictation and voice,
  send / stop. The model pill says whether a change is for this chat or for the bot. This chat's approvals rule is in
  the **+** menu (it shows where the current rule comes from: the bot, your default, or this chat), not a second pill.
- **Approvals**: a card says what the bot wants to do, in words, with **Approve** and **Deny**; "always allow" choices
  are offered only when the rule allows them, and say exactly what they cover.
- **Side panel** (desktop): the computer's live screen, or chat details. It docks only while the chat keeps at least
  560px; otherwise it opens over the chat as a sheet.

### Decisions on details

Settled so nobody guesses. Change them here, not in code.

- **Permissions decide what's shown.** Every section, row and control is filtered with `can()` on the same
  permission the server checks (`PERMISSIONS`, `packages/shared/src/access.ts`), and by ownership for bots. Never
  show a live control that will fail. Something someone may see but not change is read only, with one sentence
  ("Only admins can change this."). Hidden for viewers of a shared bot: the model pill, web search and anything
  else that changes the bot.
- **Approvals rules** are named _Ask every time_, _Reviewer checks risky actions_ (today "Auto"), _Primary bot
  decides_, and _Don't ask_ (today "YOLO"; its description says it still asks for tools set to Ask). Short forms:
  Ask, Reviewer, Primary, Don't ask.
- **Requests** (approvals, pairing, a bot asking you to sign in) are listed only in Needs you. An account page says
  "2 people want to pair" and links there. A bot's sign-in request still opens its dialog when it arrives.
- **The model pill** changes the bot's model (there's no per-chat model); it says so: "Nori's model".
- **A chat's menu**: New chat with this bot, Past chats, Chat details, Bot settings, Give it a computer (when it has
  none), Reset chat, Delete chat. No chat export and no message editing (they don't exist; not part of this work).
- **Group details**: name, purpose, members (up to 8), reply limits, routing model, this group's approvals rule, and
  Delete group at the bottom.
- **Bot rows' menu** (sidebar and Chats): Pin, Hide, Mark as read, Bot settings. Duplicate and Make primary live in
  the bot's Profile. Unread shows as a bold name and a small brand dot at the row's end (that's the one indicator;
  no counts). Mark all as read is in the section's menu and in search.
- **The chat list's sections**: Pinned, Bots, Groups, Discord & Slack (one section; each row has the platform's
  mark), and a **Hidden** fold at the end (search finds hidden bots too).
- **The collapsed sidebar (rail)**: Search, Needs you (with its count), Activity, Library, then bot avatars;
  your avatar (Settings) at the bottom.
- **Theme**: only in Settings → Appearance and the person menu. No theme buttons elsewhere.
- **Before the app**, each one centred card: first-time setup (and its passkey offer), sign in (and two-step),
  welcome (`/welcome`: your name, your first bot's name, look and model; outside the app shell), invites and
  password resets (`/welcome/invite|reset/:token`, matched before `/welcome`), a temporary password to change,
  required two-step setup, and "your account is restricted".
- **Forgetting** a memory, a saved sign-in, unlinking an account or deleting a checkpoint asks first (`Confirm`).
- **Chat details** holds this chat's context (what fills it, with the full prompt behind **Learn more**), Compact
  and Reset. Memory in the bot's settings is only what it remembers.
- **The computer**: the live screen opens beside the chat (a sheet on phones). **Take over** goes full screen on
  every device (it needs the room), with Teach inside it. Viewers of a shared bot don't see its computer.
- **Calls**: an incoming call is a sheet (Answer, Decline); a call in progress is a small bar on every screen. The
  header's Computer button shows the computer is in use with `brand` and the word "Using its computer", not violet.
- **Usage**: prices are edited in Usage → By model (admins, a `FormGroup`); limits are set in Roles and shown read
  only in Usage ("Your limit"). Admins can switch Usage and the activity log between "Just me" and "Everyone"
  (or one person). In the log, other people's entries show only what happened (when, whose, which bot, the tool's
  plain name, how it ended, who decided, the risk), never what it carried, in search and exports too.
- **Phone notifications setup** (the APNs and FCM keys, today only an API) gets a part in Settings → Server →
  Network & devices, for admins.
- **Status** is for admins; for others Settings opens at Profile. Problems show as a dot on Settings and on the
  section that has one; only Needs you shows a count.
- **One control each**: Learns as it goes (bot → Memory), web search (bot → Tools & access), browser extension
  tokens (You → Browser extension; Sign-in & security lists sessions and API tokens only).
- **Search** (⌘K) finds chats, bots (hidden ones too), messages, and Settings sections by name: exact and starting
  matches of a name first, then other words, message hits and fuzzy letters; each group sits by its best match. On
  phones, Settings' list has its own search field, which looks through Settings alone.
- **`/`** opens the last chat you had open, else your primary bot's latest chat (first run: `/welcome` for people
  who may make bots, with Skip for now and Sign out; everyone else gets the app with "No bots yet").
- **Docs move with the UI**: README, `docs/guide.md` (oss) and the AGENTS.md files name places as they are now
  ("Settings → Server → About", not "Admin → About"), including the Colorful Stage rule in the root AGENTS.md.

## Look

Refine, don't reinvent: the teal brand, the Miku logo, Inter, the light and airy feel, and the group themes stay.

### Type

One scale of roles. Use these utilities, never `text-[13px]` and friends. Sizes are CSS variables in rem (so
they follow the browser's and the system's text size) and change by platform; components never pick pixel sizes.

| Utility        | Web (desktop) | Touch screens | iOS app               | Android app           | Use                                           |
| -------------- | ------------- | ------------- | --------------------- | --------------------- | --------------------------------------------- |
| `text-caption` | 12 / 16       | 12 / 16       | 12 / 16               | 12 / 16               | timestamps, badges, counts, table headers     |
| `text-small`   | 13 / 18       | 14 / 20       | 15 / 20               | 14 / 20               | secondary lines, descriptions, hints          |
| `text-body`    | 14 / 20       | 16 / 22       | 17 / 22               | 16 / 24               | default UI text, rows, buttons, inputs        |
| `text-message` | 16 / 26       | 16 / 26       | 17 / 26               | 16 / 26               | chat messages and reading text                |
| `text-heading` | 16 / 22       | 17 / 24       | 17 / 22               | 16 / 24               | section and dialog titles (semibold)          |
| `text-title`   | 24 / 30       | 24 / 30       | 34 / 41 (large title) | 22 / 28 (top app bar) | page titles (semibold)                        |
| `text-display` | 30 / 36       | 28 / 34       | 34 / 41               | 28 / 36               | the few hero lines (welcome, Status greeting) |

Weights: 400 for text, 500 for labels, row titles and buttons, 600 for headings. Nothing below 12px. Inputs are at
least 16px on touch screens so iOS doesn't zoom.

### Colour

One vocabulary in app code: `bg`, `surface`, `surface-2`, `fg`, `fg-muted`, `fg-subtle`, `border`,
`border-strong`, `brand`, `brand-ink`, `brand-soft`, and for status `danger`, `warning`, `success`, `info`, each
with `-soft` (a tinted background) and `-ink` (text on that background and on `bg`). shadcn names stay inside
`@sekai/ui` only.

- `fg` ≥ 12:1, `fg-muted` ≥ 7:1, `fg-subtle` ≥ 4.5:1 on `bg` and on `surface`, in every theme, light and dark.
  Controls' boundaries and focus rings ≥ 3:1: a field's bottom edge, a switch that's off, a checkbox. The selected
  item (`selected`) stands out from the sidebar, rail or list around it in every theme. A test (`packages/ui`)
  computes the real pairs for every theme, and the colours the controls' own classes give each state.
- The bright brand colour is a fill, not a text colour: it's about 2:1 on white. Text and icons on it are dark
  (`brand-foreground`); links, focus rings and selected text use `brand-ink`, a darker shade that meets 4.5:1.
- Status text uses `-ink` (≥ 4.5:1); status fills use `-soft`. Colour never carries meaning alone: pair it with a
  word or an icon.
- No raw colours (hex, `text-white`, `bg-black/70`, palette classes like `violet-500`) in apps. The few
  exceptions use named tokens: `screen` (a remote screen's black), `paper` and `paper-ink` (always white: a QR
  code, a brand logo's tile, a switch's thumb), `scrim` and `on-scrim` (a label over a screenshot), and
  `series-1` … `series-8` for charts and generated tiles (`var(--series-n)`).
- The rest of the palette: `bg-subtle` (the sidebar and rails), `selected` (the selected item there and in a list),
  `surface-raised` (menus, dialogs, toasts), `surface-hover` (hover on a filled control), `surface-3` (a stronger
  fill), `primary` and `primary-foreground` (the primary button's near-black or near-white), `danger-foreground` and
  `success-foreground` (text on those fills).

### Space, shape, depth

- 4px grid. Page padding 16 (phone), 24 (tablet), 32 (desktop). 32 between sections, 12–16 inside one.
- Radii: `rounded-sm` 6 (badges), `rounded-md` 8 (buttons, inputs), `rounded-lg` 12 (groups, cards, menus),
  `rounded-xl` 16 (dialogs, sheets, the composer), `rounded-full` (avatars, pills). No arbitrary radii. On Android,
  fields are 12 and dialogs and sheets 28 (`rounded-sheet`); the components do this themselves.
- Flat by default. A group is a `surface` fill with a hairline border. Only floating things (menus, popovers,
  dialogs, toasts) have a shadow (`shadow-pop`).
- Icons: lucide, `size-4` in rows, buttons and inputs, `size-5` in navigation and headers. Stroke 1.75.
- z-index comes from named layers, lowest first: `z-sticky` (sticky bars), `z-panel` (drawers, docked panels),
  `z-overlay` (side sheets), `z-takeover` (a computer's full screen), `z-dialog` (dialogs, ⌘K, the call screen),
  `z-menu` (menus, popovers, selects, action sheets: over the dialog they open from), `z-tooltip`, `z-toast`.
- Motion: `duration-fast` (150ms) and `duration-panel` (220ms), `ease-standard` for panels and sheets. Reduced
  motion stops every animation and transition (a spinner still turns, slowly).
- Safe areas: `pt-safe`, `pb-safe`, `pl-safe`, `pr-safe`, `px-safe`, and `pt-safe-4` (the inset or a spacing
  step, whichever is more), `top-safe-2`, `bottom-safe-4`.

## Building blocks

The only way to build these things. Everything is exported from `@sekai/ui` (`packages/ui/src`); this says when to
use which, with the props that matter. See them all, in every state, at `/dev/ui` in the web app's dev server
(phone and desktop widths side by side, any theme, web, iOS or Android).

- **`Page`** (`title`, `description?`, `actions?`, `back?: { href | onClick, label?, phoneOnly? }`, `leading?`,
  `width?: "form" | "wide" | "full"`, `scroll?: "self" | "document"`): every screen except a chat. One primary
  action at most in `actions`, the rest in an overflow menu. `form` is 720px (settings and forms), `wide` 1080px
  (lists and dashboards); a form page is the left part of the wide frame, so titles start at one x on every page. It handles safe areas, padding (16 / 24 / 32), scrolling and the phone header: a large
  title that shrinks into the bar on iOS and on phone browsers, Material 3's top app bar on Android. In the phone
  bar, `actions` become the bar's own buttons by themselves: a button with an icon shows the icon alone (its words
  are its name and tooltip), tinted on iOS and phone browsers; one without shows its words as a text button; never a
  filled button. `back.label` is the previous screen's title ("‹ Settings" on iOS). From tablets up `back` is a
  small "‹ People" link above the title, the one way back from a page inside a section (a person, a role, a note,
  an account), in Settings and a bot alike; `phoneOnly` leaves it to phones (a section's own page, whose rail is the
  way back). `PageHeader` is its title block alone.
- **`SectionLayout`** (`title`, `groups: { id, title?, items: { id, title, icon?, href? | onSelect?, badge?,
  hidden?, danger? }[] }[]`, `active: string | null`, `header?`, `footer?: items`, `back?`, `actions?`,
  `children`): Settings and a
  bot. A grouped rail on the left from tablets up (it keeps the open section in view); on phones a list
  (`active={null}`, with `back` to the screen under it) that pushes each section as its own page. The open section
  is a `Page` with `back.phoneOnly` (on phones the list is a step back; from tablets up the rail is). Rows with
  `onSelect` instead of `href` do something and have no chevron. `footer` items sit apart: at the rail's foot and
  as the phone list's last group (Sign out, which asks first on touch screens).
- **Links**: `@sekai/ui` doesn't know the router. The app gives it one at its root,
  `<LinkProvider component={RouterLink}>`; `Row href`, `Page back.href` and `SectionLayout` items then navigate
  through it. `Link` renders one directly.
- **`Section`** (`title?`, `description?`, `action?`, `saveState?`): a titled block in a page. Top-level sections
  of a page get `text-heading` titles; nested ones (and ones in panels) `text-body`. `SectionNesting` nests the
  sections inside a custom titled block.
- **`List` and `Row`**: any list of things or settings (people, apps, machines, backups, tokens, toggles…). A
  `List` (`label?`) is an inset group: rounded `surface`, hairline dividers (on Android, Material 3's flat list:
  edge to edge in a page, plain leading icons, no chevrons). A `Row` takes `leading` (an avatar or
  logo) or `icon` (in a small tinted tile, `iconTone`), `title`, `subtitle` (the one muted line), and on the right
  `value`, `badge`, `trailing` (a `Switch`, a button, a `Select`), `chevron`, or `menu: MenuEntry[]` (a "…" button,
  plus right-click and touch-and-hold; in dense lists like the chat list, `menuButton="hover"` shows the "…" only on
  hover, keyboard focus or while its menu is open, and leaves touch screens to touch-and-hold; so does a row with a
  switch that opens its details, where the same actions are). On phones a badge beside a menu or a control moves
  under the text, so titles keep their room. `href` makes it a
  link row and `onClick` a button row (the whole row is the target, controls on the right stay separate); `details`
  makes it an expandable row (the whole row opens and closes what's under it, with a turning chevron; `open`,
  `onOpenChange`). `danger`, `disabled`, `selected`, `wrap` (controls under the text on narrow screens). Heights:
  36px (40 with a second line) with a mouse, 44pt on iOS, 48 on other touch screens (56 with a second line), and
  Material 3's 56dp (72) on Android. **`ToggleRow`** (`title`, `description?`, `checked`, `onCheckedChange`) and **`SelectRow`** (`title`,
  `value`, `onValueChange`, `options`) are rows with a switch and a choice. Big data (usage tables, the activity log)
  stays a real table on wide screens and becomes rows on phones (expandable ones for details).
- **`Field`** (`label`, `hint?`, `error?`, `optional?`, `action?`): label above, control, one-line hint below, error
  below that (in `danger-ink`, replacing the hint). Placeholders are examples ("e.g. …"), never labels. `optional`
  says "Optional" in the hint. Controls inside (`Input`, `PasswordInput`, `Textarea`, `Select`, `CodeInput`) are
  wired to the label and hint for screen readers.
- **`CopyField`** (`value`, `label`, `showLabel?`, `secret?`, `multiline?`, `copyValue?`): a value to copy (a link,
  a token, a command, an address, a password) in a quiet box, with a copy button that turns into a check for a
  moment. `label` names the button ("Copy redirect URL"); `showLabel` shows it before the value when several sit
  together. When the browser won't copy, it says so and the value stays selectable. `copyText()` for copying in code.
- **Saving**, two kinds and nothing else:
  - _Simple values save themselves_: switches, selects, segmented controls and short single-line fields (a name,
    a time zone). They save on change (text on blur or Enter). `const s = useAutosave(write)`; call `s.save(value)`
    on change and put `<SaveState state={s} />` in the section's `saveState`. It sends one write at a time (only the
    latest waiting value follows), shows "Saving…" then "Saved" (announced to screen readers, focus doesn't move),
    and on failure shows the error with **Try again** while your input keeps what was typed.
  - _Everything else is a `FormGroup` with an explicit button_ (`dirty`, `onSubmit` (may throw: the error shows
    under the fields), `onCancel?`, `submitLabel?` ("Save", "Connect"…), `extra?` (a **Test** button), `error?`):
    credentials and tokens, connection settings (a Proxmox server, an email server, a bot account), policies
    (approvals, roles), a bot's job, personality and instructions, and settings that only make sense together. One
    button at the group's bottom, enabled when something changed, with **Cancel**. `useFormValues(saved)` keeps the
    values and `dirty` (and follows the saved copy while nothing's edited). Leaving with unsaved changes asks first:
    `FormGroup` registers itself (`useUnsavedChanges(dirty)` for custom forms); the browser asks before closing the
    tab, and the app's router blocks navigation while `hasUnsavedChanges()` and shows `LeaveConfirm`.
  - No floating "unsaved changes" bars, no "Saved" toasts.
- **`Dialog`** (`open`, `onOpenChange`, `title`, `description?`, `footer?`, `icon?`,
  `size?: "sm" | "md" | "lg" | "xl"`): a short, single decision or creating something small (a name and a couple of
  choices). A bottom sheet on phones, with a grabber. Longer flows (inviting someone, a role, single sign-on,
  connecting an account or app, two-step setup, a custom voice) are a page or steps.
- **`Confirm`** (`title` as a question, `description` naming the consequence, `confirmLabel` as the verb,
  `danger?`, `onConfirm`): before anything with consequences (delete, remove a person, revoke, restart, restore,
  reset). "Nori's computer and its files will be deleted." Sensitive ones ask you to confirm it's you first, as
  today. **Undo** (a toast action) only where the server can fully restore it.
- **Menus**: a `MenuEntry[]` (`{ label, icon?, onSelect, danger?, disabled?, shortcut? }`, `"-"` for a separator,
  falsy entries skipped) rendered by `DropdownEntries` inside `DropdownMenu` / `DropdownTrigger` /
  `DropdownContent`, or by `ContextMenu` (right-click, touch and hold) around a row. On phone-sized touch screens
  the same menus open as an action sheet (with Cancel on iOS). Destructive entries are moved last, after a
  separator, in `danger-ink` (`tidyMenu`).
- **`Tabs`**: one style (underline) for switching between peers inside a page (`TabsList`, `TabsTrigger`,
  `TabsContent`; the old `chips`, `pill` and `line` variants are the same underline). **`Segmented`** (`value`,
  `onValueChange`, `options`, `label?`) only for a value (Light / Dark / System, Auto / Low / High); Material 3's
  segmented buttons on Android.
- **`Badge`** (`tone`): a word of status. **`StatusDot`** (`tone`, `label` for screen readers, `pulse?`): live state
  on avatars and rows. Tones: `success` (ready, running), `brand` (working, with a gentle pulse that stops under
  reduced motion), `warning` (needs you), `danger` (broken), `neutral` (off). **`Callout`** (`tone`, `icon?`,
  `title?`, `action?`): a problem or missing setup, inside a page.
- **`EmptyState`** (`icon?`, `title` as one sentence, `description?`, `action?`, `size?: "sm" | "md"`).
- **`ErrorState`** (`error?` or `description?`, `onRetry?`, `title?`): a query that failed; `errorMessage(error)`
  turns errors into sentences ("Couldn't reach Sekai. Check your connection and try again." for a failed fetch).
  Each route sits in an **`ErrorBoundary`** (`resetKey` = the path), so a crash shows this instead of a white
  screen.
- **Loading**: `SkeletonRows` (`count?`, `leading?`), `SkeletonPage`, `SkeletonChat` and `Skeleton` for one-offs,
  shaped like the content. A `Spinner` only inside a button that's working (`<Button loading>`), or for an action
  that takes over the screen.
- **Toasts** (`toast()` from sonner, one `Toaster` per app): results of background work, errors that aren't tied to
  a field, and Undo. Not "Saved". At the bottom on phones (`--toast-lift` raises them over a bar or the composer),
  Material 3 snackbars on Android.
- **`Fold`** (`title`, `summary?`, `variant?: "section" | "link"`): **Advanced** (a folded section) and **Learn
  more** (`variant="link"`). Rarely used settings go in Advanced, collapsed.
- **`IconButton`** (`label` required: the accessible name and the tooltip, `shortcut?`): every icon-only action.
  Anything else that needs a hint gets a `Tooltip`. No `title=` attributes. `Button` variants: `primary` (the one
  main action), `secondary`, `outline`, `ghost`, `brand` (rare hero actions), `danger`, `danger-ghost`, `link`;
  sizes `xs`, `sm`, `md`, `lg`, `icon`, `icon-sm`, `icon-xs`, `icon-lg`; `loading` shows a spinner and blocks
  presses.

A test (`packages/ui/test/design-lint.test.ts`) keeps app code on these rules: no pixel text sizes, shadcn or raw
colours, off-scale radii, raw z-index numbers, status text without `-ink`, `title=` tooltips (on any element or
control; touch screens never show them), or a selected item drawn with `surface-2` instead of `selected`.

## Platforms

`<html data-platform="ios" | "android" | "web">`, set by the phone apps' bridge and read by the web app
(`applyPlatform()` in `main.tsx`; in the dev server `?platform=ios` or `android` previews one). Tailwind variants
`ios:` and `android:` style the differences, `usePlatform()` reads it in code. One codebase: components adapt,
screens don't fork.

**iPhone and iPad (Human Interface Guidelines)**: the system font (SF Pro via `-apple-system`), large titles on
top-level pages that shrink on scroll, inset grouped lists, a tab bar with translucent material, sheets with a
grabber, action sheets for menus, iOS's 51×31 switches and segmented controls, a back chevron with the previous
title, swipe back. Haptics through the bridge for meaningful moments (send, approve, errors), not every tap.

**Android (Material 3)**: Roboto (system), a top app bar (title on the left), the navigation bar with its pill
indicator, a FAB for New chat on Chats, M3 shapes (12 for cards and fields, 28 for dialogs and sheets), flat lists
(edge to edge, plain leading icons, no chevrons, 56dp rows), segmented buttons, state layers for press and hover,
snackbars instead of toasts, M3 switches (52×32, an outlined track with a small thumb when off), predictive back.

**Web**: as above, with hover states and keyboard shortcuts (⌘K search, ⌘N new chat).

The native screens of the phone apps (connecting to a server, its settings, offline and error states) are native
SwiftUI on iOS and Jetpack Compose Material 3 on Android, with the same words and the same calm.

### The phone apps' bridge

What the web app and the phone apps agree on (`window.sekaiMobile`, typed in `packages/client/src/mobile.ts`; the
apps' side is `apps/mobile/shared/bridge.js` on the `dev` branch). Everything new is optional, so each side works
with an older other side.

- **Platform.** The bridge sets `<html data-platform>` at document start; the web app also sets it from
  `sekaiMobile.platform` before its first render (and `web` without the bridge).
- **Haptics.** `sekaiMobile.haptic?.(kind)`, `kind` one of `selection`, `light`, `medium`, `success`, `warning`,
  `error`. The web app calls it through one helper (`haptic(kind)` in `@sekai/client`), which does nothing on the web.
- **Back.** The web app owns navigation; the apps own the gestures. Whenever it changes, the web app reports
  `sekaiMobile.backState?.({ overlay, canGoBack })`: `overlay` is true while a sheet, dialog, menu or side panel is
  open, `canGoBack` while there's a screen to go back to inside the app. The apps enable their back handling (iOS
  swipe back, Android back and predictive back) only while either is true, so on the root screen the system's own
  back (leaving the app) works. When a back gesture commits, the app calls `window.__sekaiBack?.()`: the web app
  closes the topmost overlay, or goes back one screen, and returns `true`; `false` means nothing happened, and the
  app falls back to the WebView's history. One gesture never does both. A cancelled gesture does nothing.
- **Insets.** The web app pads with `max(env(safe-area-inset-*), var(--sekai-inset-*, 0px))`. Android draws edge to
  edge and sets `--sekai-inset-top|right|bottom|left` (CSS pixels) on `<html>` whenever the system bars change, since
  its WebView may not report `env()`; iOS relies on `env()`. The keyboard is never part of these: both apps resize
  the WebView for it, as a browser does.
- **Theme.** The page's `theme-color` and `.dark` drive the system bars (as now); the apps remember the last theme
  so a cold start doesn't flash.
