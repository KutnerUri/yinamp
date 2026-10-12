# Desktop audio visualizer

The desktop player replaces simulated bars with 20 logarithmic frequency bands from the YouTube watch-page video. Ads are included. Browser iframe playback shows idle bars because the embedded player does not expose audio samples.

## Audio and timing

The graph is media source → analyser → listening gain → output. The source stays at full volume and unmuted; the listening gain handles volume and mute after analysis. No volume compensation is applied to spectrum values. The native video volume control is hidden when the graph is available; Yinamp’s slider and mute button control output.

Sampling and rendering share a 20 Hz budget in `src/spectrum-config.js`. Desktop sampling uses a fixed 50 ms interval with an in-flight guard. Rendering uses requestAnimationFrame with an elapsed-time cap and remainder carry, without catch-up bursts. Bar transforms avoid height layout changes. Rendering settles and stops when inactive; sampling stops for paused playback or a minimized/hidden window. Each watch-page navigation installs its own graph, and replaced video elements reconnect to that graph.

## Validation — 2026-10-12

All 60 project tests passed. Live desktop checks passed on two YouTube tracks: spectrum output, pause, seeking, resume, track changes, zero volume, and mute. A continuous local tone verified unchanged analyser levels and spectrum while downstream output changed with volume or became silent.

A short alternating comparison on a Mac with 10 logical CPUs measured ~2.91% machine-wide CPU with spectrum sampling/rendering disabled and ~3.50% enabled, an incremental ~0.59 percentage points (about 5.9% of one core). The graph remained connected in both modes. This noisy short check is not a battery, audible-glitch, long-duration, or cross-device benchmark. Active phases received about 98 samples and 100 paints per five seconds; maximum sample gaps were below 57 ms, with none above 150 ms.

Electron normalizes its CPU percentage by logical processor count: https://github.com/electron/electron/blob/v44.7.0/shell/browser/api/electron_api_app.cc#L1345-L1363 . The earlier experiment’s ~4.7% reading was machine-wide, not a percentage of one core.

Prototype code, machine-specific QA scripts, screenshots, profiles, and raw measurements remain local under the ignored `work/qa/` directory. The prototype archive is `work/qa/audio-visualizer-archive/`.
