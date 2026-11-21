# apps/web

The app: React 19, Vite, Tailwind 4, TanStack Query (server state), zustand (UI state), react-router (a data
router). Built to `dist/` and served by the API server at `/` (old `/admin/…` addresses too: the router sends them
to Settings); in dev, Vite serves it and proxies `/api`.

## Map

```
src/router.tsx            the routes (DESIGN.md "Routes"): / (Chats on phones, the last chat elsewhere),
                          /c/:conversationId, /inbox, /activity (?view=working|scheduled|done|log, ?bot=),
                          /library, /bots/:agentId/:section/*, /settings/:section/*, /bot/:agentId (a bot's main
                          chat), /welcome (onboarding, outside the shell); old addresses go through redirectFor()
src/Root.tsx              the root route: sign-in, setup, invite and reset links, the steps someone owes, then the
                          app with the leave guard (useBlocker + LeaveConfirm) and the phone apps' back gesture
src/App.tsx               providers (Query, tooltips, toaster, theme) around <RouterProvider>
src/components/layout/    AppShell (desktop sidebar or rail, tablet rail with the sidebar over the screen, phone tab
                          bar, dual-screen panes, global dialogs), Sidebar (header with New and collapse, Search,
                          Needs you, Activity, Library, the chat list, the person footer), ChatList (which rows go in
                          which section), ChatRows (the rows and their menus), PersonMenu, NewMenu, TabBar,
                          Loading
src/settings/             Settings: registry.tsx (every section: id, group, title, who sees it, its file),
                          SettingsPage.tsx (the layout), one file per section in you/, bots/, people/, server/
                          (server/attention.ts: what needs an admin, for Status and the dots)
src/bots/                 a bot's page: registry.tsx (its sections), BotPage.tsx (the layout), sections/*.tsx
src/pages/                ConversationPage (chat header, messages, composer, the side panel), ChatsPage (phones),
                          Home, Inbox (approvals, pairings, sign-in requests), Activity (+ activity/ActivityLog),
                          Library, Onboarding, auth/
src/components/chat/      Composer, MessageItem, Parts (renders text/tool/reasoning/notice/audio/image parts),
                          RetryControls, VoiceNote, ChatDetails (the side panel: context or the group),
                          ContextMeter
src/components/agent/     what a bot's sections show, a file per part: ProfileForm, Sharing, BotActions (Profile);
                          ModelSettings, VoiceSettings (Model & voice); Memories, Notes (+ the note page),
                          CodeIndexes (Memory); AccessSettings, AppsAccess, SkillsAccess, ToolRules (Tools &
                          access); AccountsHome, PlatformPage, ChannelAccount, ConnectChannel, SocialAccount,
                          SlackSetup (Accounts); RoutinesList (Routines). Shared bits: MoreMenu, RiskBadge, ToolRule,
                          AccountMark
src/components/routines/  RoutineRow (a Row for a List; RoutineList is that List), RoutineDialog (the editor); the
                          bot's Routines section and Activity → Scheduled both use them
src/components/computer/  ComputerPanel (ComputerBody: the Computer section and the panel beside a chat), VncView
                          (takeover), Teach, WebApps, CredentialPrompt, ThisComputerSettings
src/components/voice/     CallProvider (calls in the app), LevelBars
src/components/dialogs/   CommandPalette (Ctrl/⌘K: bots, hidden ones too, chats, messages, Settings sections),
                          NewChatDialog, NewAgentDialog, NewGroupDialog, ImportBotDialog, GetAppsDialog (app
                          downloads; from the person menu and Settings → You, through `useUi().setGetAppsOpen`)
src/lib/access.ts         who may open what: can(), allows(Who) (pure; navigation, sections and search use it)
src/lib/redirects.ts      old addresses → new ones (pure, tested in test/redirects.test.ts)
src/lib/back.ts           going back: parentOf() (the screen under each on phones), useGoBack, useBackLayer,
                          usePhoneAppBack (window.__sekaiBack and backState for the phone apps)
src/lib/events.ts         the live stream: EventSource on /api/events → patches the Query cache, notifications,
                          "Sekai was updated" reload toast; on Settings pages anything saved elsewhere refetches
src/lib/navigation.ts     useOpenAgent (a bot's main chat), messagingChats/useMessagingChat (which chats are
                          Discord DMs or channels)
src/lib/notifications.ts  browser notifications and Web Push subscription; session.ts signOut; viewer.ts useViewer
src/lib/hooks.ts          useLayout (phone < 768px / tablet / desktop / touch / spanned), useWidth, useToastLift,
                          useLongPress, useStickToBottom…
src/lib/forms.ts          saving and "Confirm it's you": saveForm (a FormGroup's save), actionError (a mutation's
                          toast), cancelledReauth, useAfterSave (navigate once a saved form is clean)
src/stores/ui.ts          zustand, persisted as "sekai.ui": sidebar, side panel, folded sections, last chat, drafts,
                          active runs, which dialog is open
src/stores/seen.ts        zustand, persisted as "sekai.seen": last-seen time per chat (unread dots, mark read)
public/sw.js              service worker: push (skipped while the app is focused unless test), offline start
                          (navigations network-first, /assets cache-first, never /api)
test/                     bun tests for the pure parts (redirects, who sees which section)
```

