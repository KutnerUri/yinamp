# Desktop CI

Push directly to `main` to run **Latest desktop build** when shipped app files, dependencies, packaging, tests or this workflow change. Documentation, demo-only files and experiments do not trigger a desktop release. Shared player code does, since it also ships in the app. No pull request is required.

Use **Actions → Latest desktop build → Run workflow** on `main` to force a complete run regardless of which files changed. The push path filter in the workflow must stay aligned with `electron-builder.yml` and its build/test scripts. Every published build still passes all desktop tests.

After the regular tests, four parallel jobs package and check Apple Silicon Mac, Intel Mac, Windows x64 and Linux x64. **Desktop package smoke tests** check the bundled assets and dependencies. **Desktop lifecycle tests** exercise the packaged application as a whole, using an isolated profile:

1. The bundled app starts and its interface confirms readiness.
2. A staged application update starts successfully.
3. Selecting the previous version restores it and keeps it pinned.
4. A deliberately broken update is rejected and the fallback app relaunches successfully.

These are integration tests of the packaged runtime; they do not automate the operating system's installer or disk image interface.

The Linux job uses Xvfb for a virtual display. Chromium's `--no-sandbox` flag is restricted to this isolated Linux CI test process; it is not added to the shipped app. Automatic update checks are paused in the test profile, so the tests do not fetch the public update feed or depend on releases already being online.

All four jobs must pass before `publish` can update the downloads or update feed. A failed job leaves the previous published build available. On failure, a `failure-<platform>` artifact retains process logs, a test report, updater state and startup diagnostics for seven days. Artifacts exclude the full Chromium profile and session data.

## Failure emails

GitHub sends workflow emails through your account settings; the workflow does not need SMTP credentials or an email service.

1. Watch the repository on GitHub.
2. Open [Notification settings](https://github.com/settings/notifications).
3. Under **System → Actions**, enable **Email** and **Only notify for failed workflows**, then save.

This setting applies to your GitHub account and covers the workflow runs you trigger, including your pushes to `main`. It must be enabled in your account; committing this workflow does not change notification preferences.

Reference: [GitHub Actions notifications](https://docs.github.com/en/subscriptions-and-notifications/how-tos/managing-github-actions-notifications).
