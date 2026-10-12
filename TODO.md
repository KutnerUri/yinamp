# Work queue and completion record

Updated: 2026-10-12. Work proceeds in the order below. Checked items have
implementation/test evidence or an explicit user confirmation. An unchecked
verification item is not a claim that its implementation is missing.

## 1. Inline music library and playlist loading — complete

- [x] Add a permanent Winamp-style library below the player and queue.
- [x] Provide My Playlists, Mixes, and Discover; exclude podcast entries and shelves.
- [x] Remove the legacy demo prefix; start new queues empty.
- [x] Replace the queue only after a playlist loads successfully; preserve it on failure/cancel.
- [x] Verify real public discovery and an 80-song playlist with desktop playback.
- [x] Verify 30-minute catalog and playlist caches, expiry, refresh bypass, and account invalidation.
- [x] Finish regression checks, documentation, and test-process cleanup.

Evidence so far: `tests/library.test.mjs`, `tests/core.test.mjs`, controlled
browser/desktop checks, and live public discovery loading an 80-song playlist.
Final checks: 45 tests pass; browser/narrow-layout checks pass; desktop checks
prove cached repeat opens, refresh bypass, sign-out invalidation, failure/cancel
preservation, podcast filtering and playback while scrolling. All owned test
instances exited; the user's running desktop app was left open.
Private-account library behavior has controlled test coverage; live verification
against the user's own catalog is recorded separately below.

### 1a. Library artwork and new-only discovery — awaiting confirmation

- [ ] Center the card design on 135 × 135 px previews (2.6× the current 52 px artwork), with titles beneath.
- [ ] Remove the repeated owner name from My Playlists; retain track counts.
- [ ] Exclude created and saved library playlist IDs from Discover, so it presents new suggestions.
- [ ] Preserve 30-minute caching; refresh the exclusion set together with the catalog on explicit Refresh/account changes.
- [ ] Check account-info recovery during a fresh start and when returning focus; avoid replacing a known player avatar with incomplete library identity metadata.

The user reported that user info temporarily showed a generic icon with "Signed
in / Player signed in", and that a full app restart restored it. Possible stale
development-process/UI state; the cause is not proven. Record as recovered by
restart, with normal-startup/focus behavior still needing verification. The
proposed design/discovery changes have not yet received explicit confirmation.

## 2. Explore seamless playlist transitions — complete; implementation proposed

- [x] Start after task 1 is complete.
- [x] Compare retaining the previous frame, reusing YouTube navigation/player state, and preloading the next watch page.
- [x] Assess playlist ordering, shuffle/previous/seek behavior, session changes, ads, resource use, and cleanup.
- [x] Present a recommendation before a substantial transition implementation (`TRANSITIONS.md`).
- [ ] Implement one-track preparation and view swapping if approved, then measure real audible transitions and verify the above cases.

Evidence: a hidden, paused content page buffered about 20 seconds in 1.75 seconds
in an isolated anonymous profile. The second page encountered an ad, which was
not treated as ready song content. No production preloading was implemented and
no audible-gap claim was made. See `TRANSITIONS.md` for the plan and limits.

Scope: exploration requested by the user, not approval for a substantial playback
rewrite. Keep this behind the inline library/cache task.

## 3. Advertisement/next-song bug — deferred

- [ ] Investigate the reported failure to continue to the next song when an ad appears.
- [ ] Reproduce it, fix the progression logic, and verify that advertisements do not corrupt track timing or playlist order.

The user explicitly asked to ignore this bug for now because it is lower priority.
It stays recorded; do not silently mark it fixed or resume it ahead of priorities 1–2.

## 4. Remaining live verification

- [x] User confirmed that signed-in user info returned after a full app restart.
- [ ] Verify stable account matching and the main player's Premium indication during normal use and focus changes.
- [x] User screenshot confirmed 23 playlists in My Playlists from the actual app account.
- [ ] Verify personalized mixes and complete library coverage with the actual session; the screenshot does not establish these.
- [ ] Check private/large playlist pagination against real account-owned content; the UI currently identifies partial results and the queue limit is 500 songs.
- [ ] If a whole-app crash recurs during normal use, inspect the new diagnostics and macOS report and reproduce/fix that specific failure.
- [ ] Verify the initial request to open this project in the ChatGPT app. Repository evidence does not establish whether that UI action completed.

Do not enter account credentials or import/decrypt browser cookies for these checks.
Use the app's account window and public account/playlist metadata. Completion of
Google sign-in itself was confirmed by the user; these are checks of subsequent
app integration, not a request to sign in again unnecessarily.

## Completed earlier requests

### Project setup, mockup, and browser player

