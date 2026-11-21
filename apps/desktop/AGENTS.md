# apps/desktop

Electron shell around the web app, plus the part that lends this computer to bots. Built with
`scripts/build.ts` (bundles `src/main.ts`, `src/preload.ts`, `src/local/*` into `dist/`), packaged with
electron-builder (`electron-builder.yml`).

## Map

```
src/main.ts        windows, tray, menu, single instance + sekai:// deep links, notifications, IPC handlers
                   (sekai:connect, sekai:local-get/-set…); loads the user's Sekai server URL in the window
src/preload.ts     the only bridge to the page (contextBridge): a small, typed API (window.sekaiDesktop);
                   the web app reads it through packages/client/src/desktop.ts
src/config.ts      saved server URL and settings (userData)
src/connect.html   connect, change server and "couldn't reach it" screen
src/about.html     About Sekai: version, server, this computer, updates
src/bundled.ts     which file:// pages are the app's own screens (only they get sekaiConnect's powers)
scripts/tokens.ts  makes dist/tokens.css from @sekai/ui's tokens for the HTML screens and the overlay
src/updates.ts     auto-update with electron-updater from ${server}/api/desktop/updates
src/local/         lending the computer: index.ts (bridge client over WebSocket to the server, which bots
                   may use it), screen.ts, keys.ts/combos.ts (input), exec.ts (commands), code.ts (files),
                   browser.ts, overlay.ts (shows when a bot is working), windows.ts / macos.ts / linux.ts
                   helpers (windows-host.ps1, mac-helper.jxa)
```

## Rules

- Renderer stays sandboxed: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`. Add abilities
  as narrow, validated IPC handlers exposed through `preload.ts`; never expose `ipcRenderer` or Node APIs.
- Validate every IPC argument (types, allowed values); open only http(s) URLs with `shell.openExternal`.
- Lending is decided on this computer: the server may narrow which bots can use it, never widen it. The bridge
  token is scoped to the bridge (`scope: "bridge"` on the server).
- `bun run --cwd apps/desktop typecheck` and `bun run build:desktop` before committing.
