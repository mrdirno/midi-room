# Current cloud edition checks

The current Lucky artifact restores the supplied cloud interface. The older player and its tests remain available for rollback; their historical counts below do not qualify the cloud edition.

Local independent qualification on September 5, 2026 used artifact SHA256 `d5ead8e304cc07cd72f33ca0e8cc5179f08ed6803ae846fc6fb6d95e3dccf04b` and sound bank SHA256 `aa8827afb728a36de5e66339051155fe48a4ebebdfda7a0693fc185be4e981ca`.

| Current check | Passed / attempted | Reproduction |
| --- | --- | --- |
| Pinned extraction, public-only rebuild, deterministic scores, sound/score independence, locks, invalid imports and MIDI | 7 / 7 tests | `npm run test:lucky:contracts` |
| All inherited styles, two sample rates, crossfade and Stop | 46 / 46 renders: 23 styles × 44.1/48 kHz | `npm run test:lucky:audio` |
| Different sounds on the same score | 8 / 8 lane comparisons | Same PCM command |
| Locked kick, snare and hats across a new seed/palette with the UI-pinned tonal frame | 18 / 18 isolated Part/Kit comparisons | `npm run test:lucky:locks` |
| Cloud standalone/file, opaque iframe, phone, storage, exports and teardown | 8 / 8 browser cases | `npm run test:lucky:browser` |
| Six instruments and responsive host | 20 / 20 records, Chromium and WebKit | `npm run test:browser` |
| Touch, current cloud MIDI reaching the parent Save tray, imports and teardown | 20 / 20 records | `npm run test:lifecycle` |
| Cached reopening and explicit waiting update | 6 / 6 records | `npm run test:offline` |
| CSP and worker lifecycle | 6 / 6 route policies, 2 / 2 engines | `npm run test:csp` |
| Header and account-free Wish access | 10 / 10 records | `npm run test:header` |
| Previous-player source and exact prior artifact rollback | 17 / 17 tests | `npm run test:lucky:legacy` |

The full-band PCM sweep's maximum peak was 0.844043, with no non-finite samples and an exactly silent measured Stop tail. These measurements use four seconds from bar 3 per style/rate, including a sound-roll crossfade; they are not indefinite playback or every seed/preset. Same-score comparisons use 1.4 seconds per voice. Locked drums use fixed render RNG/trigger and the supported pinned-frame workflow. The scripts record their exact source hashes and limitations in JSON under `src/lucky-cloud/tests/evidence/`; CI retains those JSON reports, not audio, screenshots or visitor MIDI.

Before these checks, the stated falsifiers were a changed score under Sound rolls, rejected real lock captures, changed locked drum audio, non-finite or over-threshold PCM, non-silent Stop, or a surviving audio/export resource after teardown. Tests exposed early humanized onsets and accented velocities rejected by validation, seed-dependent locked drum velocity drift, asynchronous stop/history issues and old host selectors. Repairs preserved the actual musical events and made the tests address the shipped cloud artifact. The validators regenerate trusted source recipes rather than accepting arbitrary imported patch graphs.

No subjective listening verdict, cultural authenticity, rights clearance, physical Safari/iPhone test or hardware MIDI result is inferred. Playwright's WebKit is a separate runner. The cloud tests and the six-instrument host tests qualify local builds; a successful Actions run and an anonymous live check qualify a particular deployment. The workflow exercises the current cloud artifact; legacy checks are explicitly separate.

---

# Historical initial-player qualification

This is the September 5, 2026 local qualification record. Passing it does not establish a deployed GitHub Pages site, physical-device compatibility, or a listening preference. Each later Actions run produces its own reports for its checked-out source revision.

