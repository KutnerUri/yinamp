# Desktop updates

Yinamp ships a small native launcher with its initial application archive. Electron is a separate download: on first launch the launcher shows a compact progress window with four stages (download, check, unpack, prepare), downloads the required runtime directly from the official Electron GitHub release, verifies its pinned checksum, installs it in the user's profile, and starts the app. Subsequent launches reuse it without a network request. No Node.js installation or administrator access is needed for runtime storage.

Application updates still download quietly and switch on the next launch. If a build needs a different Electron version, the launcher downloads that runtime automatically before opening the new build. It never restarts a running player without the user's request. The first launch requires internet access; later offline launches work with cached app/runtime pairs. These builds remain unsigned by a trusted publisher; operating-system security policies can warn or block execution. The private cached macOS runtime is branded as Yinamp after verifying the official archive. The launcher uses the built-in macOS codesign tool to give the modified bundle an ad-hoc signature; no Apple developer account, certificate or developer tools are required. This does not provide Developer ID trust or notarization.

## Yinamp → Updates

- **Check for updates…** checks immediately. Automatic attempts happen at most once per rolling 24 hours, with an additional random delay of 30 seconds to five minutes. The appointment and last attempt persist across restarts, including failed/offline attempts. Manual checks are always available and also postpone the next automatic attempt for at least 24 hours. Re-enabling automatic updates respects the same limit. Recent build history is cached locally; refreshing it explicitly is a separate user action.
- **Restart to update** switches to a downloaded build now; otherwise it waits until the next launch.
- **Automatic updates** is checked when following new builds. Turn it off to stay on the current build and cancel a staged update; the label changes to **Automatic updates disabled**. Turn it on to resume checking for the latest build.
- **Use specific version** shows the checked current build and up to five other builds, including the previous local build when available. Selecting a build schedules it for the next launch and disables automatic updates, so the selection stays in place. Cached builds can be selected offline. Selecting the current build keeps it and cancels a staged update. **Refresh** reloads the recent list; **All builds on GitHub…** opens the complete history. Builds sharing an application version are distinguished by their build number.
- **Download desktop app…** remains available to older, bundled-runtime installations when a build needs a different runtime. Compact installations handle runtime changes automatically when the manifest includes a supported runtime descriptor.

## Startup and recovery

`pnpm desktop` shows the same menu as a development preview. **Check for updates…**, **Refresh** and **All builds on GitHub…** work on demand. Automatic checks, version installation and restart-to-update are disabled. Preview state is memory-only and does not change the packaged app's update settings or replace source files.

The stable Electron bootstrap reads update settings from the `updates` subfolder of the normal Electron user-data directory. The queue, layout and YouTube session keep their existing locations. Only one packaged instance can use a profile at a time.

A staged archive becomes a trial on the next launch. Before activation, its size and SHA-256 checksum are checked again and the current queue/settings file is backed up. The application must acknowledge that its interface finished initializing, then survive a ten-second grace period. A one-minute watchdog relaunches the previous build if startup never completes. If the process crashes or is killed during the trial, the next launch rejects that build and restores the previous app and settings snapshot. Two consecutive unclean exits after a successful trial also trigger fallback; a clean exit resets this counter. Power loss or force quit can therefore count as an unclean exit.

A build that failed is excluded from automatic retry, but the user can explicitly select it again. The current, previous and staged builds are retained locally; obsolete cached builds are removed after a healthy launch. The application originally embedded in the native launcher remains a fallback. The launcher retains its runtime and the runtimes required by the active, previous, staged and pinned builds; it removes unused versions after a healthy session exits. Runtime downloads are installed atomically under an OS file lock, so concurrent launches cannot install partial runtimes. A failed runtime download or a native failure before the new runtime starts the bootstrap leaves cached working versions intact and attempts to restore the previous app. If updater storage itself fails, the launcher attempts to open that bundled application without updates.

Restart waits for a renderer settings flush and the main process's pending writes. A broken renderer gets a bounded two-second wait; the last successful save remains available.

