# Sekai browser extension

Chat beside a page, and let your bots use **your actual signed-in browser** rather than a separate bot browser.
Chromium uses its native side panel, Firefox its native sidebar, and Safari a toolbar popover or **Pop out**
companion window. Safari doesn't expose an equivalent WebExtension sidebar API.

## Build and install

From the repository root:

```sh
bun install
bun run build:extension
```

Builds appear in `apps/extension/dist/chromium`, `dist/firefox` and `dist/safari`.

- **Chrome, Edge, Brave, Vivaldi and other Chromium browsers:** open the browser's extensions page, turn on
  developer mode, choose **Load unpacked** and select `dist/chromium`. Pin Sekai's toolbar icon and click it.
- **Firefox 128+:** `about:debugging` → This Firefox → Load Temporary Add-on → `dist/firefox/manifest.json`.
  Click Sekai's toolbar icon to toggle its sidebar. Temporary add-ons disappear on restart. Permanent installs
  require signing by Mozilla; a ZIP is not a signed XPI.
- **Safari:** on **macOS with Xcode**, run the command below. Open the generated project, select your signing team,
  build it, and enable it in Safari Settings → Extensions. Safari output is source for Apple's converter, not a
  signed app. macOS/iOS packaging, signing, and actual Safari runtime checks need Apple hardware/tooling.

GitHub Actions also converts and compiles an **unsigned universal macOS Safari host app** on its macOS runner.
That artifact isn't signed/notarized and isn't an iOS installer. For a normal installation, use the source route
with your own Xcode signing team. You can run that CI build locally on a Mac with
`bash apps/extension/scripts/build-safari.sh`; no Apple secrets are used by the unsigned build.

```sh
xcrun safari-web-extension-converter apps/extension/dist/safari \
  --app-name Sekai --bundle-identifier your.reverse.domain.sekai
```

The extension expects the matching Sekai server changes. Nothing connects to a hosted Sekai service.

## Connect and share

