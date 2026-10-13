# Work queue and completion record

Updated: 2026-10-13. Work proceeds in the order below. Checked items have
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

### 1a. Library artwork — complete and committed

- [x] Center the card design on 135 × 135 px previews (2.6× the previous 52 px artwork), with two-line titles beneath and a taller scrollable gallery. Browser library checks passed; desktop and narrow-layout screenshots inspected.
- [x] User approved the larger artwork; requested a tighter layout before committing.
- [x] Reduce card padding and unused title space while keeping 135 px covers. Verified five desktop columns, cover containment, long/Hebrew titles, scrolling, and no horizontal overflow at 414/375/320 px; browser library checks passed and screenshots inspected.
- [x] User approved the compact layout as-is. Committed in `5df5fbd` (`large media`).

### 1b. Library follow-ups — queued, one task per review and commit

Updated priorities from the user's latest feedback. Registration is complete;
queuing a feature does not mark its implementation complete. Present a plan and
obtain confirmation before a substantial implementation, per the user's
AGENTS.md instruction. Pause after each implemented task for behavior review
and the user's commit before starting another.

#### 0. Retrieval correction — real-account review failed; prototype proposed

- [x] Audit actual source URLs/cache grouping and reproduce an owned playlist surviving Discover filtering.
- [x] Validate YouTube Music category queries: Community playlists returns 20 playlists with no songs; Songs returns 20 songs with no playlists. Follow returned continuations: another 20 playlists and 18 new song IDs.
- [x] Confirm that search-page bootstrap HTML remains mixed despite category URL parameters; backend category requests are required for the demonstrated typed results.
- [x] Record the insufficient test coverage and source/pagination limitations in `LIBRARY-VALIDATION.md`. No production fetch behavior changed in this investigation.
- [x] User authorized retrieval correction on 2026-10-12 and instructed that bug reports should be mediated through this file rather than interrupting the active task.
- [x] Implement a typed public query adapter with explicit continuation pages. Signed-in tabs instead retain YouTube shelf membership and follow returned preset browse IDs/parameters; no keyword query substitutes for the personalized feed. Discover excludes known created/saved library IDs. Thirty-minute caching and account-generation guards remain.
- [x] Normalize provider bootstrap to `hl=en`, then use returned opaque category parameters and collection IDs; user UI labels are not category query terms. Mobile and web source availability are not assumed identical.
- [x] Verify 52 tests, controlled Electron source expansion/continuation and zero signed-in keyword searches, browser behavior/narrow layout, and live public retrieval of 112 playlists across category pages.
- [x] User reviewed the implementation: prolonged "Loading your mixes…", only five mixes, missing artwork, and Discover failing with "A community or recommended playlist collection could not be identified in this YouTube Music response." This fails the intended account behavior despite controlled checks passing.
- [x] Validate/correct the real source mapping, latency, and mix thumbnail shapes using the actual account and production adapter; see current three-tab evidence below. Behavior review remains pending.
- [x] User authorized the prototype and use of Yinamp’s own app session on 2026-10-12. Prototype scope in `experiments/music-sources/`: observe actual YouTube Music browse/search commands, measure request timing and raw result counts, compare source categories and pagination, and verify artwork metadata before normalization. Keep account credentials/cookies/authorization headers out of exported diagnostics.
- [x] Integrate the validated three sources after explicit user approval; keep Discovery broad and defer further filtering.
- [ ] Obtain fresh user behavior review; commit remains a user checkpoint.
- [x] Validate the returned expanded mix collection: 49 cards, no next continuation, all 49 covers load. This does not claim every possible account mix is enumerated.

### Actual-client prototype evidence — 2026-10-12 first pass

