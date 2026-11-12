# Desktop CI

## Workflows

| Workflow | File | Runs when |
|---|---|---|
| **Tests** | `tests.yml` | every push to every branch, or manually |
| **Publish desktop** | `latest-build.yml` | after Tests passes for a push to `main`, or manually on any branch |
| **Deploy demo** | `pages.yml` | after Tests passes for a push to `main`, or manually on `main` |
| **Windows build check** | `windows-build.yml` | branch pushes that touch Windows packaging, or manually |

Publish desktop and Deploy demo start through GitHub's `workflow_run` trigger, so they reuse the Tests result instead of running the tests again. They check out the exact commit Tests passed (`workflow_run` otherwise runs on the latest `main`). GitHub always uses the copy of a `workflow_run` workflow from `main`, so edits to these two files take effect automatically only after merging; on a branch, test them with a manual run.

Before pushing workflow changes, run `npm run lint:workflows` (needs `brew install actionlint shellcheck`). It checks syntax, `${{ }}` expressions, runner labels and the shell code in `run:` steps, which GitHub otherwise only reports when that step runs.

Publish desktop keeps the `latest-build.yml` file name on purpose: installed apps order updates by its run number, and renaming the file would restart the counter.

**Skipping unchanged commits.** On `main`, `scripts/ci-changes.mjs` compares the tested commit with the last published one (the `latest-build` tag for desktop, `version.json` on the live site for the demo). Shared UI, skin, dependency and workflow changes select both; launcher, Electron and desktop packaging changes select desktop; `src/pages-demo.js` and the Pages build script select only the demo. Documentation-only commits are tested but not published. Because the comparison is against the last *published* commit, changes in a commit that was skipped, cancelled or failed are still picked up by the next one. Manual runs always publish.

**Manual runs.** Actions → Publish desktop → Run workflow. On `main` it publishes normally; on another branch it publishes a prerelease preview and leaves `latest-build` unchanged. Publishing is serialized, and a stale `main` commit is not published.

## Desktop packages

**Windows build check** remains a fast branch/manual packaging check. Its push trigger excludes `main`, where the full desktop pipeline already packages Windows. It uses the same reusable **Package desktop target** workflow as the desktop matrix, with full lifecycle tests disabled and a `windows-installer` artifact. The Windows packaging caches are shared by both callers. It does not publish a release.

The full desktop matrix uses **Package desktop target** with all native launcher, smoke, lifecycle and installer checks enabled. All targets receive the same git-derived version. Fresh-machine Gatekeeper/SmartScreen interactions and Linux distribution-specific dependencies require separate installer testing; the CI runners are not a substitute for those checks.

After the regular tests and native Go launcher tests, CI computes the version, then four parallel jobs package and check Apple Silicon Mac, Intel Mac, Windows x64 and Linux x64. **Desktop package smoke tests** check the bundled assets and dependencies. **Desktop lifecycle tests** exercise the packaged application as a whole, using an isolated profile:

1. The bundled app starts and its interface confirms readiness.
2. A staged application update starts successfully.
3. Selecting the previous version restores it and keeps it pinned.
4. A deliberately broken update is rejected and the fallback app relaunches successfully.

Each job builds the full Electron directory for baseline tests, embeds the small application archive in a Go launcher, and verifies the matching official Electron ZIP and checksum. The shipped DMG, portable EXE or AppImage contains that launcher. Building requires Go 1.20 or newer; CI installs the current stable Go release. The launcher uses only the Go standard library. macOS builds also compile a small Cocoa progress window with the system compiler; users do not need developer tools. The Windows loader uses built-in Windows Forms and Linux uses Zenity when installed.

The official runtime ZIP is extracted and prepared with the native launcher’s production code, including macOS branding. The same lifecycle harness then runs against the compact launcher with that verified runtime seeded into an isolated cache. Separate launcher tests exercise first-run downloading, integrity failures, concurrent installation, ZIP safety, runtime switching and pruning. Production download URLs are never redirected to a test server by the shipped launcher. Electron archives are never uploaded to Yinamp releases. The application manifest carries an exact official Electron download URL and pinned checksum/size.

The baseline lifecycle tests exercise the packaged runtime. The macOS installer test additionally mounts the real DMG read-only and copies its app into a disposable Applications folder. It does not drive Finder, use accessibility, or simulate system mouse/keyboard input. Fresh-machine Gatekeeper prompts remain a separate manual check.

