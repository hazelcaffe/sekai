## Install

- **Chromium (Chrome, Edge, Brave, Vivaldi):** unzip the Chromium download, open your browser's extensions page,
  enable developer mode and choose **Load unpacked**. Select the folder containing `manifest.json`.
- **Firefox:** unzip the Firefox download. For development, open `about:debugging` → This Firefox → Load Temporary
  Add-on and select `manifest.json`. Temporary installs disappear when Firefox closes. Permanent distribution
  requires Mozilla signing; these release ZIPs are **not signed XPI installers**.
- **Safari:** `sekai-safari-macos-unsigned-*.zip` contains an **unsigned macOS host app**, compiled by Xcode in CI.
  It is not signed or notarized and won't install like a normal App Store download. For a normal installation,
  sign the app/extension with your own Apple development team; the source route below lets Xcode do that. The
  macOS app is universal (Apple Silicon and Intel); it is **not an iOS installer**.
  `sekai-safari-webextension-source-*.zip` is **WebExtension source, not an installable or signed Safari app**. Unzip it
  and run `xcrun safari-web-extension-converter /path/to/unzipped/source --app-name Sekai --bundle-identifier
  your.reverse.domain.sekai`. Open the generated project in Xcode, choose your signing team, build and enable the
  extension in Safari Settings → Extensions. Use its popover or Pop out; Safari has no equivalent sidebar API.

In Sekai, open **Settings → You → Browser extension**, make a browser token and paste it and your server address into
the extension. Choose your bot and chat, then explicitly share tabs. No tabs are shared automatically. Stop
sharing or close the panel to end control. The server must include the matching browser-extension support.

See `apps/extension/README.md` for permissions, privacy, capabilities, limitations and testing. `SHA256SUMS.txt`
contains SHA-256 checksums of all release ZIPs. These downloads aren't Chrome Web Store or Mozilla/Safari store
releases; store signing and submission are separate.
