# Yinamp

A compact, Winamp-inspired YouTube player: beveled controls, an LED display, draggable windows, playlists, and editable skins. The original design concept is preserved in `work/yinamp-preview.html`.

## Run

Requires Node.js 22.12 or newer. Install dependencies once with `pnpm install`.

```sh
pnpm install
npm run dev
```

Open **http://127.0.0.1:5173** in your browser. Use `npm start` without the development watcher. If the port is occupied, run `PORT=5174 npm run dev`.

Serve the app over HTTP; opening `index.html` directly does not work with ES modules or YouTube’s embed identity requirements. The server listens on your computer’s loopback interface only.

## Desktop prototype

```sh
pnpm install
npm run desktop
```

The Electron prototype reuses the player interface but loads normal YouTube **watch pages** in a native `WebContentsView`. The transport buttons control the page’s HTML media element. It starts its own local server, so you don’t need `npm run dev` alongside it. The Electron runtime downloads on first launch if it is not already installed.

The browser and desktop versions have separate saved settings. Use **SAVE** in the browser and **LOAD** in the desktop app to transfer a playlist. Desktop settings are stored in `yinamp-state.json` inside Electron’s Yinamp user-data directory. Imported iframe-specific embedding failure marks are cleared so those videos can be tried with the desktop player.

The native view follows the video panel when dragged and hides while dialogs are open or another window covers it; audio can continue. The fullscreen button expands the video panel; Escape returns to the normal view. The watch-page integration keeps native YouTube player controls and advertisement playback. It is a prototype, not a signed installer, and page layout changes can require updates. YouTube sign-in, consent, regional restrictions, and content availability still apply.

### YouTube account

Open **Account** in the desktop app, then choose **SIGN IN / MANAGE ACCOUNT**. A separate account window opens YouTube’s account page and its Google sign-in flow. You enter credentials directly in that window. It shares the video player’s persistent `persist:yinamp-youtube` session, separate from the interface and from your normal browser. The account window has no preload, app IPC bridge or injected playback scripts. Google authentication pages are never inspected; the app reads only the login flag, avatar, displayed account name (when available), and Premium branding on normal YouTube pages.

Close the account window when finished, then press Play. The current video reloads paused at its latest position to pick up the session changes. **SWITCH ACCOUNT** opens Google’s account chooser. **SIGN OUT OF YINAMP** closes the account window and clears only the desktop YouTube session; saved playlists, skins and normal browser accounts are preserved.

The header shows your avatar and the current login state. **Update player** means the account window has a different login state from the player's loaded page; choose **UPDATE PLAYER SESSION** to reload the current track paused. **Player connected** confirms that the player's YouTube page reports the same signed-in account. The Premium badge appears only when the player's page displays Premium branding; absent branding is not treated as proof that an account lacks Premium. **CHECK LOGIN STATUS** refreshes these observations. Identity is kept in memory, not stored in saved playlists or diagnostic logs.

Google may reject sign-in in embedded browsers. Opening the form does not establish a Premium session, and completing sign-in/Premium playback requires your own account. No credentials are imported from a browser profile, and no external OAuth token is treated as a YouTube website login.

Electron 45.0.0-beta.1 was evaluated on October 12, 2026 in separate test profiles. Playback controls, account windows, switching, session persistence and sign-out passed. The default remains Electron 44.7.0, the latest stable release at the time of evaluation. The beta's native macOS passkeys require a signed and provisioned app plus a domain association authorizing that app on the login domain; upgrading the runtime alone does not enable Google passkeys in this prototype. Use Google's **Try another way** option for password and other verification methods.

### Desktop diagnostics

If the video process stops unexpectedly, Yinamp keeps the queue and offers **Retry** to reload the track. Desktop diagnostics are stored locally as `yinamp-diagnostics.jsonl` in Electron's user-data directory (or the directory specified with `--profile`). **Account → OPEN LOGIN LOG** reveals the file. The log records startup/shutdown, process IDs, Electron versions, renderer/child-process failures, account-window responsiveness, and login navigation. Navigation entries contain only hostnames, route categories (such as password or session transfer), HTTP status or network error codes, and blocked-redirect events. It excludes page content, full URLs, query parameters, account names, credentials, form data and cookies; the previous log is retained when the current log exceeds 256 KiB. Native main-process crashes can also produce macOS reports in `~/Library/Logs/DiagnosticReports`.

