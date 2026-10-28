# DMG first-launch guide

`background.jpg` is the Finder window background configured in `electron-builder.yml`.
The top 130 pixels are reserved for Finder's real app and Applications icons.
The guide covers only the first-launch Gatekeeper approval, not installation steps.

Regenerate on macOS from the repository root (requires internet; no desktop interaction):

```sh
swift scripts/render-dmg-guide.swift
```

The renderer downloads Apple’s example screenshots directly; source PNGs are not stored.
Their “Example App” wording is preserved.
Source: https://support.apple.com/en-il/102445 (retrieved 2026-10-28).

- `blocked.png`: https://cdsassets.apple.com/live/7WUAS350/images/macos/sequoia/macos-sequoia-app-not-opened-could-not-verify-free-from-malware.png
- `settings.png`: https://cdsassets.apple.com/live/7WUAS350/images/macos/sequoia/macos-sequoia-system-settings-privacy-and-security-open-app-anyway.png

Orange outlines identify Done, Privacy & Security, and Open Anyway. The guide
never removes quarantine, changes security settings, or launches a helper.
