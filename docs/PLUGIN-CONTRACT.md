# MIDI Room plugin contract

Author: Aldrin Payopay · GPL-3.0-only

Every new instrument, DSP effect or combined module enters as a candidate. MIDI Room reads a versioned declaration before choosing its execution path. A missing declaration is recorded as legacy HTML; it is never silently treated as a compatible DSP rack module. Existing TRITON and other self-contained HTML instruments retain the sandbox host path. Their JavaScript audio graphs cannot be connected to another iframe's AudioContext by this contract.

## Supported paths

| Input | Treatment | Current boundary |
| --- | --- | --- |
| `midi-room.plugin/1` with `faust-wasm/1` | Validate artifacts and controls, then admit to the shared DSP runtime | Reviewed Faust builds with the existing Gauntlet ABI, zero to two inputs and one or two outputs |
| `gauntlet.dsp-build/1` JSON or HTML with one `dsp-build` JSON script | Adapt the compiled build into a plugin | Role follows input count; MIDI defaults to none until explicitly mapped |
| HTML with one `midi-room-plugin` JSON script and `html-sandbox/1` | Declare instrument, effect, hybrid or controller behavior independently from Web MIDI | Isolated sandbox audio, or no audio for a controller; no shared DSP rack audio access |
| Self-contained HTML without a declaration | Preserve as a legacy instrument candidate | MIDI/audio behavior requires sandbox verification |
| `midi-room.rack/1` | Validate every module and ordered audio chain | Up to four generators followed by four serial effects |
| Raw C, Faust source, VST/AU, Pure Data or an FPGA image | Reject with an adapter requirement | Intake does not compile, translate or execute these files |

A module's `role` is `instrument`, `effect`, `hybrid` or `controller`. Capabilities remain separate: HTML Web MIDI support does not imply audio routing, and an effect does not acquire MIDI merely because its UI contains a frequency slider. A hybrid Faust build with audio input occupies the effect portion of the rack. Generators have zero audio inputs and mix before effects; listed effects then process serially. An effect-only rack is valid while awaiting a source. Stereo conversion and audio lifecycle belong to the runtime.

## A compiled plugin

The full runnable examples are in [`plugin-examples`](../plugin-examples/). `bloom-drive.rack.json` embeds the unchanged existing Bloom Oscillator and Soft Drive build artifacts. Bloom's frequency mapping was authored explicitly for this example; arbitrary imported builds receive no guessed mapping.

A Faust declaration contains `format: "midi-room.plugin/1"`, a stable lowercase `id`, semantic `version`, `name`, `role`, and `engine: {type: "faust-wasm/1", build: <the full Gauntlet build>}`. It may also include author, license and description strings. An ID is at most 64 characters and begins with a letter.

`midi` uses `mode: "none"` or `mode: "mono"`, with `channel: null` for omni or a zero-based channel from 0 to 15. Mono requires `frequency` to identify a positive parameter address. Optional `gate` must identify a distinct control accepting both 0 and 1. The runtime must own note lifetimes and release output even when a DSP has no internal gate. Frequency limits come from the compiled control; an out-of-range note must be handled explicitly by the runtime. Mono does not promise polyphony, sustain, MPE, transport synchronization or sample-accurate scheduling.

`controls` and `audio` are derived from `engine.build.metadata`. They may be omitted on input. If included, they must agree exactly with the build and engine. Control bounds, initial values, steps and state offsets are never inferred from labels or overridden by a preset. The declaration lists any required capabilities in `requirements`; the currently recognized names are `audio-worklet`, `wasm`, `web-midi` and `midi-room-control/1`. The executing host must also check actual capability availability. An unknown requirement, format major or engine is rejected.

## Declaring a self-contained HTML instrument

Add one JSON script inside the actual instrument HTML:

```html
<script id="midi-room-plugin" type="application/json">
{
  "format": "midi-room.plugin/1",
  "id": "your-instrument",
  "version": "1.0.0",
  "name": "Your instrument",
  "role": "instrument",
  "engine": {"type": "html-sandbox/1"},
  "midi": {"mode": "web-midi", "channel": null}
}
</script>
```

The script declares behavior; it does not implement it. Use the existing MIDI Room private-port/virtual Web MIDI bridge in the instrument, release notes on stop or disconnect, retain route ownership until scheduled releases finish, and avoid initializing or resuming audio without the appropriate user action. The existing surface protocol remains the path for typed controller/target binding. A controller declares `role: "controller"`; its audio capability is `routing: "none"`.

