# Seamless track-transition exploration

2026-10-12. Exploration completed after the inline library and 30-minute cache
work. No production preloading or transition behavior was changed in this step.

## Current cause

`electron/main.mjs:loadVideo()` navigates the active native view to a new YouTube
watch page on every track change. Polling waits for that navigation to finish,
then applies the player layout and restores controls when the video is ready.
This exposes page initialization and network/media readiness between songs.
The 30-minute playlist cache avoids re-reading playlist metadata; it does not
cache or prepare the next song's media.

## Options

| Approach | Benefit | Limitation |
| --- | --- | --- |
| Apply the layout at DOM readiness and retain the previous frame until the next page is ready | Removes most visible page/chrome flashes | Does not remove the audio/network startup gap |
| Reuse the watch page's internal player/navigation APIs | Could avoid a document reload | The regular watch page's internal integration is not a stable documented contract; URL, metadata, account status, errors and native/app progression must remain synchronized |
| Prepare one upcoming watch page in a hidden, paused, muted native view, then swap views | Can prepare the page and initial content buffer before the current song ends | Adds one renderer/page and network work; ads, account changes and unprepared targets need a normal-load fallback |

Recommendation: one prepared upcoming track, combined with retaining the old
visual until the replacement is ready. Keep the current playlist/transport model
as the authority. This is intended to reduce gaps, not a promise of sample-accurate
gapless audio across arbitrary YouTube videos.

## Evidence

An isolated, anonymous Electron 44.7.0 profile loaded two hidden `WebContentsView`s
with the normal YouTube session partition. Both were audio-muted at the contents
level, and their media elements were paused during preparation. No credentials,
cookie import, media URL extraction, ad seeking or ad skipping was used.

- `IHHq6lAgZzs`: content readyState 4, paused, approximately 20.001 seconds
  buffered; readiness observed after 1,750 ms.
- `c8fu7tkc2Iw`: readyState 4 after 1,384 ms, but the page reported an ad.
  It was not counted as prepared song content and was not played to time startup.
- Both inspected watch-page players exposed an internal `loadVideoById` method;
  presence alone does not establish a supported regular-watch-page API contract.
- No audible transition or warm-start latency was measured in this run. Further
  validation should include the user's signed-in Premium session.

Local measurement artifact: `work/qa/transition-measurements.json` (ignored QA
output). Owned views and the test instance were closed afterward.

The official iframe API says `cueVideoById` prepares the thumbnail but does not
request video content until playback or seeking. It therefore does not by itself
provide an equivalent prepared media buffer for the browser version.
[YouTube IFrame API](https://developers.google.com/youtube/iframe_api_reference)

Electron supports independent native views, per-contents audio muting, and
background-throttling control. Those are the building blocks for the proposed
desktop approach.
[WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view),
[webContents](https://www.electronjs.org/docs/latest/api/web-contents)

## Proposed implementation, awaiting approval

1. Reserve the next queue choice once; preserve that choice for shuffle instead
   of choosing randomly a second time at the transition.
2. Prepare only one upcoming track near the current track's end. Keep it paused
   and contents-muted; avoid changing global YouTube volume preferences.
3. Confirm the intended page/content, readiness and account generation. Treat an
   ad as an ad, never as prepared song content, and keep normal ad playback intact.
4. At advance, switch only if the prepared target matches the requested track.
   Restore current volume/mute, start playback, and retire the old view safely.
5. Fall back to today's load path on manual jumps, failures, unavailable tracks,
   or an unprepared target. Keep the old visual until the replacement is ready.
6. Invalidate preparation on queue edits/reordering, shuffle/repeat changes,
   account/session changes, sign-out, renderer failures and app shutdown.
7. Assess repeat-one separately: a normal content seek/replay may avoid a reload;
   explicit Retry and account refresh must retain their forced reload behavior.
8. Verify previous/next, cancellation, seeks, skips, repeat, shuffle, sign-out,
   network failure, ad transitions, memory/process cleanup and measured audible
   gaps. Keep the already-deferred ad/next-song bug distinct from this exploration.

A substantial implementation needs confirmation under the user's supplied
AGENTS instructions. The currently authorized exploration is complete.