## Use

- **Music Library** lives below the player and queue. **MY PLAYLISTS** reads the desktop account's YouTube Music Library. **MIXES** opens the expanded personalized mix collection directly. **DISCOVERY** loads playlist cards from the personalized homepage feed, including mixes and saved playlists, with entries whose creator channel ID matches your own excluded. Saved playlists from other creators and mixes without owner metadata remain visible. Songs, albums and podcast entries are excluded by the playlist parser. The tabs can overlap. Filter loaded titles with **Find a playlist**; ↻ refreshes the view. Personal sources use the app-only account session. Public/browser discovery retains Community/Featured playlist search.
- Click a library card's **PLAY** to replace the queue and begin listening. A failed load preserves the old queue. Fresh installs start empty; the exact three-song demo prefix from older installations is removed once, preserving the remaining tracks and settings. A regular browser or signed-out desktop offers public **DISCOVER** through YouTube Music’s Community/Featured playlist search categories (a broad music query); personal sources use the desktop account. Songs, Enter-to-search/autocomplete, active-playlist labels, and artist/album display are tracked separately in `TODO.md`.
- Catalogs and playlist contents are cached in memory for **30 minutes**. Reopening the same playlist reuses the loaded tracks; ↻ bypasses the cache and clears cached contents for the next playlist open. Desktop caches are cleared on account changes/sign-out and disappear when the app exits. This also applies to changing mixes; refresh when you want a new selection.
- Press **+ ADD** (or eject) and paste a YouTube link or video ID. Watch, Shorts, live, music, embed, and `youtu.be` links work. Link timestamps are preserved.
- Paste a YouTube playlist link into **+ ADD**, then **OPEN PLAYLIST**, to replace the queue with its available songs in order. A video link with `list=...` offers **Add the entire playlist**; uncheck it to append just that video. The current queue and playback remain intact until the new playlist loads successfully. Titles fill in in the background.
- Select a track; press play. Double-click a track to play immediately. Previous/next, pause, stop, seek, volume, mute, shuffle, and repeat are connected to the YouTube player.
- Repeat cycles through off, playlist, and one track. Without repeat, playback stops at the end of the playlist.
- Videos that fail playback are marked **UNAVAILABLE**, with a per-row Retry button and an Open on YouTube link. During playback the queue skips them, including in shuffle/repeat modes. If no playable tracks remain, playback stops instead of looping through errors. Connection/identity errors do not mark the whole playlist unavailable.
- Marks are saved with the playlist. Failed tracks become eligible for another attempt after 15 minutes when normal playlist playback reaches them; there is no background autoplay. Click a row’s **↻** to retry immediately. The playlist’s **RETRY** button makes all marked tracks eligible again, leaving a current song uninterrupted. A successful playback clears the mark. Retrying cannot override a video owner’s embedding restriction.
- Use the arrows next to a playlist row to reorder it; × removes it. **SAVE/LOAD** export/import playlist JSON.
- Drag window title bars on desktop. Nearby edges snap together. **Arrange windows** resets positions. On smaller screens the windows stack.
- **EQ/PL** show or hide the equalizer and playlist. Your playlist, settings, layout, and skin are stored in this browser’s local storage.
- Keyboard: Space play/pause, left/right seek, up/down volume, M mute, N/P next/previous. Shortcuts don’t intercept text input, dialogs, or focused controls.

## Skins and modding

Open **Skins** to choose Classic, Amber, or Ice, edit seven colors live, name your skin, and export it. Import a skin to share a setup across browsers. Example skins are in `skins/`.

Skin format:

```json
{
  "version": 1,
  "name": "My skin",
  "colors": {
    "shell": "#30313f",
    "edge": "#7c7e91",
    "accent": "#a7ff48",
    "screen": "#080e08",
    "text": "#dddde7",
    "button": "#aeb0bf",
    "desktop": "#14151e"
  }
}
```

