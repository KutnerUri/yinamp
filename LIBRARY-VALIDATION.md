# Music Library retrieval validation

Validated on 2026-10-12 at the user's request. The user subsequently authorized
the retrieval correction. The audit below describes the original implementation;
the implemented checkpoint is recorded at the end. Changes remain uncommitted
for the user's behavior review.

## Finding

Treating the personalized homepage as a catalog and splitting its rendered cards
into Mixes and Discover does not satisfy the intended library behavior. The user
is right that result types should be requested from YouTube where supported,
and that the current local grouping cannot establish completeness or novelty.

## Original implementation audited

- `src/library-data.js:56`: My Playlists opens `/library/playlists`; both Mixes
  and Discover open the homepage. There is no Songs source or tab.
- `electron/library.mjs:93`: Mixes and Discover share the `home` cache and are
  selected by locally filtering `item.kind`. Discover sorts community cards
  first, but does not load or exclude the user's created/saved playlist IDs.
  A controlled reproduction retains `PL_owned` in Discover alongside `PL_new`.
- `electron/library.mjs:52`: collection scrolls and polls rendered data. It stops
  after three unchanged count/height observations separated by 450 ms (about
  1.35 seconds without change), with an 18-second collection budget. It does not
  follow shelf expansion endpoints or explicitly request continuation pages.
  Scrolling a rendered page is not evidence of a complete source listing.
- Songs are currently excluded by the playlist parser. They were not moved into
  a new tab; that implementation is still queued.
- Forty-seven passing tests establish the covered parsing/playback cases.
  Synthetic homepage fixtures did not establish a complete personalized catalog
  or a new-only Discover feed. The original test even expects an owned playlist
  in Discover; this was insufficient coverage of the product requirement.

## Live evidence

Anonymous requests used only public YouTube Music page/client data. No account
credentials, browser cookies, or the user's running app session were used.

1. The public Explore response supplied separate browse links for Moods & genres,
   New albums & singles, and New music videos. These are different sources from
   the homepage and need further navigation for appropriate playlist suggestions.
2. Search for `indie roadtrip` supplied category search endpoints for Songs,
   Community playlists, Featured playlists, and other result types.
3. Fetching a search-page HTML URL with a category parameter still returned mixed
   bootstrap results. A URL change alone is not a validated typed-query solution.
4. Posting the category parameters returned by YouTube to its WEB_REMIX search
   endpoint produced typed, paginated responses:

| Query and category | First page | Next page | New IDs on next page |
| --- | --- | --- | --- |
| indie roadtrip — Community playlists | 20 playlists, 0 songs | 20 playlists, 0 songs | 20 |
| smooth criminal — Songs | 20 songs, 0 playlists | 20 songs, 0 playlists | 18 |

Both initial responses included a continuation. Requests followed those returned
continuations rather than inventing page numbers or inferring more results from
scroll height. The current parser recognizes the 20 playlist results but returns
zero items for the 20 song results, confirming the need for explicit song support.

The first anonymous rendered-browser probe timed out. Public HTML/backend checks
succeeded with the browser compatibility header already used by Yinamp's server.
The HTML and backend results above are the live evidence, not that failed probe.

Ignored local audit artifacts are under `work/qa/source-*`, including summaries
`source-audit-backend.json` and `source-audit-pagination.json`. They are not
production code, account logs, or files to include in a commit.

## What remains unverified

The user now sees five genuine mixes. There is no five-item cap in our code;
however, the investigation has not established whether those are all available
mixes or only the current account's homepage shelf. Inspect the signed-in mix
shelf and its returned expansion/continuation endpoints before promising more.
An anonymous search cannot establish the user's personalized mix completeness.

The Music website backend is an internal interface and may change. Its Songs
category is more precise than merely searching ordinary YouTube videos. The
public YouTube Data API separately documents playlist/video type filters, but
is a different integration from the app's signed-in Music website session.

## Correction authorized by the user

1. Replace homepage-wide grouping with a shared retrieval layer that preserves
   source/category, pagination, account generation, and the existing 30-minute
   cache. Use returned query/browse endpoints instead of guessing resource type
   from playlist IDs. Validate signed-in Mixes against YouTube's own mix shelves.
2. Correct Discover using actual community/featured playlist discovery queries
   or expanded browse sources. Exclude created/saved playlist IDs as an additional
   new-to-library rule; server type filtering alone does not guarantee novelty.
   Choose discovery presets explicitly rather than assuming that the user's
   example search query represents all their interests.
3. Add Songs and the requested Enter-to-search/autocomplete flow in subsequent,
   separate review/commit checkpoints. Keep immediate filtering of loaded items.
4. Exclude podcasts throughout, retain active playback during retrieval, and
   preserve the queue until a selected result loads successfully.

## Primary references

