/*<<<KNOCK-SEAM:knock/k10-app.js>>>*/
/* ═══════════════════════════════════════════════════════════════════════════
   KNOCK · K5 THE PAGE
   One beat, whole, on screen. Six lanes — the 808, the kick, the snare, the
   hats, the ensemble, the extras — each with a PATTERN dice, a SOUND dice, a
   LOCK and a MUTE; tap a lane's name to hear it alone; one big ROLL throws
   everything unlocked. The dice guarantees are the beat builder's (K4), not
   the page's: a roll of one lane cannot move another.

   The page never touches a sample buffer. It builds beats and hands scores
   to the shared engine, which runs in an AudioWorklet built from THIS PAGE'S
   OWN SOURCE, read out of the DOM — server, hard disk and offline identical.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
'use strict';

var $ = function (id) { return document.getElementById(id); };
var LANE_COLOR = { sub: '#e0956a', kick: '#d8d2c4', snare: '#e07a8a', hat: '#8fd4dd',
  perc: '#c9a95f', aux: '#9187b0',
  keys: '#7fc9a0', lead: '#ffd98a', pad: '#a9b6ff', harm: '#e8c48a' };
var LANE_LABEL = { sub: '808', kick: 'kick', snare: 'snare', hat: 'hats',
  perc: 'percussion', aux: 'extras',
  keys: 'keys', lead: 'lead', pad: 'pad', harm: 'harmony' };
var SUB_LABEL = { sub808: 'long 808 — tuned', subBoom: 'crunk boom — tuned',
  subMiami: 'electro 808 — tuned', subDrill: 'slide 808 — tuned',
  subJungle: 'sub drop — tuned', subLog: 'log drum — tuned' };
/* The band, top to bottom the way a mixer reads: the rhythm section first,
   because that is what the drummer brought, then the harmony and the melody
   that the fusion added. Every one of them is a LANE with the same two dice,
   which is the whole point — the melodic parts are not a different kind of
   thing with a different kind of control. */
var LANE_ORDER = ['sub', 'kick', 'snare', 'hat', 'perc', 'aux', 'keys', 'pad', 'lead'];
var MELODIC = { keys: 1, lead: 1, pad: 1 };

var S = { seed: 0, style: null, roll: {}, locks: {}, mute: {}, frame: null,
  world: null, playing: false, solo: null, bar: 0, dur: 0, playhead: 0,
  ctx: null, node: null, send: null, tables: null, ready: false, mode: '',
  tp: null, audioPromise: null, wrote: '', tempo: null, vol: {} };

