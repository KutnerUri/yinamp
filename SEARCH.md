# Music Library search

Implemented and reviewed on 2026-10-13. The user confirmed pinned tabs survive restart, search artwork is visible, and current search speed is reasonable. Ready for the user’s commit.

## Interaction

Typing filters the current library/search view immediately. Enter (or selecting an autocomplete suggestion) opens a new search tab named after the query. Tabs wrap, long labels are visually shortened without a tooltip, and × closes a tab. The pin appears on hover or keyboard focus (always available on touch); the pin floats on the left and stays visible when pinned; the close action shares the tab background. Pinned tabs restore their query and result type after restart. Unpinned tabs, results, filters and scroll positions live only in memory and are discarded on reload/restart. No fixed limit is imposed on the tab count.

Each search has Playlists and Songs selectors; the permanent library tabs provide navigation back. Switching tabs retains the local filter, cached results and scroll position. Searching does not modify playback or the queue. Playlist opening keeps the existing successful-load-only queue replacement. Song results offer Play now (select existing matching track or append/select) and Queue (append without starting playback); the rest of the queue is preserved. Appending an unrelated song clears playlist-source identity. Queue capacity remains 500 tracks.

Autocomplete uses public YouTube suggestions from `suggestqueries.google.com/complete/search`, validated with a real response. It starts at two characters, waits 250 ms and shows up to six suggestions. Arrow keys, Enter, Escape, focus loss, IME composition and stale-request cancellation are handled. Suggestion failures leave local filtering and Enter-to-search available. No account history is requested.

## Sources and pagination

Desktop search reuses one separate muted window in the app's own YouTube Music session, with searches serialized through the library queue. Community/Featured categories reuse the same loaded query page. Each operation has a 25-second watchdog; crashes, unresponsiveness, unexpected navigation/query identity, missing controls and stalled results trigger window replacement and one retry. A second failure reports an error. Idle crashes also discard the window, and account invalidation/app shutdown destroy it. It executes newly returned category commands for Songs, Community playlists and Featured playlists. The observed category prefixes identify the category; the full returned command, including its variable suffix, is selected through the client. Category-confirmed rendered shelves support the site's own cache; only matching category/continuation network responses contribute additional results. Song parsing requires typed audio navigation and excludes videos/episodes. Typed artist/album metadata and approved provider artwork are retained.

Public browser search uses the existing anonymous Music query adapter with fresh category parameters. Playlist results merge Community and Featured lists, deduplicating playlist IDs. Each source's pagination remains independent. Load more requests an additional page per source, to a maximum of ten pages. Desktop pagination is executed by the site's own scroller; a new request replays the query up to the requested page count rather than exporting/replaying authenticated continuation state. Provider rendering may preload extra cards. Partial results stay explicitly labeled.

Search results use the existing 30-minute cache, keyed by query/type/page count. Desktop cache generations are invalidated with account changes; stale interface replies are ignored. Refresh bypasses cached results and keeps current cards visible. Only pinned definitions (query and result type) are saved: desktop uses its existing app settings file, while browser mode uses one local-storage record. Desktop local storage cannot survive the changing localhost port reliably. Results, pagination, filters and scroll positions are never persisted.

This is an unofficial Music interface and can change. Current behavior is supported by the project's actual-client investigation and the ytmusicapi project's typed search documentation: https://ytmusicapi.readthedocs.io/en/latest/reference/search.html . Google's supported Data API remains an alternative requiring a developer project and quota management: https://developers.google.com/youtube/v3/docs/search/list . No Python dependency or credential transfer was added.

## Verification

- Regression suite: 109 tests, including song/video/episode classification, search option validation before network access and bounded public suggestions.
- Controlled browser: wrapped tabs, truncated labels, close, pinned-query/type restoration, unpinned-tab reset, unpin persistence and verification that only query/type are saved, scroll restoration, song Queue/Play now, autocomplete keyboard selection, loading/error/empty states and stale-response rejection; 375 px layout has no horizontal overflow. Desktop and narrow screenshots inspected.
- Live public: 40 playlist cards across the initial Community/Featured pages; 20 songs initially and 40 across two pages, all 40 with artwork and matching typed artist/album metadata.
- Isolated anonymous desktop: category-confirmed results and cache path verified for Songs and Playlists; two-page requests returned 40 songs and 82 deduplicated playlist cards in the final run. Automated live checks used an anonymous profile; subsequent user review confirmed pinned-tab restoration and visible search artwork in the main app.

Reusable local QA: `work/qa/search-check.mjs` and `work/qa/search-desktop-main.mjs`. All owned verification instances are closed on completion. Restart the main desktop backend to pick up the new search action.

Desktop pin fix: tested two real isolated app launches with different localhost origins, restored the pinned query, and verified unpinning updates the app settings file.

Reusable-window milestone: isolated live Songs search returned 20 cards in 2.5 seconds; Playlists returned 40 in 3.2 seconds on the same window. A forced renderer crash caused replacement, and the next Songs query returned 20 cards in 2.2 seconds. Account invalidation removed the retained window. These are sample timings, not a before/after benchmark or a guarantee for signed-in searches. QA: `work/qa/search-reuse-main.mjs`.

## Response schema and artwork milestone

Expected fields and raw renderer shapes are defined in `src/search-schema.js`. Invalid optional fields are omitted; entries with invalid required identity/title/type are skipped. Missing optional artist, album or artwork is valid. Unknown populated result renderers, invalid artwork shapes/URLs, malformed JSON and invalid consumed fields produce shape-only mismatch reports.

Search response JSON is primary. Category-confirmed page data is a fallback when no matching response is observed, and incomplete copies cannot erase known artwork/metadata. The playlist parser now supports the nested `thumbnail.musicThumbnailRenderer.thumbnail.thumbnails` shape used by responsive search rows.

A separate red bulb beside the connection status flashes with MISMATCH for five seconds after a report. Reduced motion disables flashing. Reports go to `yinamp-search-mismatches.jsonl` in desktop app data, accessible from View → Search mismatch log. The log rotates after 1 MiB, retaining one previous file; it contains timestamp, category, source, field path, expected shape and actual type, plus entry index when available. It excludes query text, raw response bodies, headers, credentials and rejected values. Logging failure does not block valid search results.

Validation: 109 regression tests; controlled interface verifies the five-second indicator and unchanged search interactions. Live isolated desktop search returned 43/43 playlist artwork URLs and 20/20 song artwork URLs without mismatch reports. Six artwork samples from each of three live desktop searches decoded successfully (18 checks). The user confirmed search artwork in the main app. Internal search navigation remains a separate milestone.