- [YouTube Music navigation and search categories](https://support.google.com/youtubemusic/answer/13401025?hl=en): Home recommendations, Explore, Library, and Search have distinct roles.
- [YouTube Music personal/custom mixes](https://support.google.com/youtubemusic/answer/15165061?hl=en): mixes are account/music-preference experiences; this does not establish a universal number of mixes.
- [YouTube Data API search](https://developers.google.com/youtube/v3/docs/search/list): explicit playlist/video result types and page tokens are documented for the public API.

## Earlier retrieval checkpoint — superseded after real-account review

- Signed-in tabs use YouTube's own shelf membership and returned collection
  browse IDs/parameters. Mixes include saved mixes and expand mix collections.
  Discover uses community/recommended playlist sources, never the Library shelf;
  created/saved playlist IDs are excluded as the additional new-to-library rule.
- Pagination follows returned browse continuations. Settling the rendered page
  no longer ends after just three unchanged observations. Bounded/truncated
  results are reported as partial, not claimed complete.
- Public/signed-out discovery uses real Community/Featured playlist category
  search requests and explicit continuations. This broad music search is not
  substituted for the signed-in personalized feed. Live public verification
  retrieved 112 distinct playlists (54 community, 58 featured) across pages.
- Server requests use returned IDs/opaque parameters. A fixed provider locale
  (`hl=en`) is used only for bootstrap command discovery; the user's display
  language does not become a category search term. This is not a claim that
  every mobile shelf has an identical web-client endpoint or universal code.
- Thirty-minute caching, Refresh bypass, account invalidation, and preserved
  playback/queue behavior remain. Desktop query requests use its own session.
- Fifty-two tests pass. Controlled Electron checks prove mix source expansion
  and continuation, removal of owned playlists from Discover, and no keyword
  search for signed-in tabs. Browser behavior/narrow layout checks pass. The
  user's actual signed-in mix count/source availability remains a review item.

Songs UI, Enter-to-search/autocomplete, active-playlist labels, auto-next bug
investigation, and artist/album display remain separate tasks in `TODO.md`.

## Current three-tab implementation — 2026-10-12

The user approved the validated Library/Mixes sources and the broader Home feed,
then deferred further filtering. My Playlists uses the Library listing; Mixes
opens `FEmusic_mixed_for_you` with `ggMEgAKCBA%3D%3D`; Discovery retains all
playlist cards from Home, including mixes and saved items. The tabs may overlap.
Translated shelf names and inferred Community endpoints are no longer used to
select desktop sources. The obsolete title-based shelf adapter was removed.

The site's own authenticated client owns requests and pagination. The adapter
observes browse catalog responses and visible active-page metadata, scrolls
`ytmusic-app #content`, and distinguishes reload commands from next continuations.
The minimal cookie-only browse transport is no longer used for signed-in catalogs.
Complete provider `/image/mixart` and static image URLs are preserved.

Final real-account run of the production adapter, using an isolated encrypted
session snapshot:

| Tab | Unique cards | Artwork metadata | Total cold load |
| --- | --- | --- | --- |
| My Playlists | 23 | 23 | 3,558 ms |
| Mixes | 49 | 49 | 3,063 ms |
| Discovery | 47 | 46 | 5,756 ms |

All three returned terminal listings in this run. Discovery is a changing feed;
earlier production checks returned 38 and 53 cards. These total timings include
page startup and settling, unlike the prototype's single-request timings.
All 49 mix covers loaded successfully using the interface partition and the
same no-referrer policy as the actual cards. Discovery's one missing recognized
image remains a possible later artwork follow-up, not a failure to load mixes.
Repeated catalogs hit cache immediately. Mix Refresh fetched 49 cards in
2,560 ms; account invalidation reloaded 23 Library entries in 2,729 ms.

Fifty-five regression tests pass, including pending-response settling, auth
redirects/account-generation guards, exact preset selection, mix artwork and
reload-versus-next pagination. Controlled desktop checks pass for direct Mixes,
Home continuation loading, broader Discovery membership, zero signed-in keyword
searches, cache reuse/Refresh, playback during browsing, failed import preserving
the queue, and account invalidation. Browser/narrow-layout checks pass. Real
account counts and image loading are provider evidence, not synthetic fixtures.

Evidence: `experiments/music-sources/reports/production-validation.json` (ignored,
local), plus the investigation report. The user's running main app was left open.
Changes are ready for behavior review; no Git operation was performed. Restart
Yinamp to load the changed desktop backend. Additional Community/new-only filters,
special Library-entry filtering, or exclusion of curated cards from the expanded
Mixes collection remain decisions for later review.

Generated reports, raw response captures, screenshots and inactive test profiles
were removed during pre-commit cleanup on 2026-10-12. The measured findings above
are retained; referenced ignored report paths describe outputs regenerated by
running the lab, rather than files included in the commit.

## Current Discovery creator filtering — 2026-10-12

The user approved an owner-based filter instead of catalog membership comparisons.
Playlist subtitle runs expose an explicit MUSIC_PAGE_TYPE_USER_CHANNEL endpoint.
The parser retains its canonical creator channel ID only when unambiguous; artist
credits are not mistaken for ownership. The current channel ID is read from the
visible public field on YouTube’s advanced account page, with exact-page checks
and no auth-page inspection or full account-context export. No channel ID is
hardcoded. The identity is account-scoped, cached in memory for 30 minutes and
cleared on Refresh/account changes.

Discovery excludes only exact creator matches. Saved playlists by others and
provider mixes without an explicit owner remain. If the current identity cannot
be verified, all cards remain and the panel reports that owner filtering was not
applied. Library and Mixes are not loaded to compute exclusions. Known creator
metadata from browse responses survives later DOM snapshots that omit it.

Real-account production check: 54 raw Home playlist cards, 12 matching creators
excluded, 42 Discovery cards (41 recognized images), terminal listing, 6,717 ms
cold / immediate cached repeat. Library remains 23 cards; Mixes remains 49 with
all 49 rendered covers. Provider Mixes supplied zero explicit owner IDs, confirming
that owner filtering alone cannot remove every personalized mix. Fifty-eight
regression tests pass; controlled desktop checks verify exact owner exclusion,
other-owner saved entries retained, caching/account invalidation and unchanged
playback/import failure behavior. The app must restart to load the changed backend.

Only these aggregated findings are retained in committed documentation. Generated
owner diagnostics, raw account-specific catalog summaries and temporary profiles
were removed after recording evidence. A proposed whole-word mix-title heuristic
for “my” is not yet applied; its exact language scope awaits confirmation.