1. In the main Sekai app, open **Settings → Browser extension**. Make a browser token (you may need to confirm
   it's you). Copy the server address and token into the extension. Use HTTPS except for localhost development.
2. Choose one of **your own bots**, then an existing direct chat or **New**. The same chat is visible in Sekai.
3. Click **Choose tabs to share**. Grant site access when asked, then share only the intended tabs. Tab titles
   in this picker stay local; only shared tabs are returned to the bot. Private windows and non-web pages are excluded.
4. Give your bot a task. It loads the built-in **Using the user's browser** skill and uses `extension_browsers`
   and `extension_browser`. Regular `browser_open` tools remain separate; they never silently use your browser.
5. Allow or deny action requests in the sidebar. Every mutation asks you even in YOLO. Opening and sharing a new
   tab needs a second, local **Open and share** click and the new site's permission. Scroll follows the ordinary
   approval policy. Read-only mode still prevents changes.
6. **Stop sharing**, **Unshare**, switch bot/chat, disconnect or close the panel to end access. No sharing grant
   is ever saved or restored. If the panel loses contact, the server lease expires after 12 seconds. In-flight
   browser operations may already have happened; check before retrying. The server never replays a delivered command.

**Screenshots:** select the shared tab and click Sekai's toolbar icon there first. Browsers require that explicit
activation (`activeTab`) to capture the viewport. The extension will not request all-sites access for screenshots.
Hide sensitive material first: screenshots can include visible personal information, including nested frames.

Revoke any browser token in **Settings → Browser extension → Connected browser tokens**. Disconnect removes the
saved token from this browser profile; it doesn't revoke it on the server. Treat it like a password.

## Tools and boundaries

`extension_browsers` returns connections shared with this bot **in this chat**. `extension_browser` takes a
`connectionId` and an `input` action:

- `tabs`: IDs, titles and URLs of shared tabs only.
- `snapshot`: rendered top-level page text and up to 200 element refs, with a fresh `pageId`. Input values are omitted.
- `click`, `type`, `select`, `press`, `scroll`: explicit `tabId`, fresh `pageId`, and element `ref` where needed.
- `navigate`, `back`, `forward`, `reload`, `close`: also require the snapshot's `pageId`.
- `open`: locally confirmed new tab, added to the share list.
- `screenshot`: visible viewport of an active shared tab only, subject to the browser's capture permission.

Element refs live in the extension's **isolated world**, not attributes a page can forge. Stale documents,
hidden/detached elements and changed origins fail closed. Navigation to a different origin requires sharing again;
site redirects don't grant access to the destination. A new server process has no grants.

This is a portable DOM bridge, not a DevTools/OS automation tunnel. Events are synthetic and some sites reject
them. There is no arbitrary JavaScript evaluation, cookie or browser-storage access, debugger/native messaging,
file upload/download API, browser-settings access, private-window access, frame traversal, shadow-root traversal,
or trusted keyboard/mouse-event emulation. Password, one-time-code and payment-autocomplete fields are blocked;
the user handles sign-in and sensitive fields themselves. Custom fields may not identify themselves as sensitive,
so share carefully. Page text and screenshots are untrusted data, never instructions.

## Permissions and privacy

- `storage`: server address/token in **local** extension storage, never sync. No grants or command queues are stored.
  Chromium additionally restricts this store to trusted extension contexts.
- `tabs`: show a local tab picker and act on explicit shared IDs. Unshared tab metadata is not sent to Sekai.
- `scripting`: inject only the bundled, isolated DOM function into shared top-level pages.
- `activeTab`: capture after you invoke Sekai on that tab. Chromium also uses `sidePanel`.
- **Optional** HTTP(S) hosts: asked separately for the Sekai server and each shared site's hostname. Browser host
  permissions cover that hostname's ports, but local grants are narrower: one tab and exact scheme/host/port origin.
  Browsers may retain host permission after unsharing; that alone never allows this bridge to act on a tab.

The extension sends chats, approvals, shared-tab results and requested screenshots **only to your configured Sekai
server**. Its scoped token cannot call server setup, mint tokens, access other API groups or open WebSockets.
It can access your own direct chats and approvals, so protecting/revoking it matters. Sekai may send chat/tool
content to the model provider you chose as part of normal agent operation. There is no telemetry or third-party
extension backend. The panel cannot be embedded by websites and exposes no page-to-extension messaging channel.

## Tests and releases

```sh
bun run check
bun run build:web
bun run build:extension
# Use a throwaway Postgres + pgvector database; this deletes its test accounts.
SEKAI_EXTENSION_TEST_DATABASE_URL=postgres://USER:PASS@127.0.0.1:5433/sekai_extension_test \
SEKAI_EXTENSION_TEST_FIREFOX=1 bun run --cwd apps/extension test:e2e
bun run apps/extension/release.ts
```

Install Playwright's Chromium/Firefox first by running `bun x --no-install playwright-core install chromium firefox`
from `apps/extension`.
The E2E test loads the real built extension in disposable Chromium, exercises real server routes and tools,
per-tab grants, DOM actions, sensitive-field/stale-page rejection, screenshots, chat, approvals and stop sharing,
and checks panel/settings layouts at 390px and 1280px, light and dark. Only the disposable test manifest pregrants
hosts (headless browsers cannot answer permission dialogs or activate the toolbar's screenshot grant). The test
asserts the shipped manifest has no mandatory hosts. Firefox DOM behavior is checked when the flag is set;
Firefox extension installation/sidebar and Safari runtime/signing still require native/manual checks.

GitHub Actions **Browser extensions** builds and tests pull requests, pushes that touch the extension and manual
runs (which keep the ZIPs as artifacts). Every Sekai release (`vX.Y.Z`) builds the extensions with the release's
version through the same workflow and attaches the Chromium and Firefox ZIPs, the Safari WebExtension source and
an unsigned macOS Safari host app to the GitHub release, with the other apps and SHA-256 checksums; the Safari
Xcode job must pass first. This does **not** publish to stores, sign Firefox/Safari installers, or upload Apple
credentials.

Character art © SEGA / © CP / © CFM. The bundled icon is the unmodified, resized Sekai icon.