Standalone descriptor JSON is useful for authoring and inspection but contains no executable HTML payload. Place it in the instrument before importing the HTML. Do not include both `midi-room-plugin` and `dsp-build` declarations: one file needs one authoritative interpretation. Intake reads JSON only and never evaluates surrounding HTML or JavaScript.

## Rack state

A rack contains `format: "midi-room.rack/1"`, `version: 1`, `name`, and `modules`. Each module contains a unique lowercase `instanceId`, an embedded plugin, a `values` object keyed by its parameter addresses, and boolean `bypass`. Omitted values use DSP defaults; unknown addresses or values outside the compiled limits are rejected. Omitted bypass means false.

List all zero-input generators first. Their outputs mix, then feed effects in their listed order. Bypassed generators are silent; bypassed effects pass the signal through. HTML and controller plugins cannot be inserted into this shared audio rack. A saved rack is a recipe, not evidence that the audio was rendered or heard successfully. Imports inside DSP Rack pass integrity and bounded runtime preflight before replacing its recipe. Changing structure stops audio; enabling the revised graph is explicit. The outer Room validates artifact identity before opening a slot, and DSP Rack validates runtime shape before enabling audio. A failed start stays silent.

## Intake and preservation

From this project's root:

```sh
node tools/plugin-intake.mjs plugin-examples/bloom-drive.rack.json
node tools/plugin-intake.mjs incoming/new-plugin.html --output workspace/new-plugin.intake.json
node tools/plugin-intake.mjs incoming/new-plugin.html --stage workspace/plugin-candidates
```

Inspection is read-only by default. Only regular files are read: FIFOs, devices and directories are rejected before opening, with a nonblocking descriptor check protecting against file replacement races. Reads are bounded by the measured file size plus one byte and reject a file that changes during intake. `--output` writes a new receipt exclusively. `--stage` creates a new directory named by the SHA-256 of the exact input, containing the unchanged candidate, normalized manifest and receipt. Existing files/directories are never overwritten. Symlink path components are rejected; use canonical paths (macOS `/private/tmp` rather than its `/tmp` alias). Staging does not launch a plugin, rewrite a source file or promote a candidate to an evolution-loop champion.

For each new drop, preserve its source identity, classify it, verify available artifacts, add a specific adapter where required, then exercise it in MIDI Room. The acceptance record should bind tests to the candidate hash and include the relevant audio render, controls/preset reload, note-off/panic, disconnect, rack rollback, mobile layout and measured browser timing. Add native C comparisons when that backend is present. A hardware candidate needs its own build identity and physical measurements. Keep failed candidates and their diagnostics separate from the current working instrument. When the user's next TRITON arrives, compare that exact candidate against the preserved baseline before admitting it to evolution loops.

## Validation and its limits

The pure ES module `dist/plugin-contract.js` exports `extractPlugin(source, filename)`, `validatePlugin(value)`, `createPluginFromBuild(build, options)`, `validateValues(parameters, values)`, `validateRack(value)` and asynchronous `verifyPlugin(manifest)`.

- File input: 32 MiB. A plugin/rack JSON value: 16 MiB, 16,000 nodes and depth 24.
- DSP state: 8 MiB. Parameters: 64 unique addresses and aligned, unique offsets. UI: 256 nodes and 12 groups deep, with exact control/parameter correspondence.
- Wasm bytes: 4 MiB. Initial memory: at most 16 MiB. An explicit maximum of at most 64 MiB is required; the existing Faust artifacts declare 63 MiB. Runtime-owned state and audio allocations have a separate 16 MiB budget. These declarations do not stop module code from growing memory up to its maximum.
- Wasm start functions, shared/64-bit memory, external memory imports and imports other than the adapter's known math functions are rejected. Required Faust export names/kinds must exist. Intake compiles the Wasm module for inspection but does not instantiate it.
- SHA-256 checks cover the exact Faust source, generated C, header and Wasm plus the canonical DSP card identity. Matching hashes establish identity and detect accidental changes; a producer can replace both an artifact and its hash. Metadata, control meanings and mathematical fidelity still need review and runtime checks.

An `artifact-verified` receipt means these structural and hash checks passed. It is not a performance certificate, a security endorsement, a proof of correct DSP, native parity or measured browser/hardware latency. Reviewed code is required: AudioWorklet moves computation onto the audio execution path but cannot guarantee deadlines for hostile or pathological modules. Native C and FPGA are separate execution targets; neither is automatically a browser plugin or evidence of a speedup.

Run the focused gate with `node --test tests/plugin-contract.test.mjs`. The tests use the real preserved compiled examples for successful validation and malicious/malformed fixtures for rejection; they do not instantiate DSP or stand in for the runtime's render and MIDI tests.
