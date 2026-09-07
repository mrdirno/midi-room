const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const {load, root, sha, script} = require('./engine-loader.cjs');
const {x, html} = load();
const json = v => JSON.stringify(v);
const build = (seed, options) => x.LuckyCloudSoundBank.build(seed, options);
const seeds = Array.from({length: 3}, (_, i) => parseInt(sha('cloud-contract-heldout-2026-09-05:' + i).slice(0, 8), 16));
const notes = w => json(w.events);

test('cloud engine and app inputs are pinned exact extractions; shipped page excludes the private trailing manuscript', () => {
  const source = path.join(root, 'src/lucky-cloud');
  assert.equal(sha(fs.readFileSync(path.join(source, 'engine.original.js'))), 'f5f482f5eebe55ef90b5d9b25e548b4a1b5b5381a74f72c9d418d02440ecaea1');
  assert.equal(sha(fs.readFileSync(path.join(source, 'app.original.js'))), '57cc5b3097f413b1eecdc27d542c8deadfc2885e533b5028b0189030df89f5d4');
  // The shipped engine is the pinned engine plus EXACTLY the repairs in engine-patches.json.
  // Applying that same list here keeps this a drift detector: any other change to the engine
  // block, or a repair that is not written down, still fails.
  const patches = JSON.parse(fs.readFileSync(path.join(source, 'engine-patches.json'), 'utf8')).patches;
  let patched = fs.readFileSync(path.join(source, 'engine.original.js'), 'utf8');
  for (const p of patches) {
    assert.equal(patched.split(p.old).length - 1, p.count, `engine patch anchor drift: ${p.id}`);
    patched = patched.split(p.old).join(p.new);
  }
  assert.equal(sha(script(html, 'engine-src')), sha(Buffer.from(patched)));
  assert.match(html, /id="cloudKit"/);
  assert.match(html, /LUCKY DREAMER/);
  assert.equal((html.match(/data:image\/[^;]+;base64,/g) || []).length, 5, 'original five cloud artworks remain');
  for (const privateMarker of ['RINGS · agent context', 'INHERITED FROM LUCKY SOUNDS (the melodic parent)']) assert.ok(!html.includes(privateMarker), privateMarker);
  assert.ok(!/\/(?:Users|Volumes)\//.test(html), 'no private local filesystem roots in shipped page');
  assert.ok(!/<script[^>]+src=["']https?:/i.test(html));
});

test('public-safe inputs rebuild the identical cloud page without any private reference tree', () => {
  const temp = fs.mkdtempSync(path.join(__dirname, '.public-rebuild-'));
  try {
    const dest = path.join(temp, 'src/lucky-cloud'); fs.mkdirSync(dest, {recursive: true});
    for (const name of ['engine.original.js', 'app.original.js', 'cloud.css', 'integration.css', 'shell.html', 'lifecycle.js', 'sound-bank.js', 'provenance.json', 'build-cloud.py', 'engine-patches.json']) fs.copyFileSync(path.join(root, 'src/lucky-cloud', name), path.join(dest, name));
    cp.execFileSync('python3', [path.join(dest, 'build-cloud.py')], {stdio: 'pipe'});
    assert.deepEqual(fs.readFileSync(path.join(temp, 'dist/instruments/lucky-dreamer.html')), fs.readFileSync(path.join(root, 'dist/instruments/lucky-dreamer.html')));
    assert.equal(fs.existsSync(path.join(temp, 'reference')), false);
  } finally {fs.rmSync(temp, {recursive: true, force: true});}
});

test('fresh held-out seeds rebuild deterministic finite scores in every inherited style', () => {
  for (const style of x.KSTYLE_KEYS) for (const seed of seeds) {
    const world = build(seed, {style});
    assert.equal(json(world), json(build(seed, {style})), `${style}/${seed} replay`);
    assert.ok(world.events.length > 0 && world.roster.length > 0);
    let previous = -Infinity;
    for (const e of world.events) {
      assert.ok(Number.isFinite(e.t) && Number.isFinite(e.dur) && Number.isFinite(e.vel), `${style}/${seed} finite score`);
      // The original cloud score has slightly early humanized onsets and
      // accented synthesis velocities above 1. MIDI/output bounds are tested
      // on the actual encoded/rendered results, not imposed on this score.
      assert.ok(e.t >= previous && e.t >= -1 && e.dur > 0 && e.vel > 0, `${style}/${seed} event bounds`);
      assert.ok(world.roster.some(p => p.id === e.part), `${style}/${seed} part exists`);
      if (e.note !== undefined) assert.ok(Number.isFinite(e.note) && e.note >= 0 && e.note <= 127);
      previous = e.t;
    }
  }
});

test('per-lane sound rolls preserve every event, chord, tempo and key', () => {
  for (const style of x.KSTYLE_KEYS) {
    const seed = seeds[0], original = build(seed, {style});
    for (const lane of Object.keys(original.laneParts)) {
      const changed = build(seed, {style, roll: {[lane]: {p: 0, s: 1}}});
      assert.equal(notes(changed), notes(original), `${style}/${lane} notes and rhythm`);
      assert.equal(json(changed.changes), json(original.changes), `${style}/${lane} harmony`);
      assert.equal(changed.bpm, original.bpm); assert.equal(changed.tonic, original.tonic);
      assert.equal(json(changed), json(build(seed, {style, roll: {[lane]: {p: 0, s: 1}}})), `${style}/${lane} deterministic timbre`);
    }
  }
});

test('real lane captures survive validation and a new whole-band roll', () => {
  const laneEvents = (w, lane) => json(w.events.filter(e => e.ln === lane).map(({part, ...event}) => event));
  for (const style of ['knock', 'miami', 'bap']) {
    const original = build(948216731, {style});
    for (const lane of ['keys', 'lead', 'kick', 'snare']) {
      if (original.laneParts[lane] === undefined) continue;
      const captured = x.LuckyCloudSoundBank.capture(original, lane);
      assert.doesNotThrow(() => x.LuckyCloudSoundBank.validateCapture(captured, lane), `${style}/${lane} accepts its own generated capture`);
      const next = build(67312111, {style, frame: {style, bpm: original.bpm, tonic: original.tonic}, locks: {[lane]: captured}});
      assert.equal(sha(laneEvents(next, lane)), sha(laneEvents(original, lane)), `${style}/${lane} locked notes survive`);
    }
  }
});

test('named presets and palettes preserve the score and reject invalid imported choices', () => {
  const seed = seeds[2], original = build(seed, {style:'miami'});
  for (const palette of x.LuckyCloudSoundBank.palettes) {
    const choices = {};
    for (const lane of Object.keys(original.laneParts)) {
      const catalog = x.LuckyCloudSoundBank.catalog(lane, palette.id);
      choices[lane] = catalog[Math.floor(catalog.length/2)].id;
    }
    const options = {style:'miami', soundBank:{version:'1.0.0',palette:palette.id,lanes:choices}};
    const selected = build(seed,options);
    assert.equal(notes(selected),notes(original),palette.id+' keeps notes and rhythm');
    assert.equal(json(selected),json(build(seed,options)),palette.id+' restores deterministic preset selection');
    for (const [lane,id] of Object.entries(choices)) assert.equal(selected.soundBank.lanes[lane].id,id,lane+' uses the selected preset');
  }
  for (const config of [
    {version:'2.0.0',palette:'full',lanes:{}},
    {version:'1.0.0',palette:'unknown',lanes:{}},
    {version:'1.0.0',palette:'full',lanes:{kick:'fm/ebell'}},
    {version:'1.0.0',palette:'full',lanes:{lead:'constructor'}},
    JSON.parse('{"version":"1.0.0","palette":"full","lanes":{},"__proto__":{"polluted":true}}')
  ]) assert.throws(()=>build(seed,{soundBank:config}),/Sound bank:/);
  const captured = x.LuckyCloudSoundBank.capture(original,'lead');
  const valid = x.LuckyCloudSoundBank.validateCapture(captured,'lead');
  const changed = JSON.parse(JSON.stringify(captured)); changed.events[0].vel *= .8;
  assert.throws(()=>x.LuckyCloudSoundBank.validateCapture(changed,'lead'),/differ from their source recipe/);
  const forged = {...captured,bankPart:{p:{gain:1000000}},bankChoice:{id:'forged'}};
  assert.equal(json(x.LuckyCloudSoundBank.validateCapture(forged,'lead')),json(valid),'untrusted patch/gain fields are regenerated from source');
});

test('MIDI visitor exports contain complete balanced note events', () => {
  const bytes = Buffer.from(x.encodeMidi(build(seeds[1], {style: 'bap'})));
  assert.equal(bytes.toString('ascii', 0, 4), 'MThd');
  assert.equal(bytes.readUInt16BE(8), 1);
  let offset = 14, ons = 0, offs = 0;
  for (let track = 0; track < bytes.readUInt16BE(10); track++) {
    assert.equal(bytes.toString('ascii', offset, offset + 4), 'MTrk');
    const end = offset + 8 + bytes.readUInt32BE(offset + 4); offset += 8;
    const active = new Map();
    function vlq() {let n = 0, b, count = 0; do {b = bytes[offset++]; n = (n << 7) | (b & 127); assert.ok(++count <= 4);} while (b & 128); return n;}
    while (offset < end) {
      vlq(); const status = bytes[offset++];
      if (status === 255) {offset++; const length = vlq(); offset += length; continue;}
      const kind = status & 240, note = bytes[offset++];
      if (kind === 192 || kind === 208) continue;
      const value = bytes[offset++], key = `${status & 15}:${note}`;
      if (kind === 144 && value) {ons++; active.set(key, (active.get(key) || 0) + 1);}
      else if (kind === 128 || kind === 144 && !value) {offs++; assert.ok(active.get(key) > 0, 'note off has matching note on'); active.set(key, active.get(key) - 1);}
    }
    assert.equal(offset, end); assert.ok([...active.values()].every(n => n === 0));
  }
  assert.equal(offset, bytes.length); assert.equal(ons, offs); assert.ok(ons > 100);
});
