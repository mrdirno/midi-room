/* Aldrin Payopay — local TRITON transport ownership, 2026-09-04. */
(function () {
  'use strict';
  // The preserved first-run surface is Soul, whose reference performance is
  // 132 BPM. One initial authority keeps that posture and both readouts agree.
  let bpm = 132, revision = 0, reason = 'original Soul reference tempo';
  const history = [], listeners = new Set();
  function record(writer, requested, accepted) {
    history.push({writer, requested, effective: bpm, accepted, revision, at: Date.now()});
    if (history.length > 80) history.shift();
  }
  const transport = window.TritonTransport = {
    snapshot: () => ({bpm, effectiveBpm: bpm, owner: 'local', follow: false, revision, reason, history: history.slice()}),
    preference(value, writer) { record(writer, value, false); return bpm; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    set(value, options = {}) {
      if(typeof exporting!=='undefined'&&exporting)return false;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 40 || value > 240) return false;
      if (options.owner && options.owner !== 'local') { record('rejected foreign owner', value, false); return false; }
      if (value === bpm) return true;
      bpm = value; revision++; reason = String(options.reason || 'explicit local tempo').slice(0,120);
      record(reason, value, true);
      for (const fn of listeners) fn(transport.snapshot());
      return true;
    }
  };
  Object.defineProperty(state, 'tempo', {
    configurable: false, enumerable: true, get: () => bpm,
    set(value) { if (value !== bpm) record('blocked legacy assignment', value, false); }
  });
})();
