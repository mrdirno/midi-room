// Real PCM from the shipped cloud synthesis and sound bank. Not a taste score.
const fs = require('node:fs');
const path = require('node:path');
const {load, sha} = require('./engine-loader.cjs');
const {x, sourceHashes} = load();
const out = path.join(__dirname, 'evidence'); fs.mkdirSync(out, {recursive: true});
const report = {
  sourceHashes, generatedAt: new Date().toISOString(),
  scope: 'Fresh SHA-derived held-out seed per inherited style at 44.1 and 48 kHz. Four seconds from bar 3 including a sound-roll crossfade and a verified Stop tail. Separate same-score sound comparisons.',
  thresholds: {nonFinite: 0, peak: 1, absoluteMeanDC: .03, audibleRms: .001, stoppedPeak: .0001},
  limitations: ['These are decoded synthesis measurements; no subjective listening judgement is asserted.', 'Playwright WebKit is not installed Safari or a physical iPhone.', 'Tests do not establish rights clearance or cultural authenticity.'],
  renders: [], soundComparisons: [], failures: []
};
function checkpoint() {fs.writeFileSync(path.join(out, 'pcm-report.json'), JSON.stringify(report, null, 2) + '\n');}
function stats() {return {frames: 0, peak: 0, sum: 0, meanL: 0, meanR: 0, nonFinite: 0};}
function add(m, L, R) {
  for (let i = 0; i < L.length; i++) {
    if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) {m.nonFinite++; continue;}
    m.peak = Math.max(m.peak, Math.abs(L[i]), Math.abs(R[i]));
    m.sum += L[i] * L[i] + R[i] * R[i]; m.meanL += L[i]; m.meanR += R[i];
  }
  m.frames += L.length;
}
function finish(m) {return {frames: m.frames, peak: m.peak, rms: Math.sqrt(m.sum / Math.max(1, 2 * m.frames)), dcL: m.meanL / Math.max(1, m.frames), dcR: m.meanR / Math.max(1, m.frames), nonFinite: m.nonFinite};}
function processAudio(tp, rate, seconds) {
  const total = Math.round(rate * seconds), m = stats();
  for (let f = 0; f < total; f += 128) {const n = Math.min(128, total - f), L = new Float32Array(n), R = new Float32Array(n); tp.process(L, R, n); add(m, L, R);}
  return finish(m);
}
const tables = x.buildWavetables();
const styles = process.env.CLOUD_EVAL_STYLES?.split(',') || x.KSTYLE_KEYS;
const rates = process.env.CLOUD_EVAL_RATES?.split(',').map(Number) || [44100, 48000];
for (const style of styles) for (const rate of rates) {
  const seed = parseInt(sha('cloud-pcm-heldout-v1-2026-09-05:' + style).slice(0, 8), 16);
  const world = x.LuckyCloudSoundBank.build(seed, {style});
  const mk = () => new x.Engine(rate, {tables, seed});
  const tp = new x.Transport(mk(), rate, () => {}, mk);
  const started = performance.now();
  tp.msg({type: 'load', world, loop: true}); tp.eng.seekBar(2);
  const first = processAudio(tp, rate, 2);
  const changed = x.LuckyCloudSoundBank.build(seed, {style, roll: {lead: {p: 0, s: 1}}});
  if (JSON.stringify(changed.events) !== JSON.stringify(world.events)) report.failures.push({style, rate, reason: 'sound roll changed notes or rhythm'});
  tp.msg({type: 'swap', world: changed, follow: true});
  const crossfade = processAudio(tp, rate, 2);
  tp.msg({type: 'stop'}); processAudio(tp, rate, .25); const stopped = processAudio(tp, rate, .1);
  const row = {style, seed, rate, first, crossfade, stopped, transportPlayingAfterStop: tp.playing, wallSeconds: (performance.now() - started) / 1000};
  report.renders.push(row);
  for (const [phase, m] of Object.entries({first, crossfade})) {
    if (m.nonFinite || m.peak >= 1 || Math.abs(m.dcL) >= .03 || Math.abs(m.dcR) >= .03 || m.rms < .001) report.failures.push({style, rate, phase, reason: 'PCM threshold', metrics: m});
  }
  if (stopped.peak > .0001 || tp.playing) report.failures.push({style, rate, reason: 'Stop not silent', metrics: stopped});
  console.log(JSON.stringify({style, rate, peak: Math.max(first.peak, crossfade.peak), nonFinite: first.nonFinite + crossfade.nonFinite, stoppedPeak: stopped.peak, seconds: row.wallSeconds}));
  checkpoint();
}