macOS GUI tests first probe permission to access Launch Services and WindowServer. A sandbox that explicitly denies either service fails the test before Electron is launched, rather than causing an AppKit registration crash and a macOS crash dialog. This is a test failure, not a skipped or passing check; run GUI validation on the native Mac CI runners or from an unrestricted Terminal session. The probe uses the system compiler and affects only test processes.

They live in `tests/desktop/package-smoke.mjs`, `tests/desktop/lifecycle.mjs` and `tests/desktop/install-uninstall.mjs`. CI runs them explicitly against a packaged app; `npm test` runs the regular `tests/*.test.mjs` suite. The `scripts/` directory contains build and publishing tools.

The Linux job uses Xvfb for a virtual display. Chromium's `--no-sandbox` flag is restricted to this isolated Linux CI test process; it is not added to the shipped app. Linux download progress uses Zenity when installed and otherwise writes to the terminal; the runtime download still works without Zenity. Linux system library and sandbox requirements remain those of Electron. Automatic update checks are paused in the test profile, so the tests do not fetch the public update feed or depend on releases already being online.

For a manual fresh-download check, set `YINAMP_TEST_COLD_START=1` when running the compact lifecycle harness. It leaves the runtime cache empty, downloads directly from Electron, and then exercises cached restarts and app updates.

The Mac bundles are then merged into a universal launcher and universal progress helper with `lipo`, signed again, and packaged as `Yinamp-latest-mac-universal.dmg`. Both native Mac runners test that exact DMG, including a fresh Electron download, installation/uninstall, and cached-runtime update/rollback lifecycle checks. Separate architecture DMGs remain available as fallbacks. All build and universal-test jobs must pass before `publish` can update the downloads or update feed. A failed job leaves the previous published build available. On failure, a `failure-<platform>` artifact retains process logs, a test report, updater state and startup diagnostics for seven days. Artifacts exclude the full Chromium profile and session data.

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

Set `YINAMP_INSTALL_COLD_START=1` for a full first-launch download from official Electron releases instead of seeding the runtime. The universal DMG tests run this network check on both native Mac runners. `YINAMP_INSTALL_TEST_OUTPUT` selects the report/log directory. Reports exclude the full profile and session data.

The test also verifies that the native launcher, Electron and its helpers exit after uninstall. Set `YINAMP_INSTALL_LAUNCHSERVICES=1` to launch through macOS as Finder does; local macOS privacy settings may prevent the test from inspecting its resulting Trash entries.

## Automatic versions

The version follows the code. `package.json` sets major.minor (and a starting patch, normally `0`); every commit on `main`'s first-parent line since that version was set adds one patch. A merge commit counts once, however many commits it brings in, so merge branches with `--no-ff`. Bump the minor in `package.json` for breaking changes or major features; the patch then restarts. `scripts/desktop-version.mjs` computes it from git history, so it needs a full clone (`fetch-depth: 0`).

Every commit has a version even when nothing is published, so the published releases can skip numbers. A rerun of the same commit gets the same version. No tags are reserved and nothing is written back to the repository. The demo and desktop builds of a commit show the same version.

Branch builds use `<version>-<branch>.<run-number>.<attempt>`, with the branch name normalized for semver. They publish only their own prerelease; `main` builds publish stable releases and also refresh `latest-build`. Neither a failed build nor a branch preview can replace the main update feed. Do not rewrite `main`'s history: that would change the count.

## Failure emails

GitHub sends workflow emails through your account settings; the workflow does not need SMTP credentials or an email service.

1. Watch the repository on GitHub.
2. Open [Notification settings](https://github.com/settings/notifications).
3. Under **System → Actions**, enable **Email** and **Only notify for failed workflows**, then save.

This setting applies to your GitHub account and covers the workflow runs you trigger, including your pushes to `main`. It must be enabled in your account; committing this workflow does not change notification preferences.

Reference: [GitHub Actions notifications](https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications).

Mac builds default to universal; `--arm64` and `--x64` still build individual fallback packages. Build one universal Mac DMG locally with `npm run build:desktop -- --mac --universal` (`--dir` skips DMG creation). This builds both compact launchers and preserves their separate embedded payloads; Electron is still downloaded only for the running architecture.