var toastT = null;
function toast(msg, ms) {
  var t = $('toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(function () { t.classList.remove('on'); }, ms || 2200);
}

/* audio first; the paint rides the next frame; the save debounces with a
   pagehide flush (the tap path discipline RING 8 measured) */
var paintQ = false, saveT = null;
function paintSoon() {
  if (paintQ) return;
  paintQ = true;
  requestAnimationFrame(function () { paintQ = false; paintSong(); });
}
function saveSessionSoon() { clearTimeout(saveT); saveT = setTimeout(saveSession, 500); }
window.addEventListener('pagehide', function () {
  if (saveT) { clearTimeout(saveT); saveT = null; saveSession(); }
});

function hasAny(o) { for (var k in o) return true; return false; }
function buildOpts() {
  var o = { style: S.style || null };
  if (hasAny(S.locks)) { o.locks = S.locks; if (S.frame) o.frame = S.frame; }
  if (hasAny(S.roll)) o.roll = S.roll;
  if (hasAny(S.mute)) o.mute = S.mute;
  if (S.tempo) o.bpm = S.tempo;
  return o;
}
function rebuildWorld() { S.world = buildBand(S.seed >>> 0, buildOpts()); return S.world; }
function laneVoiceLabel(lane) {
  var w = S.world;
  var pid = w.laneParts[lane];
  var part = null;
  for (var i = 0; i < w.roster.length; i++) if (w.roster[i].id === pid) part = w.roster[i];
  if (!part) return '';
  if (lane === 'sub') return (SUB_LABEL[part.patch] || part.patch) + (w.keyName ? ' to ' + w.keyName : '');
  if (lane === 'kick' || lane === 'snare' || lane === 'hat') return part.patch + ' kit';
  if (MELODIC[lane]) return (ENGINE_LABEL[part.engine] || part.engine) + ' \u00b7 ' + part.patch;
  return part.patch + ' set';
}
/* what each synthesis architecture is, in the words a player would use rather
   than the words the code uses */
var ENGINE_LABEL = { analog: 'analog poly', fm: '6-op FM', tine: 'tine piano',
  organ: 'tonewheel organ', station: 'wavetable', solina: 'string machine',
  vox: 'formant choir', pluck: 'plucked string', bowed: 'bowed string',
  mallet: 'modal bar', wind: 'waveguide wind', kit: 'drum kit', perc: 'percussion' };
function volActive() {
  for (var k in S.vol) if ((S.vol[k] | 0) !== KVOL_MID) return true;
  return false;
}
function scoreFor(w) {
  /* the loudness faders ride the SCORE, not the world — the world stays
     dice-pure (locks capture unfaded lanes), and the fade lands on event
     VELOCITY so a quieter lane is also a softer-played lane, the way a
     drummer actually pulls back. kLaneGain does the Fletcher-Munson math. */
  var ev = w.events;
  if (volActive()) {
    ev = new Array(w.events.length);
    for (var i = 0; i < w.events.length; i++) {
      var e = w.events[i], g = kLaneGain(e.ln, S.vol[e.ln]);
      if (g === 1) { ev[i] = e; continue; }
      var c = {};
      for (var k in e) c[k] = e[k];
      c.vel = Math.min(1.25, e.vel * g);
      ev[i] = c;
    }
  }
  return { seed: w.seed, name: w.name, bpm: w.bpm, steps: w.steps, secPerStep: w.secPerStep,
    duration: w.duration, bars: w.bars, climate: w.climate, roster: w.roster, events: ev,
    masterGain: w.masterGain };
}

/* ── the address: #w=seed&y=style&r=lane dice&m=mutes ──────────────────── */
function encodeRoll() {
  var out = [];
  for (var i = 0; i < LANE_ORDER.length; i++) {
    var r = S.roll[LANE_ORDER[i]];
    if (!r || (!r.s && !r.p)) continue;
    out.push(i.toString(36) + '.' + (r.s || 0).toString(36) + '.' + (r.p || 0).toString(36));
  }
  return out.join('-');
}
function decodeRoll(str) {
  var out = {};
  if (!str) return out;
  str.split('-').forEach(function (e) {
    var m = e.split('.');
    if (m.length !== 3) return;
    var i = parseInt(m[0], 36), s = parseInt(m[1], 36), p = parseInt(m[2], 36);
    if (!isFinite(i) || i < 0 || i >= LANE_ORDER.length) return;
    if ((s | 0) || (p | 0)) out[LANE_ORDER[i]] = { s: (s | 0) || 0, p: (p | 0) || 0 };
  });
  return out;
}
function encodeMute() {
  var bits = 0;
  for (var i = 0; i < LANE_ORDER.length; i++) if (S.mute[LANE_ORDER[i]]) bits |= (1 << i);
  return bits ? bits.toString(36) : '';
}
function decodeMute(n) {
  var out = {};
  if (!isFinite(n) || n <= 0) return out;
  for (var i = 0; i < LANE_ORDER.length; i++) if (n & (1 << i)) out[LANE_ORDER[i]] = 1;
  return out;
}
function encodeVol() {
  var out = [];
  for (var i = 0; i < LANE_ORDER.length; i++) {
    var v = S.vol[LANE_ORDER[i]];
    if (v === undefined || (v | 0) === KVOL_MID) continue;
    out.push(i.toString(36) + '.' + (v | 0).toString(36));
  }
  return out.join('-');
}
function decodeVol(str) {
  var out = {};
  if (!str) return out;
  str.split('-').forEach(function (e) {
    var m = e.split('.');
    if (m.length !== 2) return;
    var i = parseInt(m[0], 36), v = parseInt(m[1], 36);
    if (!isFinite(i) || i < 0 || i >= LANE_ORDER.length) return;
    if (isFinite(v) && v >= 0 && v <= KVOL_MAX && v !== KVOL_MID) out[LANE_ORDER[i]] = v;
  });
  return out;
}
function readAddress() {
  var h = (location.hash || '').replace(/^#/, ''), out = {};
  h.split('&').forEach(function (kv) {
    var i = kv.indexOf('='); if (i < 0) return;
    var k = kv.slice(0, i), v = kv.slice(i + 1);
    if (k === 'r' || k === 'v') { out[k] = v; return; }
    var n = parseInt(v, 36);
    if (isFinite(n) && n >= 0) out[k] = n >>> 0;
  });
  return out;
}
function writeAddress() {
  var p = ['w=' + (S.seed >>> 0).toString(36)];
  if (S.style) p.push('y=' + (KSTYLE_KEYS.indexOf(S.style) + 1).toString(36));
  var r = encodeRoll();
  if (r) p.push('r=' + r);
  var mm = encodeMute();
  if (mm) p.push('m=' + mm);
  if (S.tempo) p.push('t=' + (S.tempo | 0).toString(36));
  var vv = encodeVol();
  if (vv) p.push('v=' + vv);
  var h = '#' + p.join('&');
  S.wrote = h;
  try { history.replaceState(null, '', h); } catch (e) {}
}
function onHashChange() {
  var h = location.hash || '';
  if (h === S.wrote) return;
  var a = readAddress();
  if (!a.w) return;
  S.seed = a.w >>> 0;
  S.style = a.y ? (KSTYLE_KEYS[a.y - 1] || null) : null;
  S.roll = decodeRoll(a.r);
  S.mute = decodeMute(a.m);
  S.tempo = a.t && a.t >= 40 && a.t <= 220 ? a.t : null;
  S.vol = decodeVol(a.v);
  S.bar = 0;
  rebuildWorld(); paintSong(); syncStyleChip(); saveSession();
  if (S.playing) sendSwap(0, false);
  toast('address opened — ' + S.world.name, 2400);
}

/* ── audio ─────────────────────────────────────────────────────────────── */
function engineSource() { return $('engine-src').textContent; }
var WORKLET_GLUE = '\n' +
  'class KnockProcessor extends AudioWorkletProcessor {\n' +
  '  constructor(opts) {\n' +
  '    super();\n' +
  '    var o = (opts && opts.processorOptions) || {};\n' +
  '    var eng = new Engine(sampleRate, { tables: o.tables, seed: 1 });\n' +
  '    this.tp = new Transport(eng, sampleRate, (m) => this.port.postMessage(m),\n' +
  '      () => new Engine(sampleRate, { tables: o.tables, seed: 2 }));\n' +
  '    this.port.onmessage = (e) => this.tp.msg(e.data);\n' +
  '    this.port.postMessage({ type: "ready", sr: sampleRate });\n' +
  '  }\n' +
  '  process(inputs, outputs) {\n' +
  '    var out = outputs[0];\n' +
  '    this.tp.process(out[0], out[1] || out[0], out[0].length);\n' +
  '    return true;\n' +
  '  }\n' +
  '}\n' +
  'registerProcessor("knock", KnockProcessor);\n';

function ensureAudio() {
  if (S.audioPromise) return S.audioPromise;
  var AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return Promise.reject(new Error('this browser has no Web Audio'));
  var ctx = new AC({ latencyHint: 'playback' });
  S.ctx = ctx;
  buildTables();
  S.audioPromise = startWorklet(ctx).catch(function () {
    return startWorkletData(ctx);       /* file:// gets a real audio thread */
  }).catch(function (e) {
    return startScriptProcessor(ctx, e);
  });
  return S.audioPromise;
}
function finishWorklet(ctx) {
  var node = new AudioWorkletNode(ctx, 'knock', {
    numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
    processorOptions: { tables: S.tables }
  });
  node.connect(ctx.destination);
  node.port.onmessage = function (e) { onEngineMsg(e.data); };
  S.node = node;
  S.send = function (m) { node.port.postMessage(m); };
  S.mode = 'worklet'; S.ready = true;
  return ctx;
}
function startWorklet(ctx) {
  if (!ctx.audioWorklet) return Promise.reject(new Error('no AudioWorklet'));
  var src = engineSource() + WORKLET_GLUE;
  var url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
  return ctx.audioWorklet.addModule(url).then(function () {
    URL.revokeObjectURL(url);
    return finishWorklet(ctx);
  });
}
function startWorkletData(ctx) {
  if (!ctx.audioWorklet) return Promise.reject(new Error('no AudioWorklet'));
  var src = engineSource() + WORKLET_GLUE;
  var url = 'data:application/javascript;charset=utf-8,' + encodeURIComponent(src);
  return ctx.audioWorklet.addModule(url).then(function () { return finishWorklet(ctx); });
}
function startScriptProcessor(ctx, why) {
  if (!ctx.createScriptProcessor && !ctx.createJavaScriptNode) throw (why || new Error('no audio path'));
  var eng = new Engine(ctx.sampleRate, { tables: S.tables, seed: 1 });
  var tp = new Transport(eng, ctx.sampleRate, onEngineMsg,
    function () { return new Engine(ctx.sampleRate, { tables: S.tables, seed: 2 }); });
  var mk = ctx.createScriptProcessor ? ctx.createScriptProcessor.bind(ctx) : ctx.createJavaScriptNode.bind(ctx);
  var sp = mk(4096, 0, 2);
  sp.onaudioprocess = function (e) {
    var o = e.outputBuffer;
    tp.process(o.getChannelData(0), o.getChannelData(1), o.length);
  };
  sp.connect(ctx.destination);
  S.node = sp; S.tp = tp;
  S.send = function (m) { tp.msg(m); };
  S.mode = 'script'; S.ready = true;
  return ctx;
}
function onEngineMsg(m) {
  if (m.type === 'pos') {
    S.playhead = m.t; S.dur = m.dur || S.dur;
    if (!S.solo && S.world) {
      var barSec = S.world.secPerStep * S.world.steps;
      S.bar = Math.floor(m.t / barSec) % Math.max(1, S.world.bars);
    }
    paintPos();
  } else if (m.type === 'stopped') {
    S.playing = false; syncPlay();
  }
}
function buildTables() {
  if (S.tables) return S.tables;
  S.tables = buildWavetables();
  return S.tables;
}
function sendSwap(bar, follow) {
  if (!S.send) return;
  S.send({ type: 'swap', world: scoreFor(S.world),
    bar: bar === undefined ? S.bar : bar, follow: follow === true });
}

/* ── play / pause ──────────────────────────────────────────────────────── */
function play(fromBar) {
  S.solo = null; S.playing = true;
  syncPlay(); paintBand();
  ensureAudio().then(function (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    if (!S.playing || S.solo) return;
    sendSwap(fromBar === undefined ? S.bar : fromBar, false);
  }).catch(function (e) {
    S.playing = false; syncPlay();
    toast('audio unavailable: ' + (e && e.message ? e.message : 'blocked'), 3600);
  });
}
function pause() {
  if (S.send) S.send({ type: 'stop' });
  S.playing = false; S.solo = null;
  syncPlay(); paintBand();
}
function syncPlay() {
  $('icoPlay').style.display = S.playing ? 'none' : 'block';
  $('icoPause').style.display = S.playing ? 'block' : 'none';
  $('bPlay').classList.toggle('playing', S.playing);
  $('songCard').classList.toggle('live', S.playing);
}

/* ── solo: one lane, alone ─────────────────────────────────────────────── */
function soloScore(lane) {
  var w = S.world, pid = w.laneParts[lane];
  if (pid === undefined) return null;
  var from = -1, notes = [];
  for (var i = 0; i < w.events.length; i++) {
    var e = w.events[i];
    if (e.ln !== lane) continue;
    if (from < 0) from = Math.floor(e.t / w.steps / 2) * w.steps * 2;
    if (e.t - from >= w.steps * 4) break;
    notes.push({ t: e.t - from, dur: e.dur, note: e.note, vel: e.vel, part: 0, slot: e.slot, slide: e.slide });
  }
  if (!notes.length) return null;
  var part = null;
  for (i = 0; i < w.roster.length; i++) if (w.roster[i].id === pid) part = w.roster[i];
  var sp = {};
  for (var k in part) sp[k] = part[k];
  sp.id = 0; sp.level = 1; sp.pan = 0; sp.duck = 0;
  return { seed: w.seed, name: w.name + ' · ' + lane, bpm: w.bpm,
    steps: w.steps, secPerStep: w.secPerStep,
    duration: w.steps * 4 * w.secPerStep, bars: 4, climate: w.climate,
    masterGain: Math.min(1.6, w.masterGain || 1),   /* solo: loud, not blasting */
    roster: [sp], events: notes };
}
function toggleSolo(lane) {
  if (S.solo === lane) {
    S.solo = null;
    if (S.playing) sendSwap(S.bar, false); else pause();
    paintBand();
    return;
  }
  var solo = soloScore(lane);
  if (!solo) { toast(LANE_LABEL[lane] + ' rests in this beat'); return; }
  S.solo = lane; S.playing = true;
  syncPlay(); paintBand();
  ensureAudio().then(function (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    if (S.solo !== lane) return;
    S.send({ type: 'load', world: solo });
    toast(LANE_LABEL[lane] + ' alone — ' + laneVoiceLabel(lane), 2400);
  }).catch(function () { S.solo = null; S.playing = false; syncPlay(); paintBand(); toast('audio unavailable'); });
}

/* ── THE DICE ──────────────────────────────────────────────────────────── */
function rollPart(lane, kind, btn) {
  if (S.locks[lane]) { toast(LANE_LABEL[lane] + ' is locked — tap the lock to free it'); return; }
  var r = S.roll[lane] = S.roll[lane] || { s: 0, p: 0 };
  r[kind]++;
  if (btn) { btn.classList.remove('rolling'); void btn.offsetWidth; btn.classList.add('rolling'); }
  rebuildWorld();
  if (S.solo === lane) {
    var solo = soloScore(lane);
    if (solo && S.send) S.send({ type: 'load', world: solo });
  } else if (S.playing && !S.solo) sendSwap(S.bar, true);
  paintSoon(); writeAddress(); saveSessionSoon();
  if (kind === 's') toast(LANE_LABEL[lane] + ' → ' + laneVoiceLabel(lane), 2000);
}
function rollAll() {
  S.seed = (Math.random() * 4294967296) >>> 0;
  S.roll = {};
  S.bar = 0; S.solo = null;
  rebuildWorld();
  play(0);
  paintSoon(); writeAddress(); saveSessionSoon();
  var held = 0; for (var k in S.locks) held++;
  toast(held ? 'rolled around ' + held + ' locked lane' + (held > 1 ? 's' : '') + ' — ' + S.world.name
             : 'a new beat — ' + S.world.name, 2400);
}

/* ── LOCKS ─────────────────────────────────────────────────────────────────
   A lock keeps a lane EXACTLY — its hits and its sound — through every roll
   after it. The first lock pins the beat's style, tempo and tuning (a kept
   groove with the floor moved out from under it is not kept); freeing every
   lock lets the dice have all of it back. */
function toggleLock(lane) {
  if (S.locks[lane]) {
    delete S.locks[lane];
    if (!hasAny(S.locks)) S.frame = null;
    toast(LANE_LABEL[lane] + ' freed — the dice has it back', 2000);
  } else {
    if (S.world.laneParts[lane] === undefined) return;
    S.locks[lane] = kCaptureLane(S.world, lane);
    if (!S.frame) {
      S.frame = { style: S.world.style, bpm: S.world.bpm, tonic: S.world.tonic };
      toast(LANE_LABEL[lane] + ' locked — style, tempo and tuning pinned with it', 2600);
    } else toast(LANE_LABEL[lane] + ' locked — it survives the roll', 2000);
  }
  rebuildWorld();
  if (S.playing && !S.solo) sendSwap(S.bar, true);
  paintSoon(); writeAddress(); saveSessionSoon();
}

/* ── MUTE ──────────────────────────────────────────────────────────────── */
function toggleMute(lane) {
  if (S.world.laneParts[lane] === undefined) return;   /* not a lane of this style */
  if (S.mute[lane]) {
    delete S.mute[lane];
    toast(LANE_LABEL[lane] + ' is back', 1800);
  } else {
    S.mute[lane] = 1;
    if (S.solo === lane) S.solo = null;
    toast(LANE_LABEL[lane] + ' muted — it stays out until you bring it back', 2400);
  }
  rebuildWorld();
  if (S.playing && !S.solo) sendSwap(S.bar, true);
  paintSoon(); writeAddress(); saveSessionSoon();
}

/* ── THE TEMPO DIAL ──────────────────────────────────────────────────────
   A performance control: it outranks the dice's tempo draw and even a
   locked frame, but consumes no draws — the beat is byte-identical at any
   dial position, just faster or slower. Tap the number to hand the tempo
   back to the dice. Swaps are throttled: a held button steps the display
   every repeat but only restrikes the engine when the hand settles. */
var swapT = null;
function swapSoon(ms) {
  clearTimeout(swapT);
  swapT = setTimeout(function () {
    swapT = null;
    if (S.playing && !S.solo) sendSwap(S.bar, true);
  }, ms || 200);
}
function nudgeTempo(d) {
  var v = Math.max(40, Math.min(220, (S.tempo || S.world.bpm) + d));
  if (v === S.tempo) return;
  S.tempo = v;
  rebuildWorld();
  paintSoon(); swapSoon(240); writeAddress(); saveSessionSoon();
}
function resetTempo() {
  if (!S.tempo) return;
  S.tempo = null;
  rebuildWorld();
  paintSoon(); swapSoon(120); writeAddress(); saveSessionSoon();
  toast('tempo handed back to the dice — ' + S.world.bpm + ' bpm', 2000);
}
function holdable(el, fn) {
  var rep = null, del = null;
  function stop() { clearTimeout(del); clearInterval(rep); del = rep = null; }
  el.addEventListener('pointerdown', function (e) {
    e.preventDefault(); fn();
    del = setTimeout(function () { rep = setInterval(fn, 80); }, 380);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) {
    el.addEventListener(ev, stop);
  });
}

/* ── THE LOUDNESS FADERS ─────────────────────────────────────────────────
   Per-lane volume on the Fletcher-Munson exchange rate (kLaneGain): one
   step is the same felt loudness change on every lane, spending fewer dB
   on the sub than on the hats. The fade rides the score's velocities —
   the world stays dice-pure, and locks capture the unfaded lane. */
function setVol(lane, v) {
  v = Math.max(0, Math.min(KVOL_MAX, v | 0));
  if (v === KVOL_MID) delete S.vol[lane]; else S.vol[lane] = v;
  swapSoon(150); writeAddress(); saveSessionSoon();
}

/* ── painting ──────────────────────────────────────────────────────────── */
var ICON_PAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3.4" y="3.4" width="17.2" height="17.2" rx="4"/><circle cx="8.3" cy="8.3" r="1.45" fill="currentColor" stroke="none"/><circle cx="15.7" cy="8.3" r="1.45" fill="currentColor" stroke="none"/><circle cx="8.3" cy="15.7" r="1.45" fill="currentColor" stroke="none"/><circle cx="15.7" cy="15.7" r="1.45" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.45" fill="currentColor" stroke="none"/></svg>';
var ICON_SOUND = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3.4" y="3.4" width="17.2" height="17.2" rx="4"/><path d="M7 12c1.3-3.4 2.6-3.4 3.9 0s2.6 3.4 3.9 0 2.2-2.9 3.2-.6" stroke-linecap="round"/></svg>';
var ICON_SPK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4.5 9.5v5h3.2L12 18.6V5.4L7.7 9.5H4.5z" fill="currentColor" stroke="none" opacity=".85"/><path d="M15 9.2c1.6 1.5 1.6 4.1 0 5.6M17.6 7c2.8 2.7 2.8 7.3 0 10" stroke-linecap="round"/></svg>';
var ICON_SPK_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4.5 9.5v5h3.2L12 18.6V5.4L7.7 9.5H4.5z" fill="currentColor" stroke="none" opacity=".85"/><path d="M15.2 9.7l5 5M20.2 9.7l-5 5" stroke-linecap="round"/></svg>';
var ICON_LOCK_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5.4" y="10.6" width="13.2" height="9" rx="2.4"/><path d="M8.6 10.6V7.8a3.4 3.4 0 0 1 6.5-1.4"/></svg>';
var ICON_LOCK_SHUT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="5.4" y="10.6" width="13.2" height="9" rx="2.4"/><path d="M8.6 10.6V7.6a3.4 3.4 0 0 1 6.8 0v3"/><circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none"/></svg>';

function metaBit(parent, txt, strong) {
  var s = document.createElement(strong ? 'b' : 'span');
  s.textContent = txt; parent.appendChild(s);
  var d = document.createElement('span'); d.className = 'dot'; d.textContent = '·';
  parent.appendChild(d);
}
function paintSong() {
  paintHarmony();
  var w = S.world;
  $('sName').textContent = w.name;
  $('sEpithet').textContent = w.epithet;
  $('sAddr').textContent = '#' + (w.seed >>> 0).toString(36);
  var m = $('sMeta');
  while (m.firstChild) m.removeChild(m.firstChild);
  metaBit(m, w.styleLabel, true);
  metaBit(m, w.bpm + ' bpm');
  if (w.keyName) metaBit(m, 'in ' + w.keyName);
  metaBit(m, w.triplet ? '12/8' : '4/4');
  var last = document.createElement('span');
  last.textContent = w.bars + ' bars · ' + fmtTime(w.duration);
  m.appendChild(last);
  $('sOrigin').textContent = w.styleOrigin || '';
  var tv = $('tVal');
  if (tv) {
    tv.textContent = w.bpm;
    $('tempoRow').classList.toggle('set', !!S.tempo);
    tv.title = S.tempo ? 'the dial holds ' + w.bpm + ' bpm — tap to hand the tempo back to the dice'
                       : 'the dice chose ' + w.bpm + ' bpm — the − and + take it over';
  }
  paintBand();
  paintPos();
}
function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  return Math.floor(sec / 60) + ':' + ('0' + (sec % 60)).slice(-2);
}
function sectionAt(bar) {
  var w = S.world;
  for (var i = 0; i < w.sections.length; i++) {
    var s = w.sections[i];
    if (bar >= s.startBar && bar < s.startBar + s.bars) return s.name;
  }
  return '';
}
function paintPos() {
  var w = S.world;
  if (!w) return;
  var t = S.solo ? 0 : (S.playhead % Math.max(0.001, w.duration));
  $('prog').style.width = (S.playing && !S.solo ? (t / w.duration) * 100 : (S.bar / Math.max(1, w.bars)) * 100) + '%';
  $('sTime').textContent = (S.playing && !S.solo ? fmtTime(t) : fmtTime(S.bar * w.steps * w.secPerStep)) + ' / ' + fmtTime(w.duration);
  $('sSec').textContent = S.solo ? LANE_LABEL[S.solo] + ' alone' : sectionAt(S.bar);
}
function rowFor(lane) {
  var col = LANE_COLOR[lane] || '#999';
  var row = document.createElement('div'); row.className = 'row';
  var locked = !!S.locks[lane], muted = !!S.mute[lane];
  if (locked && !muted) row.classList.add('held');
  if (muted) row.classList.add('muted');
  if (S.solo === lane) { row.classList.add('soloing'); row.style.color = col; }
  if (MELODIC[lane]) row.classList.add('melodic');

  var mb = document.createElement('button');
  mb.className = 'rbtn mutebtn' + (muted ? ' off' : '');
  mb.innerHTML = (muted ? ICON_SPK_OFF : ICON_SPK) + '<em>' + (muted ? 'MUTED' : 'MUTE') + '</em>';
  mb.title = muted ? 'bring the ' + LANE_LABEL[lane] + ' back' : 'silence the ' + LANE_LABEL[lane] + ' — in this beat and every roll after it';
  mb.addEventListener('click', function (e) { e.stopPropagation(); toggleMute(lane); });
  row.appendChild(mb);

  var name = document.createElement('button'); name.className = 'rname';
  name.title = muted ? LANE_LABEL[lane] + ' is muted' : (S.solo === lane ? 'back to the whole beat' : 'hear the ' + LANE_LABEL[lane] + ' alone');
  var sw = document.createElement('span');
  var CLOUD = { sub: 'cl-kick', kick: 'cl-kick', snare: 'cl-snare', hat: 'cl-hihat',
    perc: 'cl-maraca', aux: 'cl-maraca',
    /* the four cloud instruments are the drummer's. The melodic lanes get a
       drawn cloud-glyph in the same language rather than a stock icon or a
       stretched photograph of a drum, because there is no cloud piano and
       pretending otherwise would look exactly like what it is. */
    keys: 'cl-glyph gl-keys', pad: 'cl-glyph gl-pad', lead: 'cl-glyph gl-lead' };
  sw.className = 'swatch cloud ' + (CLOUD[lane] || '');
  sw.style.color = col;
  var lab = document.createElement('span'); lab.className = 'rlab';
  var r1 = document.createElement('span'); r1.className = 'role'; r1.textContent = LANE_LABEL[lane];
  var r2 = document.createElement('span'); r2.className = 'eng'; r2.textContent = laneVoiceLabel(lane);
  lab.appendChild(r1); lab.appendChild(r2);
  name.appendChild(sw); name.appendChild(lab);
  name.addEventListener('click', function () {
    if (S.mute[lane]) { toast(LANE_LABEL[lane] + ' is muted — tap the speaker to bring it back'); return; }
    toggleSolo(lane);
  });
  row.appendChild(name);

  var vc = document.createElement('div'); vc.className = 'rvol';
  var vs = document.createElement('input');
  vs.type = 'range'; vs.min = 0; vs.max = KVOL_MAX; vs.step = 1;
  vs.value = S.vol[lane] !== undefined ? S.vol[lane] : KVOL_MID;
  vs.title = LANE_LABEL[lane] + ' loudness — equal-loudness steps (the sub spends fewer dB per notch than the hats; ISO 226). Double-tap to reset.';
  if (S.vol[lane] !== undefined) vc.classList.add('set');
  vs.addEventListener('input', function (e) {
    e.stopPropagation();
    setVol(lane, +vs.value);
    vc.classList.toggle('set', S.vol[lane] !== undefined);
  });
  vs.addEventListener('dblclick', function () {
    vs.value = KVOL_MID; setVol(lane, KVOL_MID); vc.classList.remove('set');
  });
  vs.addEventListener('click', function (e) { e.stopPropagation(); });
  if (muted) vs.disabled = true;   /* a muted lane has no loudness to fade */
  vc.appendChild(vs);
  row.appendChild(vc);

  function btn(iconHtml, caption, title, fn, cls) {
    var b = document.createElement('button');
    b.className = 'rbtn' + (cls ? ' ' + cls : '');
    b.innerHTML = iconHtml + '<em>' + caption + '</em>';
    b.title = title;
    b.addEventListener('click', function (e) { e.stopPropagation(); fn(b); });
    row.appendChild(b);
    return b;
  }
  var bPat = btn(ICON_PAT, 'PATTERN', 'roll a new pattern for the ' + LANE_LABEL[lane],
    function (b) { rollPart(lane, 'p', b); });
  var bSnd = btn(ICON_SOUND, 'SOUND', 'roll a new sound for the ' + LANE_LABEL[lane],
    function (b) { rollPart(lane, 's', b); });
  if (locked || muted) { bPat.disabled = true; bSnd.disabled = true; }
  var bl = btn(locked ? ICON_LOCK_SHUT : ICON_LOCK_OPEN, locked ? 'LOCKED' : 'LOCK',
    locked ? 'locked — tap to free it' : 'keep this exact lane through the big ROLL',
    function () { toggleLock(lane); }, locked ? 'locked' : '');
  if (muted) bl.disabled = true;
  return row;
}
/* THE HARMONY DIE. Harmony cannot be a lane with its own stream, because the
   chord is a shared object every part reads — so it draws from a stream
   salted by neither lane nor roll, exactly the way the drummer's dropout bars
   do, and it gets its own die. Rolling it moves every melodic part's PITCHES
   and leaves every rhythm and entrance byte-identical. */
function rollHarmony(btn) {
  S.roll.harm = { p: ((S.roll.harm && S.roll.harm.p) || 0) + 1, s: 0 };
  if (btn) { btn.classList.add('rolling'); setTimeout(function () { btn.classList.remove('rolling'); }, 420); }
  rebuildWorld(); paintSoon(); swapSoon(0); saveSessionSoon(); writeAddress();
  var w = S.world;
  toast(w && w.harmLocked && w.harmCells < 2
    ? 'this cell is the genre \u2014 the crawl is where it moves'
    : 'new changes \u2014 every part kept its rhythm', 2400);
}
function paintHarmony() {
  var el = $('harmCredit');
  if (el && S.world) el.textContent = S.world.harmCredit || '';
}

function paintBand() {
  var band = $('band');
  if (!band || !S.world) return;
  while (band.firstChild) band.removeChild(band.firstChild);
  for (var i = 0; i < LANE_ORDER.length; i++) {
    var lane = LANE_ORDER[i];
    if (S.world.laneParts[lane] === undefined) continue;
    band.appendChild(rowFor(lane));
  }
}

/* ── copy ──────────────────────────────────────────────────────────────── */
function copy(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).catch(function () { fallbackCopy(text); }); }
  else fallbackCopy(text);
}
function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } catch (e) {}
  document.body.removeChild(ta);
}