- [x] Run five successful real-account prototype passes inside the authorized 15-minute timebox; production player/retrieval files unchanged.
- [x] Validate `FEmusic_liked_playlists`: 24 raw cards / 23 unique navigable Library entries, 272–836 ms. Includes special Library entries; ordinary created/saved playlist count not independently established. Scrolling produced no next page; its `reloadContinuationData` is not result pagination.
- [x] Validate `FEmusic_mixed_for_you` with `ggMEgAKCBA%3D%3D`: 49 cards in all five runs, 597–970 ms, no returned continuation. All 49 rendered covers loaded after scrolling; 47 use `music.youtube.com/image/mixart`. The experimental image allowlist had rejected this host/path. Production artwork remains unchanged.
- [x] Observe real Home pagination through URL `ctoken`/`continuation` parameters with context-only JSON bodies. Latest five pages: 37/27/25/30/10 cards, 194–317 ms each; final page has no next continuation.
- [x] Confirm Community shelf has 8–10 cards and no standalone browse/More command in observed responses. UUID shelf IDs change; no language-independent Community-only selector validated.
- [x] Click recommended-playlist More: `FEmusic_moods_and_genres` / `ggMEgAK5Ag%3D%3D` returned a 41-button directory, not a playlist collection (366 ms). Do not equate that command with an expanded recommendation feed.
- [x] Compare actual client mixes with cloned-session minimal-context request (`credentials=include`): HTTP 401 / 102 ms versus 49-card client success. Required additional auth/context is unresolved; no credential values, authorization headers, or full account contexts inspected/exported.
- [x] Broaden safe observation and record eight deduplicated API endpoints; validate all eight client search categories and actual continuation pages. Community search: 20 + 20 cards (19 new IDs); Featured search: 20 + 4, then terminal. Query searches are not personalized presets. Parameter suffixes vary; use returned commands.
- [ ] Validate a stable Community-only preset/marker and playlist-only recommendation source before production integration.
- [ ] Implement the demonstrated mapping/artwork correction only in the separately authorized production checkpoint, then obtain real-account behavior review. Current controlled tests alone do not establish source correctness.

Evidence and query inventory: `experiments/music-sources/INVESTIGATION-2026-10-12.md`;
ignored local `reports/latest.json`, four named run archives and `reports/api-inventory.json`.
The prototype now chooses known More commands by ID/params, scopes DOM roots to
visible active content, and distinguishes reload commands from next-page evidence.
`hl=en` still produced locale `iw`; translated titles cannot be a stable source selector.
Three pre-startup SIGABRT launches succeeded on retry; causation remains unresolved.

### Three-tab production checkpoint — implemented, behavior review pending

- [x] User explicitly approved implementation after verifying the separate queries and Discovery pagination; defer further filtering.
- [x] Use the Library listing, direct expanded Mixes preset, and complete available Home playlist feed. Remove title-based source selection and signed-in cookie-only continuation requests.
- [x] Preserve provider mix/static artwork URLs. Real interface-session check loaded all 49 mix covers with zero failures.
- [x] Real-account final results: My Playlists 23 cards / 3.6 s; Mixes 49 / 3.1 s; Discovery 47 / 5.8 s, of which 46 have recognized artwork. All terminal in this run; Discovery counts vary with the feed. Cached repeats immediate; Refresh/account invalidation fetched fresh data.
- [x] Pass 55 regression tests and browser/narrow-layout checks. Controlled desktop checks pass for source selection, actual-client continuation behavior, broader Discovery membership, preserved playback/queue on failed import, cache Refresh and account invalidation.
- [ ] User reviews the restarted main app. Additional membership filtering remains deferred. No Git operation performed.

Evidence: `LIBRARY-VALIDATION.md` and ignored
`experiments/music-sources/reports/production-validation.json`.

#### 1. Mixes should contain only mixes

- [x] Reproduced the parser issue: song/video cards carrying radio playlist IDs were classified as mixes and could consume the ID of a genuine mix before it was parsed.
- [x] Use playlist navigation versus single-track metadata to exclude song/video cards, including responsive rows and play overlays; preserve genuine mixes and curated playlists. All 47 tests pass. Isolated Electron checks confirm song cards are absent, a genuine mix plays, queue replacement/cache refresh still work, and the test app exits.
- [x] User reports improvement and five mixes after the parser correction. This confirms the observed filtering improvement, not catalog completeness; the retrieval audit above identifies the remaining source problem.
- [ ] User behavior review and commit checkpoint.

Current source of truth: My Playlists uses the Library listing; Mixes uses the
validated expanded mix collection; Discovery uses all playlist cards from the
personalized Home feed. The user approved this broader three-tab behavior and
deferred additional filtering. Lists may overlap. Title-based category selection
was removed; public/signed-out Community/Featured search remains separate.
See the latest production-adapter evidence in `LIBRARY-VALIDATION.md`.

