# Playback ownership and provider queues — 2026-10-13

The initial research below led to the user-approved minimal repair described at the end of this document. The user's historical queue escape was not reproduced conclusively; a timing-dependent failure to disable autoplay was reproduced.

## Current ownership

Yinamp stores the queue, picks next/previous/shuffle/repeat locally, and loads one ordinary YouTube watch page at a time. `watchURL` carries video ID/start time, not a playlist ID or native queue. Song/video alternate recordings mean the requested recording ID can legitimately differ from the visible queue track ID; any trace must record both.

`controlPage` attempts to turn the native autoplay toggle off when a command runs. `pollVideo` reads every 300 ms. Once initialized, a different non-ad provider video ID causes pause and a synthetic ended state, letting Yinamp choose the next track. An ended-event marker helps when the provider advances before polling.

## Confirmed gaps and observations

1. Autoplay-off is attempted but not verified continuously. Two muted anonymous initialization runs differed:
   - With the player already playing, volume then play changed autoplay from true to false and it stayed false over four seconds.
   - With `readPage.ready` true but player state buffering, the same volume/play sequence left autoplay true, including after it became playing, over the following four seconds.
   This matches the production readiness predicate/command order and demonstrates a timing problem. It does not establish whether a delayed control update, repeated toggle clicks, or another site state change is responsible.
2. Before initialization, unexpected IDs are deliberately tolerated, but there is no deadline for a persistent non-ad mismatch. `didProviderAdvance` returns false in that state, and `pollVideo` returns on the mismatched ID without a terminal recovery/error. A transient startup allowance can therefore become indefinite.
3. The initialized mismatch handler treats any unexpected non-ad ID as the previous track ending. It cannot distinguish genuine completion from a user/native navigation or another provider change. That can skip a still-valid selected track instead of restoring it.
4. Polling and page-script exceptions are silently ignored. Existing player diagnostics record lifecycle/account activity, not requested/actual ID transitions or autoplay state. The main app log contained 260 records and no playback-identity trace; it cannot explain the earlier report.
5. The controlled non-ad ending probe produced the expected ended-ID marker and state 0 while the metadata ID stayed the requested video. The full user-reported long-lived escape has not been established, and no live ad-specific failure was reproduced. The earlier deferred ad bug was not resumed or marked fixed.

## YouTube's own queue and Premium

Desktop/web YouTube supports Add to queue without a Premium requirement; mobile/tablet queuing requires Premium. Queues are temporary and do not survive closing the browser unless saved as a playlist. Source: https://support.google.com/youtube/answer/9546304?hl=en . No account playlist was created or modified during this investigation.

YouTube describes autoplay as continuing to a related video after the current video ends, with device-specific settings: https://support.google.com/youtube/answer/6327615?hl=en . Explicit queued/playlist progression is a separate mechanism from recommended-video autoplay.

The supported IFrame API documents cuePlaylist/loadPlaylist arrays of IDs, index controls and next/previous: https://developers.google.com/youtube/iframe_api_reference . Yinamp currently uses an ordinary watch page, not this supported embed contract, because embedding previously rejected some content. Similar method names in the ordinary player do not establish equivalent behavior.

## Native-player queue experiment

In an isolated anonymous watch page, cuePlaylist/loadPlaylist/getPlaylist/getPlaylistIndex/nextVideo/previousVideo were exposed. cuePlaylist accepted three known IDs and getPlaylist returned them. However:

- cuePlaylist began playback rather than reliably staying cued.
- nextVideo did not establish a transition to the second ID in the observed interval.
- playVideoAt(1) changed the reported queue index to 1 while getVideoData and the snapshot still reported the first video ID.

Thus queue membership/index is not sufficient evidence of actual playback. This is evidence that a local provider queue is possible, not a validated integration path. A later prototype should exercise YouTube's own queue UI/returned commands and compare actual video ID, queue index and audible content across transitions. It must not assume that calling ordinary-player methods is a stable public API.

## Recommendation and milestones

First repair ownership while keeping Yinamp's queue authoritative:

- Add a small sanitized playback-transition log: selected track ID, requested recording ID, provider ID, watch-URL ID, load generation, playback/ad/initialization state, end marker, autoplay state and recovery decision. Exclude credentials, cookies, account contexts and media URLs.
- Disable autoplay idempotently after the player settles and verify the resulting state, with bounded retries instead of repeated blind clicks on every command.
- Put a bounded, ad-aware grace period on startup ID mismatches. On persistent mismatch, pause/recover the requested recording or show an actionable error rather than silently ignoring it.
- Treat explicit completion separately from unexplained navigation; do not advance the local queue solely because an unrelated video appeared. Verify last-track stop, repeat/shuffle, VID counterpart switching and command/navigation races.

Then consider a separate native-queue prototype if transitions remain a priority. Mirroring the queue could help provider-managed transitions, but requires one authority: the current guard would otherwise treat every legitimate provider transition as an escape, while the frontend would also try to advance. Queue edits, unavailable/private videos, 500-track capacity, shuffle/repeat, restarts and account changes all need synchronization. Do not combine that architecture change with the containment repair.

## Local evidence

- `work/qa/playback-queue-investigation.mjs` and ignored JSON: three-ID queue and index/content mismatch probe.
- `work/qa/playback-autoplay-investigation.mjs` and ignored JSON: initialization timing and ordinary ending probe.
- Pure guard checks confirm initialized/non-ad mismatch detection, and deliberate suppression during ads/preinitialization/offsite contexts.

All experiments used muted isolated anonymous profiles, with no credential entry or cookie transfer. All owned windows exited. No production player files were edited.

## Approved minimal repair — 2026-10-13

The ordinary YouTube player remains in use. YouTube Music still supplies library/search data and song/video counterpart IDs; switching to its player is a separate proposal.

- Autoplay is checked after non-ad playback is playing, rather than clicked blindly during volume/play initialization. At most two off attempts are spaced by one second, and the resulting on/off state is recorded in the existing diagnostics. An absent toggle is unknown, not a verified off state.
- A non-ad wrong recording ID gets a two-second loading grace. Persistent mismatch pauses playback and reloads the selected recording once at its last known position/play intent. Another persistent mismatch stops with a Retry error. Correct IDs/ads clear the grace timer, but only an explicit new selection/switch resets the recovery budget.
- Only an observed ending of the requested recording advances the local queue. Unexplained provider navigation does not synthesize an ending. Stale/wrong-ID snapshots are withheld from the interface.
- Exceptional events (`playback-ended`, `playback-mismatch`, `autoplay-disable`, `autoplay-disabled`, `autoplay-disable-failed`) use the existing rotated diagnostics file. No new recovery framework, native queue mirroring or account storage was added.

132 regression tests pass, including actual-ending-only progression, transient mismatch/ad grace, one-reload budget and idempotent explicit autoplay control. User behavior review remains pending; the historical escape is not claimed fixed by reproduction alone.

Controlled real-desktop check: autoplay was verified off; a persistent provider-ID override triggered exactly one reload, a second override produced the existing Retry error, and the selected queue track stayed unchanged. The check used a muted isolated profile and a controlled identity override, not reproduction of the historical user escape. QA: `work/qa/playback-ownership-check.mjs`.
