# Music Library search

Current implementation: unfiltered mixed results, 2026-10-13. User reviewed the unfiltered view and reports it seems pretty fast; requested commit preparation. Ready for user commit.

## Interaction

Typing filters the current view immediately; Enter or an autocomplete selection opens a query tab. There are no Songs/Playlists filter buttons. Search preserves YouTube Music's top result and the order of subsequent supported cards, deduplicating repeated identities without sorting by type. Podcasts/episodes remain excluded.

Songs and music videos offer Play now and Queue, preserving the rest of the queue. Playlists retain successful-load-only queue replacement. Artist, album and profile cards offer Open in YouTube Music through the ordinary external browser; Yinamp does not navigate their catalog internally. Searching and opening a provider page do not modify the playback queue.

Tabs wrap, titles truncate without a tooltip, and × closes a tab. The hover/focus pin floats without reserving space until pinned, when the label gains room for it. Pins restore their query after restart; old Songs/Playlists pin definitions migrate to the unfiltered All mode. Desktop uses the existing settings file and browser mode uses local storage for pinned definitions only. Results, filters, pagination and scroll remain in memory.

Autocomplete floats below the field, matching its width without shifting the layout. Public YouTube suggestions are debounced 250 ms, start at two characters, and are limited to six. Arrow keys/Enter/Escape, focus loss, IME composition and stale cancellation are handled. A clear button resets the field and suggestions.

## Retrieval and completion

Desktop search keeps one separate muted Music window in the app session. New queries use the loaded component's internal navigation; a full load is reserved for startup or recovery. Network observation starts before navigation, including coordination with a new window's first load. Compressed request bodies are decoded only to identify the query and continuation; no authentication context is exported.

The unfiltered response is parsed by `src/search-all-data.js`, including the top-card renderer and responsive result rows in their original order. Only public card metadata crosses into Yinamp. `src/search-schema.js` validates consumed fields and raw card shapes. Invalid optional fields are dropped; entries with invalid identity/title/type are skipped. Missing optional artist/album/artwork is valid. A category-confirmed cached view remains available when no new response is issued.

Validated results stream to their request. Tab/query/type/page-count/request-generation checks reject obsolete or late updates. The request completes at the requested page count without waiting for unsolicited provider prefetch. Logical searches remain sequential in one shared queue. Public browser search also uses one unfiltered source, with server requests queued sequentially; it returns one final HTTP response rather than desktop progress events.

Only returned unfiltered continuation tokens can trigger Load more. The tested unfiltered overview responses were terminal: the UI does not issue category searches to fill out the overview. Category-specific More commands are not silently followed. Results are cached for 30 minutes by query/page count; refresh bypasses them, and account changes invalidate desktop caches. A local filter covers only loaded cards, not an exhaustive catalog.

## Failure handling and diagnostics

Each hidden-client attempt has a 25-second watchdog and one fresh-window retry. Internal transitions have a six-second readiness bound. Renderer failure, idle crash and unresponsiveness discard the window; account invalidation and shutdown destroy it. Late reads cannot publish after collection ends. Empty results are successful completion, while actual errors clear the loading state and preserve already displayed valid data.

Schema mismatches flash a separate red MISMATCH indicator for five seconds; reduced-motion settings disable flashing. Shape-only records go to `yinamp-search-mismatches.jsonl`, accessible from View → Search mismatch log. The log rotates at 1 MiB and retains one previous file. It excludes query text, credentials, headers, rejected field values and raw responses. General `search-retry` diagnostics retain category/attempt/safe reason codes; retry errors retain their cause.

## Verification

128 regression tests pass, including provider-order/top-card types, safe provider links, compressed matching, schema sanitization, pin migration, startup sequencing, empty/unavailable-source outcomes and failure recovery.

Controlled interface checks verify absence of facets, mixed ordering, top card, queue/video actions, provider opening, restored pins and 375 px layout. Screenshots inspected. Live isolated desktop results: arguably 23 cards (album top); smooth criminal 27 (song top); Michael Jackson 27 (artist top). Every returned card had an artwork URL. Warm samples completed in 0.86–0.92 seconds; those are isolated anonymous timings, not signed-in guarantees. Public All search also returned 27 Michael Jackson results with artwork and artist top.

Local QA: `work/qa/search-all-production.mjs`, `search-all-ui.mjs`, `search-all-real-ui.mjs`. The retired typed desktop collector was removed. Earlier typed-search QA is historical and superseded by these scripts. All owned verification instances are closed on completion. Restart the desktop backend to load this milestone.

Research and prior performance evidence: `SEARCH-ALL.md` and `SEARCH-PERFORMANCE.md`. Artist/album browsing and advanced filters remain deferred.
