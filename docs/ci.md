# Desktop CI

Push directly to `main` to run **Latest desktop build** when shipped app files, dependencies, packaging, tests or this workflow change. Documentation, demo-only files and experiments do not trigger a desktop release. Shared player code does, since it also ships in the app. No pull request is required.

Use **Actions → Latest desktop build → Run workflow** on `main` to force a complete run regardless of which files changed. Manual runs on another branch run the same build and tests but do not publish releases. The push path filter in the workflow must stay aligned with `electron-builder.yml` and its build/test scripts. Every published build still passes all desktop tests. Fresh-machine Gatekeeper/SmartScreen interactions and Linux distribution-specific dependencies require separate installer testing; the CI runners are not a substitute for those checks.

After the regular tests and native Go launcher tests, four parallel jobs package and check Apple Silicon Mac, Intel Mac, Windows x64 and Linux x64. **Desktop package smoke tests** check the bundled assets and dependencies. **Desktop lifecycle tests** exercise the packaged application as a whole, using an isolated profile:

1. The bundled app starts and its interface confirms readiness.
2. A staged application update starts successfully.
3. Selecting the previous version restores it and keeps it pinned.
4. A deliberately broken update is rejected and the fallback app relaunches successfully.

Each job builds the full Electron directory for baseline tests, embeds the small application archive in a Go launcher, and verifies the matching official Electron ZIP and checksum. The shipped DMG, portable EXE or AppImage contains that launcher. Building requires Go 1.20 or newer; CI installs the current stable Go release. The launcher uses only the Go standard library. macOS builds also compile a small Cocoa progress window with the system compiler; users do not need developer tools. The Windows loader uses built-in Windows Forms and Linux uses Zenity when installed.

The official runtime ZIP is extracted and prepared with the native launcher’s production code, including macOS branding. The same lifecycle harness then runs against the compact launcher with that verified runtime seeded into an isolated cache. Separate launcher tests exercise first-run downloading, integrity failures, concurrent installation, ZIP safety, runtime switching and pruning. Production download URLs are never redirected to a test server by the shipped launcher. Electron archives are never uploaded to Yinamp releases. The application manifest carries an exact official Electron download URL and pinned checksum/size.

These are integration tests of the packaged runtime; they do not automate the operating system's installer or disk image interface.

They live in `tests/desktop/package-smoke.mjs` and `tests/desktop/lifecycle.mjs`. CI runs them explicitly against a packaged app; `npm test` runs the regular `tests/*.test.mjs` suite. The `scripts/` directory contains build and publishing tools.

The Linux job uses Xvfb for a virtual display. Chromium's `--no-sandbox` flag is restricted to this isolated Linux CI test process; it is not added to the shipped app. Linux download progress uses Zenity when installed and otherwise writes to the terminal; the runtime download still works without Zenity. Linux system library and sandbox requirements remain those of Electron. Automatic update checks are paused in the test profile, so the tests do not fetch the public update feed or depend on releases already being online.

For a manual fresh-download check, set `YINAMP_TEST_COLD_START=1` when running the compact lifecycle harness. It leaves the runtime cache empty, downloads directly from Electron, and then exercises cached restarts and app updates.

All four jobs must pass before `publish` can update the downloads or update feed. A failed job leaves the previous published build available. On failure, a `failure-<platform>` artifact retains process logs, a test report, updater state and startup diagnostics for seven days. Artifacts exclude the full Chromium profile and session data.

## Failure emails

GitHub sends workflow emails through your account settings; the workflow does not need SMTP credentials or an email service.

1. Watch the repository on GitHub.
2. Open [Notification settings](https://github.com/settings/notifications).
3. Under **System → Actions**, enable **Email** and **Only notify for failed workflows**, then save.

This setting applies to your GitHub account and covers the workflow runs you trigger, including your pushes to `main`. It must be enabled in your account; committing this workflow does not change notification preferences.

Reference: [GitHub Actions notifications](https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications).