#### 2. Show the active playlist — approved; ready for user commit

- [x] Show a compact active-playlist name above the track queue and identify the matching card in Music Library, when the queue has a known playlist source.
- [x] Persist playlist identity across restarts; retain it through track changes and pause, replace it only after a successful playlist load, and clear it when the queue is emptied or replaced with an unrelated queue.
- [x] Preserve the previous active playlist on failed/cancelled loads. Avoid claiming that a restored, paused queue is currently playing.
- [x] Existing saved queues have no playlist-source identity; explain that opening a playlist once establishes it instead of guessing from song titles.
- [x] User approved implementation on 2026-10-13. Verify 94 regression tests, browser library checks, and controlled desktop-adapter checks for identity across pause/track changes/reload, failed loads, empty-queue clearing and narrow layout. Screenshots inspected.
- [x] User approved the cover/name presentation on 2026-10-13 and requested preparation for commit.
- [ ] User commit checkpoint.

The queue shows the playlist cover beside its name (the `PLAYLIST` prefix was removed at the user’s request), and its library card shows `IN QUEUE`; neither claims playback is active. Adding an unrelated song or loading a queue JSON clears the source identity. Artwork is saved with playlist identity; reopen previously saved playlists once to capture their cover. Missing or failed artwork is hidden. Cover persistence and narrow layout passed the controlled interface check. Older saved queues show “Open a playlist to identify this queue.” Evidence: `tests/core.test.mjs` and ignored `work/qa/active-playlist-check.mjs`.

#### 3. Discover should contain new suggestions — skipped for now

- [x] Earlier checkpoint implemented exclusions; superseded by the user’s approved broader Discovery feed after actual-client investigation.
- [ ] Reconsider new-only/library exclusions and Community filters after review of the current three tabs; they are not enabled in the current broad feed.
- [x] Preserve 30-minute caching, refresh source/library/exclusion catalogs together on Refresh/account changes, and identify partial results.
- [ ] User behavior review and commit checkpoint.

#### 4. Songs in a separate tab — skipped for now

- [ ] Propose a minimal Songs tab for individual music tracks removed from Mixes, then confirm the implementation plan.
- [ ] Implement song classification and playback with distinct queue behavior from playlist replacement; keep podcasts excluded.
- [ ] User behavior review and commit checkpoint.

#### 5. Loaders in appropriate locations — complete

- [x] Show loading feedback for initial catalog/tab loads, catalog refresh, and playlist opening: skeleton cards, shared segment indicators, refresh feedback, and an OPENING indicator on the selected card. Search feedback belongs to task 6 when search is added.
- [x] Keep current content visible during refresh; clear loading state on completion/error and ignore stale catalog responses. Provide accessible busy/status states and reduced-motion styling.
- [x] User confirmed this task was just completed on 2026-10-13; code inspection confirms the implementation in `src/library-ui.js`, `src/loading-ui.js`, and `src/styles.css`. This inspection did not include fresh visual QA.
- [ ] User commit checkpoint.

#### 6. Search YouTube for playlists and songs — reviewed; ready for user commit

Next implementation priority: the user skipped tasks 3 and 4 on 2026-10-13. A standalone Songs tab is not a prerequisite for typed song search. The user approved search tabs on 2026-10-13, with wrapping, shortened labels, hover pins and close buttons. Implementation and verification are recorded in `SEARCH.md`. Latest user clarification: pinning restores a tab after restart. Save only pinned queries and result type in desktop app settings (browser mode uses local storage); results, pagination, filters, scroll and unpinned tabs remain memory-only.

- [x] Research typed Music search and public autocomplete, present the plan and obtain user approval before implementation.
- [x] Keep search inside Music Library using the existing "Find a playlist" input: typing filters the current in-library view immediately; pressing Enter submits an actual online search. Preserve the in-library filter rather than replacing it.
- [x] Make online search results distinct from filtered library results, with a simple return to the prior library view; searching itself must not replace the playback queue.
- [x] Add autocomplete as an enhancement to this flow if supported: keyboard-accessible suggestions, bounded/debounced requests, and cancellation of stale query responses; preserve Enter-to-search and immediate local filtering.
- [x] Support playlist search such as "indie roadtrip" and song search such as "smooth criminal", with clearly separated result types and no podcasts.
- [x] Preserve playback while searching, replace the queue only on successful playlist opening, and offer Play now and Queue on song results, preserving the existing queue; a standalone Songs library tab remains skipped.
- [x] Check loading, no-results, failure, account/session isolation, and suitable search-result caching.
- [x] User reviewed search, confirmed pins survive restart and images now appear, and requested commit preparation.
- [ ] User commit checkpoint.

