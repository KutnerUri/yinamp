# YouTube Music actual-client investigation — 2026-10-12

Authorized first pass, within the 15-minute limit. Started 18:16:57 Asia/Jerusalem;
five successful automatic real-account runs completed by 18:23:43. Analysis and
evidence recording followed within the same timebox. Production player/retrieval
files were not edited. No Git changes were made.

## Validated preset/query mapping

All request paths below use https://music.youtube.com. No keyword search is used
as a substitute for a personalized preset. Labels below describe evidence;
translated shelf titles are not category selectors in the updated prototype.

| Intended source | Actual query / operation | Validated contents and latency | Pagination |
| --- | --- | --- | --- |
| My created/saved library | POST /youtubei/v1/browse; browseId=FEmusic_liked_playlists; no params field observed | Five runs: 24 raw cards, 23 unique navigable entries; 272–836 ms. Includes special Library entries; this is not proof of 23 ordinary created/saved playlists. One raw card is Create playlist, with no catalog ID. | No next-page request after four real scroller passes. The response's one reloadContinuationData is a reload command, not evidence of another result page. |
| Personalized mixes | POST /youtubei/v1/browse; browseId=FEmusic_mixed_for_you; params=ggMEgAKCBA%3D%3D | Five runs: 49 cards each; 597–970 ms. Collection navigation came from actual More buttons. | No continuation in these responses; scrolling added no result page. Completeness is established for this returned collection, not every possible account mix. |
| Community preset | Home document plus actual POST /youtubei/v1/browse feed continuations | Community-labeled shelf: 8 cards in baseline, 10 in later observed network responses; no shelf browse/More command. Latest feed page containing it: 25 total cards, 236 ms. | Follow the Home feed, not an invented community endpoint. No language-independent community-only shelf identifier was established. |
| Recommendations | Home document plus actual POST /youtubei/v1/browse feed continuations | Latest Home: 50 initial cards, then pages of 37/27/25/30/10 cards at 263/317/236/209/194 ms. Mixed songs, albums, playlists and podcasts, rather than a playlist-only preset. | Final page lacked nextContinuationData. Homepage contents/order vary across loads. No dedicated personalized playlist-only recommendation browse ID validated. |

One recommended-playlist shelf advertised FEmusic_moods_and_genres with
params=ggMEgAK5Ag%3D%3D. Clicking its actual More button returned a directory with
41 musicNavigationButtonRenderer entries in 366 ms, and zero playlist cards.
It must not be treated as an expanded recommendation playlist collection.

Other returned shelf commands, **observed but not validated as requested
collections in this pass**:

- FEmusic_listen_again, params=ggMEgAKgAw%3D%3D.
- FEmusic_library_landing, params=ggMEgAKABw%3D%3D.
- FEmusic_moods_and_genres_category, params=ggMTOg1uX21NWWpBbU01SDgygAK3Cg%3D%3D.
- FEmusic_new_releases_albums, params=ggMEgALSAg%3D%3D.
- Artist-channel browse commands were also returned; they are listed once per
  distinct ID/params in the local inventory rather than asserted to be presets.

## Pagination and artwork

Actual feed/search continuations put ctoken, continuation, type, itct, and
prettyPrint in the URL query; the JSON body contained only context. Diagnostics
retain parameter names/presence, not continuation or tracking values. Ignoring
URL query parameters would miss these continuation requests entirely.

Shelf UUIDs varied between loads; they are not category codes. hl=en continued
to yield client locale iw. The prototype now selects known More commands by
browse ID/params and snapshots only visible active-page shelf/grid roots, avoiding
cached hidden pages and parent/child root double counting.

Mix artwork was present: 47/49 cards have thumbnails on
https://music.youtube.com/image/mixart with provider query parameters; two have
external/static artwork. All 49 rendered covers loaded after settling and real
scrolling in three later runs. These were absolute URLs, not missing/relative
thumbnail tokens. The old diagnostic allowlist rejected the Music host, explaining
its 2/49 recognized images. The experimental analyzer now accepts specifically
that host/path. Production normalization was not changed. Keep the provider's
complete image URL, including its query, rather than reconstructing the cover.
The mix renderer path is thumbnailRenderer.musicThumbnailRenderer.thumbnail.thumbnails.
Search result artwork was recognized for every card on all measured category pages.

## Authenticated client versus minimal cookie-session request

The site client successfully returned 49 mixes. A session.fetch request using the
same cloned session, explicit credentials=include, observed browse ID/params and
only minimal clientName/clientVersion/hl context returned HTTP 401 in 102 ms and
zero cards. Earlier minimal-context attempts also returned 401. No authorization
header or cookie value was inspected or exported. This demonstrates that this
minimal request is insufficient; it does **not** isolate whether authorization,
additional client context, request origin, or another condition causes the failure.
Do not replace the site's client transport with a presumed cookie-only adapter.

## Deduplicated API endpoint inventory

These are all distinct API endpoints observed in the broadened client capture,
not a claim to enumerate every YouTube API. All used POST.

