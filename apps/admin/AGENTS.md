# apps/admin

The admin app, served at `/admin` (react-router `basename="/admin"`). Same stack as apps/web and the same sign-in
(the main app signs you in, then sends you back).

## Map

```
src/App.tsx                  routes /admin and /admin/:tab → AdminHome: renders only the active page inside a
                             Radix <Tabs> (pages use SettingsPanel, which is a TabsContent); PageStyleProvider
                             value="page" gives every page a large title and roomy sections
src/components/AdminShell.tsx  AdminFrame: sidebar on large screens (grouped nav, Search settings with Ctrl/⌘K,
                             attention dots, account menu, theme), MobileBar on phones (back to the list, title
                             appears once the page title scrolls away)
src/lib/nav.tsx              NAV groups/items (label, icon, tone, blurb, search keywords); searchNav()
src/lib/attention.ts         useAttention(): what needs the owner (approvals, gateway down, subscriptions to
                             sign in again, MCP apps, the web engine, Discord offline, Tailscale keys, devices
                             bots can't reach, no passkey) + worst tone per page for nav dots
src/pages/OverviewPanel.tsx  Needs you, At a glance (desktop), the page list with search (phones)
src/pages/*Panel.tsx         one per page: Models (+ ApiProviders), Subscriptions, Apps, Voice, Web reading
                             (Firecrawl Local), Memory, Approvals, Computers (ComputerSettings), Tailscale
                             (+ HostsSection), Account, Devices ("Sign-ins & tokens"), About
src/lib/settings.ts          useSaveSettings(): PATCH settings + quiet "Saved" toast
src/lib/theme.ts             theme shared with the main app (localStorage "sekai.theme")
```

## Adding a page

1. Add the tab id to `Tab` and an item to a `NAV` group in `lib/nav.tsx` (pick an icon, tone, blurb, keywords).
2. Write `src/pages/<Name>Panel.tsx` returning `<SettingsPanel value="<tab>" title description>` with `Section`s.
3. Register it in `PANELS` in `App.tsx`. If something there can need the owner's attention, add it to
   `useAttention()` with `tab: "<tab>"` so the nav shows a dot and the overview lists it.

Sections inside sections get smaller headings automatically. Prefer `SettingsGroup`/`SettingsRow` or a bordered
`rounded-2xl` list for rows, and `Callout` for problems. Check pages at 1440×900 and 390×844, light and dark.
