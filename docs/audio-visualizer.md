# Desktop audio visualizer

The desktop player replaces simulated bars with 20 logarithmic frequency bands from the YouTube watch-page video. Ads are included. Browser iframe playback shows a simulated decorative spectrum because the embedded player does not expose audio samples. It animates only during PLAYING, settles to zero for other playback states, stops while the page is hidden, and uses a static pattern for reduced motion. It uses a slower 100 ms rendering interval, with the same discrete LEDs as the desktop renderer.

## Audio and timing

The graph is media source → EQ preamp → nine filters → analyser → listening gain → output. See `docs/equalizer.md` for EQ behavior and validation. The source stays at full volume and unmuted; the listening gain handles volume and mute after analysis. No volume compensation is applied to spectrum values. The native video volume control is hidden when the graph is available; Yinamp’s slider and mute button control output.

Sampling and rendering share a 20 Hz budget in `src/spectrum-config.js`. Desktop sampling uses a fixed 50 ms interval with an in-flight guard. Rendering uses requestAnimationFrame with an elapsed-time cap and remainder carry, without catch-up bursts. Bar transforms avoid height layout changes. Rendering settles and stops when inactive; sampling stops for paused playback or a minimized/hidden window. Each watch-page navigation installs its own graph, and replaced video elements reconnect to that graph.

## Validation — 2026-10-12

All 60 project tests passed. Live desktop checks passed on two YouTube tracks: spectrum output, pause, seeking, resume, track changes, zero volume, and mute. A continuous local tone verified unchanged analyser levels and spectrum while downstream output changed with volume or became silent.

A short alternating comparison on a Mac with 10 logical CPUs measured ~2.91% machine-wide CPU with spectrum sampling/rendering disabled and ~3.50% enabled, an incremental ~0.59 percentage points (about 5.9% of one core). The graph remained connected in both modes. This noisy short check is not a battery, audible-glitch, long-duration, or cross-device benchmark. Active phases received about 98 samples and 100 paints per five seconds; maximum sample gaps were below 57 ms, with none above 150 ms.

Electron normalizes its CPU percentage by logical processor count: https://github.com/electron/electron/blob/v44.7.0/shell/browser/api/electron_api_app.cc#L1345-L1363 . The earlier experiment’s ~4.7% reading was machine-wide, not a percentage of one core.

Prototype code, machine-specific QA scripts, screenshots, profiles, and raw measurements remain local under the ignored `work/qa/` directory. The prototype archive is `work/qa/audio-visualizer-archive/`.

## Browser fallback — 2026-10-13

The browser fallback uses a shared slow pulse and smooth waves across adjacent bars, with faster attack, slower decay and small smoothed random variations. Rise and fall smoothing use 1/φ and 1/φ³ (approximately 0.618 and 0.236). It replaces the earlier independent random heights. The accessible label and tooltip identify it as simulated. All 88 project tests pass; browser checks with controlled YouTube events verified sustained animation, pause/stop settling and a static reduced-motion pattern. The renderer lifecycle test also verifies hidden-page suspension and resumption. Electron continues to consume real spectrum samples.
