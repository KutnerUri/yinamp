# DMG first-launch guide

`background.jpg` is the Finder window background configured in `electron-builder.yml`.
The top panel holds Finder's real Yinamp and Applications icons with a dot-matrix drag arrow
between them, styled like the player's LCD.
Each icon sits on a mid-gray tile (`#7c7e91`) because Finder draws labels black in Light
mode and white in Dark mode; both are readable on it. Colors come from `skins/classic.json`.
Below it, a three-action guide covers only the first-launch Gatekeeper approval.
Proportions follow the golden ratio φ: the panel spans the guide's width and is 1 : φ³ tall,
the arrow's 3-dot shaft to its 33-dot length is about 1 : φ⁵, and tile padding to arrow gap is φ : 1.
The window size and icon centers in `electron-builder.yml` must match the renderer, which
prints the icon centers it computed.
Finder's title bar hides about 28 px of the window height, so the renderer fails if
the guide would reach the bottom 30 px.

Regenerate on macOS from the repository root (requires internet; no desktop interaction):

```sh
swift scripts/render-dmg-guide.swift
```

The renderer downloads Apple’s example screenshots directly; source PNGs are not stored.
Their “Example App” wording is preserved.
Source: https://support.apple.com/en-il/102445 (retrieved 2026-10-28).

- `blocked.png`: https://cdsassets.apple.com/live/7WUAS350/images/macos/sequoia/macos-sequoia-app-not-opened-could-not-verify-free-from-malware.png
- `settings.png`: https://cdsassets.apple.com/live/7WUAS350/images/macos/sequoia/macos-sequoia-system-settings-privacy-and-security-open-app-anyway.png

Thin dark rings with numbered badges (1–3) mark Done, Privacy & Security, and Open Anyway. The guide
never removes quarantine, changes security settings, or launches a helper.