| Check | Passed / attempted | Evidence or reproduction |
| --- | --- | --- |
| Host unit and contract tests | 139 / 139 | `npm test` (host test group) |
| TRITON scheduling, tempo, ownership and export regressions | 20 / 20 | `verification/triton-regressions.json`; `npm test` |
| Lucky composition, PCM renderer, MIDI and public-only build regressions | 17 / 17 | `npm test` (Lucky test group) |
| Delete and rebuild six instruments, portable page and service worker without private references | 8 / 8 byte-identical artifacts | `verification/public-rebuild.json` |
| Host catalog, six instrument launches/play/Stop, and responsive widths | 20 / 20 check records: 10 per browser engine | `verification/production-browser.json` |
| Visible wish access, focus return, header routes and narrow-screen branding | 10 / 10 check records: 5 per engine | `verification/production-header.json`; `npm run test:header` |
| Scoped content-security policy and DSP worker lifecycle | 6 / 6 route policies; 2 / 2 browser engine runs | `verification/production-csp.json`; `npm run test:csp` |
| Touch, generated MIDI save tray, imported sandbox, teardown and conductor stop | 16 / 16: 8 per engine | `verification/production-lifecycle.json` |
| Cached reopening, waiting worker, explicit stopped update | 6 / 6: 3 per engine; reopening covers all six instruments | `verification/production-offline.json` |
| Lucky standalone interaction and lifecycle | 22 / 22: 11 per engine | `node src/lucky/tests/browser-check.cjs` |
| Lucky full-band worklet signal | 44 / 44 style runs: 22 per engine, 1.5 seconds each at bar 11 | `node src/lucky/tests/browser-audio-stress.cjs` |
| Lucky composition qualification | 528 / 528 worlds: 24 seeds × 22 styles | `npm run test:lucky:heldout` |
| Lucky rendered-sample qualification | 22 / 22: one seed per style, six seconds from bar 3 at 24 kHz | `npm run test:lucky:audio` |

The browser engines were Playwright Chromium 151 and WebKit 26.5. Test scripts use installed `playwright`, resolve their own checkout, serve ephemeral localhost origins, and close their contexts. The host launch test uses `/nested/midi-room/`; lifecycle/offline tests use `/midi-room/`. They need no `BASE_URL` setting and do not test the public deployment. Lucky's standalone checks open the locally built HTML file.

## Musical and audio limits

Lucky's development seeds were 42, 731 and 20260905. An initial 528-world sweep exceeded the predeclared note-occupancy limit in 406 worlds. Articulation was shortened, then a fresh seed set passed the unchanged conditions: bounded register, chord anchors, gaps, no overlapping lead notes, no pad crossing a harmony boundary, and repeatable composition. That final set is frozen in source; future CI runs are regression checks, not new unseen evaluations. A changed composition algorithm needs a separately chosen holdout before a new generalization claim.

An earlier sample sweep found two failures caused by extreme metallic-oscillator ratios at low sample rates. Those seeds became explicit regressions; the repaired renderer passed a fresh 22-style sweep. Its maximum measured peak was 0.550047, minimum RMS 0.055430, with zero non-finite samples and zero output-protection clamps. This covers the sampled durations and rates, not every possible seed or an indefinitely running session.

Six separate 16-second audition excerpts were generated for review. No subjective listening verdict was established. These excerpts have no extra assertions and are not a CI quality check: CI uses `npm run test:lucky:audio -- --skip-auditions`, retaining all 22 asserted PCM holdouts. The normal local command still generates the audition WAVs. Uploaded reports and the Pages artifact exclude them. Structure, nonzero signal and clean stops do not prove musical taste, cultural authenticity, rights clearance, physical output quality or acceptable device latency.

Installed Safari, physical iPhones/iPads, hardware MIDI controllers and OS installation prompts were not tested. Playwright WebKit is not a substitute for those checks. Chromium used its offline flag plus an unavailable origin; WebKit used an unavailable origin because its simulated offline flag failed internally. This establishes cache reopening in those runners, not an iOS airplane-mode result.

## Continuous verification and Pages

`.github/workflows/ci-pages.yml` uses the lockfile, rebuilds twice, checks generated `dist/` against committed output, and runs the tests above on Ubuntu with Chromium and WebKit. Reports are retained as a named Actions artifact; local qualification is not a claim that this Linux workflow has already passed.

Pull requests only verify. Successful pushes to `main`, or manual runs selecting `main`, may publish `dist/` after adding the public license, attribution, lineage, Wish It Better manifest and docs. Only the deploy job has Pages/OIDC write permissions. The repository must have **Settings → Pages → Source → GitHub Actions** enabled; environment rules still apply. The workflow follows [GitHub's custom Pages workflow contract](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), with official action release commits pinned and verified on September 5, 2026.
