# Desktop equalizer

Electron playback supports nine peaking filters (60, 170, 310, 600, 1k, 3k, 6k, 12k and 16k Hz; Q = 1) and preamp, each adjustable from −12 to +12 dB in 0.5 dB steps. ON/BYPASS preserves the curve; RESET restores enabled, flat settings. Settings are validated, saved with the player state and applied again on each watch-page navigation. Replaced video elements reconnect to the same graph. Browser iframe playback retains disabled EQ controls.

The audio path is media source → preamp → nine filters → spectrum analyser → listening volume/mute → output. The spectrum now reflects the processed audio and stays independent of listening volume/mute. Parameters settle smoothly with a 15 ms time constant. The curve display joins slider values; it is not a measured frequency-response plot.

Band boosts do not change the overall preamp gain. PRE controls overall gain manually; lower it if boosts cause distortion. Bypass restores unity preamp and zero filter gains. The filters remain connected during bypass. Controls report EQ unavailable when the desktop audio graph cannot be installed; ordinary playback still works.

## Validation — 2026-10-12

All 87 project tests pass, including EQ state round trips, corrupt settings and IPC validation. An isolated Electron instance verified sliders, bypass/reset and persistence after reload. A real 1 kHz PCM media source verified −12 dB attenuation, −6 dB preamp, +12 dB boost with the original compensation, unity bypass, silence on mute and 37% output volume.

Live YouTube playback checks passed on two tracks: retained EQ across track changes, bypass/restoration, pause/resume and no renderer errors. The desktop panel screenshot was inspected.

A short alternating local-tone CPU comparison measured the audio renderer at roughly 0.19% machine-wide with filters disconnected and 0.30% with all nine filters active (−3 dB each): about 0.10 percentage points added on this machine. These are two five-second samples per condition, not a long-duration or cross-device benchmark. Other renderers were excluded from this comparison. QA sources and raw measurements are kept under ignored `work/qa/equalizer-*` paths; isolated test instances were closed.

## Manual preamp update — 2026-10-13

Removed automatic compensation after user review: boosting a band now leaves preamp unchanged. All 87 tests pass. The isolated PCM check measured a +12 dB band boost at about 3.98× baseline amplitude with unity preamp, and rechecked cuts, manual preamp, bypass, mute, volume and saved controls.
