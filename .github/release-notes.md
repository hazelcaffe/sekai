## Install

**The server** (the part everything else connects to): with Docker,
`docker pull ghcr.io/{repo}:{version}`, or follow [installing Sekai](https://github.com/{repo}/blob/main/docs/install.md).

| App               | Download                                                                   | Notes                                                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows           | `Sekai-{version}-setup-x64.exe` (installer) or `-portable-x64.exe`         | Not signed yet: in the SmartScreen prompt, choose **More info → Run anyway**.                                                                                               |
| macOS             | `Sekai-{version}-arm64.dmg` (Apple silicon) or `-x64.dmg` (Intel)          | Not notarized: the first time, open it from **System Settings → Privacy & Security → Open anyway**.                                                                         |
| Linux             | `Sekai-{version}-x86_64.AppImage`, `sekai_{version}_amd64.deb` (and arm64) |                                                                                                                                                                             |
| Android           | `Sekai-{version}.apk`                                                      | Allow installing from your browser or file manager when Android asks.                                                                                                       |
| iPhone and iPad   | `Sekai-{version}-unsigned.ipa`                                             | Unsigned: sign it with your own certificate (Xcode, or a sideloading tool), or build it from source. Push needs an Apple developer team.                                    |
| Browser extension | `sekai-chromium-{version}.zip`, `sekai-firefox-{version}.zip`, Safari      | Chromium: unzip, then **Load unpacked** in developer mode. Firefox: a temporary add-on until it's signed. Safari: an unsigned macOS app, or the source to build with Xcode. |

The apps ask for your server's address on first start. The desktop app updates itself from your server after
that (`bun run --cwd apps/desktop publish:local`). For notifications on phones while the app is closed, set up
**Admin → Phone apps**.

`SHA256SUMS.txt` has every file's checksum (`sha256sum -c SHA256SUMS.txt`).