/* ── save: the mix, the score, the session ─────────────────────────────── */
var worker = null, workerDead = false;
function ensureWorker() {
  if (worker || workerDead) return worker;
  try {
    var src = engineSource() + '\n' +
      'self.onmessage = function (e) {\n' +
      '  var m = e.data;\n' +
      '  if (m.type === "render") {\n' +
      '    var tables = buildWavetables();\n' +
      '    var r = renderOffline(m.world, m.sr, tables, { onProgress: function (p) { self.postMessage({ type: "progress", p: p, id: m.id }); } });\n' +
      '    var buf = encodeWav(r.L, r.R, m.sr, makeRng(m.world.seed >>> 0));\n' +
      '    self.postMessage({ type: "wav", buf: buf, id: m.id }, [buf]);\n' +
      '  } else if (m.type === "bundle") {\n' +
      '    var tables2 = buildWavetables();\n' +
      '    var stems = stemScores(m.world);\n' +
      '    var files = [], total = stems.length + 1, done = 0;\n' +
      '    for (var i = 0; i < stems.length; i++) {\n' +
      '      var sr2 = renderOffline(stems[i].score, m.sr, tables2, {});\n' +
      '      files.push({ name: "stems/" + stems[i].role + ".wav", data: new Uint8Array(encodeWav(sr2.L, sr2.R, m.sr, makeRng(m.world.seed >>> 0))) });\n' +
      '      done++; self.postMessage({ type: "progress", p: done / total, id: m.id });\n' +
      '    }\n' +
      '    var mix = renderOffline(m.world, m.sr, tables2, {});\n' +
      '    files.push({ name: "mix.wav", data: new Uint8Array(encodeWav(mix.L, mix.R, m.sr, makeRng(m.world.seed >>> 0))) });\n' +
      '    files.push({ name: "beat.mid", data: new Uint8Array(encodeMidi(m.world)) });\n' +
      '    var zip = encodeZipStore(files);\n' +
      '    self.postMessage({ type: "zip", buf: zip, id: m.id }, [zip]);\n' +
      '  }\n' +
      '};\n';
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'application/javascript' })));
  } catch (e) { workerDead = true; worker = null; }
  return worker;
}
var saveId = 0, saving = {};
function baseName() {
  return 'dream-' + S.world.name.toLowerCase() + '-' + (S.world.seed >>> 0).toString(36);
}
function openSaveMenu() {
  $('sheetBody').innerHTML = '<h2>SAVE</h2>' +
    '<p>The mix is the beat you are hearing, sample for sample. The MIDI is the beat as a score — every hit with its groove intact, the 808 line as a bass track — and opens in any DAW. The session pack renders every lane to its own stem, zipped with the mix and the MIDI.</p>' +
    '<div class="stylegrid">' +
    '<button class="stylebtn" id="svMix">the mix<em>one WAV</em></button>' +
    '<button class="stylebtn" id="svMidi">the score<em>MIDI, instant</em></button>' +
    '<button class="stylebtn" id="svStems">the session<em>stems + mix + MIDI, zipped</em></button>' +
    '</div>';
  $('sheet').classList.add('on');
  $('svMix').addEventListener('click', function () {
    $('sheet').classList.remove('on');
    saveScore(scoreFor(S.world), baseName() + '.wav');
  });
  $('svMidi').addEventListener('click', function () {
    $('sheet').classList.remove('on');
    deliver(new Blob([encodeMidi(S.world)], { type: 'audio/midi' }), baseName() + '.mid');
  });
  $('svStems').addEventListener('click', function () {
    $('sheet').classList.remove('on');
    saveBundle();
  });
}
function saveBundle() {
  var id = ++saveId, lbl = $('saveLbl');
  $('bSave').disabled = true;
  lbl.textContent = 'STEMS 0%';
  var sr = S.ctx ? S.ctx.sampleRate : 44100;
  var w = ensureWorker();
  var name = baseName() + '-session.zip';
  function done() { $('bSave').disabled = false; lbl.textContent = 'SAVE'; }
  if (w) {
    saving[id] = 1;
    w.onmessage = function (e) {
      var m = e.data;
      if (!saving[m.id]) return;
      if (m.type === 'progress') { lbl.textContent = 'STEMS ' + Math.round(m.p * 100) + '%'; return; }
      if (m.type === 'zip') {
        done(); delete saving[m.id];
        deliver(new Blob([m.buf], { type: 'application/zip' }), name);
      }
    };
    w.onerror = function () { workerDead = true; worker = null; bundleHere(sr, name, done); };
    w.postMessage({ type: 'bundle', world: scoreFor(S.world), sr: sr, id: id });
    return;
  }
  bundleHere(sr, name, done);
}
function bundleHere(sr, name, done) {
  var stems = stemScores(S.world);
  var jobs = stems.map(function (st) { return { name: 'stems/' + st.role + '.wav', score: st.score }; });
  jobs.push({ name: 'mix.wav', score: scoreFor(S.world) });
  var files = [], ji = 0, lbl = $('saveLbl');
  function next() {
    if (ji >= jobs.length) {
      files.push({ name: 'beat.mid', data: new Uint8Array(encodeMidi(S.world)) });
      done();
      deliver(new Blob([encodeZipStore(files)], { type: 'application/zip' }), name);
      return;
    }
    var job = jobs[ji];
    renderScoreHere(job.score, sr, function (p) {
      lbl.textContent = 'STEMS ' + Math.round(((ji + p) / jobs.length) * 100) + '%';
    }, function (L, R) {
      files.push({ name: job.name, data: new Uint8Array(encodeWav(L, R, sr, makeRng(S.world.seed >>> 0))) });
      ji++; next();
    });
  }
  next();
}
function renderScoreHere(score, sr, onProgress, onDone) {
  var eng = new Engine(sr, { tables: buildTables(), seed: score.seed });
  eng.loop = false; eng.load(score);
  var tail = Math.ceil(sr * (1.2 + 5 * score.climate.space));
  var total = Math.ceil(score.duration * sr) + tail;
  var L = new Float32Array(total), R = new Float32Array(total);
  var slice = Math.max(8192, Math.round(sr * 0.35)), i = 0;
  var bL = new Float32Array(slice), bR = new Float32Array(slice);
  function step() {
    var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
    while (i < total && (((window.performance && performance.now) ? performance.now() : Date.now()) - t0) < 24) {
      var n = Math.min(slice, total - i);
      for (var k = 0; k < n; k++) { bL[k] = 0; bR[k] = 0; }
      eng.render(bL, bR, n);
      for (k = 0; k < n; k++) { L[i + k] = bL[k]; R[i + k] = bR[k]; }
      i += n;
    }
    onProgress(i / total);
    if (i < total) { requestAnimationFrame(step); return; }
    onDone(L, R);
  }
  requestAnimationFrame(step);
}
function saveScore(score, name) {
  var id = ++saveId, lbl = $('saveLbl');
  $('bSave').disabled = true;
  lbl.textContent = 'RENDERING 0%';
  var sr = S.ctx ? S.ctx.sampleRate : 44100;
  var w = ensureWorker();
  function done() { $('bSave').disabled = false; lbl.textContent = 'SAVE'; }
  if (w) {
    saving[id] = 1;
    w.onmessage = function (e) {
      var m = e.data;
      if (!saving[m.id]) return;
      if (m.type === 'progress') { lbl.textContent = 'RENDERING ' + Math.round(m.p * 100) + '%'; return; }
      if (m.type === 'wav') {
        done();
        delete saving[m.id];
        deliver(new Blob([m.buf], { type: 'audio/wav' }), name);
      }
    };
    w.onerror = function () { workerDead = true; worker = null; renderHere(score, sr, name, done); };
    w.postMessage({ type: 'render', world: score, sr: sr, id: id });
    return;
  }
  renderHere(score, sr, name, done);
}
function renderHere(score, sr, name, done) {
  var lbl = $('saveLbl');
  renderScoreHere(score, sr,
    function (p) { lbl.textContent = 'RENDERING ' + Math.round(p * 100) + '%'; },
    function (L, R) {
      done();
      deliver(new Blob([encodeWav(L, R, sr, makeRng(score.seed >>> 0))], { type: 'audio/wav' }), name);
    });
}
var SAVE_BRIDGE = null;
function initSaveBridge() {
  if (!(window.claude && typeof window.claude.use === 'function')) return;
  try {
    var p = window.claude.use('downloads');
    if (p && typeof p.then === 'function') {
      p.then(function (d) { SAVE_BRIDGE = d || null; }, function () { SAVE_BRIDGE = null; });
    }
  } catch (e) { SAVE_BRIDGE = null; }
}
function deliver(blob, filename) {
  var mb = blob.size / 1048576;
  if (SAVE_BRIDGE && SAVE_BRIDGE.save) {
    blob.arrayBuffer().then(function (ab) {
      return SAVE_BRIDGE.save({ filename: filename, data: ab });
    }).then(function () {
      toast('saved — ' + filename, 3000);
    }, function (e) {
      var code = (e && e.code) || 'unavailable';
      if (code === 'declined') { toast('save cancelled'); return; }
      if (code === 'too_large') { toast(mb.toFixed(0) + ' MB is over this viewer’s 16 MB limit — open the page itself to export', 6000); return; }
      if (code === 'rejected_extension' || code === 'extension_not_enabled') { toast('this viewer will not save this file type — open the page itself to export', 6000); return; }
      if (code === 'rate_limited') { toast('a save is already open — try again in a moment', 3600); return; }
      toast('this viewer cannot save files — open the page itself to export', 5200);
    });
    return;
  }
  if (window.claude) { toast('this view cannot save files — open the page itself to export', 5200); return; }
  anchorSave(blob, filename);
}
function anchorSave(blob, filename) {
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 4000);
  toast('saved — ' + filename, 2800);
}

