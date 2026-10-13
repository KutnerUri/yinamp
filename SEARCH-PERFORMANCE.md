# Search performance investigation — 2026-10-13

The measurement/recommendation phase left production unchanged. The subsequent implementation checkpoint is recorded below. All searches were sequential in one muted window, using isolated anonymous profiles. Live timing varies; these are small repeated trials, not a signed-in benchmark.

## Measured costs

| Stage | Observed time | Implication |
| --- | --- | --- |
| New query's general-results navigation | 635–912 ms warm; about 1.4 s cold in the initial baseline | The client first fetches general results, then selects a typed category. |
| Typed category request | Usually 330–650 ms | Genuine provider/network work remains. |
| Settling after initial usable results | About 510–560 ms per category in the baseline | Avoidable wait; Playlists pays it for Community and Featured. |
| Consumed-field parsing/schema checking | 1–5 ms per response | Not a useful optimization target. |
| Combined DOM reads | Usually 6–117 ms per category | Much smaller than network and settling. |

Baseline warm Songs: 1.74–1.84 s; combined Community/Featured Playlists: 2.74–2.97 s in the first repeated run.

## Request matching issue

Actual search request bodies can be compressed. Production tries JSON.parse on request.postData and silently misses those requests. The instrumented copy verified that the existing prototype decoder recognizes them: initial category bodies contain query/params, while continuation requests carry their tokens in URL parameters and context-only bodies. No context values, credentials or raw payloads were exported.

This means the intended response-primary path did not run in the initial measurements. Correcting the decoder alone can *increase* latency: the provider automatically prefetches continuation pages, and the current pending/settling rule waits for those too. The decoded-only experiment returned up to 59/60 entries despite requesting one page, taking 3.2 s for Community plus 1.6 s for Featured in that run.

## Verified experiment: finish at the requested page count

A QA-only copy decoded the requests and finished after the requested number of validated category responses instead of waiting for unsolicited continuations. It preserved the same query/category checks and schema validation. Warm Songs: 1.44–1.47 s. Combined Playlists: 1.95–2.02 s. Each category returned its first page (19–20 entries), all carrying artwork URLs. All requests remained sequential.

This experiment is not production-ready: response completion should be event-driven, continuation matching must be scoped to tokens returned for the current query/category, and late reads need cleanup/cancellation before another category uses the window. Retain the verified-page fallback and watchdog/retry paths.

## Recommendation

1. First implement compressed request matching and completion at the requested page count together. Expect roughly 0.5–1 s less waiting for combined playlist results in these trials, rather than assuming fixing the decoder alone is faster. Keep first-page partial labeling and Load more.
2. Then measure again. A direct typed internal navigation could remove the general-results pass, worth another 0.6–0.9 s on new queries. A prototype using the search component's searchParams field did not forward params into the request, so this route is not yet validated and should not be represented as implemented.
3. If playlist first-paint still feels slow, consider showing Community results before the sequential Featured request completes. That improves perceived latency but changes the result-delivery/UI flow and requires a separate milestone.

Do not optimize the schema checker, add parallel queries, or synthesize signed-in API authentication for this first speed milestone.

## Local QA artifacts

- `work/qa/build-search-timing.mjs` generates an instrumented copy of the production collector.
- `work/qa/search-timing-main.mjs` runs sequential timing trials.
- `work/qa/search-timings.json`: initial nine-category baseline.
- `work/qa/search-request-shapes.json`: decoded-only trial; key names and match flags, never raw values.
- `work/qa/build-search-fast-experiment.mjs`, `work/qa/search-fast-timings.json`: first-response completion experiment.
- `work/qa/search-typed-timing.mjs`: unsuccessful direct-category prototype; not a production path.

All owned test windows/processes exited. Generated collectors and reports remain ignored under work/qa. No production search source was edited during this investigation.

## Subsequent approved implementation

The user approved first-page completion plus incremental desktop display. Production now decodes compressed request fields, matches only current query/category and returned continuation tokens, publishes validated pages promptly, and stops at the requested page count. Logical searches remain sequential. Live sample: playlist first results 1.38 s, final combined results 1.91 s; warm Songs 1.42 s. Regression suite: 117 tests. See `SEARCH.md` for behavior and remaining limits. Direct typed navigation remains unvalidated.
