# packages

Three workspace packages shared by the apps. They're consumed as TypeScript source (no build step).

## @sekai/shared (packages/shared/src)

Types and validation shared by the server and every app, one file per area (`agent.ts`, `conversation.ts`,
`message.ts`, `hosts.ts`, `voice.ts`, `channel.ts`, `x.ts`, `instagram.ts`…).

- Input schemas are zod (`AgentCreate`, `HostCreate`…); PATCH bodies use `patchOf(schema)` from `patch.ts`
  (all keys optional, defaults not re-applied). Output shapes are TS interfaces (`Host`, `HostWithStatus`).
- `events.ts`: the `ServerEvent` union streamed over `/api/events`.
- `client.ts`: `createApiClient({ baseUrl, getToken })` → `api.<area>.<verb>()`; one method per server route.
  Keep paths, methods and body shapes identical to `apps/server/src/routes/*`.
- Server-only code doesn't belong here (no node: imports, no DB).

## @sekai/client (packages/client/src)

React glue used by web and admin.

- `api.ts`: the app's `api` instance (from `createApiClient`), `adminUrl()`, `assetUrl()`.
- `query.ts`: `queryClient` and `qk` (every query key). `data.ts`: `useAgents()`, `useConversations()`,
  `useMessages()`, `useSettings()`, `useApprovals()`… Add a key to `qk` and a hook here for new server data.
- `components/`: AgentAvatar, AppStore (MCP app catalog), ModelPicker, VoiceSettings, MakeVoice, Markdown,
  BrandLogo (`BrandTile`, `BrandGlyph`, `presetBrand`, `vendorBrand`; marks in `logos.ts`).
- `voice/`: microphone capture and audio playback for calls and voice notes. `desktop.ts`: the Electron bridge.
- `utils.ts`: `cn`, `timeAgo`, `shortTime`, `pluralize`, `providerLabel`…

## @sekai/ui (packages/ui/src)

The design system: shadcn/ui components restyled (`shadcn/*.tsx`, generated style, edit sparingly) and Sekai's
own building blocks (`components/*.tsx`), all exported from `index.ts`.

- `button.tsx`: Button, IconButton (label = tooltip + accessible name), Tooltip.
- `form.tsx`: Field, Input, PasswordInput, Select, Switch, Segmented, ToggleRow, Textarea.
- `misc.tsx`: Badge, Callout, Card, EmptyState, Fold, IconTile, Kbd, Section, Skeleton, Spinner, Tabs.
- `overlay.tsx`: Dialog (sheet on phones), Sheet, Confirm, Popover, DropdownMenu (+ items), and menus from a
  list: `MenuEntry[]` rendered by `ContextMenu` (right-click / long-press) and `DropdownEntries`.
- `settings.tsx`: SettingsTabs, SettingsPanel, SettingsGroup, SettingsRow. `page-style.tsx`:
  `PageStyleProvider value="page"` makes SettingsPanel/Section render as full pages (used by admin).
- `styles/index.css`: tokens (`--surface-2`, `--fg-muted`, `--brand-ink`…, dark theme under `.dark`) and the
  `coarse:` variant for touch.

Tokens over raw colours, sentence case, and every component must work in dark mode and on touch screens.