// A sound comparison uses the same event list and isolated lane for every preset.
// Removing its arrangement offset lets a short render measure the actual voice.
function solo(world, lane) {
  const pid = world.laneParts[lane], part = world.roster.find(p => p.id === pid);
  const events = world.events.filter(e => e.ln === lane);
  if (!part || !events.length) return null;
  const first = events[0].t;
  return {...world, bars: 8, duration: 8 * world.steps * world.secPerStep, laneParts: {[lane]: 0}, roster: [{...part, id: 0}], events: events.filter(e => e.t - first < 8 * world.steps).map(e => ({...e, t: e.t - first, part: 0}))};
}
function voicePCM(world, rate) {
  const engine = new x.Engine(rate, {tables, seed: world.seed}); engine.load(world); engine.loop = false;
  const total = Math.round(rate * 1.4), L = new Float32Array(total), R = new Float32Array(total), m = stats();
  for (let f = 0; f < total; f += 128) {const n = Math.min(128, total - f), a = L.subarray(f, f + n), b = R.subarray(f, f + n); engine.render(a, b, n); add(m, a, b);}
  return {L, R, metrics: finish(m)};
}
function normalizedCorrelation(a, b) {
  let cross = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) {cross += a[i] * b[i]; aa += a[i] * a[i]; bb += b[i] * b[i];}
  return aa && bb ? cross / Math.sqrt(aa * bb) : null;
}
for (const lane of ['sub', 'kick', 'snare', 'hat', 'aux', 'keys', 'pad', 'lead']) {
  const seed = 948216731, style = 'miami', a = x.LuckyCloudSoundBank.build(seed, {style});
  const b = x.LuckyCloudSoundBank.build(seed, {style, roll: {[lane]: {p: 0, s: 1}}});
  const soloA = solo(a, lane), soloB = solo(b, lane);
  if (!soloA || !soloB) {report.soundComparisons.push({lane, skipped: 'lane absent in selected score'}); continue;}
  if (JSON.stringify(a.events) !== JSON.stringify(b.events)) report.failures.push({lane, reason: 'sound changed score'});
  const one = voicePCM(soloA, 44100), two = voicePCM(soloB, 44100);
  const correlation = normalizedCorrelation(one.L, two.L);
  const row = {lane, seed, style, rate: 44100, first: one.metrics, second: two.metrics, normalizedCorrelation: correlation, exactPcmMatch: Buffer.from(one.L.buffer).equals(Buffer.from(two.L.buffer))};
  report.soundComparisons.push(row);
  if (row.exactPcmMatch || correlation === null || Math.abs(correlation) > .9999 || one.metrics.nonFinite || two.metrics.nonFinite || Math.max(one.metrics.peak, two.metrics.peak) >= 1) report.failures.push({lane, reason: 'sound distinction or PCM safety', ...row});
  checkpoint();
}
report.summary = {renders: report.renders.length, soundComparisons: report.soundComparisons.length, failures: report.failures.length, peakMax: Math.max(0, ...report.renders.flatMap(r => [r.first.peak, r.crossfade.peak]))};
checkpoint(); console.log(JSON.stringify(report.summary)); if (report.failures.length) process.exitCode = 1;
