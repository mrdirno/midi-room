# Production MIDI Room

The deployable directory is `dist/`. The original private development tree remains untouched. Publish the curated `dist/` artifacts or allowlisted public source export; never copy private `reference/` or handoff directories wholesale.

## Launch contract

The root displays the instrument catalog. Canonical links are `./?instrument=triton-rack`, `lucky-dreamer`, `improvisator`, `drum-pad`, `field-keys`, and `dsp-rack`. `?plugin=` and `#instrument=`/`#plugin=` accept the same allowlisted identifiers; `triton` aliases `triton-rack`. Unknown names display a message and never fetch a user-supplied path. Direct standalone files are `./instruments/<id>.html`. Relative shell, manifest, worker and instrument URLs support `/midi-room/` and nested GitHub Pages project prefixes.

TRITON Rack and Improvisator are distinct public views generated from one maintained TRITON16 engine and counted patch builder. The original controller, scheduler, synth and phrase library remain shared source. This is not a claim that the two synthesis implementations have been independently rewritten. Lucky Dreamer has its own standalone extracted runtime and player.

## Browser behavior

Touch/computer-key Web Audio is independent of hardware MIDI. Web MIDI is feature-detected, secure-context gated and requested through MIDI controls. It is optional in every bundled instrument. Moving hosting providers or installing the PWA does not add a missing browser API. The WebKit Web MIDI implementation issue remains open: https://bugs.webkit.org/show_bug.cgi?id=107250 . Web MIDI's secure-context requirement is specified at https://www.w3.org/TR/webmidi/ . WebKit documents user-activation and iframe boundaries at https://webkit.org/blog/13862/the-user-activation-api/ . Sources checked September 5, 2026.

The verified engine is Playwright WebKit 26.5, not the installed Safari application or a physical iPhone. Chromium 151 and WebKit both render and play built-ins without hardware MIDI in the test environment; only Chromium exposes the native MIDI API. See `verification/production-browser.json`, `production-lifecycle.json`, and the Lucky-specific evidence. Real native AudioContext signal measurements establish generated samples, not subjective sound quality or physical device latency.

A real WebKit first-touch race in Drum Pad was fixed: an ordinary released one-shot may start when the gesture's resume settles within 750ms, while cancellation, Stop, reassignment and newer generations invalidate it. TRITON Stop cancels its conductor clock, future voices, held computer keys and touch owners. Field Keys has actual keyboard handlers. The host emits panic/dispose, closes AudioContexts and removes retired iframes. Imported instruments remain opaque-origin sandboxed and cannot access parent storage or make network requests. Real-browser CSP tests verify those boundaries and generated MIDI export through the parent save tray.

## Installation and offline behavior

The manifest includes 192/512 icons and relative scope/start URL. `sw.js` precaches the catalog, shell modules and six self-contained instrument files. Imported files, user maps, generated takes and audio releases are not in the cache inventory. Cache names include the worker path and a content version so another app's caches are untouched. Installation appears where the browser emits `beforeinstallprompt`; other browsers use their own Add to Home Screen/Install flow.

An updated worker waits while existing music continues. Player settings show **Update and reload**. Only that explicit action stops the local room and reloads it. Other open tabs do not automatically reload. Chromium offline-flag navigation and both engines with the origin unavailable reopen all six built-ins. Playwright WebKit's `setOffline(true)` produced an internal navigation error, so its offline proof uses an unavailable origin while the service worker serves its cache. This does not claim a physical iOS airplane-mode installation test.

Serve `sw.js` and `manifest.webmanifest` with revalidation (`Cache-Control: no-cache`); avoid immutable caching for HTML or unhashed JS. Serve the directory over HTTPS in production. The portable HTML remains available separately and bypasses service-worker registration.

## Commands

- `python3 src/build-slice.py`
- `npm test`
- `node tools/production-browser-check.mjs`
- `node tools/production-lifecycle-check.mjs`
- `node tools/production-offline-check.mjs`

Browser scripts launch isolated contexts and close them. They start their own temporary local server.