Evidence: 99 regression tests pass; controlled browser checks cover tab wrapping/closing/pinned-query restoration, filter/scroll restoration, autocomplete keyboard use, Queue/Play now, stale replies, errors/empty states and 375 px layout. Live public search and isolated anonymous desktop search verified; fresh signed-in account behavior remains for user review. See `SEARCH.md`.

#### 7. Repeated metadata — low priority; usefulness still to be decided

- [ ] Reconsider repeated owner names in My Playlists and generic type labels across tabs (e.g. "mix" within Mixes, "song" within Songs).
- [ ] Keep useful metadata such as track counts, artist names, or community creators. Do not remove all metadata automatically; the user noted that some may be useful.
- [ ] User behavior review and commit checkpoint if a cleanup is selected.

#### 8. Playback leaves the queue — reported; queued after retrieval

- [ ] Compare the actual YouTube content ID with the selected Yinamp track and reproduce unexpected videos during playlist progression; YouTube auto-next is a hypothesis, not a proven cause.
- [ ] Disable/control YouTube auto-next while Yinamp owns the queue and prevent unexpected content navigation from desynchronizing playback.
- [ ] Verify endings, shuffle/repeat, and advertisements; review and commit separately. This new report does not silently resume the earlier deferred ad bug.

#### 9. Artist and album in the player — metadata check complete; UI queued

- [x] Inspect current metadata pipeline. Music song search results explicitly tag artist/album runs; examples include Michael Jackson / Bad (25th Anniversary) and Michael Jackson / Number Ones. Playlist rows expose tagged artists but may lack albums.
- [x] Confirm current parsing/persistence drops these fields, desktop snapshots contain only playback state, and the video-title lookup's author/channel is ignored by the UI.
- [x] Preserve explicitly tagged artist/album metadata from Music playlist rows and matching song/video lookup results through queue loading, saved state and JSON export/import. Display artist and album beneath the title, replacing the prominent YouTube/Desktop labels while retaining playback status/duration. User instructed missing values to remain empty; no channel fallback or album guesses.
- [x] Enrich only from the Music lookup row matching the requested song or its provider-declared counterpart; reject stale responses after selection changes. No watch-page/media-session or advertisement metadata is used. Unavailable fields remain empty.
- [x] Present implementation scope and obtain user approval for this separate UI/persistence task.
- [x] Verify typed metadata, channel rejection, duplicate-row enrichment, bounded saved-state round trips and selected-ID lookup isolation; 84 regression tests pass. Controlled browser desktop-adapter check confirms display, clearing missing values on track changes, lookup enrichment, reload persistence and narrow layout; screenshots inspected.
- [x] Add a subtle monospace `---` opacity pulse (38%–62%, 1.8 seconds) for missing artist/album while the lookup is pending; clear on success/failure, leave unavailable values empty, and respect reduced-motion preferences. Controlled browser check verifies pending and resolved states; screenshot inspected.
- [x] User reviewed and approved the metadata display and pending indicator; requested the final 38%–62% opacity range.
- [ ] User commit checkpoint. Existing saved queues without metadata retain empty fields until a playlist is reopened or an uncached lookup supplies typed metadata.

The user reported that user info temporarily showed a generic icon with "Signed
in / Player signed in", and that a full app restart restored it. Possible stale
development-process/UI state; the cause is not proven. Record as recovered by
restart, with normal-startup/focus behavior still needing verification. Avoid
replacing a known player avatar with incomplete library identity metadata;
account integration checks remain in section 4 below.

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

Pre-commit cleanup (2026-10-12): removed generated diagnostic/report files, raw
response captures, screenshots and inactive QA profiles. Retained experimental
source, reusable QA scripts and sanitized findings; lab usage is documented in
`experiments/music-sources/README.md`. Referenced ignored reports are regenerated
on demand.

