# MIDI Room

Six browser instruments from DRINOMAN / Aldrin Payopay: TRITON Rack, Lucky Dreamer, Improvisator, Drum Pad, Field Keys and DSP Rack. Play with touch or a computer keyboard; connect a hardware MIDI controller where the browser supports Web MIDI.

**[Open MIDI Room](https://persona500.com/midi-room/)** · **[The cards](https://persona500.com/midi-room-card/)** · **[Wish it better](https://persona500.com/midi-room/#wish)**

Music led to these tools. Building the tools led back to music. [RUN THIS GAME](https://persona500.com/run-this-game/) shows that process: an original recording, new musical seeds, a different delivery, and five paintings. The recordings and private prompts are not part of this source repository.

## Play

- **Lucky Dreamer** creates a whole-band phrase from a repeatable seed, with connected melody, harmony, bass and drums. Keep parts you like and explore variations.
- **TRITON Rack** is an independent browser synthesizer with patches and effects. It uses local synthesis, not Korg sample ROMs; it is not a Korg product or affiliated with Korg.
- **Improvisator** opens the conductor and harmony view of the same underlying TRITON engine. It is a focused view, not an independently invented sound engine.
- **Drum Pad** gives you sixteen playable pads and MIDI takes.
- **Field Keys** offers a compact playable keyboard.
- **DSP Rack** hosts the bundled Bloom and Soft Drive modules with their source and verification records.

Choose an instrument, then press play or a key. Sound starts with your action. Saved recipes and MIDI/WAV you make yourself remain exportable. Files imported into your room are kept on your device; sending a wish sends the text you type, not your music, MIDI events or private diagnostic log.

## Build and improve it

See [BUILD.md](docs/BUILD.md) for the reproducible build and checks, and [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution path. The standalone output uses relative URLs and can also be hosted on GitHub Pages. Moving hosts does not add a missing browser API: touch and keyboard Web Audio are the baseline, and hardware MIDI is optional.

The [compatibility record](docs/PRODUCTION-COMPATIBILITY.md) distinguishes Chromium and Playwright WebKit checks from physical Safari, iOS and MIDI-hardware testing. Musical structure and sample stability are measured separately from whether you like a phrase.

## A project that can keep changing

[Wish It Better](WISH_IT_BETTER.md) provides the loop: wish, triage, build, prove, log. The account-free wish form is the primary route; [GitHub issues](https://github.com/mrdirno/midi-room/issues) are an additional route for people who use GitHub. Raw wishes stay in the existing private queue. Public history records the accepted change and its checks, with a contributor's name only when they choose attribution.

We declare **L0 / adopting**, not a higher conformance level inferred from the number of tests. The [network manifest](wish-it-better.json), [lineage record](lineage.json), [attribution](ATTRIBUTION.md) and [citation](CITATION.cff) give later forks a route back to this project. A fork should retain its inherited credits, record what it changed, and name its own maintainer and wish destination. A source link is not a promise of an automatic agent or a guaranteed response time.

## Licenses and credits

The MIT license applies to the newly authored host, integration and other code covered by [NOTICE](NOTICE). Bundled engines, musical data, DSP code and third-party tools retain their own terms and notices. This repository is not a blanket relicensing of those components. Read [the component inventory](docs/PRODUCTION-LICENSE-INVENTORY.md) before redistribution.

Created and directed by **Aldrin Payopay, DRINOMAN**, with AI assistance for implementation and testing. See [ATTRIBUTION.md](ATTRIBUTION.md) for source lineage and [the license files](dist/licenses/) for bundled notices.
