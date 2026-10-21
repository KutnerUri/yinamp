# Auto-update plan

Current downloads update on GitHub; installed copies update only when downloaded again. This plan adds update checks first, then installation once the packages support it.

## 1. Offer updates in the app

- Embed the source commit and CI run number into each packaged app.
- Add **Check for updates…** to the app menu, plus a quiet check after startup. Check only in packaged builds, with a timeout and no overlapping requests.
- Read the published release's `BUILD-INFO.json`. Compare commit IDs and increasing run numbers: the current rolling builds all report `1.2.0`, so comparing package versions alone misses updates.
- Show a small **New build available — Download** notice linking to the existing release. Keep playback running, allow dismissal, and retry failures later without interrupting the player. Never treat unavailable metadata as an update.
- Keep this manual-download path for unsigned macOS builds and portable Windows builds.

## 2. Prepare packages for installation

- Use `electron-updater`, matching the pinned electron-builder v26 setup. Give each build an increasing prerelease version such as `1.2.1-alpha.<run_number>`; keep commit IDs for diagnostics. A rollback is a new, higher-version build of the earlier source.
- macOS: obtain Developer ID signing credentials, sign and notarize the app, and produce both DMG and ZIP downloads. The v26 updater requires the ZIP alongside the DMG, and macOS requires a signed app.
- Windows: add a signed per-user NSIS installer for users who want updates. Keep the portable EXE as a separate manual-download option.
- Linux: use electron-updater's AppImage support, with a manual fallback when the installed file cannot be replaced.
- Publish versioned package filenames, blockmaps and update manifests only after every platform passes checks. Merge both Mac architectures into the macOS update metadata rather than overwriting one with the other. Keep the friendly rolling download links for first-time installs.
- Keep old update packages available long enough for clients that have already fetched their manifests. Replacing all files under fixed names can race with a client downloading an older manifest.

## 3. Add the install flow

- Start with one explicit **Preview** channel matching today's rolling builds. Add **Stable** later as a separate feed; do not silently switch users between channels.
- Offer **Download update**, then **Restart to update** when ready. Do not restart during playback or silently install on quit. Save the queue, layout and settings before an approved restart.
- Leave the current app usable after offline checks, rate limits, cancelled downloads or failed installation. Preserve user data and show a retry or manual-download link.
- Test upgrading between two real packaged versions on Apple Silicon, Intel Mac, Windows and Linux, including offline checks, interrupted downloads, unsupported versions, and a running playlist.

First implementation: update notification with a download link. Automatic installation follows signing and packaging setup; it needs a separate end-to-end release test before enabling it for users.

References: [electron-builder v26 auto-update](https://www.electron.build/v26/docs/features/auto-update/), [v26 targets](https://www.electron.build/v26/docs/targets/), [v26 update channels](https://www.electron.build/v26/docs/tutorials/release-using-channels/).
