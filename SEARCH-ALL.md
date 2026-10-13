# Unfiltered search recommendation — 2026-10-13

The research below led to the user-approved implementation recorded in `SEARCH.md`.

## Recommendation

Make All the default. Use the normal, unfiltered YouTube Music response that our client already loads, and display it immediately. Preserve its top result and the order of the following cards; do not concatenate separately fetched Community and Featured pages to construct the initial ranking.

Keep Songs and Playlists as optional local view filters over the loaded results. Switching filters should perform no network request. Label/count them as loaded results: a local filter is not an exhaustive search of that type. If deeper type-specific search is wanted later, expose an explicit More songs / More playlists action using the existing typed adapter, with requests still sequential.

## Actual-client evidence

Two isolated anonymous runs tested arguably, indie roadtrip, smooth criminal and Michael Jackson. Unfiltered search responses arrived in 0.67–1.28 seconds; most samples were 0.7–0.9 seconds. These are warm-client response timings before Yinamp rendering, not signed-in end-to-end guarantees. The current playlist flow then adds category requests, whereas this response is already available.

The current provider shape contains a musicCardShelfRenderer top result followed by ordered itemSectionRenderer wrappers containing responsive cards, rather than the Music shelf collections used by typed search. Top result types observed:

- arguably: album.
- indie roadtrip: album.
- smooth criminal: song, with video alternatives.
- Michael Jackson: artist, with song rows.

Existing helpers recognized 5–8 songs and 3–6 playlists in each mixed response, out of roughly 29–32 responsive rows plus the top result. Other rows include artists, albums, videos and profiles. These numbers show why a local Playlists filter can have far fewer cards than the current typed 20-result page.

The current ytmusicapi project documentation independently describes default search as mixed result types, with explicit resultType and category metadata: https://ytmusicapi.readthedocs.io/en/stable/reference/search.html . Actual ordering and quantities should come from the client response, not copied examples or translated shelf-name heuristics.

## Scope and limits

The unfiltered transport is already demonstrated; normalization needs work. Existing song/playlist parsers do not capture the top card or all mixed types, and running them separately then joining the arrays would destroy provider order. Add a single order-preserving mixed-result parser and extend the schema for the top card and supported result types. Classify by provider navigation/type metadata; preserve artwork and existing mismatch diagnostics.

For a small first milestone, show the top result and supported result cards in the provider's order, with ordinary queue actions for songs/music videos and playlist loading for playlists. Artist/album top results must be represented deliberately: a simple Open in YouTube Music action avoids pretending they are playable tracks or silently discarding the best match. Full artist/album browsing can remain a later milestone. Keep the existing podcast exclusion.

Do not assume unfiltered Load more is equivalent to typed pagination. The response inventory did not validate its next-page behavior. Follow only continuation or More commands that the site actually provides. If there is no demonstrated unfiltered continuation, show the loaded overview and defer broader browsing; never silently fire every category query to fill local filters.

Retain one reused muted window, serial requests, early validated response delivery, cached-view fallback, account/request-generation guards and bounded failure recovery. Save only pinned query definitions; mixed result contents remain memory-only. Existing pinned Songs/Playlists searches should migrate their preferred view to a local filter rather than forcing typed searches on startup.

## Proposed next milestone

Unfiltered All results, top-card normalization and provider ordering first. Optional local Songs/Playlists filters are lightweight; more filter categories, exhaustive typed expansion and artist/album browsing are lower priority. Obtain approval for handling artist/album top cards and continuation scope before implementation.

Local QA: work/qa/search-all-investigation.mjs and ignored search-all-investigation.json contain result-type/renderer summaries and timings only. No authorization values, account contexts or raw responses were exported. All owned test windows exited.

Approved implementation: one unfiltered view, no filter controls, provider ordering/top cards and external Music opening for artists/albums/profiles. Internal catalog browsing is deferred. 128 tests pass.