/* ── the gate dice ─────────────────────────────────────────────────────── */
function drawDice(faceSeed) {
  var cv = $('dcv'), g = cv.getContext('2d'), W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  var rng = makeRng(faceSeed >>> 0);
  var pips = 1 + Math.floor(rng() * 6);
  var LAY = { 1: [[.5, .5]], 2: [[.3, .3], [.7, .7]], 3: [[.28, .28], [.5, .5], [.72, .72]],
    4: [[.3, .3], [.7, .3], [.3, .7], [.7, .7]],
    5: [[.28, .28], [.72, .28], [.5, .5], [.28, .72], [.72, .72]],
    6: [[.3, .25], [.7, .25], [.3, .5], [.7, .5], [.3, .75], [.7, .75]] };
  var pts = LAY[pips];
  for (var i = 0; i < pts.length; i++) {
    var x = pts[i][0] * W, y = pts[i][1] * H, r = W * 0.062;
    var gl = g.createRadialGradient(x, y, 0, x, y, r * 2.4);
    gl.addColorStop(0, 'rgba(21,80,160,.55)'); gl.addColorStop(1, 'rgba(21,80,160,0)');
    g.fillStyle = gl; g.beginPath(); g.arc(x, y, r * 2.4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1a4f8f'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
}

/* ── the style picker ──────────────────────────────────────────────────── */
function syncStyleChip() {
  var b = $('bStyle');
  b.textContent = S.style ? KSTYLES[S.style].label : 'any style';
  b.classList.toggle('on', !!S.style);
}
function openStylePicker() {
  var cur = S.style || null;
  var h = '<h2>STYLE</h2><p>Pick one and the dice rolls that drum language. Leave it on <b>any</b> and every roll chooses for itself. The patterns behind every style are the real, credited figures — the dembow cell, the Triggerman chain, the Amen grammar, the surdo family — played here by synthesized drums, because you cannot own a rhythm, only a recording of one.</p><div class="stylegrid">';
  h += '<button class="stylebtn' + (cur ? '' : ' on') + '" data-style="">any style<em>let the dice choose</em></button>';
  for (var i = 0; i < KSTYLE_KEYS.length; i++) {
    var k = KSTYLE_KEYS[i], st = KSTYLES[k];
    h += '<button class="stylebtn' + (cur === k ? ' on' : '') + '" data-style="' + k + '">' + st.label +
      '<em>' + st.place + ' · ' + st.tempo[0] + '–' + st.tempo[1] + ' bpm</em></button>';
  }
  h += '</div>';
  $('sheetBody').innerHTML = h;
  $('sheet').classList.add('on');
  var btns = $('sheetBody').querySelectorAll('.stylebtn');
  for (i = 0; i < btns.length; i++) {
    btns[i].addEventListener('click', function () {
      var want = this.getAttribute('data-style') || null;
      if (hasAny(S.locks) && S.frame && want !== S.frame.style) {
        toast('locked lanes pin the style — free the locks to travel', 3200);
        $('sheet').classList.remove('on');
        return;
      }
      S.style = want;
      $('sheet').classList.remove('on');
      syncStyleChip();
      rollAll();
    });
  }
}

/* ── about ─────────────────────────────────────────────────────────────── */
var ABOUT = '<h2>DREAM DRUMMER</h2>' +
'<p>Roll the dice in the clouds and a whole beat lands — a real drum language with its lineage named, played by drums synthesized on the spot from circuits and physics. There is not one sample in this page. The 808 is a real playable instrument here: a tuned boom with the slide, its 2nd and 3rd partials synthesized so a phone speaker hears the bass a car trunk feels.</p>' +
'<h3>THE LANES</h3>' +
'<li><b>808</b> — the tuned boom, playing the bassline (the log drum, in amapiano)</li>' +
'<li><b>KICK / SNARE / HATS</b> — one drummer’s limbs, on one clock</li>' +
'<li><b>PERCUSSION / EXTRAS</b> — the ensembles: congas, bells, surdos, djembes, cowbells</li>' +
'<h3>THE DICE</h3>' +
'<li><b>ROLL</b> throws a new beat — everything except what you have locked</li>' +
'<li><b>PATTERN</b>, on any lane, rolls what that lane plays — nothing else moves a hit</li>' +
'<li><b>SOUND</b> rolls how it sounds — not one hit changes</li>' +
'<li><b>LOCK</b> keeps that exact lane through every roll; the first lock pins style, tempo and tuning</li>' +
'<li><b>MUTE</b> silences a lane and keeps it out of every roll until you bring it back</li>' +
'<li>tap a lane’s <b>name</b> to hear it alone</li>' +
'<h3>THE PATTERNS</h3>' +
'<p>Grooves and patterns are nobody’s property — only recordings are — so these are the real figures, played: the dembow cell looped verbatim the way reggaetón demands; the Triggerman chain after the Showboys’ “Drag Rap”, roll-bars and bells included; the Amen grammar with its displaced third-bar backbeat; the surdo family and the telecoteco; the seven-stroke bell with the dunun conversation under it; Chuck Brown’s go-go pocket; the second line’s Big Four; the Bay’s empty-field slaps where the 808 IS the bassline. The style picker names every source.</p>' +
'<h3>THE FEEL</h3>' +
'<p>Timing comes from measurement, not vibes: MPC swing by Roger Linn’s own formula, backbeats that sit late the way Clyde Stubblefield’s did, ghost notes at the measured funk ratio, a 1/f-correlated human clock for the played styles — and the machine styles stay machines, because a quantized grid is trap’s identity, not its failure.</p>' +
'<h3>TAKING IT WITH YOU</h3>' +
'<p><b>SAVE</b> renders the mix to a WAV, writes the beat as a MIDI file (the 808 line as a real bass track, slides and all), or packs every lane as stems with the mix and the MIDI in one zip. The <b>#address</b> regrows this exact beat anywhere, forever.</p>';

/* ── SESSIONS ARE A HISTORY, NOT A STATE ───────────────────────────────────
   This used to restore the last session silently on every load, which means
   the app never starts clean: you open it to make something and you are
   already inside whatever you left behind, with its mutes and its locks and
   its frame. Opening a blank page is the point of opening the page.

   So the last hundred sessions are KEPT and none of them is LOADED. The ring
   is append-only with de-duplication on the address, newest first, and a
   session is written when the beat actually changes rather than on a timer —
   a hundred entries of the same beat is not a history. */
var SKEY = 'knock.v1';
var HKEY = 'knock.hist.v1';
var HMAX = 100;
function sessionRecord() {
  return { seed: S.seed >>> 0, style: S.style || null, roll: S.roll || {}, locks: S.locks || {},
           mute: S.mute || {}, frame: S.frame || null, tempo: S.tempo || null, vol: S.vol || {},
           addr: (S.wrote || '').replace(/^#/, ''), at: Date.now() };
}
function readHistory() {
  try {
    var raw = localStorage.getItem(HKEY);
    if (!raw) return [];
    var a = JSON.parse(raw);
    return (a && a.length) ? a : [];
  } catch (e) { return []; }
}
function saveSession() {
  try {
    var rec = sessionRecord();
    if (!rec.seed) return;
    var h = readHistory();
    /* the same address twice in a row is one session, not two */
    if (h.length && h[0].addr === rec.addr) { h[0] = rec; }
    else {
      for (var i = 0; i < h.length; i++) if (h[i].addr === rec.addr) { h.splice(i, 1); break; }
      h.unshift(rec);
    }
    if (h.length > HMAX) h.length = HMAX;
    localStorage.setItem(HKEY, JSON.stringify(h));
    /* the single-slot key is still written, for anything that reads it — but
       nothing loads it at boot any more */
    localStorage.setItem(SKEY, JSON.stringify(rec));
  } catch (e) {}
}
function restoreRecord(o) {
  if (!o || !o.seed) return false;
  S.seed = o.seed >>> 0; S.style = o.style || null;
  S.roll = o.roll || {}; S.locks = o.locks || {}; S.mute = o.mute || {}; S.frame = o.frame || null;
  S.tempo = o.tempo && o.tempo >= 40 && o.tempo <= 220 ? o.tempo : null;
  S.vol = o.vol || {};
  return true;
}
function ago(ms) {
  var s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return Math.round(s / 60) + ' min ago';
  if (s < 129600) return Math.round(s / 3600) + ' hr ago';
  return Math.round(s / 86400) + ' days ago';
}
function openHistory() {
  var h = readHistory();
  var body = '<h2>SESSIONS</h2>';
  if (!h.length) {
    body += '<p>Nothing yet. Every beat you land on is kept here — the last ' + HMAX +
      ', newest first — and none of them loads on its own. This page always opens empty.</p>';
  } else {
    body += '<p>The last ' + h.length + ', newest first. Nothing here loads unless you pick it.</p><div class="histlist">';
    for (var i = 0; i < h.length; i++) {
      var o = h[i];
      var st = o.style && KSTYLES[o.style] ? KSTYLES[o.style].label : 'any style';
      var tp = o.tempo ? o.tempo + ' bpm' : '';
      var lk = o.locks ? Object.keys(o.locks).length : 0;
      var mu = o.mute ? Object.keys(o.mute).filter(function (k) { return o.mute[k]; }).length : 0;
      body += '<button class="histbtn" data-i="' + i + '">' +
        '<span class="hname">' + st + '</span>' +
        '<span class="hmeta">' + tp + (lk ? ' · ' + lk + ' locked' : '') + (mu ? ' · ' + mu + ' muted' : '') + '</span>' +
        '<span class="hwhen">' + ago(o.at || 0) + '</span></button>';
    }
    body += '</div><p class="hclear"><button class="stylebtn" id="histClear">forget all of them</button></p>';
  }
  $('sheetBody').innerHTML = body;
  $('sheet').classList.add('on');
  var btns = $('sheetBody').querySelectorAll('.histbtn');
  for (var b = 0; b < btns.length; b++) {
    btns[b].onclick = function () {
      var rec = readHistory()[+this.getAttribute('data-i')];
      if (restoreRecord(rec)) {
        $('sheet').classList.remove('on');
        S.bar = 0;
        writeAddress();
        rebuildWorld(); paintSong(); syncStyleChip();
        if (S.playing) sendSwap(0, false);
        toast('session opened — ' + S.world.name, 2400);
      }
    };
  }
  var cl = $('histClear');
  if (cl) cl.onclick = function () {
    try { localStorage.removeItem(HKEY); } catch (e) {}
    openHistory();
  };
}

/* ── boot ──────────────────────────────────────────────────────────────── */
function enterApp() {
  $('gate').classList.add('gone');
  $('bar').classList.remove('hidden');
  $('stage').classList.remove('hidden');
  $('deck').classList.remove('hidden');
  buildTables();
}
function boot() {
  initSaveBridge();
  var addr = readAddress();
  /* NOTHING IS RESTORED HERE. The history exists and the SESSIONS sheet
     offers it; boot does not reach into it. An address in the URL is a
     different matter — that is the user asking for a specific beat. */
  var hadSession = false;
  if (addr.w) {
    S.seed = addr.w >>> 0;
    S.style = addr.y ? (KSTYLE_KEYS[addr.y - 1] || null) : null;
    S.roll = decodeRoll(addr.r);
    S.mute = decodeMute(addr.m);
    S.tempo = addr.t && addr.t >= 40 && addr.t <= 220 ? addr.t : null;
    S.vol = decodeVol(addr.v);
    if (!hadSession || S.seed !== ((addr.w) >>> 0)) { S.locks = {}; S.frame = null; }
  }
  drawDice(addr.w || S.seed || ((Math.random() * 1e9) | 0));
  syncStyleChip();

  if ((hadSession || addr.w) && S.seed) {
    rebuildWorld();
    var g = $('gCont');
    g.textContent = (addr.w ? 'play ' : 'continue — ') + S.world.name;
    g.classList.add('show');
    g.addEventListener('click', function () {
      enterApp(); paintSong(); writeAddress(); play(0);
    });
  }
  $('dice').addEventListener('click', function () {
    var d = $('dice');
    d.classList.remove('rolling'); void d.offsetWidth; d.classList.add('rolling');
    var s = (Math.random() * 4294967296) >>> 0;
    drawDice(s);
    setTimeout(function () {
      enterApp();
      S.seed = s; S.roll = {};
      rebuildWorld(); paintSong(); writeAddress(); saveSession();
      play(0);
    }, 480);
  });

  $('bPlay').addEventListener('click', function () {
    if (S.playing && !S.solo) pause();
    else play();
  });
  holdable($('tMinus'), function () { nudgeTempo(-1); });
  holdable($('tPlus'), function () { nudgeTempo(1); });
  $('tVal').addEventListener('click', resetTempo);
  $('bRoll').addEventListener('click', rollAll);
  $('bSave').addEventListener('click', openSaveMenu);
  $('bStyle').addEventListener('click', openStylePicker);
  var hb = $('bHarm'); if (hb) hb.addEventListener('click', function () { rollHarmony(hb); });
  $('bAbout').addEventListener('click', function () {
    $('sheetBody').innerHTML = ABOUT; $('sheet').classList.add('on');
  });
  $('sAddr').addEventListener('click', function () {
    var url = location.origin + location.pathname + (S.wrote || ('#w=' + (S.seed >>> 0).toString(36)));
    copy(url);
    toast(hasAny(S.locks)
      ? 'address copied — locks live in this browser and do not travel with it'
      : 'address copied — it regrows this exact beat anywhere', 3200);
  });
  $('progWrap').addEventListener('click', function (e) {
    if (!S.world) return;
    var r = this.getBoundingClientRect();
    var frac = Math.min(0.999, Math.max(0, (e.clientX - r.left) / r.width));
    var bar = Math.floor(frac * S.world.bars);
    S.bar = bar;
    if (S.playing && !S.solo) sendSwap(bar, false);
    paintPos();
  });
  $('sClose').addEventListener('click', function () { $('sheet').classList.remove('on'); });
  $('bHist').addEventListener('click', openHistory);
  $('sheet').addEventListener('click', function (e) { if (e.target === $('sheet')) $('sheet').classList.remove('on'); });
  window.addEventListener('hashchange', onHashChange);
  document.addEventListener('keydown', function (e) {
    var gateUp = !$('gate').classList.contains('gone');
    if (e.key === ' ') {
      e.preventDefault();
      if (gateUp) $('dice').click();
      else if (S.playing && !S.solo) pause();
      else play();
    } else if (e.key === 'Escape') { $('sheet').classList.remove('on'); }
    else if ((e.key === 'r' || e.key === 'R') && !gateUp) rollAll();
  });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

/* the console/tests handle on the running page */
window.KNOCK = {
  state: S,
  world: function () { return S.world; },
  play: play, pause: pause, rollAll: rollAll,
  roll: function (lane, kind) { rollPart(lane, kind === 's' ? 's' : 'p'); },
  lock: toggleLock, solo: toggleSolo, mute: toggleMute,
  seed: function (n) { S.seed = n >>> 0; S.roll = {}; rebuildWorld(); paintSong(); writeAddress(); saveSession(); if (S.playing) sendSwap(0); },
  build: function (n, opts) { return buildBeat(n >>> 0, opts); },
  version: '1.0'
};
})();

