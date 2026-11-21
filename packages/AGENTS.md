# packages

Three workspace packages shared by the apps. They're consumed as TypeScript source (no build step).

## @sekai/shared (packages/shared/src)

Types and validation shared by the server and every app, one file per area (`agent.ts`, `conversation.ts`,
`message.ts`, `hosts.ts`, `voice.ts`, `channel.ts`, `x.ts`, `instagram.ts`…).

- Input schemas are zod (`AgentCreate`, `HostCreate`…); PATCH bodies use `patchOf(schema)` from `patch.ts`
  (all keys optional, defaults not re-applied). Output shapes are TS interfaces (`Host`, `HostWithStatus`).
- `events.ts`: the `ServerEvent` union streamed over `/api/events`.
- `teach.ts`: teaching a bot by doing it once: the recorded steps' schema and `TeachRecorder`, which turns pointer,
  wheel and key events into steps (pure, so the server's tests cover it).
- `downloads.ts`: the repo constant (`SEKAI_REPO`), the shape of `GET /api/apps/downloads`, and the pure
  `detectDevice` / `primaryDownload` that pick the download for a visitor's platform and processor.
- `client.ts`: `createApiClient({ baseUrl, getToken })` → `api.<area>.<verb>()`; one method per server route.
  Keep paths, methods and body shapes identical to `apps/server/src/routes/*`.
- Server-only code doesn't belong here (no node: imports, no DB).

## @sekai/client (packages/client/src)

React glue for the web app (and what the desktop app and extension share with it).

- `api.ts`: the app's `api` instance (from `createApiClient`), `settingsUrl(section)` (an in-app path to a
  Settings section, opened through the router), `assetUrl()`.
- `query.ts`: `queryClient` and `qk` (every query key). `data.ts`: `useAgents()`, `useConversations()`,
  `useMessages()`, `useSettings()`, `useApprovals()`… Add a key to `qk` and a hook here for new server data.
- `components/`: AgentAvatar, AppStore (MCP app catalog), ModelPicker, VoiceSettings, MakeVoice, Markdown,
  BrandLogo (`BrandTile`, `BrandGlyph`, `presetBrand`, `vendorBrand`; marks in `logos.ts`).
- `voice/`: microphone capture and audio playback for calls and voice notes. `desktop.ts`: the Electron bridge.
  `mobile.ts`: the phone apps' bridge (`window.sekaiMobile`; new members optional) and `haptic(kind)`.
- `utils.ts`: `cn`, `timeAgo`, `shortTime`, `pluralize`, `providerLabel`…

## @sekai/ui (packages/ui/src)

The design system: shadcn/ui components restyled (`shadcn/*.tsx`, edit sparingly) and Sekai's own building blocks
(`components/*.tsx`), all exported from `index.ts`. `DESIGN.md` is the spec (when to use which, with their props);
`/dev/ui` in the web app's dev server shows every block in its states.

- `page.tsx`: Page (every screen but a chat), PageHeader. `section-layout.tsx`: SectionLayout (Settings, a bot).
  `link.tsx`: LinkProvider/Link (the app hands in its router's link).
- `list.tsx`: Section, List, Row, ToggleRow, SelectRow. `form.tsx`: Field, Input, PasswordInput, Textarea,
  Select, Switch, Checkbox, Segmented, CodeInput. `save.tsx`: useAutosave + SaveState, FormGroup + useFormValues,
  useUnsavedChanges/hasUnsavedChanges + LeaveConfirm.
- `overlay.tsx`: Dialog (sheet on phones), Sheet, Confirm, Popover, DropdownMenu (+ items), and menus from a
  list: `MenuEntry[]` rendered by `ContextMenu` (right-click / long-press) and `DropdownEntries`; on phone-sized
  touch screens they open as action sheets.
- `misc.tsx`: Badge, StatusDot, Callout, Card, Fold, IconTile, Kbd, Spinner, Tabs. `states.tsx`: EmptyState,
  ErrorState, ErrorBoundary, errorMessage, Skeleton and its presets. `button.tsx`: Button, IconButton, Tooltip.
  `copy.tsx`: CopyField (a value with a copy button) and copyText.
- `page-style.tsx`: `PageStyleProvider` (set by `Page`) gives full pages their large titles and roomier sections.
- `lib/platform.ts`: applyPlatform (sets `<html data-platform>`), usePlatform, useIsPhone, useActionSheets.
- `styles/index.css`: the tokens (Sekai's colour names per group theme, the type roles per platform, radii,
  layers, motion, safe areas) and the `coarse:`, `fine:`, `ios:` and `android:` variants. shadcn's colour names are
  aliases for the shadcn parts only.
- `test/`: contrast of every theme's colour pairs (read from the stylesheet) and the design rules for app code.

Tokens over raw colours, sentence case, and every component must work in dark mode and on touch screens.