These checks catch startup failures, corruption and repeated crashes. They cannot certify every playback feature or detect every behavioral regression. The previous build remains available under **Use specific version** for those cases. Updates must preserve backward compatibility with saved settings and cookies; only the queue/settings file is backed up automatically.

## Publishing and trust

CI embeds the commit, workflow run number, attempt, package version and Electron version into each desktop package. After all platforms pass tests and packaged-asset checks, it publishes a separate `build-<run ID>-<attempt>` prerelease containing the compact desktop downloads, four application ASAR payloads, checksums and `UPDATE.json`. Builds read the official Electron release’s `SHASUMS256.txt`, download and verify the matching archive using Electron’s installer library, and embed its official URL, checksum and size in the application metadata. Users download that archive directly from `electron/electron` releases. Yinamp does not host or publish runtime archives. The descriptor revision identifies the local preparation contract, currently revision 2.

The rolling `latest-build` release is updated afterward. Its update manifest is uploaded last and points to the completed versioned release. Published versioned payloads are never overwritten by the workflow. Keeping them available avoids mixing an older manifest with a newer download and lets users select older builds.

The updater accepts manifests and payload URLs only from this project's GitHub release paths, follows only HTTPS redirects to GitHub's asset hosts, bounds download size/time, and verifies the payload checksum before staging and before launch. The trust root is the GitHub repository and HTTPS; this is not Apple code signing or independent release-signature verification. No GitHub token is shipped in the application.

A compact installation accepts a different Electron version only when the manifest supplies a valid platform-specific runtime descriptor. Runtime URLs are restricted to the exact official Electron version/platform archive, redirect hosts are restricted to GitHub, and compressed/expanded sizes and SHA-256 checksums are bounded and checked. ZIP extraction rejects traversal and escaping symlinks. Runtime preparation happens before startup-trial bookkeeping, so changing runtimes does not count as a failed launch.

The native supervisor passes its embedded bootstrap archive to the official Electron executable as the application argument. There is no custom shim inside the runtime. The bootstrap chooses and verifies the application, then requests a runtime handoff if needed. Exit codes 75, 76 and 77 signal runtime handoff, restart and bundled-app recovery respectively. Normal application exits stop the supervisor. All relaunch paths return through the supervisor, preserving runtime selection.

Older bundled-runtime installations retain the exact-version compatibility rule and need a one-time manual DMG/EXE/AppImage installation to gain the native launcher. Installing the compact launcher preserves the existing profile. The native launcher itself is not self-updating in this version: a future launcher/protocol change would require another installer download.

## Validation and remaining rollout checks

The Go launcher tests cover first download, offline cache reuse, concurrent installation, corrupt downloads, unsafe archives, runtime handoffs and cleanup. Application tests cover staging, restart activation, locking, pausing, rollback, failed startup, repeated crashes, settings restoration, corrupt archives, bad metadata, incompatible runtimes and constrained downloads. The existing desktop lifecycle harness also runs through the compact launcher on each CI target, seeding a local runtime to avoid depending on an unpublished release. It checks startup, application activation, manual rollback and broken-build recovery.

Before relying on production distribution, run the GitHub workflow and verify a real published upgrade between two builds on each supported OS. Windows, Linux and Intel Mac packaging and relaunch behavior still require their respective native runs. This release does not add stable channels; numbered builds are sufficient for now.

References: [Electron ASAR support](https://www.electronjs.org/docs/latest/tutorial/asar-archives), [Electron relaunch](https://www.electronjs.org/docs/latest/api/app#apprelaunchoptions), [Electron user data](https://www.electronjs.org/docs/latest/api/app#appgetpathname).

## Uninstalling on macOS

Choose **Yinamp → Uninstall Yinamp…** in the installed compact app. The confirmation defaults to Cancel. Confirming quits Electron, then moves the launcher app and the Yinamp Application Support folder to Trash, including downloaded runtimes, updates, playlists, settings, and sign-in data. The option is not offered for development or custom test profiles. Dragging the app to Trash manually does not remove its Application Support folder.
