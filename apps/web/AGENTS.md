# apps/web

The main app: React 19, Vite, Tailwind 4, TanStack Query (server state), zustand (UI state), react-router.
Built to `dist/` and served by the API server at `/`; in dev, Vite serves it and proxies `/api` and `/admin`.

## Map

```
src/App.tsx               routes inside <AppShell>: / (home), /c/:conversationId, /inbox, /activity,
                          /settings, /welcome (onboarding), /bot/:agentId; sign-in pages when signed out
src/components/layout/    AppShell (phone drawer, tablet rail, desktop sidebar, dual-screen panes), Sidebar
src/pages/                ConversationPage (chat header, messages, composer, details panel), Home, Inbox
                          (approvals, pairings, sign-in requests), Activity, Settings, auth/
src/components/chat/      Composer, MessageItem, Parts (renders text/tool/reasoning/notice/audio/image parts),
                          RetryControls, VoiceNote
src/components/agent/     the bot panel: AgentPanel (tabs) + ProfileTab, ModelTab, VoiceTab, ToolsTab
                          (Access / Apps & skills / Accounts → ChannelsTab, DiscordUserTab, XTab, SocialTab),
                          BrainTab, NotesTab, CodeTab, RoutinesTab, ActivityTab
src/components/computer/  ComputerPanel, VncView (takeover), CredentialPrompt, ThisComputerSettings (desktop app)
src/components/voice/     CallProvider (calls in the app), LevelBars
src/components/dialogs/   CommandPalette (Ctrl/⌘K), NewAgentDialog, NewGroupDialog…
src/lib/events.ts         the live stream: EventSource on /api/events → patches the Query cache, notifications,
                          "Sekai was updated" reload toast
src/lib/navigation.ts     useOpenAgent (a bot's main chat), messagingChats/useMessagingChat (which chats are
                          Discord DMs or channels)
src/lib/notifications.ts  browser notifications and Web Push subscription
src/lib/hooks.ts          useLayout (phone/tablet/desktop/touch/spanned), useLongPress, useStickToBottom…
src/stores/ui.ts          zustand, persisted as "sekai.ui": sidebar, panel tab, folded sections, active runs…
src/stores/seen.ts        zustand, persisted as "sekai.seen": last-seen time per chat (unread dots, mark read)
public/sw.js              service worker: push (skipped while the app is focused unless test), offline start
                          (navigations network-first, /assets cache-first, never /api or /admin)
```

## Patterns

- **Data**: use hooks from `@sekai/client` (`useAgents`, `useConversations`, `useMessages`…) and `api.*` for
  mutations (`useMutation`). Query keys live in `packages/client/src/query.ts` (`qk`); events.ts updates those same
  keys, so a new server event usually needs a case there.
- **Unread**: a chat is unread when `lastMessageAt > seen[id]` and it isn't open. `useSeen().markRead(chats)`
  marks read; the sidebar's context menus and ⌘K use it.
- **Menus**: rows use `ContextMenu` (right-click / long-press) and a "…" `DropdownMenu` built from the same
  `MenuEntry[]` (`@sekai/ui`). Stop click propagation inside menus that sit in clickable rows.
- **Layout**: decide with `useLayout()`; the bot panel is a docked pane on wide screens and a sheet elsewhere.
  Overlays use z-index tiers (sheets < takeover z-[58] < menus z-[65]).
- **Hooks**: never call hooks after an early return (React error #310 in production builds).

## Checking your change

`bun run --cwd apps/web typecheck`, `bun run build:web`, then look at it: Playwright scripts that sign in with the
`sekai_session` cookie and take screenshots at 1280×800 and 390×844 (and `colorScheme: "dark"`). Chromium
under Playwright can't register push; use Firefox for push tests. Plain http disables the mic, push and passkeys.
