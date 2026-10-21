# Desktop updates

Yinamp downloads application updates quietly, then switches on the next launch. It never restarts itself during normal use. The installed Electron runtime stays in place, so unsigned macOS apps do not need to be replaced for ordinary code updates. No Apple developer account or paid signing service is required for this mechanism.

## Yinamp → Updates

- **Check for updates…** checks immediately. Automatic attempts happen at most once per rolling 24 hours, with an additional random delay of 30 seconds to five minutes. The appointment and last attempt persist across restarts, including failed/offline attempts. Manual checks are always available and also postpone the next automatic attempt for at least 24 hours. Re-enabling automatic updates respects the same limit. Recent build history is cached locally; refreshing it explicitly is a separate user action.
- **Restart to update** switches to a downloaded build now; otherwise it waits until the next launch.
- **Automatic updates** is checked when following new builds. Turn it off to stay on the current build and cancel a staged update; the label changes to **Automatic updates disabled**. Turn it on to resume checking for the latest build.
- **Use specific version** shows the checked current build and up to five other builds, including the previous local build when available. Selecting a build schedules it for the next launch and disables automatic updates, so the selection stays in place. Cached builds can be selected offline. Selecting the current build keeps it and cancels a staged update. **Refresh** reloads the recent list; **All builds on GitHub…** opens the complete history. Builds sharing an application version are distinguished by their build number.
- **Download desktop app…** appears only when the updater encounters a build that requires a different desktop runtime.

## Startup and recovery

`pnpm desktop` shows the same menu as a development preview. **Check for updates…**, **Refresh** and **All builds on GitHub…** work on demand. Automatic checks, version installation and restart-to-update are disabled. Preview state is memory-only and does not change the packaged app's update settings or replace source files.

The bundled launcher reads update settings from the `updates` subfolder of the normal Electron user-data directory. The queue, layout and YouTube session keep their existing locations. Only one packaged instance can use a profile at a time.

A staged archive becomes a trial on the next launch. Before activation, its size and SHA-256 checksum are checked again and the current queue/settings file is backed up. The application must acknowledge that its interface finished initializing, then survive a ten-second grace period. A one-minute watchdog relaunches the previous build if startup never completes. If the process crashes or is killed during the trial, the next launch rejects that build and restores the previous app and settings snapshot. Two consecutive unclean exits after a successful trial also trigger fallback; a clean exit resets this counter. Power loss or force quit can therefore count as an unclean exit.

A build that failed is excluded from automatic retry, but the user can explicitly select it again. The current, previous and staged builds are retained locally; obsolete cached builds are removed after a healthy launch. The application originally bundled with the launcher remains a fallback. If updater storage itself fails, the launcher attempts to open that bundled application without updates.

Restart waits for a renderer settings flush and the main process's pending writes. A broken renderer gets a bounded two-second wait; the last successful save remains available.

These checks catch startup failures, corruption and repeated crashes. They cannot certify every playback feature or detect every behavioral regression. The previous build remains available under **Use specific version** for those cases. Updates must preserve backward compatibility with saved settings and cookies; only the queue/settings file is backed up automatically.

## Publishing and trust

CI embeds the commit, workflow run number, attempt, package version and Electron version into each desktop package. After all platforms pass tests and packaged-asset checks, it publishes a separate `build-<run ID>-<attempt>` prerelease containing the full desktop downloads, four application ASAR payloads, checksums and `UPDATE.json`.

The rolling `latest-build` release is updated afterward. Its update manifest is uploaded last and points to the completed versioned release. Published versioned payloads are never overwritten by the workflow. Keeping them available avoids mixing an older manifest with a newer download and lets users select older builds.

The updater accepts manifests and payload URLs only from this project's GitHub release paths, follows only HTTPS redirects to GitHub's asset hosts, bounds download size/time, and verifies the payload checksum before staging and before launch. The trust root is the GitHub repository and HTTPS; this is not Apple code signing or independent release-signature verification. No GitHub token is shipped in the application.

A payload must match the installed Electron version and launcher protocol. Incompatible builds require a fresh DMG/EXE/AppImage download. Installing the newer shell over the old copy preserves normal user data. The first launcher-enabled version also needs this one-time manual install; older copies cannot gain an updater on their own.

## Validation and remaining rollout checks

Automated tests cover staging, restart activation, locking, pausing, rollback, failed startup, repeated crashes, settings restoration, corrupt archives, bad metadata, incompatible runtimes and constrained downloads. Packaged macOS startup is also tested with an isolated profile.

Before relying on production distribution, run the GitHub workflow and verify a real published upgrade between two builds on each supported OS. Windows, Linux and Intel Mac packaging and relaunch behavior still require their respective native runs. This release does not add stable channels; numbered builds are sufficient for now.

References: [Electron ASAR support](https://www.electronjs.org/docs/latest/tutorial/asar-archives), [Electron relaunch](https://www.electronjs.org/docs/latest/api/app#apprelaunchoptions), [Electron user data](https://www.electronjs.org/docs/latest/api/app#appgetpathname).