- [x] Set up the new project and implement the Winamp homage/mockup (`work/yinamp-preview.html`, `index.html`, `src/styles.css`).
- [x] Document how to run it in the browser and on desktop (`README.md`, `package.json`).
- [x] Turn the mockup into a functional browser YouTube player with play/pause/stop, previous/next, seek, volume/mute, shuffle, and repeat (`src/youtube.js`, `tests/youtube.test.mjs`, browser checks).
- [x] Provide draggable/snapping panes, saved positions, and Arrange windows (`src/panels.js`).
- [x] Restore a closed playlist/equalizer with PL/EQ toggles (`src/app.js`, `index.html`).
- [x] Provide classic/amber/ice skins plus editable/importable/exportable JSON colors (`src/core.js`, `src/app.js`, `skins/`, core tests).
- [x] Keep EQ/balance visibly unavailable and the spectrum decorative, as YouTube audio is not exposed to the app (`README.md`, interface).

### Playlist import, unavailable videos, and persistence

- [x] Support single videos and online playlist links through + ADD (`src/core.js`, `src/playlist-import.js`).
- [x] Fix public playlist loading when its first video rejects iframe playback, using the public listing fallback (`playlist-listing.mjs`, `tests/playlist-listing.test.mjs`, user confirmation).
- [x] Fill available titles and preserve source order; deduplicate imported videos and report partial listings/limits (playlist/core tests).
- [x] Mark unavailable videos, skip them safely, support per-track/bulk Retry, and retry after a cooldown (`src/core.js`, `src/app.js`, core tests).
- [x] Preserve unavailable marks and settings without endless looping through an entirely unavailable queue (core tests).
- [x] Save/load playlist JSON and persist playlists, skins, volume, layout, and visibility (core tests and browser/desktop checks).
- [x] Explain embedding limits and assess language/runtime alternatives before implementing the authorized desktop approach (`README.md`, conversation).

### Electron playback and app-only account login

- [x] Add the Electron desktop shell and ordinary YouTube watch-page playback for previously blocked embedded videos (`electron/`, native playback checks).
- [x] Bind desktop controls, native video bounds, fullscreen/Escape, modal visibility, and persisted settings (`electron/page-scripts.mjs`, `src/native-player.js`, native checks).
- [x] Keep desktop YouTube login separate from normal browser accounts using a persistent app partition (`electron/contracts.mjs`, account checks).
- [x] Add sign-in/manage, switch account, and app-only sign-out; preserve saved playlists and other browser sessions (account checks).
- [x] Stop automated work before real credentials; the user completed sign-in and showed Premium in the account window (user screenshot).
- [x] Add avatar/login/observed Premium UI, distinguish a newly signed-in account from the player's loaded account, and offer Update player (`src/account-ui.js`, `electron/account.mjs`, `tests/account.test.mjs`, controlled native UI checks).
- [x] Investigate the password-submit freeze: widen the Google session-transfer allowlist, avoid treating redirect cancellation as a fatal open failure, and scope navigation guards to the main frame (account tests and synthetic redirect-chain checks).
- [x] Add sanitized login navigation/responsiveness logs and Account → Open login log (`electron/main.mjs`, `README.md`). The exact historical freeze was not proven by the old startup-only log.

### Crash investigation, cleanup, and Electron version evaluation

- [x] Inspect macOS crash reports; the reports found matched prior automated test processes. Normal-use crash causation remains unconfirmed (remaining verification above).
- [x] Reuse/clear the account window when dismissed instead of repeatedly destroying it; verify open/close/switch/restart behavior (native account checks).
- [x] Add local startup/shutdown and renderer/child-process diagnostics, plus a Retry path that preserves the queue after a video-process failure (native forced-failure check).
- [x] Kill the four abandoned windowless Electron test instances, helpers, and runners; verify their exit (process inventory/cleanup in the conversation).
- [x] Add bounded test teardown so later QA does not leave the same abandoned instances behind (`work/qa/electron-check.mjs`, ignored local QA artifact).
- [x] Evaluate Electron 45.0.0-beta.1 in isolated profiles; playback/account checks passed. Keep 44.7.0, the stable version at the evaluation date, as the default (`README.md`).
- [x] Investigate native passkeys and local authorization: Electron's platform path needs signing/provisioning/domain association; Apple's browser path additionally requires an approved browser entitlement (official documentation reviewed).
- [x] Discuss a Swift/WebKit alternative and Google embedded-login restrictions; a rewrite was not authorized.

## Proposed, not approved for implementation

- [ ] A small Swift/WebKit login/playback prototype before considering a language/framework rewrite. This was proposed, but no explicit approval for that prototype was received.
- [ ] Native macOS passkey support, if the necessary signing/domain or browser entitlement requirements become available. Password/other Google verification remains the current route.

These proposals are recorded for completeness and are not inserted ahead of the
authorized execution queue.
