# Lucky Dreamer — cloud edition

Roll a band, keep a lane, and explore another pattern or sound. The original cloud interface and whole-band engine come from Aldrin Payopay / DRINOMAN's supplied Aug 27 edition. The integration restores that interface with bounded audio, history, sharing and export lifecycles.

From the repository root:

```sh
npm run build
npm run test:lucky:contracts
npm run test:lucky:audio
npm run test:lucky:locks
npm run test:lucky:browser
```

`build-cloud.py` verifies the preserved inputs against `provenance.json`, then builds `dist/instruments/lucky-dreamer.html`. It also works in a copy containing only the nine source inputs, without `reference/`. The host build embeds this same page in the portable edition and versions its offline cache. The previous player remains in `src/lucky/`; its rollback test reproduces the previous published artifact rather than comparing old tests with the new UI.

## Sound and replay

The Sound control selects from compatible inherited synthesis patches and layered stacks. Six palettes organize them by timbre. Per-lane Sound rolls leave every note, hit, harmony and tempo unchanged; pattern rolls remain separate. The catalogue exposes 104 supported patch entries plus eight existing stacks. Nine legacy drum entries lack a compatible Part adapter and are not advertised as working voices. Shared kit labels with identical selected drum voices are omitted from automatic Sound cycles; their original IDs remain available for direct selection.

`LuckyCloudSoundBank` is worker-safe and exposes `normalize`, `catalog`, `build`, `apply`, `capture`, `validateCapture` and `inventory`. Its versioned config is `{version:'1.0.0',palette:'full',lanes:{}}`. Manual lane choices use existing IDs such as `fm/ebell`; choosing one resets that lane's sound counter. The seed, sound palette and counters determine the selected timbres.

Keeping a lane pins the original tonal frame. Its source recipe regenerates the allowed sound and events; imported raw patch graphs are never trusted. Locks retain the original humanized onset and accented velocities. History preserves lock snapshots. A copied address keeps this version's seed and controls; lock snapshots remain in PAST and are not promised by that address. History uses local storage where available, with a session fallback when storage is unavailable.

## Audio and exports

Playback starts with an explicit user action. Worklet audio and the compatibility path share the same engine and sound bank. Stop cancels pending playback and fades to silence. Destroy releases timers, workers, object URLs and the AudioContext. Export creates the visitor's MIDI, rendered WAV, or stems plus mix/MIDI on the current device; it can be cancelled. The built-in instrument makes no network request and does not require a hardware MIDI permission.

`window.LuckyCloud` exposes state, source world, seed/restore, per-lane roll/lock/mute/solo, play/stop, copy address, MIDI/WAV export, cancellation and destroy. `window.LuckyDreamer` aliases this current API for host lifecycle compatibility; it is not a promise of the previous player's entire API. The host listens through the existing panic/dispose events and Save tray.

## Evidence and limits

The tests load the exact shipped scripts. Contracts check the pinned extraction, public-only rebuild, deterministic scores, sound/score independence, real locks, malicious recipe rejection and balanced MIDI. PCM checks render every inherited style at 44.1 and 48 kHz, compare same-score timbres and verify Stop. Separate isolated Part/Kit tests compare locked drums across a new seed and palette. Browser tests exercise Chromium and WebKit at desktop/phone widths, opaque iframes, exports, history and teardown.

Test reports are generated in `tests/evidence/` and ignored by Git. CI retains JSON reports only; it does not publish audition audio, screenshots or visitor MIDI. Finite samples, headroom and different timbres do not establish taste, cultural authenticity, legal clearance or physical-device latency. See the root NOTICE and component inventory for inherited rights and artwork scope.
