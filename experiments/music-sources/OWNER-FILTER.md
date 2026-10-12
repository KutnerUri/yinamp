# Discovery owner evidence — 2026-10-12

Actual client Home/Library cards expose creator channel IDs in subtitle runs tagged
MUSIC_PAGE_TYPE_USER_CHANNEL. Artist credits use a different page type. The
visible channel field on YouTube’s advanced account page independently identified
the signed-in public channel; it matched the creator IDs on 21 ordinary Library
cards. Identity was not inferred from those cards or their names.

The production adapter now retains explicit creator IDs and excludes exact
current-channel matches only in Discovery. One cached public channel lookup is
used; neither Library nor Mixes catalogs are loaded for filtering. Unknown owners
are retained. The 49-card expanded Mixes collection had no explicit creator IDs,
so those provider-personalized mixes are outside the owner-only exclusion rule.

Real production check: 54 raw feed playlist cards minus 12 own-creator cards = 42
Discovery results, 6.7 seconds cold and immediate cached repeat. My Playlists stayed
at 23; Mixes stayed at 49 with all covers loaded. Fifty-eight regression tests
and controlled desktop owner/playback/cache checks passed. No auth values or full
account contexts were inspected/exported, and no real account ID is stored here.

Rerun metadata investigation with `npm run prototype -- --auto --owners`, or the
production adapter check with `npm run prototype -- --auto --validate-production`.
Generated reports are ignored and were cleaned after recording these findings.

### Mix title inspection — 2026-10-12

Authorized live session-snapshot probe (`npm run prototype -- --auto --mix-metadata`) inspected active rendered card metadata from the expanded mix collection and scrolled Home. The collection exposed 48 parsed mix cards this run (49 raw cards), compared with 49 on the previous run. No title contained English “my” or “My Mix 6”; only “הסופרמיקס שלי” contained Hebrew “שלי”. Numbered mood titles used localized names such as “מיקס ברגוע 1” through 3. Descriptions contained artist names. The specific artwork labeled “My Mix 6” was not reproduced, so its corresponding metadata remains unverified. A title-word filter cannot be assumed to detect all personalized mixes.

Code inspection also corrected an earlier report: `parseMusicLibrary(..., 'discover')` already excludes recognized mix cards using their navigation ID/page type. Owner filtering supplements that existing type filter. No new production filter was added. The initial diagnostic Home mix list was empty because it used the Discovery parser; the retained probe now uses the inclusive parser for Home inspection.
