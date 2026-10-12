# Discarded mix grouping experiment — insights

The user explicitly requested reverting grouping entirely on 2026-10-12.
Grouping UI, preview server, generated preview data, diagnostics specific to
this experiment and its QA script were removed. The main app retains its
original flat Mixes collection. The audio-visualizer experiment was untouched.

Useful provider findings:

- The real expanded collection returned 49 cards in one flat grid.
- No explicit mix-family/ordinal field was found in the inspected card metadata.
- All 49 cards had identical navigation params and playlist page type; these
  fields do not establish family membership.
- Generic numbered-title matching found nine sets of three (27 cards), leaving
  22 standalone entries. This remains a naming heuristic, not a provider category.

Useful design findings:

- Full-width expansion panels, grid reflow and separate family sections disrupted
  the existing library too much.
- A stable card footprint and fixed description placement were better received.
- Large fixed hover targets with the selected cover fully in front worked better
  than thin cropped cover strips.
- Moving artwork among corner regions and resizing it did not meet the user's
  intended interaction. Those variants were not approved for integration.
- Touch needs an explicit preview/selection distinction; opening a group must
  never cause accidental playback. Keyboard access must remain available.

These notes are retained as evidence and lessons only. Grouping is not an active
implementation task and no grouping behavior was added to production.