## Settings and a bot's sections

Each section is its own file, listed once in a registry; navigation (the rail, the phone list), ⌘K search and the
redirects read the registry, so sections can change without touching each other.

- **A Settings section**: add an entry to `SETTINGS_SECTIONS` in `src/settings/registry.tsx` (`id` is its address,
  `group`, `title`, `icon`, a one-line `blurb` and search `keywords`, `who` may open it: `"everyone"`, `"admin"`,
  a permission or a list of them; `edit` when fewer may change it, which makes it read only for the rest; `only`
  for the desktop or phone apps; `parent` for a page inside another section, at `/settings/<parent>/<id>`), and a
  file exporting the component it loads. The component gets `{ back, rest, readOnly }` (`SettingsSectionProps`) and
  renders a `<Page back={back} title description>`; `rest` is the address after its own (a person's id…), whose
  page gets its own `back` (`{ label: "People", onClick: () => goBack("/settings/people") }`).
- **A bot's section**: an entry in `BOT_SECTIONS` in `src/bots/registry.tsx` (`who: "owner"` or `"anyone"`, also
  people it's shared with; `viewerReadOnly`) and a file in `src/bots/sections/`; it gets `{ agent, back, rest,
  readOnly }` (`BotSectionProps`).
- Links to a section: `settingsUrl("models")` from `@sekai/client`, `sectionPath(id)` here, `botPath(agentId,
  section)`; through the router (`Link` from `@sekai/ui`, `navigate()`), never a full page load.
- A section's own pages are addresses under it (`rest`), not state, so back and the phone apps' back gesture work:
  `/settings/subscriptions/<id>` and `…/new`, `/settings/apps/<id>`, `/settings/apps/skills/<id>`. Settings → Apps
  & skills opens a new custom app at `/settings/apps/custom` (or `?add=custom`) and, with `?return=<path in the app>`
  (checked by `safeReturnPath`), adds it for that bot and goes back there.
- Who sees what is decided in one place (`lib/access.ts` and the registries); `test/access.test.ts` pins the lists
  for an admin, a member and someone with no features. Controls inside a section use `useAccess().can()` for the
  same permissions the server checks.
- Something that needs an admin (a broken connection, missing setup) goes in `settings/server/attention.ts` with
  its `section`: Status lists it and the section gets a dot (the sidebar's Settings button too).

## Phones

Below 768px there's no sidebar: Chats (`/` on phones), Needs you, Activity and Library are tabs (TabBar, shown on
those four only); everything else pushes full screen with a back to the screen under it (`parentOf`), even from a
direct link, so back buttons use `useGoBack()` (or a `Page`'s `back.onClick`), not a link. Overlays that aren't
Radix dialogs, sheets or menus register with `useBackLayer(open, close)` so the phone apps' back gesture closes
them first. `haptic(kind)` (`@sekai/client`) is for meaningful moments only (send, approve or deny, errors).

The phone apps' bridge is `window.sekaiMobile`, typed in `packages/client/src/mobile.ts` (the contract is in
`packages/ui/DESIGN.md`, "The phone apps' bridge"). `applyPlatform()` in `main.tsx` sets `data-platform` before the
first render. `usePhoneAppBack()` (in `lib/back.ts`, run from `SignedInApp` in `Root.tsx`) defines `window.__sekaiBack`
and reports `backState` on every change, so the system's back gesture closes the topmost overlay first and otherwise
goes back one screen.

## Patterns

- **Data**: use hooks from `@sekai/client` (`useAgents`, `useConversations`, `useMessages`…) and `api.*` for
  mutations (`useMutation`). Query keys live in `packages/client/src/query.ts` (`qk`); events.ts updates those same
  keys, so a new server event usually needs a case there.
- **Unread**: a chat is unread when `lastMessageAt > seen[id]` and it isn't open. `useSeen().markRead(chats)`
  marks read; the sidebar's context menus and ⌘K use it.
- **Menus**: rows use `ContextMenu` (right-click / long-press) and a "…" `DropdownMenu` built from the same
  `MenuEntry[]` (`@sekai/ui`). Stop click propagation inside menus that sit in clickable rows.
- **Layout**: decide with `useLayout()`; a chat's side panel (its details, the bot's computer) docks only while the
  chat keeps 560px, else it's a sheet.
  Overlays use the named z-index layers from `@sekai/ui` (z-sticky < z-panel < z-overlay < z-takeover < z-dialog
  < z-menu < z-tooltip < z-toast); never raw numbers.
- **Building blocks**: screens use `@sekai/ui`'s Page, SectionLayout, Section, List/Row, Field, FormGroup or
  useAutosave, EmptyState/ErrorState and the Skeleton presets (see `packages/ui/DESIGN.md`), and its type roles and
  colour names, not pixel sizes or raw colours. `/dev/ui` (dev server only) shows them all.
- **A bot's settings**: simple values save themselves (`useAutosave` + `SaveState` in the Section), connections and
  policies are a `FormGroup`; `useAgentUpdate(agent)` (`src/bots/`) saves a change to the bot and updates the cache at
  once. A page inside a section (a note, an account) is addressed through the section's `rest` and gets its own `back`
  ("‹ Notes"), which `Page` shows above the title from tablets up; the section's own `back` is `phoneOnly`.
- **Unsaved changes**: `FormGroup` (or `useUnsavedChanges(dirty)` for a custom form) makes leaving ask first, through
  the router's blocker in `Root.tsx`. To leave after a save (a new item's page, back to the list), navigate with
  `useAfterSave()`: from the save's own callback the form is still dirty and the guard would ask.
- **"Confirm it's you"**: the API client asks and retries by itself; when the person cancels, say nothing more
  (`saveForm` for a FormGroup's save with the mutation's `onError: () => {}`, `actionError` for other mutations).
- **Hooks**: never call hooks after an early return (React error #310 in production builds).

## Checking your change

`bun run --cwd apps/web typecheck`, `bun run build:web`, then look at it: Playwright scripts that sign in with the
`sekai_session` cookie and take screenshots at 1280×800 and 390×844 (and `colorScheme: "dark"`; add `?platform=ios`
or `?platform=android` in the dev server to see the phone apps' variants). Chromium
under Playwright can't register push; use Firefox for push tests. Plain http disables the mic, push and passkeys.
