<div align="center">

# ϟ yinamp

**Less feed. More music. Back to the desktop.**

A tiny pet project with one foot in the 2000s and the other in a YouTube queue.

[Get it running](#press-play) · [Player guide](docs/player-guide.md) · [MIT license](LICENSE)

![Yinamp browser demo: classic gray windows, green display, equalizer and playlist editor](docs/images/yinamp-player.jpg)

_Best viewed with your favorite skin and a completely unreasonable attachment to desktop music players._

</div>

## What is this thing?

Remember when a music player looked like a tiny piece of hi-fi equipment? When buttons had edges, displays glowed radioactive green, and rearranging three little windows counted as personal expression?

Yinamp wants some of that back. A familiar, Winamp-inspired interface, rebuilt for modern streaming: draggable windows, a playlist editor, skins, keyboard shortcuts, and YouTube playback. No MP3 collection required. Bring your own questionable taste.

## The actual experiment

This is a pet project exploring how far agentic code building can go with the bare minimum of human intervention. The human brings the idea, taste, nudges, and occasional “that button should probably work.” Coding agents do the bulk of the implementation and iteration.

A known interface gives the experiment something concrete to aim at. The nostalgia sets the visual direction; streaming, browser restrictions, persistent state, and desktop integration supply the interesting problems.

This isn't a claim that software now builds itself perfectly. Things break. Assumptions sneak in. A convincing interface can hide an unfinished feature. The point is to find out what works by building something you can actually poke, play with, and inspect. The source, tests, and development notes are here for that reason.

**Small ambition: make a lovely little player. Bigger curiosity: see how little hand-holding it takes.**

## Press play

Requires **Node.js 22.12+** and **pnpm 10**.

```sh
pnpm install
npm run dev
```

Open **http://127.0.0.1:5173**. Click **+ ADD**, paste a YouTube video link, and hit play. Drag the title bars. Try **Skins**. Make yourself at home.

For the Electron desktop prototype:

```sh
npm run desktop
```

The desktop version adds a native YouTube player, account sign-in, personal playlists and mixes, and deeper music discovery. The runtime may download on first launch. This is a development app, not a signed installer.

## Live on the world wide web

The repository includes a GitHub Pages deployment workflow. Once enabled, the live demo URL appears in the repository's **Deployments → github-pages** entry and **Settings → Pages**. The permanent link will be added here when the repository exists.

The demo runs the real browser interface: add individual YouTube videos, manage your queue, move windows, and try skins. YouTube decides which videos can play in embeds; availability, region, ads, and browser autoplay rules still apply. Playback needs a click.

| Feature                          | Pages demo                   | Local browser             | Desktop prototype   |
| -------------------------------- | ---------------------------- | ------------------------- | ------------------- |
| Windows, skins, queue, save/load | Yes                          | Yes                       | Yes                 |
| YouTube playback                 | Embedded player              | Embedded player           | Native watch page   |
| Music search & discovery         | Needs local app              | Local server              | Desktop integration |
| Personal library & account       | —                            | —                         | Yes                 |
| Playlist links                   | Embed preview when available | Preview + server fallback | Desktop integration |

GitHub Pages hosts static files, so the demo cannot run the Node server or desktop account features. It tells you this up front instead of pretending to search.

## A few honest rough edges

- YouTube audio stays inside its player in a regular browser. The browser equalizer and balance controls are unavailable; the spectrum is a decorative simulation. See the [equalizer notes](docs/equalizer.md) and [visualizer notes](docs/audio-visualizer.md) for desktop behavior.
- Provider pages and internal responses can change. Search, discovery, and desktop integration are experimental.
- Playlists, skins, and layout are saved locally. The desktop YouTube session is separate from your normal browser. See the [account and diagnostics guide](docs/player-guide.md#youtube-account).
- Yinamp is an independent project, unaffiliated with Winamp, YouTube, or Google. Music and third-party branding belong to their respective owners. The MIT license covers this project's code, not streamed media.

## Tinker with it

Plain HTML, CSS, and JavaScript; Preact Signals for reactive state; a small Node server; an Electron desktop shell. No frontend bundler required for local use.

```sh
npm test              # run the test suite
npm run build:pages   # assemble the static demo in dist/
```

The [player guide](docs/player-guide.md) covers controls, skins, playlist imports, architecture, and desktop troubleshooting. [TODO.md](TODO.md) and the other development notes show the work in progress, warts included.

Bug reports, small fixes, and delightfully unnecessary skins are welcome. Describe what you expected, what happened, and whether you used the browser demo, local browser, or desktop app. Please keep cookies, credentials, and personal diagnostic data out of public issues.

## License

[MIT](LICENSE) · Copyright © 2026 Uri Kutner.

Dependencies keep their own licenses. The Pages build includes the Preact Signals license beside its bundled module.

---

<div align="center">

**✦ UNDER CONSTRUCTION, IN THE GRAND TRADITION OF THE INTERNET ✦**

No visitor counter. You're still visitor number 000001 in our hearts.

<div align=center><img src='https://www.counter12.com/img-wBYwzb4DwBbW0220-26.gif' border='0' alt='free counter'></div>

</div>
