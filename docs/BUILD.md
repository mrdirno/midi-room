# Build and test the public edition

Python 3 and Node.js 20 or newer are required. Playback is static HTML, CSS and JavaScript; the public build never needs Python, Node, a package CDN or a MIDI permission to play touch/computer keys.

```sh
npm run build
npm test
```

`src/build-slice.py` rebuilds all six instrument pages, the self-contained `dist/midi-room-local.html`, and the content-versioned service worker. Host modules and shell in `dist/` are maintained source files. Field Keys comes from `src/surface/field-keys.html`; the other generated instrument pages come from their `src/` builders. The portable edition contains the same six instruments inline.

The public TRITON input is `src/triton/inherited-runtime.html`: the supplied executable engine with embedded HTML manuscript/history comments removed. Its separate provenance JSON pins the sanitized input hash and records the original private input hash. Counted transformations fail rather than silently patch an unfamiliar version. Lucky Dreamer similarly uses its sanitized engine input; its source builder records its input boundary. Original private manuscripts are unnecessary to build this edition.

DSP Rack builds from pinned local runtime, authored DSP source, generated C/header and Wasm descriptors under `src/rack/vendor/`. Repacking is deterministic and verifies the supplied artifact identities. Recompiling DSP from scratch requires the original pinned Faust toolchain; the normal app build does not invoke a compiler or network service.

For real browser checks:

```sh
npm install
npx playwright install chromium webkit
npm run test:browser
npm run test:lifecycle
npm run test:offline
```

These scripts serve a temporary local HTTP origin, use real trusted test gestures, and close their browsers. Browser binaries install separately. WebKit means the Playwright build, not the installed Safari app or an iPhone; hardware MIDI and subjective listening are not inferred from it. The WebKit offline check disables the origin because the runner's simulated offline switch produced an internal navigation failure; Chromium also uses its offline flag.

Serve `dist/` over HTTPS (or localhost) for installation/offline support. All built-in asset and launch routes are relative to the app directory, including a nested GitHub Pages prefix. `?instrument=lucky-dreamer` opens that verified catalog member. See `PRODUCTION-COMPATIBILITY.md` for all route IDs, cache headers, offline update behavior and iframe boundaries.

User-created WAV/MIDI/recipe exports remain local, explicit actions. There are no supplied artist song recordings or private prompt libraries in this project. Wish It Better is account-free and sends only on a deliberate Send press; it is not necessary for playing offline.