All colors must be six-digit hexadecimal colors. Skin tokens apply to all windows and transport controls. To change shapes, textures, fonts, or control artwork, edit `src/styles.css` and the semantic buttons in `index.html`. Their IDs are the bindings used by `src/app.js`; keep those IDs when replacing artwork. Legacy Winamp `.wsz` skins are not supported in this version.

## YouTube behavior

The browser version uses the official [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference). The desktop prototype uses ordinary watch pages instead. Internet access is required; some videos disallow embedding or require sign-in, and browsers can block autoplay. Errors appear beside the player with Retry and an Open on YouTube link. The desktop version’s page bridge does not extract media URLs or replace YouTube’s playback system.

YouTube does not expose its decoded audio to the app. EQ and balance are visibly disabled rather than pretending to process audio. The LED spectrum is a decorative animation; it is not an audio analyzer. YouTube’s native controls remain available. No YouTube API key is needed; the local server uses YouTube oEmbed for optional title lookup, and lookup failures do not block playback.

Desktop catalogs use temporary, hidden, muted windows in the app's YouTube session. My Playlists opens the Library listing; Mixes opens the validated `FEmusic_mixed_for_you` browse route with its observed parameters; Discovery opens Home. The website makes authenticated requests and follows continuations through its actual content scroller. The adapter observes only browse catalog responses and visible active-page metadata; it does not synthesize authorization, replay cookie-only requests, inspect Google authentication pages, or retrieve attestation/account response bodies. Reload/sort commands are not treated as next pages. Mix covers retain complete provider `/image/mixart` URLs. Catalogs are cached for 30 minutes, Refresh bypasses caches, and account changes invalidate results. Browsing does not replace the playback queue. Catalog collection is bounded to 18 seconds after document load and 1,000 unique cards, with a 35-second overall page timeout; unfinished listings are marked partial. Discovery is the provider’s changing feed. Owner filtering uses the exact creator channel ID from playlist bylines and your public channel ID from YouTube advanced settings, cached in memory for 30 minutes and cleared on Refresh/account changes. It does not compare Library/Mixes listings or names. Unknown owners remain visible; an identity lookup failure is reported without guessing. This is not a guaranteed complete or new-only playlist catalog. Playlist import continues using temporary muted views and up to 500 unique songs. Browser playlist import uses the player API with a public-page fallback; public discovery uses typed Community/Featured search with up to three pages per category. YouTube page changes can require adapter updates. Playback restrictions still apply to individual tracks.

## Development

```sh
npm test
```

- `src/core.js`: URL parsing, playlist progression, persisted state, skin validation.
- `src/youtube.js`: official player API adapter and connection/error states.
- `src/playlist-import.js`: cancellable online playlist preview and track discovery.
- `playlist-listing.mjs`: public listing fallback for playlists whose preview is blocked.
- `src/panels.js`: window dragging, snapping, and saved positions.
- `src/app.js`: player commands, playlist editing, import/export, and explicit save requests.
- `src/player-ui.js`: scalar signals and small effects for controls, visibility, playback, and playlist selection. Use `savedPlayerState()` for persistence and queue navigation; keep queue edits explicit.
- `src/persistence.js`: debounced settings saves, flushed when the page is hidden or left.
- `server.mjs`: local static server and fixed-destination title lookup.
- `electron/`: desktop shell, isolated UI bridge, public watch-page playback, and persisted settings.
- `src/native-player.js`: desktop implementation of the player interface.

The UI uses `@preact/signals-core` without a build step. An import map loads its installed ESM entry through one fixed server route. Changes to scalar signals update their dependent controls automatically; group related writes with `batch()`. Queue edits and metadata changes rebuild rows, while selection updates existing rows.

Tests cover input validation, playlist merging and preview lifecycle, persistence recovery, repeat/shuffle behavior, static serving, and metadata failure handling. Browser checks verify the interface with a mocked player API as well as a real YouTube embed; real playback depends on video availability and the network.
