# apps/extension

Manifest V3 WebExtension. React + Vite panel uses `@sekai/ui`; Chromium opens it in sidePanel, Firefox in
sidebarAction, Safari as a popover or companion window. `bun run build:extension` makes `dist/{chromium,firefox,safari}`.
Safari's output must be converted and signed with Xcode on macOS; do not claim Linux builds tested Safari.
`scripts/build-safari.sh` does the unsigned macOS host build in CI; actual Safari runtime and signing still need a Mac.

`src/browser.ts` contains the small cross-browser API surface; `dom.ts` is a self-contained function injected
in the isolated world, not MAIN. `control.ts` enforces per-tab, per-origin local grants before every command.
Only the panel polls `/api/extension`, so closing it ends control. Never persist grants, auto-share tabs, restore
commands, replay writes, expose tokens to pages, add arbitrary evaluation, or make the bridge remotely callable.
No content scripts, externally_connectable, debugger, cookies, webRequest, nativeMessaging or mandatory host access.
Host permissions are requested from a user gesture, separately for the server and each shared site.

`build.ts` generates manifests from `manifests.ts` and bundles the tiny background entry separately. Built outputs
are ignored. Tests exercise the real extension in Chromium plus DOM and broker security. Keep the README's
compatibility and limitations honest, particularly synthetic events, frames, password fields and Safari.
