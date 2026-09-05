# Lucky Dreamer — previous player

This directory preserves the previous player for rollback. The shipped cloud edition is documented in [../lucky-cloud/README.md](../lucky-cloud/README.md). The following controls and evidence describe the previous player, not the current app.

Aldrin Payopay’s whole-band browser sketchbook. One die creates an arrangement; the melody returns, answers itself and leaves space. Keep a lane, roll its pattern or sound, move the key, play along, and export a recipe or MIDI score.

## Build and run

From the project root:

```sh
python3 src/lucky/build-legacy.py
node --test src/lucky/tests/*.test.cjs
node src/lucky/tests/held-out-evaluation.cjs
node src/lucky/tests/render-evaluation.cjs
node src/lucky/tests/browser-check.cjs
```

The browser check needs Playwright with Chromium and WebKit installed. It resolves the `playwright` package normally, or accepts `PLAYWRIGHT_MODULE` as an alternate package location. Each browser context and browser closes in `finally`.

Open `dist/instruments/lucky-dreamer.html` directly, or serve it with the MIDI Room. Playback needs no internet, Web MIDI, external assets or account. Sound starts with a click, tap or keyboard gesture. Compatibility audio is available when AudioWorklet cannot load.

## Source contract

- `engine.original.js` is the exact executable `engine-src` from the supplied original Lucky Dreamer. Its SHA-256 is pinned by the builder. The original app UI, manuscript, development diary and embedded documents are excluded.
- `original-provenance.json` names the original file and both hashes. If the full original exists in the development tree, the builder verifies the extraction against it. Public source builds work without that tree.
- `composition.js` adds planned phrases, melodic path search, bounded voice leading, chord-aware pad gates and independent variations over the original whole-band architecture.
- `audio-runtime.js` shares the renderer between the worklet, compatibility mode and tests. It adds exact sample loop boundaries, late-clock recovery, finite-output diagnostics, lifecycle stops and Nyquist-safe metallic voices.
- `player.html` and `player.js` supply the UI. `build-legacy.py` assembles their dependency-free standalone output. Generated HTML is not edited by hand.

The original runtime does not contain its own explicit license notice. Its credited rhythmic/harmonic vocabulary is preserved; that is provenance, not independent clearance of every musical reference. Use the project’s rights documentation for the applicable publication decision.

## Replay and controls

The recipe includes version, seed, selected language, variation counters, tempo, kept lanes, mutes, levels and loop preference. It uses an allowlisted schema and a 64 KB import limit. Version 1.0 recipes are reproducible under version 1.0; later composition algorithms must deliberately migrate or retain this version.

The address contract is `#v=1&seed=NUMBER`, with optional `style`, `bpm`, `r` (JSON variation counters), `m` (muted lane names), `k` (kept lane names), `vol` (JSON levels), and `loop=0`. This is the instrument’s own address, not a MIDI Room host instrument-selection route. Recipes are the portable way to keep a composition across either launch mode.

Keeping a lane protects it during whole-band rolls. Changing musical language starts a new frame and clears keeps. Moving the key is disabled while a pitched lane is kept, so the band cannot silently leave a retained part in the previous key. Sound and pattern variations use separate streams. Tempo preserves the planned lead; inherited drum microtiming expressed in milliseconds changes its step offsets with tempo.

MIDI export contains the currently audible score, with muted and solo-filtered lanes reflected. It carries notes, meter, tempo and instrument hints. A receiving DAW’s instruments determine its sound. Generated WAV exports are not exposed by this player; internal audition renders belong to verification.

## Host/API contract

`window.LuckyDreamer` exposes `version`, `getState()`, `getWorld()`, `compose(seed, options)`, `play(bar?)`, `stop()`, `seek(bar)`, `setSeed(seed, options)`, `variant(lane, kind)`, `exportMidi(download?)`, `recipe()`, `loadRecipe(recipe)`, `noteOn(note, owner?)`, `noteOff(note, owner?)`, and `destroy()`.

`play()` is asynchronous and still requires a browser audio gesture. `exportMidi(false)` returns an ArrayBuffer without downloading. `destroy()` is permanent for that instance, releases its held notes, disconnects nodes and closes its AudioContext. State reports include non-finite sample and clipping counters; those counters are not silently treated as healthy audio.

When present, `window.MidiRoom` receives a capability declaration. The player listens for `midiroom:panic`, `midiroom:dispose` and `pagehide`. Blob-anchor exports use the host’s existing Save tray interception. It does not request hardware MIDI or transmit notes to other instruments by default.

## Evidence boundaries

The tests measure score invariants, deterministic replay, MIDI validity, audio samples, exact loop timing and actual browser controls. Evaluation seeds are separated from development seeds; the first failed density sweep and the first failed metallic-voice render report remain in the local evidence folder. Repairs are followed by new holdouts or named regression tests.

These are musical heuristics, not a learned human performance. Fewer jumps or overlaps do not prove better taste. The renderer produces real audition files, but this agent cannot receive audio input and no human preference result is claimed. Physical phones, external MIDI devices and every possible synthesized patch at every sample rate are not established by desktop Chromium/WebKit results.

## Visual direction

The frontend-design skill guided this interface. Its visual anchor is the raspberry die rising from a simple cloud, with the band’s actual melody drawn below it. The palette is sky `#e7f1ff`, cloud `#fffefa`, ink `#172550`, blue `#21408c`, raspberry `#bd315a` and violet `#797ac7`. Georgia gives the title its storybook shape; Avenir/Trebuchet keeps controls legible offline.

The first view offers one idea and playback. Lane controls, keys, recipes and source context appear when requested. The palette and die preserve the supplied instrument’s playful premise; a dense studio dashboard was rejected during the design review because it would bury the one-roll interaction. Motion answers a roll, respects reduced-motion preferences, and does not continue while the user is reading.
