# apps/mobile

The iOS and Android apps: thin native shells around the web app, like the desktop app. Each one asks which Sekai
server to use (native screens: SwiftUI, Jetpack Compose), then shows that server's own web app in a web view, and
adds what a web page can't do on a phone: push notifications (Firebase on Android, Apple push on iOS) with Approve /
Deny buttons, signing in through the system browser (passkeys and Google won't work in an embedded web view), the
microphone and camera for calls, file uploads and downloads, links in the system browser, and `sekai://` links.
Everything else is the web app, so features land in the apps the moment the server has them.

## Map

```
shared/bridge.js        window.sekaiMobile for the server's pages (typed in packages/client/src/mobile.ts);
                        the apps inject it at document start with __SEKAI_APP__ replaced (see the file)
shared/icon.png         the logo (Colorful Stage art: resize only, see the root AGENTS.md)
version.xcconfig        MARKETING_VERSION and CURRENT_PROJECT_VERSION for both apps (Gradle reads it too)
android/                Kotlin, Gradle (Kotlin DSL), one activity: a WebView under Jetpack Compose Material 3 screens
ios/                    Swift: SwiftUI server screens over UIKit + WKWebView; XcodeGen reads ios/project.yml
```

App id (package name and bundle id): `io.github.hazelcaffe.sekai`, set in one place per app. People who build their
own copy (for their own Firebase project or Apple team) change it there.

## The bridge

The page sees `window.sekaiMobile` (only on the connected server's origin, main frame). Messages are JSON
`{id?, method, args}`; replies `{id, result}` or `{id, error}`; native → page events `{event, data}` with events
`navigate` (`data` is a path) and `pushToken` (`data` is a `MobilePushToken`; the types are in
packages/shared/src/mobile.ts). Methods:

| method                     | args                                  | does                                                                |
| -------------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| `ready`                    |                                       | the page loaded the bridge (Android: keep its replyProxy)           |
| `notify`                   | title, body, conversationId, approval | a local notification, only while the app isn't in front             |
| `setBadge`                 | count                                 | the app icon's number (iOS)                                         |
| `openSettings`             |                                       | the server screen, over the page (Cancel and back keep the page)    |
| `openNotificationSettings` |                                       | the system's notification settings for the app                      |
| `haptic`                   | kind                                  | a tick or buzz: selection, light, medium, success, warning or error |
| `backState`                | overlay, canGoBack (booleans)         | what back would do in the page (see "Back" below)                   |
| `openExternal`             | url (http/https only)                 | system browser                                                      |
| `theme`                    | color (#rrggbb), dark, system         | system bar colors follow the page (system: Sekai's Auto theme)      |
| `saveFile`                 | name, mime, base64                    | Android: Downloads (MediaStore); iOS: share sheet                   |
| `push.register`            | fcm: MobileFcmConfig or null          | asks permission, returns MobilePushToken                            |
| `push.current`             | fcm                                   | the token if push was on before (never asks), or null               |
| `push.unregister`          |                                       | forgets the token                                                   |
| `push.permission`          |                                       | "granted", "denied" or "prompt"                                     |
| `push.requestPermission`   |                                       | asks to show notifications (no push needed): "granted" or "denied"  |
| `signInWithBrowser`        | provider (SSO provider id or null)    | the browser sign-in below                                           |

The bridge also sets `<html data-platform="ios" | "android">` at document start, before the page runs. Everything
added later (`openNotificationSettings`, `haptic`, `backState`, `theme`'s `system`) is optional on both sides: a page
calls it with `?.()`, and an app that doesn't know a method answers with an error the page can ignore.

Validate every argument; ignore messages from any other origin or frame. The server screens aren't part of the
bridge: the app normalises the address (adds https:// when no scheme, drops paths), checks
`GET <url>/api/auth/status` answers JSON with a `setupRequired` field (else "Not a Sekai server"), saves it (and up
to 5 recent ones) and opens it.

Back: the web app owns navigation, the apps own the gestures. The page reports `backState({overlay, canGoBack})`
whenever it changes; the apps enable their back handling only while either is true (so on the root screen the
system's own back runs: on Android its predictive animation to the home screen, on iOS nothing app-level, the edge
swipe stays with the page). When a back gesture commits, the app calls `window.__sekaiBack?.()`: the page closes its
topmost overlay or goes back a screen and returns `true`; on `false` (or no such function) the app uses the web
view's history. A cancelled gesture does nothing. A report holds until the page reports again or a new document
loads (in-page navigation keeps it). A page that has never reported (an older web app) is handled through the web view's
history alone: back is on while there's an earlier page (on Android, not counting the server's `/`, which only
redirects to a chat), and the app's native screens always close first.

The app's user agent ends with ` SekaiApp/<version> (<Android|iOS>)`.

## Server endpoints the apps use

- `GET /api/push/mobile` → `{ fcm: MobileFcmConfig | null, apns: boolean }` (the page passes `fcm` to
  `push.register`; null means an admin hasn't added Firebase in Settings → Server → Network & devices → Phone notifications).
- `POST /api/push/devices` `{provider, token, environment?, appId, device}` and `POST /api/push/devices/remove`
  `{token}`: the page registers the token for the signed-in person (the native side never does).
- Pushes. FCM: data-only messages (all values strings): `title`, `body`, `url` (a path), `tag`, `ring` ("1" for
  calls), `toolCallId` (set when the notification gets Approve / Deny), `test` ("1": show even while the app is
  in front). APNs: `aps.alert {title, body}`, `aps.sound`, `aps.thread-id`, `aps.category` = `SEKAI_APPROVAL` when
  there's a `toolCallId`, `aps.interruption-level` = `time-sensitive` for calls, plus top-level `url`, `tag`,
  `toolCallId`, `test`. Pushes are skipped while the app is in front unless `test` (the page shows its own).
- Approve / Deny from a notification: `POST <server>/api/approvals/<toolCallId>` with JSON
  `{"approve": true|false, "scope": "once"}`, the web view's cookies and `Origin: <server origin>`. 404 means it
  was already answered; then say so in the notification. On any other failure, open the app at the chat.
- Signing in with the browser (PKCE-style, so another app that grabs the `sekai://` link can't use it):
  1. `verifier` = 32 random bytes, base64url; `challenge` = base64url(SHA-256(verifier)); keep the verifier
     (also on disk: the app may be killed while the browser is open).
  2. Open `<server>/api/auth/app/start?challenge=<challenge>&provider=<id or empty>` in Custom Tabs (Android) or
     `ASWebAuthenticationSession` with callback scheme `sekai` (iOS, not ephemeral, so a signed-in Safari is used).
  3. The server signs the person in there as usual and ends at `sekai://signed-in?code=<code>`.
  4. In the web view, POST `<server>/api/auth/app/exchange` as `application/x-www-form-urlencoded`
     `code=…&verifier=…` (Android `WebView.postUrl`, iOS `URLRequest` with `httpMethod = "POST"`). The server sets
     the session cookie and redirects to `/`.
- Links: `sekai://c/<conversationId>` opens that chat; `sekai://signed-in?code=…` as above.

## Rules

- Only the connected server's origin gets `sekaiMobile`. Other sites open in the system browser (Custom Tabs /
  SFSafariViewController), never in the app's web view.
- Same-origin links stay in the web view. `target=_blank` and `window.open`: other sites go to the browser;
  the server's own `/api/` file links download (Android) or open in a share sheet / preview (iOS).
- Plain http is allowed (people reach Sekai on their own network or over Tailscale), but the mic, push and
  passkeys need https in the web view, as in a browser.
- Grant the mic and camera to the server's origin only, after the system permission.
- Colorful Stage art: icons and splash use `shared/icon.png` resized on a plain background, whole and uncropped
  (inside Android's adaptive-icon safe zone and iOS's rounded corners). No themed/tinted icon variants: they
  recolor it.
- No secrets in the apps. Firebase's client config comes from the server at runtime (the page passes it), so one
  build works with any server's Firebase project; Android re-initialises Firebase from the saved config at
  start, so pushes arrive while the app is closed.
- Approve / Deny on a notification only when the page's `approval.alwaysAsk` is exactly `false` (missing means ask
  in the chat), and both apps need the phone unlocked to send the answer.
- Sentence case and the friendly copy rules from the root AGENTS.md (and the words in packages/ui/DESIGN.md) apply
  to native text too; both apps say the same things (Connect to Sekai, Change server, Forget this server, You're
  offline, Can't reach your server, Try again…), each in its platform's own components.

## Android (Compose, Material 3)

`android/app/src/main/kotlin/io/github/hazelcaffe/sekai/`:

```
MainActivity.kt      decides what's loaded; owns the web view, the bridge and back
ShellState.kt        what the screens show (page load state, the stack of native screens, dialogs, back state)
ShellActions.kt      what the screens can ask for (connect, retry, forget, open a screen…)
ui/                  Compose Material 3: Theme, Shell (the root), AddressScreen, ServerScreen, AboutScreen
                     (+ LicenceScreen), StatusScreens (offline, connecting, web view too old), Parts
Notifications.kt     channels, messages, approvals (Approve / Deny need the phone unlocked), calls (CallStyle)
PageBridge.kt        window.sekaiMobile's native side; Haptics.kt, Insets.kt, Snacks.kt, Connectivity.kt
```

- Compose draws everything native; the page's web view stays alive underneath and is only covered, so changing
  the server or opening About never throws the page away (Cancel and back return to it). Dependency versions are in
  `android/gradle/libs.versions.toml`; the Compose BOM, `activity` and `lifecycle` are held back because later ones
  need `compileSdk` 37 (lint's `GradleDependency` notes for them are ignored in `app/lint.xml`).
- Colors: Material You on Android 12 and later, Sekai's teal (#33CCBB as the seed, made with Google's
  material-color-utilities) before that; fonts and shapes are Material 3's, text sizes follow the phone's.
- Edge to edge, nothing padded: the activity draws behind the bars and doesn't pad the web view for them. The page
  gets `--sekai-inset-top|right|bottom|left` (CSS pixels, system bars and cutout) on `<html>` whenever they change,
  also for pages that load next (a document-start script). The keyboard shortens the web view once as it opens (as
  in a browser, `interactive-widget=resizes-content`), so the keyboard is never part of `--sekai-inset-bottom`: it's
  the navigation bar's height, and 0 while the keyboard is up (it covers the bar). Keep it that way; a page that
  added the keyboard's height again would leave a gap above it. Native screens use Compose's window insets.
- Back (`ShellState.canHandleBack`): the callback is enabled only while something can use it (a native screen, or
  the page reporting an overlay or a screen to go back to), so the system's predictive back-to-home runs on the root
  screen. Before Android 12 (no predictive back, and the system's back would close the activity and its page) it
  stays enabled and sends the app to the background. Native screens shrink as you swipe them away.
- Feedback goes through `Snacks.show` (Material 3 snackbars; a toast only when no screen is up), the page's alert,
  confirm and prompt are Material 3 dialogs, and `haptic` uses the system's own effects (no permission).
- Notifications: Approve / Deny use `setAuthenticationRequired(true)` and replace their own notification with the
  outcome (it clears itself); the lock screen shows a short placeholder; a call (`USE_FULL_SCREEN_INTENT`, kept on
  purpose: the APK ships outside Play and calls are a core feature) is a CallStyle notification titled with the
  bot's name, with Answer and Decline, ringing until answered, declined or 45 s. Without the full-screen permission
  (Android 14 lets people turn it off) or before Android 12 it's a heads-up notification with the same two buttons.
  Answer opens the chat and the activity clears the notification (`openIntent`'s tag), since buttons don't; the
  full-screen intent opens the chat without clearing it, because the system starts that one itself on a locked phone.
- Debug builds have `GalleryActivity` (in `src/debug`): `adb shell am start -n
  io.github.hazelcaffe.sekai/.GalleryActivity --es screen offline` shows a native screen with made-up state (first,
  first-recent, address-error, address-checking, address-invalid, change, server, about, licence, offline,
  unreachable, untrusted, error, retrying, connecting, webview, snack; `--ez dynamic false` for the teal palette), and
  `--es screen notify-approval` (or `notify-call`, `notify-message`) posts a notification. For calls without the
  full-screen permission: `adb shell appops set io.github.hazelcaffe.sekai USE_FULL_SCREEN_INTENT deny` (`allow` to
  undo).
- Check the phone's emulator with `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` and the page's
  `getComputedStyle(document.documentElement).getPropertyValue('--sekai-inset-top')`, `visualViewport` and `100vh`
  (a web view with `wrap_content` layout params reports 0 for `vh`: keep `match_parent`). Emulators need RAM: stop
  Gradle (`./gradlew --stop`) before running one on a small machine. Back on the root screen leaves the activity
  running only when it was opened from the launcher; opened by `adb shell am start` or a notification, Android
  closes it, as for any app.

## iOS (SwiftUI over UIKit)

`ios/Sekai/`: `App/` (delegates, the router for links, the log), `Server/` (the SwiftUI screens in
`ServerViews.swift` and `AboutView.swift`, the address check, the saved servers), `Web/` (`ShellViewController`
with the web view, its navigation and UI delegates, `PageBridge`, file sharing), `Notifications/`, `SignIn/`.

- One web view per server; native screens cover it. Setup and the connecting, offline and can't-reach states are
  SwiftUI views over the web view (`ConnectionStatusView`, with Try again, pull to refresh and Change server);
  Settings → Server is a sheet (`ServerSettingsView`: Change server, About, Forget this server), and Cancel returns
  to the same page with its draft. Forget removes the address and the web view's data (signed out, as on Android).
- The web view draws edge to edge (`env(safe-area-inset-*)` stays live) and shrinks only for a docked keyboard
  (the keyboard layout guide; on iOS 16 only while the keyboard is up). `--native-font-scale` on `<html>` is the
  Dynamic Type body size relative to the default.
- Back is an edge swipe that starts only while the page has something for it (`backState`, or the web view's history
  for pages that never report; see "Back" above), so on the root screen it never takes the page's touches.
- The page's theme (`theme`) colors the window and status bar and, unless it's Sekai's Auto theme, fixes the native
  sheets, alerts and keyboard to its light or dark; it's remembered so a cold start doesn't flash.
- Notifications: Approve / Deny (`SEKAI_APPROVAL`, authentication required) replace the request with the outcome, for
  Apple pushes too; requests that always ask get a category without actions; with previews hidden they say only "A bot
  needs you", as on Android. `haptic` uses UIKit's feedback generators; `openNotificationSettings` opens the app's
  notification settings.

## Building and testing

- Android: `cd apps/mobile/android && ./gradlew assembleDebug` (JDK 21; SDK in `~/Android/Sdk`). The emulator
  `sekai_phone` (Pixel 8, Android 16): `sg kvm -c "$ANDROID_HOME/emulator/emulator -avd sekai_phone -no-window
  -no-audio -gpu swiftshader_indirect"` (drop `-no-window` to see it), with `TMPDIR` and `ANDROID_TMP` pointing
  somewhere roomy like `~/.cache/android-tmp` (/tmp can be a small in-memory disk, and the emulator's netsimd once
  filled it with a 7.7 GB log); stop it with `adb emu kill` when done. A dev server on this machine is
  `http://10.0.2.2:<port>` from the emulator; screenshots with `adb exec-out screencap -p > shot.png`.
- Android, more: the app id is `applicationId` in `android/app/build.gradle.kts`. Gradle copies `shared/bridge.js`,
  `shared/icon.png` and the repo's `LICENSE` into the assets at build time; the icons in `res/` are made from
  `shared/icon.png` by `android/scripts/icons.sh` (ImageMagick). `./gradlew assembleDebug assembleRelease
  testDebugUnitTest lint` builds both, runs the unit tests and lint. Release builds are minified and signed with
  `SEKAI_KEYSTORE`, `SEKAI_KEYSTORE_PASSWORD`, `SEKAI_KEY_ALIAS` and `SEKAI_KEY_PASSWORD` when `SEKAI_KEYSTORE` is set
  (else with the debug key), to `app/build/outputs/apk/release/`. Debug builds allow remote debugging of the web view:
  `adb forward tcp:9222 localabstract:webview_devtools_remote_$(adb shell pidof io.github.hazelcaffe.sekai)`, then
  chrome://inspect or the DevTools protocol on port 9222. The mic needs a secure context, so test calls at
  `http://localhost:<port>` after `adb reverse tcp:<port> tcp:<port>`.
- iOS: `cd apps/mobile/ios && xcodegen && open Sekai.xcodeproj` on a Mac, or `.github/workflows/mobile.yml` on
  GitHub's Macs (simulator build, unit tests, a smoke test with screenshots, and an unsigned `.ipa` to sign
  yourself). The app id is `SEKAI_APP_ID` in `ios/project.yml`; set your team in Xcode (Signing & Capabilities).
  The smoke test (`ios/scripts/smoke-test.sh`) opens the app with no server, an unreachable one and a real one
  (`ios/scripts/ci-server.sh`: Postgres from Homebrew and this checkout's server, set up with a first account), and
  checks the app's log (`Log.swift`) for bridge.js reaching the app. Launch arguments stand in for a saved server:
  `xcrun simctl launch <udid> <app id> -serverUrl http://127.0.0.1:7420`.
- The simulator interface tests (`ios/SekaiUITests`) use a small page, `ios/scripts/bridge-fixture.html`, on
  `http://127.0.0.1:7491`: they open the server sheet from it, edit the address, open About and cancel back to the
  same page, check both back paths (`__sekaiBack`, then history) and a page that reports `backState`, typing above
  the keyboard, forgetting a server, and a dark Sekai theme on a light phone. Run `bash
  ios/scripts/serve-bridge-fixture.sh` from `apps/mobile` before testing locally; CI runs it for the tests and
  exports their light/dark screenshots alongside the smoke test's. The same page works in the Android app (connect
  it to `http://10.0.2.2:7491`) for checking back by hand.
- The unsigned `.ipa` (`Payload/Sekai.app`, built with `CODE_SIGNING_ALLOWED=NO`) has no entitlements: whoever
  signs it gives it theirs (Xcode, `codesign`, or a sideloading tool). Push needs an Apple team with the Push
  Notifications capability (free personal teams can't), a profile whose `aps-environment` the app reads to tell the
  page "sandbox" or "production", and the server's Apple push key (Settings → Server → Network & devices → Phone notifications) for the same app id.
- Releases: the release workflow calls `mobile.yml` (`workflow_call`, also `workflow_dispatch`) with `version` and
  `build`, which overwrite `version.xcconfig` for that run, and the `ANDROID_KEYSTORE_*` / `ANDROID_KEY_*` secrets
  (a signed release APK; without them a debug one). Artifacts: `sekai-android` (`Sekai-<version>.apk`, or
  `Sekai-<version>-debug.apk`), `sekai-ios` (`Sekai-<version>-unsigned.ipa`) and `ios-screenshots`.