### Mix grouping experiment — discarded

- [x] Investigate actual provider metadata and prototype interaction alternatives.
- [x] User explicitly requested reverting grouping entirely. Remove the grouping preview/server, grouping diagnostics, generated data and prototype QA script. Keep the original flat Mixes collection.
- [x] Retain metadata findings and UI takeaways in `experiments/music-sources/MIX-GROUPING.md`; grouping is not queued for integration.
- [x] Leave the audio-visualizer experiment untouched.

### Discovery creator filter — implemented

- [x] User requested filtering by owner instead of comparing Library/Mixes listings.
- [x] Preserve explicitly typed public creator channel IDs from playlist bylines. Resolve the current public channel ID from the visible YouTube advanced-settings field; cache it for 30 minutes and invalidate on Refresh/account changes.
- [x] Exclude only exact owner matches in Discovery. Keep saved playlists from other creators and entries without explicit owner metadata. Unknown/ambiguous owner identity retains cards and reports that filtering was not applied.
- [x] Preserve known network-response ownership when rendered snapshots omit it. Never inspect Google auth pages or full account contexts.
- [x] Actual account: 54 Home playlist cards minus 12 matching creators = 42 Discovery cards; 6.7 s cold, immediate cached repeat. My Playlists remains 23 and Mixes 49; all mix artwork still loads.
- [x] Pass 58 regression tests and controlled desktop checks for exact owner exclusion, retained other-owner saved playlists, cache/account invalidation, preserved playback and failed-import queue protection.
- [ ] User review after restarting the desktop backend.

A suggested additional title heuristic (“my” in mix names) is pending confirmation
of the exact words/languages. It is not applied yet; personalized mixes generally
lack a creator ID and remain visible under the owner-only rule.

- Mix metadata inspection (2026-10-12): live localized collection had 48 mix cards, no English “my” title; only My Supermix had Hebrew “שלי”. Specific “My Mix 6” artwork not reproduced. Existing Discovery parser already excludes recognized mixes; no title heuristic added. See experiments/music-sources/OWNER-FILTER.md.

### Audio follow-ups — 2026-10-12

- [x] Add a simulated browser visualizer fallback while YouTube is playing; settle on pause/stop and respect reduced-motion settings. Clearly identify it as decorative.
- [x] Desktop equalizer: preamp, nine bands, bypass/reset, saved settings and manual preamp. Automatic compensation removed at the user’s request on 2026-10-13. All 87 tests pass; controlled PCM audio, two live YouTube tracks, reload persistence and a short CPU comparison passed. See `docs/equalizer.md`.

### Search speed milestone — reusable hidden client

- [x] Reuse one muted hidden search window, serialize operations and reuse a loaded query for Community/Featured selection.
- [x] Bound each attempt to 25 seconds, validate query/category, discard crashed/unresponsive windows (including idle failures), and retry once on a fresh window. Report a second failure; cancel on account invalidation and clean up on shutdown.
- [x] Pass 105 regression tests, including silent stalls, renderer failures, idle failure and account cancellation. Live anonymous reuse/crash recovery evidence is recorded in `SEARCH.md`.
- [x] User described current search speed as reasonably fast; confirmed the artwork fix in the next milestone.
- [ ] Implement internal search navigation after a separate approval; new queries still perform full page loads in the reused window. Direct-API transport remains a separate proposal.

### Search response schema and artwork — artwork reviewed; ready for user commit

- [x] Prefer response JSON, use category-confirmed page fallback only when a matching response is absent, and preserve richer metadata/artwork during merges.
- [x] Support responsive playlist search rows' nested artwork shape.
- [x] Add a separate expected-schema file; drop invalid fields/entries, and keep absent optional metadata valid.
- [x] Flash a separate red MISMATCH bulb for five seconds and log sanitized shape details to `yinamp-search-mismatches.jsonl`; provide View → Search mismatch log.
- [x] Pass 109 regression tests, controlled indicator/interface checks and live anonymous artwork/source checks; evidence in `SEARCH.md`.
- [x] User confirmed artwork appears in search results and requested commit preparation. The mismatch indicator has controlled verification; no live provider mismatch was deliberately induced in the user’s session.
- [ ] User commit checkpoint. Internal navigation remains a separate search-speed milestone.
