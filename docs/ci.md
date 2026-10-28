# Desktop CI

## Independent tests and demo deployment

**Tests** runs on branch pushes, pull requests and manual requests. It is also a reusable workflow called by **Latest desktop build**, so desktop publishing cannot bypass the same JavaScript and Go checks.

**Deploy demo** runs separately after a successful Tests run from this repository's default branch. It checks out the exact tested commit. Failed, cancelled, PR and fork runs cannot deploy. To request a fresh demo deployment, manually run **Tests** on the default branch; a passing run starts deployment. The new workflow triggers take effect after the workflow files are pushed (the demo's `workflow_run` listener must exist on the default branch).

## Desktop packages

**Windows build check** runs immediately on pushes affecting packaging or the launcher, and can also be started manually from Actions on a selected branch. It builds only the Windows portable EXE, caches Electron and packaging downloads, and saves a `windows-installer` artifact for seven days. It does not wait for other platforms, reserve a release version or publish a release. Use it for a shorter packaging feedback loop; the full desktop workflow still runs the lifecycle checks before publishing.

Push directly to `main` to run **Latest desktop build** when shipped app files, dependencies, packaging, tests or this workflow change. Documentation, demo-only files and experiments do not trigger a desktop release. Shared player code does, since it also ships in the app. No pull request is required.

Use **Actions → Latest desktop build → Run workflow** on `main` to force a complete run regardless of which files changed. Manual runs on another branch run the same build and tests, then publish a prerelease without changing the main update feed. Branch pushes do not automatically run the desktop workflow. The push path filter in the workflow must stay aligned with `electron-builder.yml` and its build/test scripts. Every published build still passes all desktop tests. Fresh-machine Gatekeeper/SmartScreen interactions and Linux distribution-specific dependencies require separate installer testing; the CI runners are not a substitute for those checks.

After the regular tests and native Go launcher tests, CI reserves one shared semantic version, then four parallel jobs package and check Apple Silicon Mac, Intel Mac, Windows x64 and Linux x64. **Desktop package smoke tests** check the bundled assets and dependencies. **Desktop lifecycle tests** exercise the packaged application as a whole, using an isolated profile:

1. The bundled app starts and its interface confirms readiness.
2. A staged application update starts successfully.
3. Selecting the previous version restores it and keeps it pinned.
4. A deliberately broken update is rejected and the fallback app relaunches successfully.

Each job builds the full Electron directory for baseline tests, embeds the small application archive in a Go launcher, and verifies the matching official Electron ZIP and checksum. The shipped DMG, portable EXE or AppImage contains that launcher. Building requires Go 1.20 or newer; CI installs the current stable Go release. The launcher uses only the Go standard library. macOS builds also compile a small Cocoa progress window with the system compiler; users do not need developer tools. The Windows loader uses built-in Windows Forms and Linux uses Zenity when installed.

The official runtime ZIP is extracted and prepared with the native launcher’s production code, including macOS branding. The same lifecycle harness then runs against the compact launcher with that verified runtime seeded into an isolated cache. Separate launcher tests exercise first-run downloading, integrity failures, concurrent installation, ZIP safety, runtime switching and pruning. Production download URLs are never redirected to a test server by the shipped launcher. Electron archives are never uploaded to Yinamp releases. The application manifest carries an exact official Electron download URL and pinned checksum/size.

The baseline lifecycle tests exercise the packaged runtime. The macOS installer test additionally mounts the real DMG read-only and copies its app into a disposable Applications folder. It does not drive Finder, use accessibility, or simulate system mouse/keyboard input. Fresh-machine Gatekeeper prompts remain a separate manual check.

They live in `tests/desktop/package-smoke.mjs`, `tests/desktop/lifecycle.mjs` and `tests/desktop/install-uninstall.mjs`. CI runs them explicitly against a packaged app; `npm test` runs the regular `tests/*.test.mjs` suite. The `scripts/` directory contains build and publishing tools.

