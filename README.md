# Yinamp

A compact, Winamp-inspired YouTube player: beveled controls, an LED display, draggable windows, playlists, and editable skins. The original design concept is preserved in `work/yinamp-preview.html`.

## Run

Requires Node.js 22 or newer. No dependencies to install.

```sh
npm run dev
```

Open **http://127.0.0.1:5173** in your browser. Use `npm start` without the development watcher. If the port is occupied, run `PORT=5174 npm run dev`.

Serve the app over HTTP; opening `index.html` directly does not work with ES modules or YouTube’s embed identity requirements. The server listens on your computer’s loopback interface only.

## Use

- Press **+ ADD** (or eject) and paste a YouTube link or video ID. Watch, Shorts, live, music, embed, and `youtu.be` links work. Link timestamps are preserved.
- Paste a YouTube playlist link into **+ ADD** to append its available videos in order. A video link with `list=...` offers **Add the entire playlist**; uncheck it to add just that video. Existing tracks are kept and duplicates are skipped. Titles fill in in the background, and importing a playlist does not interrupt the current track.
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

This first version runs as a browser app with an embedded YouTube player, not as a native desktop WebView. It uses the official [YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference). Internet access is required; some videos disallow embedding or require sign-in, and browsers can block autoplay. Errors appear beside the player with Retry and an Open on YouTube link. Video-owner restrictions are preserved.

YouTube does not expose its decoded audio to the app. EQ and balance are visibly disabled rather than pretending to process audio. The LED spectrum is a decorative animation; it is not an audio analyzer. YouTube’s native controls remain available. No YouTube API key is needed; the local server uses YouTube oEmbed for optional title lookup, and lookup failures do not block playback.

Online playlist import uses a temporary visible YouTube preview and the player API’s `getPlaylist()` method. When the preview fails (for example, the first video disallows embedding), the local server falls back to reading the playlist’s public YouTube page. Public and accessible unlisted playlists can be imported without an API key. Private, empty, personalized, or otherwise unavailable lists produce an error; Cancel stops the import without changing the queue. The queue holds up to 500 unique videos. Imports capture the videos YouTube exposes at that moment, rather than synchronizing later changes to the source playlist. The public-page fallback depends on YouTube’s page structure; if only a first page is exposed, the import message reports that limitation. Playback restrictions still apply to individual tracks.

## Development

```sh
npm test
```

- `src/core.js`: URL parsing, playlist progression, persisted state, skin validation.
- `src/youtube.js`: official player API adapter and connection/error states.
- `src/playlist-import.js`: cancellable online playlist preview and track discovery.
- `playlist-listing.mjs`: public listing fallback for playlists whose preview is blocked.
- `src/panels.js`: window dragging, snapping, and saved positions.
- `src/app.js`: UI bindings, playback state, playlist editing, import/export.
- `server.mjs`: local static server and fixed-destination title lookup.

Tests cover input validation, playlist merging and preview lifecycle, persistence recovery, repeat/shuffle behavior, static serving, and metadata failure handling. Browser checks verify the interface with a mocked player API as well as a real YouTube embed; real playback depends on video availability and the network.
