/**
 * MIDI Room local cable graph, protocol v1.
 *
 * The host authenticates the source by its private MessagePort, then calls
 * publish(sessionId, event). Nothing here reads global messages, touches native
 * MIDI outputs, or uses the network. A delivery callback is a private port send.
 *
 * Legacy receivers can opt in through the host's virtual Web MIDI adapter.
 * Each route is a separate virtual input, so its notes can be released without
 * sending an all-notes-off to unrelated controllers.
 */
export const BUS_VERSION = 1;
export const BUS_LIMITS = Object.freeze({ sessions: 8, routes: 32, futureMs: 16000, burst: 256, perSecond: 1024, notesPerRoute: 512 });
const KINDS = new Set(['midi', 'transport', 'field', 'signal']);
const SIGNAL = /^[a-zA-Z][a-zA-Z0-9_.:-]{0,47}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$/;
const finite = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
const integer = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const cleanList = input => Array.isArray(input) && input.length <= 4 && input.every(k => KINDS.has(k)) ? [...new Set(input)] : null;
const signalsList = input => Array.isArray(input) && input.length > 0 && input.length <= 32 && input.every(k => typeof k === 'string' && SIGNAL.test(k)) ? [...new Set(input)] : null;

function jsonValue(value) {
  let nodes = 0;
  function visit(v, depth) {
    if (++nodes > 512 || depth > 4) return false;
    if (v === null || typeof v === 'boolean') return true;
    if (typeof v === 'number') return Number.isFinite(v);
    if (typeof v === 'string') return v.length <= 8192;
    if (Array.isArray(v)) return v.length <= 128 && v.every(x => visit(x, depth + 1));
    if (!record(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) return false;
    const keys = Object.keys(v);
    return keys.length <= 64 && keys.every(k => k.length <= 128 && visit(v[k], depth + 1));
  }
  try {
    if (!visit(value, 0)) return null;
    const encoded = JSON.stringify(value);
    if (new TextEncoder().encode(encoded).length > 8192) return null;
    return { value: JSON.parse(encoded) };
  } catch { return null; }
}

export function validMIDI(data) {
  if (!(Array.isArray(data) || data instanceof Uint8Array) || data.length < 2 || data.length > 3) return false;
  const status = data[0];
  if (!integer(status, 0x80, 0xef) || data.length !== ((status & 0xe0) === 0xc0 ? 2 : 3)) return false;
  for (let i = 1; i < data.length; i++) if (!integer(data[i], 0, 127)) return false;
  return true;
}

/** Return only bounded protocol fields. Extra sender fields never cross a wire. */
export function validateInstrumentEvent(input) {
  if (!record(input)) return null;
  if (input.kind === 'midi') return validMIDI(input.data) ? { kind: 'midi', data: Array.from(input.data) } : null;
  if (input.kind === 'signal') {
    if (typeof input.signal !== 'string' || !SIGNAL.test(input.signal)) return null;
    const checked = jsonValue(input.value);
    return checked ? { kind: 'signal', signal: input.signal, value: checked.value } : null;
  }
  if (input.kind === 'transport') {
    if (!['start', 'stop', 'continue', 'seek', 'tempo'].includes(input.action)) return null;
    if (input.bpm !== undefined && !finite(input.bpm, 20, 300)) return null;
    if (input.beat !== undefined && !finite(input.beat, 0, 1e9)) return null;
    if (input.action === 'tempo' && input.bpm === undefined || input.action === 'seek' && input.beat === undefined) return null;
    const result = { kind: 'transport', action: input.action };
    if (input.bpm !== undefined) result.bpm = input.bpm;
    if (input.beat !== undefined) result.beat = input.beat;
    if (input.meter !== undefined) {
      if (!Array.isArray(input.meter) || input.meter.length !== 2 || !integer(input.meter[0], 1, 12) || ![2, 4, 8, 16].includes(input.meter[1])) return null;
      result.meter = [...input.meter];
    }
    return result;
  }
  if (input.kind === 'field') {
    const result = { kind: 'field' };
    if (input.key !== undefined) {
      if (!integer(input.key, 0, 11)) return null;
      result.key = input.key;
    }
    if (input.scale !== undefined) {
      if (!['major', 'minor', 'dorian', 'mixolydian', 'pentatonic-major', 'pentatonic-minor', 'chromatic'].includes(input.scale)) return null;
      result.scale = input.scale;
    }
    for (const key of ['energy', 'density', 'swing']) {
      if (input[key] === undefined) continue;
      if (!finite(input[key], 0, 1)) return null;
      result[key] = input[key];
    }
    if (input.groove !== undefined) {
      if (!Array.isArray(input.groove) || input.groove.length < 1 || input.groove.length > 32 || !input.groove.every(n => finite(n, 0, 1))) return null;
      result.groove = [...input.groove];
    }
    return Object.keys(result).length > 1 ? result : null;
  }
  return null;
}

/** Translate a route cancellation into releases for that route's virtual input. */
export function cancellationMIDI(event) {
  if (event?.kind !== 'cancel' || !Array.isArray(event.notes) || !Array.isArray(event.channels)) return [];
  const data = [];
  for (const channel of event.channels.slice(0, 16)) if (integer(channel, 0, 15)) data.push([0xb0 | channel, 64, 0]);
  for (const note of event.notes.slice(0, BUS_LIMITS.notesPerRoute)) {
    if (!Array.isArray(note) || !integer(note[0], 0, 15) || !integer(note[1], 0, 127) || !integer(note[2], 1, 8)) continue;
    for (let i = 0; i < note[2]; i++) data.push([0x80 | note[0], note[1], 0]);
  }
  for (const channel of event.channels.slice(0, 16)) if (integer(channel, 0, 15)) {
    data.push([0xb0 | channel, 120, 0], [0xb0 | channel, 123, 0], [0xb0 | channel, 121, 0], [0xe0 | channel, 0, 64]);
  }
  return data;
}

export class InstrumentBus {
  constructor({ now = () => globalThis.performance ? performance.timeOrigin + performance.now() : Date.now(), translate = null } = {}) {
    if (typeof now !== 'function') throw new TypeError('A monotonic clock is required.');
    if (translate !== null && typeof translate !== 'function') throw new TypeError('A translator must be a function.');
    this.now = now;
    // Policy lives outside the bus. The host supplies this from dist/instrument-map.json;
    // with no translator the bus forwards bytes exactly as it always has.
    this.translate = translate;
    this.sessions = new Map();
    this.routes = new Map();
    this.serial = 0;
    this.stats = { published: 0, delivered: 0, rejected: 0, cancelled: 0, failed: 0 };
  }

  addSession({ id, send, capabilities = { send: [], receive: ['midi'] }, instrument = null } = {}) {
    if (typeof id !== 'string' || !ID.test(id) || typeof send !== 'function') throw new TypeError('Session id and private send callback are required.');
    if (instrument !== null && (typeof instrument !== 'string' || !ID.test(instrument))) throw new TypeError('An instrument name must be a plain identifier.');
    if (this.sessions.has(id)) throw new Error('Session already exists.');
    if (this.sessions.size >= BUS_LIMITS.sessions) throw new RangeError('Close an instrument before adding another.');
    const output = cleanList(capabilities.send || []), input = cleanList(capabilities.receive || []);
    if (!output || !input) throw new TypeError('Unsupported instrument capabilities.');
    this.sessions.set(id, { id, send, output, input, instrument, tokens: BUS_LIMITS.burst, tokenAt: this.now(), faultUntil: 0 });
    return id;
  }

  setCapabilities(id, capabilities) {
    const session = this.sessions.get(id);
    const output = cleanList(capabilities?.send || []), input = cleanList(capabilities?.receive || []);
    if (!session || !output || !input) return false;
    for (const route of [...this.routes.values()]) {
      if (route.from === id && route.kinds.some(k => !output.includes(k)) || route.to === id && route.kinds.some(k => !input.includes(k))) this.removeRoute(route.id, 'capability-change');
    }
    session.output = output; session.input = input;
    return true;
  }

  addRoute({ id, from, to, kinds = ['midi'], signals = [] } = {}) {
    const source = this.sessions.get(from), target = this.sessions.get(to), types = cleanList(kinds);
    if (typeof id !== 'string' || !ID.test(id) || this.routes.has(id)) throw new TypeError('A unique route id is required.');
    if (!source || !target || from === to) throw new Error('Choose two different open instruments.');
    if (!types?.length || types.some(k => !source.output.includes(k) || !target.input.includes(k))) throw new Error('These instruments do not declare matching ports.');
    const allowedSignals = types.includes('signal') ? signalsList(signals) : [];
    if (!allowedSignals) throw new TypeError('Choose the signals this cable may carry.');
    if (this.routes.size >= BUS_LIMITS.routes) throw new RangeError('The room has reached its cable limit.');
    if ([...this.routes.values()].some(r => r.from === from && r.to === to && r.kinds.some(k => types.includes(k)))) throw new Error('This connection already exists.');
    if (this._reachable(to, from)) throw new Error('This cable would create a feedback loop.');
    this.routes.set(id, { id, from, to, kinds: types, signals: allowedSignals, notes: new Map(), channels: new Set(), generation: 0 });
    return id;
  }

  _reachable(start, end) {
    const seen = new Set(), pending = [start];
    while (pending.length) {
      const id = pending.pop();
      if (id === end) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const route of this.routes.values()) if (route.from === id) pending.push(route.to);
    }
    return false;
  }

  _reject(reason) { this.stats.rejected++; return { ok: false, reason, delivered: 0 }; }

  publish(sourceId, input) {
    const source = this.sessions.get(sourceId);
    if (!source) return this._reject('unknown-source');
    const event = validateInstrumentEvent(input);
    if (!event || !source.output.includes(event.kind)) return this._reject('invalid-event');
    const now = this.now();
    if (!finite(now, 0, Number.MAX_VALUE)) return this._reject('invalid-clock');
    if (input.at !== undefined && !finite(input.at, now - 1000, now + BUS_LIMITS.futureMs)) return this._reject('invalid-time');
    const at = Math.max(now, input.at ?? now);
    source.tokens = Math.min(BUS_LIMITS.burst, source.tokens + Math.max(0, now - source.tokenAt) * BUS_LIMITS.perSecond / 1000);
    source.tokenAt = now;
    if (source.tokens < 1) {
      if (now >= source.faultUntil) { this.panicSession(sourceId, 'rate-limit'); source.faultUntil = now + 1000; }
      return this._reject('rate-limit');
    }
    source.tokens--;
    const routes = [...this.routes.values()].filter(route => route.from === sourceId && route.kinds.includes(event.kind) && (event.kind !== 'signal' || route.signals.includes(event.signal)));
    const id = 'event-' + (++this.serial);
    let delivered = 0;
    for (const route of routes) {
      // A send callback may remove a route synchronously (e.g. a closed frame).
      if (this.routes.get(route.id) !== route) continue;
      const carried = this._carry(source, route, event);
      // Track what is actually SENT, not what arrived. A cancelled cable releases
      // notes from this table, so tracking the untranslated number would leave the
      // receiver holding a note nobody ever asks it to let go of.
      if (carried.kind === 'midi' && !this._track(route, carried.data)) { this._cancel(route, 'note-limit'); continue; }
      if (this._send(route, { ...carried, id, at, clock: { now, unit: 'unix-ms' } })) delivered++;
    }
    this.stats.published++;
    this.stats.delivered += delivered;
    return { ok: true, id, delivered };
  }

  /** Say what this receiver reads, in its own numbers. Any failure keeps the original. */
  _carry(source, route, event) {
    if (!this.translate || event.kind !== 'midi') return event;
    const target = this.sessions.get(route.to);
    let translated;
    try {
      translated = this.translate(event, { id: route.id, from: source.instrument, to: target ? target.instrument : null });
    } catch { return event; }
    if (!translated || translated.kind !== 'midi' || !validMIDI(translated.data)) return event;
    // Only the bytes are taken, and only a message of the same type: a translation that
    // turned a note-off into a note-on would leave the receiver sounding forever.
    if ((translated.data[0] & 0xf0) !== (event.data[0] & 0xf0)) return event;
    return { ...event, data: Array.from(translated.data) };
  }

  _track(route, data) {
    const channel = data[0] & 15, type = data[0] & 0xf0, key = channel * 128 + data[1];
    route.channels.add(channel);
    if (type === 0x90 && data[2] > 0) {
      const count = route.notes.get(key) || 0;
      if (count >= 8 || !count && route.notes.size >= BUS_LIMITS.notesPerRoute) return false;
      route.notes.set(key, count + 1);
    } else if (type === 0x80 || type === 0x90 && data[2] === 0) {
      const count = route.notes.get(key) || 0;
      if (count > 1) route.notes.set(key, count - 1); else route.notes.delete(key);
    } else if (type === 0xb0 && (data[1] === 120 || data[1] === 123)) {
      for (const key of route.notes.keys()) if (Math.floor(key / 128) === channel) route.notes.delete(key);
    }
    return true;
  }

  _send(route, event) {
    const target = this.sessions.get(route.to);
    if (!target) return false;
    // Identity, destination, route and generation are host-owned fields.
    const envelope = { ...event, type: 'instrument-event', version: BUS_VERSION, origin: route.from, destination: route.to, route: route.id, generation: route.generation };
    try { if (target.send(envelope) === false) { this.stats.failed++; return false; } return true; }
    catch { this.stats.failed++; return false; }
  }

  _cancel(route, reason, removed = false) {
    const now = this.now();
    route.generation++;
    this._send(route, {
      kind: 'cancel', id: 'event-' + (++this.serial), at: now,
      clock: { now, unit: 'unix-ms' },
      reason: String(reason).slice(0, 80),
      removed,
      notes: [...route.notes].map(([key, count]) => [Math.floor(key / 128), key % 128, count]),
      channels: [...route.channels],
    });
    route.notes.clear(); route.channels.clear(); this.stats.cancelled++;
  }

  removeRoute(id, reason = 'cable-removed') {
    const route = this.routes.get(id);
    if (!route) return false;
    this._cancel(route, reason, true);
    this.routes.delete(id);
    return true;
  }

  removeSession(id) {
    if (!this.sessions.has(id)) return false;
    for (const route of [...this.routes.values()]) if (route.from === id || route.to === id) this.removeRoute(route.id, 'instrument-closed');
    this.sessions.delete(id);
    return true;
  }

  panicSession(id, reason = 'instrument-stopped') {
    for (const route of [...this.routes.values()]) if (route.from === id || route.to === id) this._cancel(route, reason);
  }

  panicSource(id, reason = 'source-stopped') {
    for (const route of [...this.routes.values()]) if (route.from === id) this._cancel(route, reason);
  }

  panic(reason = 'room-stopped') { for (const route of [...this.routes.values()]) this._cancel(route, reason); }

  snapshot() {
    return {
      version: BUS_VERSION,
      clock: { now: this.now(), unit: 'unix-ms' },
      sessions: [...this.sessions.values()].map(s => ({ id: s.id, instrument: s.instrument, capabilities: { send: [...s.output], receive: [...s.input] } })),
      routes: [...this.routes.values()].map(r => ({ id: r.id, from: r.from, to: r.to, kinds: [...r.kinds], signals: [...r.signals], activeNotes: r.notes.size, generation: r.generation })),
      stats: { ...this.stats },
    };
  }
}