The Linux job uses Xvfb for a virtual display. Chromium's `--no-sandbox` flag is restricted to this isolated Linux CI test process; it is not added to the shipped app. Linux download progress uses Zenity when installed and otherwise writes to the terminal; the runtime download still works without Zenity. Linux system library and sandbox requirements remain those of Electron. Automatic update checks are paused in the test profile, so the tests do not fetch the public update feed or depend on releases already being online.

For a manual fresh-download check, set `YINAMP_TEST_COLD_START=1` when running the compact lifecycle harness. It leaves the runtime cache empty, downloads directly from Electron, and then exercises cached restarts and app updates.

All four jobs must pass before `publish` can update the downloads or update feed. A failed job leaves the previous published build available. On failure, a `failure-<platform>` artifact retains process logs, a test report, updater state and startup diagnostics for seven days. Artifacts exclude the full Chromium profile and session data.

## Installer-to-uninstall test on macOS

Both Mac build jobs run the real DMG-to-uninstall flow. The test uses a disposable home directory, a uniquely named app copy, and the packaged launcher's normal profile/path checks. It seeds the already verified Electron runtime to keep ordinary runs fast, then waits for the real bootstrap and renderer to become healthy.

The isolated Electron process is started with a loopback Node inspector. Through that internal API, the test finds the real menu item and supplies Cancel followed by Uninstall. Only the external confirmation response is stubbed inside that debug process; normal launches expose neither a debug endpoint nor a confirmation bypass. Cancel must leave the running process, installation and profile intact. Confirmed uninstall must exit Electron and let the actual native helper move both the app and profile to Trash, with their contents preserved. The helper reports the exact moved paths. The test verifies its unique markers before removing only those disposable Trash entries; it never enumerates or empties the user's Trash.

Run locally after packaging:

```sh
node tests/desktop/install-uninstall.mjs \
  release/Yinamp-latest-mac-arm64.dmg \
  release/checked-runtime-darwin-arm64 \
  release/mac-arm64/Yinamp.app/Contents/Resources/app.asar
```

Set `YINAMP_INSTALL_COLD_START=1` for a full first-launch download from official Electron releases instead of seeding the runtime. This optional network check is not repeated in every CI run. `YINAMP_INSTALL_TEST_OUTPUT` selects the report/log directory. Reports exclude the full profile and session data.

## Automatic versions

`package.json` supplies the minimum intended stable version. Each main build reserves the next patch after all existing stable versions, unless the file requests a higher minor/major version. For example, with `1.2.0` in the file and `1.2.8` already used, CI chooses `1.2.9`; changing the file to `1.3.0` starts that series. Existing legacy releases are included when computing the next version.

Allocation atomically creates a `desktop-v<version>` GitHub tag pointing to the workflow commit. If another build reserves the same version first, allocation retries. Failed builds leave their reservation in place, so patch numbers can have gaps. The single version-job output is passed to all platform packages and their update manifests. No source version files or branches are modified, avoiding routine merge conflicts. Only deliberate minor/major source edits need manual conflict resolution.

Branch builds reserve `<next-stable>-<branch>.<run-number>.<attempt>` versions, with the branch name normalized for semver. These do not consume the next stable version. They publish only their immutable prerelease; main builds publish stable releases and also refresh `latest-build`. Neither a failed matrix nor a branch preview can replace the main update feed. The workflow token needs write permission to reserve version tags and publish releases. Tags protected by repository rules must permit these reservations.

## Failure emails

GitHub sends workflow emails through your account settings; the workflow does not need SMTP credentials or an email service.

1. Watch the repository on GitHub.
2. Open [Notification settings](https://github.com/settings/notifications).
3. Under **System → Actions**, enable **Email** and **Only notify for failed workflows**, then save.

This setting applies to your GitHub account and covers the workflow runs you trigger, including your pushes to `main`. It must be enabled in your account; committing this workflow does not change notification preferences.

Reference: [GitHub Actions notifications](https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications).