| Endpoint | Relevance / captured scope |
| --- | --- |
| /youtubei/v1/search | Typed keyword search and its continuation pages; catalog summaries captured. |
| /youtubei/v1/music/get_search_suggestions | Search suggestion service observed; request/response bodies not captured. |
| /youtubei/v1/browse | Library, mix collection, directory and homepage continuations; catalog summaries captured. |
| /youtubei/v1/next | Additional client data call; catalog-only analysis captured, purpose/content not fully established. |
| /youtubei/v1/guide | Navigation service observed; bodies not captured. |
| /youtubei/v1/account/account_menu | Account service observed incidentally; bodies not captured or inspected. |
| /youtubei/v1/att/get | Attestation service observed separately; bodies not captured or inspected. |
| /youtubei/v1/log_event | Telemetry observed; bodies not captured. |

The Home/search document GET and /image/mixart image GET are also relevant data
loads; neither is an additional youtubei API endpoint. No player API call was
observed in this bounded non-playback investigation.

## Actual-client search category queries

Separate query inventory requested during the investigation. Search term:
indie roadtrip, used only for search testing. Every parameter below came from an
actual client category chip; every category was clicked, and its next page loaded
by the actual scroller. Category names describe client controls, with response
types checked independently. These searches do not validate personalized presets.

POST /youtubei/v1/search with query plus returned params:

| Category | Exact observed params | First page: cards / ms | Next page: cards / ms / new IDs |
| --- | --- | --- | --- |
| Albums | EgWKAQIYAWoQEAkQAxAEEAoQFRAQEBEQDg%3D%3D | 20 / 588 | 20 / 719 / 20 |
| Songs | EgWKAQIIAWoQEAkQAxAEEAoQFRAQEBEQDg%3D%3D | 28 / 619 | 20 / 549 / 20 |
| Videos | EgWKAQIQAWoQEAkQAxAEEAoQFRAQEBEQDg%3D%3D | 20 / 495 | 20 / 771 / 20 |
| Community playlists | EgeKAQQoAEABahAQCRADEAQQChAVEBAQERAO | 20 / 812 | 20 / 693 / 19 |
| Profiles | EgWKAQJYAWoQEAkQAxAEEAoQFRAQEBEQDg%3D%3D | 20 / 491 | 20 / 555 / 19 |
| Episodes | EgWKAQJIAWoQEAkQAxAEEAoQFRAQEBEQDg%3D%3D | 20 / 548 | 20 / 487 / 20 |
| Podcasts | EgWKAQJQAWoQEAkQAxAEEAoQFRAQEBEQDg%3D%3D | 20 / 516 | 20 / 576 / 18 |
| Featured playlists | EgeKAQQoADgBahAQCRADEAQQChAVEBAQERAO | 20 / 443 | 4 / 468 / 4 |

Album, playlist, user-channel and podcast responses carry explicit corresponding
MUSIC_PAGE_TYPE values. Songs/videos/episodes carry video IDs; distinguishing
those three requires their source category and more metadata than the current
experimental summary. Community/Featured pages contain playlist cards and no
single-video cards. Featured's 4-card next page has no further continuation;
other measured next pages still advertise one. All measured cards have artwork.
Opaque parameter suffixes differed across runs (earlier examples end in
EBAQDhAR rather than EBEQDg). Reuse newly returned parameters; do not claim the
entire string is a universal stable constant.

## Recommended integration and remaining questions

Use a narrow adapter around the site's own authenticated client/navigation and
observe sanitized catalog responses. Request the validated Library and Mixes
collections by their observed commands; retain provider pagination separately
from reload/sort commands. Normalize Music /image/mixart covers. Treat Home as a
mixed recommendation feed, retain response membership and explicit item types,
and exclude known library IDs for new-to-library discovery. That exclusion alone
does not make a feed a community preset. Do not ship a Community-only preset until
a stable server marker or standalone query is actually demonstrated.

Unresolved: language-independent community shelf selection; a playlist-only
recommendation preset; which additional transport/context requirements explain
the 401; personalized mix completeness outside this collection; exact ordinary
created/saved versus special Library-entry counts; and whether mix image URLs
remain valid outside the session/over cache expiry. Genre category commands were
observed but their collections were not validated in this pass.

Three launch attempts aborted with SIGABRT before module startup; immediate
retries succeeded. Their profiles were cleaned by the launcher. Crash causation
was not investigated. Successful prototypes exited; the main app was untouched.

Evidence: ignored reports/pass1-baseline.json, pass2-endpoints-artwork.json,
pass3-api-inventory.json, pass4-search-categories.json and latest.json. The third
run's later search clicks used detached chips and did not change categories;
only its initial album request/pages are evidence. This was corrected by finding
the live chip using its exact returned params; the fourth run validates all eight
categories. reports/api-inventory.json deduplicates endpoint identities and exact
query/advertised-command variants across runs. Syntax checks passed; conclusions
above come from actual account/client responses and loaded images, not fixtures.

Generated reports, raw response captures, screenshots and inactive test profiles
were removed during pre-commit cleanup on 2026-10-12. The measured findings above
are retained; referenced ignored report paths describe outputs regenerated by
running the lab, rather than files included in the commit.
