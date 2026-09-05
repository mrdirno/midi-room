/** This function is serialized into an opaque-origin iframe before instrument code. */
export function childBootstrap(options) {
  'use strict';
  const nonce = String(options.nonce), MAX_SAVE_BYTES = 256 * 1024 * 1024;
  let channel = null, disposed = false, serial = 0, granted = false, lastNotice = -Infinity, notices = 0;
  let bridgeTimer = null;
  const pendingMIDI = new Map(), pendingSaves = new Map(), blobs = new Map(), contexts = new Set();
  const inputStore = new Map(), inputCache = new Map(), queuedNotices = [];
  const cleanups = [];
  const wires = new Map(), subscribers = new Map();
  let surfaceProfile = null;
  const controlListeners = new Set();
  const protocolKinds = ['midi', 'transport', 'field', 'signal'];
  let hardwareState = { access: false, inputs: [], selection: 'auto' }, pendingTimers = 0;
  let declaration = { name: 'HTML instrument', send: [], receive: ['midi'] };
  let legacyVibeBus = false;

  function readyDeclaration() {
    return { type: 'instrument-ready', ...declaration, receive: legacyVibeBus ? [...new Set([...declaration.receive, 'signal'])] : [...declaration.receive], legacyVibeBus };
  }

  function now() { return Number.isFinite(performance.timeOrigin) ? performance.timeOrigin + performance.now() : Date.now(); }
  function goodID(id) { return typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$/.test(id); }
  function kinds(value) { return Array.isArray(value) && value.length <= 4 && value.every(k => protocolKinds.includes(k)) ? [...new Set(value)] : null; }
  function declare(value = {}) {
    if (disposed || !value || typeof value !== 'object') return false;
    const output = kinds(value.send || []), input = kinds(value.receive || []);
    if (!output || !input) return false;
    declaration = { name: String(value.name || declaration.name || 'HTML instrument').slice(0, 80), send: output, receive: input };
    send(readyDeclaration());
    return true;
  }
  function emit(event) {
    if (disposed || !event || typeof event !== 'object' || !protocolKinds.includes(event.kind) || !declaration.send.includes(event.kind)) return false;
    // The parent applies the authoritative schema and rate/route limits.
    // Bound the child transport too, so an accidental giant payload stays local.
    try { if (JSON.stringify(event).length > 10000) return false; } catch { return false; }
    return send({ type: 'instrument-publish', event });
  }
  function on(kind, callback) {
    if (disposed || ![...protocolKinds, 'cancel'].includes(kind) || typeof callback !== 'function') return () => {};
    const listeners = subscribers.get(kind) || new Set();
    if (listeners.size >= 64) return () => {};
    listeners.add(callback); subscribers.set(kind, listeners);
    return () => { listeners.delete(callback); if (!listeners.size) subscribers.delete(kind); };
  }
  function dispatchInstrument(event) {
    for (const callback of [...(subscribers.get(event.kind) || [])]) {
      try { callback(event); } catch (error) { notice('Instrument callback: ' + String(error?.message || error)); }
    }
  }
  const midiRoom = Object.freeze({
    version: 1, declare, emit, on, now,
    controlVersion: 1,
    describe(profile) {
      try { if (!profile || profile.version !== 1 || JSON.stringify(profile).length > 16384) return false; } catch { return false; }
      surfaceProfile = profile; return send({type:'surface-describe',profile});
    },
    onControl(callback) {
      if (typeof callback !== 'function' || controlListeners.size >= 16) return () => {};
      controlListeners.add(callback); return () => controlListeners.delete(callback);
    },
    requestControl(action,payload={}) {
      try { if (!['bind','hit','cancel','save-map','load-map'].includes(action) || JSON.stringify(payload).length > 16384) return false; } catch { return false; }
      return send({type:'surface-request',version:1,action,payload});
    },
    audioTime(context, at) {
      if (!context || !Number.isFinite(context.currentTime) || !Number.isFinite(at)) return null;
      return context.currentTime + Math.max(0, at - now()) / 1000;
    }
  });
  try { Object.defineProperty(window, 'MidiRoom', { configurable: true, value: midiRoom }); } catch {}
  function signalCapability(direction) {
    if (!declaration[direction].includes('signal')) declare({ ...declaration, [direction]: [...declaration[direction], 'signal'] });
  }
  const defaultVibeBus = {
    cardId: nonce,
    get capabilities() { return { send: [...declaration.send], receive: [...declaration.receive] }; },
    emit(signal, value) {
      if (typeof signal !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_.:-]{0,47}$/.test(signal)) return false;
      signalCapability('send'); return emit({ kind: 'signal', signal, value });
    },
    listen(signal, callback) {
      if (typeof signal !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_.:-]{0,47}$/.test(signal) || typeof callback !== 'function') return () => {};
      signalCapability('receive');
      return on('signal', event => { if (event.signal === signal) callback(event.value, event); });
    }
  };
  let vibeValue;
  try { vibeValue = window.VibeBus || defaultVibeBus; } catch { vibeValue = defaultVibeBus; }
  function detectVibeBus(notifyChange = true) {
    if (disposed) return;
    let value;
    try { value = window.VibeBus; } catch { return; }
    const next = value != null && value !== defaultVibeBus && ['object', 'function'].includes(typeof value);
    if (next === legacyVibeBus) return;
    legacyVibeBus = next;
    if (notifyChange) send(readyDeclaration());
  }
  try {
    Object.defineProperty(window, 'VibeBus', {
      configurable: true, enumerable: true,
      get: () => vibeValue,
      set(value) { vibeValue = value; detectVibeBus(); }
    });
  } catch {
    // A non-configurable app property retains its exact original semantics.
    // Lifecycle checks still detect object replacement where possible.
    try { if (!window.VibeBus) window.VibeBus = defaultVibeBus; } catch {}
  }
  detectVibeBus(false);
  listen(document, 'DOMContentLoaded', () => detectVibeBus());
  listen(window, 'load', () => detectVibeBus());

  function fail(message, name = 'NotSupportedError') { return new DOMException(message, name); }
  function send(message) {
    if (!channel || disposed) return false;
    try { channel.postMessage(message); return true; } catch { return false; }
  }
  function notice(message) {
    const now = performance.now();
    if (disposed || now - lastNotice < 1500 || notices >= 3) return;
    lastNotice = now; notices++;
    const event = { type: 'notice', message: String(message).slice(0, 240) };
    if (!send(event)) queuedNotices.push(event);
  }
  function listen(target, type, listener, capture = false) {
    target.addEventListener(type, listener, capture);
    cleanups.push(() => target.removeEventListener(type, listener, capture));
  }
  function eventWith(type, properties) {
    const event = new Event(type);
    for (const [key, value] of Object.entries(properties)) Object.defineProperty(event, key, { value, enumerable: true });
    return event;
  }
  function handlerProperty(target, name, type, open = false) {
    let handler = null;
    Object.defineProperty(target, name, {
      configurable: true, enumerable: true, get: () => handler,
      set(value) {
        if (handler) target.removeEventListener(type, handler);
        handler = typeof value === 'function' ? value : null;
        if (handler) { target.addEventListener(type, handler); if (open) target.open(); }
      }
    });
  }
  function portMap(store) {
    return Object.freeze({
      get size() { return store.size; },
      get: key => store.get(key), has: key => store.has(key),
      keys: () => store.keys(), values: () => store.values(), entries: () => store.entries(),
      [Symbol.iterator]: () => store[Symbol.iterator](),
      forEach(callback, thisArg) { store.forEach((value, key) => callback.call(thisArg, value, key, this)); }
    });
  }
  class Input extends EventTarget {
    constructor(meta) {
      super();
      this.id = meta.id; this.name = meta.name || 'MIDI input'; this.manufacturer = meta.manufacturer || '';
      this.version = meta.version || ''; this.type = 'input'; this.state = 'connected'; this.connection = 'closed'; this._wantsOpen = false;
      handlerProperty(this, 'onmidimessage', 'midimessage', true);
      handlerProperty(this, 'onstatechange', 'statechange');
    }
    addEventListener(type, listener, options) {
      super.addEventListener(type, listener, options);
      if (type === 'midimessage' && listener) this.open();
    }
    open() {
      if (disposed) return Promise.reject(fail('The instrument has closed.', 'AbortError'));
      this._wantsOpen = true;
      const next = this.state === 'connected' ? 'open' : 'pending';
      if (this.connection !== next) { this.connection = next; this._changed(); }
      return Promise.resolve(this);
    }
    close() {
      this._wantsOpen = false;
      if (this.connection !== 'closed') { this.connection = 'closed'; this._changed(); }
      return Promise.resolve(this);
    }
    _changed() {
      this.dispatchEvent(eventWith('statechange', { port: this }));
      access.dispatchEvent(eventWith('statechange', { port: this }));
    }
    _message(data) {
      if (this.state !== 'connected' || this.connection !== 'open') return;
      const time = performance.now();
      this.dispatchEvent(eventWith('midimessage', { data: new Uint8Array(data), receivedTime: time, timeStamp: time }));
    }
  }
  const access = new EventTarget();
  Object.defineProperties(access, {
    inputs: { value: portMap(inputStore), enumerable: true },
    outputs: { value: portMap(new Map()), enumerable: true },
    sysexEnabled: { value: false, enumerable: true }
  });
  handlerProperty(access, 'onstatechange', 'statechange');

  function setMIDIState(state) {
    if (!state || typeof state !== 'object') return;
    hardwareState = state;
    reconcileInputs();
  }
  function reconcileInputs() {
    const state = hardwareState;
    const desired = new Map();
    for (const meta of (Array.isArray(state.inputs) ? state.inputs : []).slice(0, 128)) {
      if (meta && typeof meta.id === 'string' && !meta.id.startsWith('wire:') && meta.state !== 'disconnected') desired.set(meta.id, meta);
    }
    for (const wire of wires.values()) desired.set(wire.meta.id, wire.meta);
    const changed = [];
    for (const [id, port] of inputStore) {
      if (desired.has(id)) continue;
      inputStore.delete(id); port.state = 'disconnected'; port.connection = port._wantsOpen ? 'pending' : 'closed'; changed.push(port);
    }
    for (const [id, meta] of desired) {
      const existing = inputStore.get(id);
      if (existing) { existing.name = String(meta.name || 'MIDI input'); existing.manufacturer = String(meta.manufacturer || ''); continue; }
      const port = inputCache.get(id) || new Input(meta);
      port.state = 'connected'; port.connection = port._wantsOpen ? 'open' : 'closed';
      port.name = String(meta.name || 'MIDI input'); port.manufacturer = String(meta.manufacturer || '');
      inputCache.set(id, port); inputStore.set(id, port); changed.push(port);
    }
    for (const port of changed) port._changed();
    const wasGranted = granted;
    granted = state.access === true || wires.size > 0;
    if (granted) {
      for (const request of pendingMIDI.values()) request.resolve(access);
      pendingMIDI.clear();
      if (!wasGranted || changed.length) window.dispatchEvent(new CustomEvent('midiroom:connected', { detail: { inputCount: inputStore.size, selection: String(state.selection || 'auto') } }));
    }
  }

  function requestMIDIAccess(requestOptions = {}) {
    if (disposed) return Promise.reject(fail('The instrument has closed.', 'AbortError'));
    if (requestOptions?.sysex) return Promise.reject(fail('System-exclusive MIDI is not supported by this player.'));
    if (granted) return Promise.resolve(access);
    if (!options.supported) return Promise.reject(fail('No hardware MIDI is exposed here. Connect a local instrument cable or use touch.'));
    if (pendingMIDI.size >= 32) return Promise.reject(fail('A MIDI permission request is already waiting. Tap MIDI in the player.', 'QuotaExceededError'));
    const requestId = 'midi-' + (++serial);
    return new Promise((resolve, reject) => {
      pendingMIDI.set(requestId, { resolve, reject });
      send({ type: 'request-midi', requestId });
    });
  }
  try { Object.defineProperty(navigator, 'requestMIDIAccess', { configurable: true, writable: true, value: requestMIDIAccess }); }
  catch { notice('This browser could not connect the instrument to the MIDI player.'); }

  function validMessage(data) {
    if (!data || typeof data.length !== 'number' || data.length < 2 || data.length > 3) return false;
    const status = data[0];
    if (!Number.isInteger(status) || status < 0x80 || status > 0xef || data.length !== ((status & 0xe0) === 0xc0 ? 2 : 3)) return false;
    for (let i = 1; i < data.length; i++) if (!Number.isInteger(data[i]) || data[i] < 0 || data[i] > 127) return false;
    return true;
  }
  function setRoutesState(state) {
    const desired = new Map();
    for (const meta of (Array.isArray(state?.inputs) ? state.inputs : []).slice(0, 32)) {
      if (!meta || typeof meta.id !== 'string' || !meta.id.startsWith('wire:') || !goodID(meta.id.slice(5))) continue;
      desired.set(meta.id.slice(5), { id: meta.id, name: String(meta.name || 'Instrument cable').slice(0, 100), manufacturer: 'MIDI Room · local cable', state: 'connected' });
    }
    for (const [route, wire] of wires) if (!desired.has(route)) { cancelWire(route, { removed: true, reason: 'routes-state' }); }
    for (const [route, meta] of desired) {
      const wire = wires.get(route);
      if (wire) wire.meta = meta;
      else wires.set(route, { meta, generation: 0, timers: new Set(), notes: new Map(), channels: new Set() });
    }
    reconcileInputs();
  }
  function clearWireTimers(wire) {
    for (const timer of wire.timers) { clearTimeout(timer); pendingTimers--; }
    wire.timers.clear();
  }
  function rememberWireMIDI(wire, data) {
    const channel = data[0] & 15, type = data[0] & 0xf0, key = channel * 128 + data[1];
    wire.channels.add(channel);
    if (type === 0x90 && data[2] > 0) wire.notes.set(key, Math.min(8, (wire.notes.get(key) || 0) + 1));
    else if (type === 0x80 || type === 0x90 && data[2] === 0) {
      const count = wire.notes.get(key) || 0;
      if (count > 1) wire.notes.set(key, count - 1); else wire.notes.delete(key);
    } else if (type === 0xb0 && (data[1] === 120 || data[1] === 123)) {
      for (const key of wire.notes.keys()) if (Math.floor(key / 128) === channel) wire.notes.delete(key);
    }
  }
  function cancelWire(route, event = {}) {
    const wire = wires.get(route);
    if (!wire) { if (event.kind === 'cancel') dispatchInstrument(event); return; }
    clearWireTimers(wire);
    const port = inputStore.get(wire.meta.id);
    for (const channel of wire.channels) port?._message([0xb0 | channel, 64, 0]);
    for (const [key, count] of wire.notes) for (let i = 0; i < count; i++) port?._message([0x80 | Math.floor(key / 128), key % 128, 0]);
    for (const channel of wire.channels) {
      for (const cc of [120, 123, 121]) port?._message([0xb0 | channel, cc, 0]);
      port?._message([0xe0 | channel, 0, 64]);
    }
    wire.notes.clear(); wire.channels.clear();
    wire.generation = Number.isInteger(event.generation) ? Math.max(wire.generation, event.generation) : wire.generation;
    dispatchInstrument({ ...event, type: 'instrument-event', kind: 'cancel', route, at: now() });
    if (event.removed === true) { wires.delete(route); reconcileInputs(); }
  }
  function instrumentEvent(event) {
    if (!event || event.version !== 1 || !goodID(event.route) || !Number.isInteger(event.generation) || event.generation < 0) return;
    if (event.kind === 'cancel') { cancelWire(event.route, event); return; }
    if (!protocolKinds.includes(event.kind) || !Number.isFinite(event.at) || event.at > now() + 16000) return;
    // A replaced legacy bus receives a single source-checked window envelope
    // from the host. Never also invoke the default SDK signal path.
    if (event.kind === 'signal' && legacyVibeBus) return;
    // SDK consumers schedule directly against `at`; the host already validates
    // payloads. Legacy MIDI is delivered by its own bounded route timer queue.
    if (event.kind !== 'midi') { dispatchInstrument(event); return; }
    if (!validMessage(event.data)) return;
    const wire = wires.get(event.route);
    if (!wire || event.generation < wire.generation) return;
    if (event.generation > wire.generation) cancelWire(event.route, { generation: event.generation, reason: 'generation-change' });
    if (subscribers.get('midi')?.size) { dispatchInstrument(event); return; }
    const deliver = () => {
      if (disposed || wires.get(event.route) !== wire || wire.generation !== event.generation) return;
      const port = inputStore.get(wire.meta.id);
      if (!port || port.connection !== 'open') return;
      rememberWireMIDI(wire, event.data); port._message(event.data);
    };
    const delay = event.at - now();
    if (delay <= 1) { deliver(); return; }
    if (pendingTimers >= 1024) { cancelWire(event.route, { reason: 'timer-limit' }); notice('Cable queue cleared: too many scheduled events.'); return; }
    let timer = setTimeout(() => { if (wire.timers.delete(timer)) pendingTimers--; deliver(); }, delay);
    wire.timers.add(timer); pendingTimers++;
  }
  function audioState() {
    const active = [...contexts].filter(context => context.state !== 'closed');
    const state = active.some(context => context.state === 'running') ? 'running' : active.length ? 'suspended' : contexts.size ? 'closed' : 'off';
    send({ type: 'audio-state', state, contexts: active.length });
  }
  function watchContext(context) {
    if (!context || contexts.has(context)) return context;
    if (disposed) { try { Promise.resolve(context.close()).catch(() => {}); } catch {} return context; }
    contexts.add(context);
    const changed = () => { audioState(); if (context.state === 'closed') { contexts.delete(context); context.removeEventListener?.('statechange', changed); } };
    context.addEventListener?.('statechange', changed);
    cleanups.push(() => context.removeEventListener?.('statechange', changed));
    audioState(); return context;
  }
  const wrappers = new Map();
  for (const key of ['AudioContext', 'webkitAudioContext']) {
    const NativeContext = window[key];
    if (typeof NativeContext !== 'function') continue;
    let Wrapped = wrappers.get(NativeContext);
    if (!Wrapped) {
      Wrapped = new Proxy(NativeContext, {
        construct(target, args, newTarget) { return watchContext(Reflect.construct(target, args, newTarget === Wrapped ? target : newTarget)); }
      });
      wrappers.set(NativeContext, Wrapped);
    }
    try { Object.defineProperty(window, key, { configurable: true, writable: true, value: Wrapped }); } catch { notice('The browser could not expose its audio state to the player.'); }
  }
  function releaseInputs(hardwareOnly = false) {
    for (const port of inputStore.values()) {
      if (hardwareOnly && port.id.startsWith('wire:')) continue;
      for (let ch = 0; ch < 16; ch++) {
      for (const cc of [64, 120, 123, 121]) port._message([0xb0 | ch, cc, 0]);
      port._message([0xe0 | ch, 0, 64]);
      }
    }
  }
  function panic(suspend = true) {
    for (const route of wires.keys()) cancelWire(route, { reason: 'room-stopped' });
    releaseInputs();
    window.dispatchEvent(new CustomEvent('midiroom:panic', { detail: { suspend } }));
    for (const context of suspend ? contexts : []) {
      if (context.state === 'closed') continue;
      try { Promise.resolve(context.suspend()).then(audioState, () => {}); } catch { /* Already closing. */ }
    }
    audioState();
  }
  function resumeContexts() {
    if (document.hidden || disposed) return;
    for (const context of contexts) if (context.state === 'suspended' || context.state === 'interrupted') {
      try { Promise.resolve(context.resume()).then(audioState, () => {}); } catch { /* A closed context cannot resume. */ }
    }
  }
  function resumeFromGesture(event) {
    if (!event.isTrusted || document.hidden || disposed) return;
    detectVibeBus(); send({ type: 'gesture' }); resumeContexts();
  }
  listen(document, 'pointerdown', resumeFromGesture, true);
  listen(document, 'pointerup', resumeFromGesture, true);
  listen(document, 'touchend', resumeFromGesture, true);
  listen(document, 'keydown', resumeFromGesture, true);
  listen(document, 'visibilitychange', () => { if (document.hidden) panic(); });

  function fileName(value) {
    const name = String(value || 'instrument-export').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 160);
    return name && name !== '.' && name !== '..' ? name : 'instrument-export';
  }
  function saveBlob(blob, name) {
    if (disposed) return Promise.reject(fail('The instrument has closed.', 'AbortError'));
    if (!(blob instanceof Blob) || blob.size > MAX_SAVE_BYTES) return Promise.reject(fail('The export must be a file smaller than 256 MB.', 'DataError'));
    const queuedBytes = [...pendingSaves.values()].reduce((sum, entry) => sum + entry.message.blob.size, 0);
    if (pendingSaves.size >= 4 || queuedBytes + blob.size > MAX_SAVE_BYTES) return Promise.reject(fail('Save or dismiss the waiting files before exporting again.', 'QuotaExceededError'));
    const id = 'save-' + (++serial), message = { type: 'save', id, blob, name: fileName(name), mime: String(blob.type || 'application/octet-stream') };
    return new Promise((resolve, reject) => { pendingSaves.set(id, { resolve, reject, message }); send(message); });
  }
  const nativeCreateURL = URL.createObjectURL?.bind(URL), nativeRevokeURL = URL.revokeObjectURL?.bind(URL);
  if (nativeCreateURL) URL.createObjectURL = function (object) {
    const url = nativeCreateURL(object); if (object instanceof Blob) blobs.set(url, object); return url;
  };
  if (nativeRevokeURL) URL.revokeObjectURL = function (url) { blobs.delete(String(url)); return nativeRevokeURL(url); };

  function dataBlob(url) {
    if (url.length > MAX_SAVE_BYTES * 1.4) throw fail('The export is too large.', 'DataError');
    const comma = url.indexOf(','); if (comma < 0) throw fail('This export could not be read.', 'DataError');
    const header = url.slice(5, comma), payload = url.slice(comma + 1), mime = header.split(';')[0] || 'text/plain';
    if (/;base64(?:;|$)/i.test(header)) {
      const binary = atob(payload), bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    // Percent escapes in a data URL denote bytes, including values outside UTF-8.
    const parts = [];
    for (let start = 0; start < payload.length;) {
      const at = payload.indexOf('%', start);
      if (at < 0) { parts.push(payload.slice(start)); break; }
      if (at > start) parts.push(payload.slice(start, at));
      const bytes = []; let cursor = at;
      while (payload[cursor] === '%' && /^[\da-f]{2}$/i.test(payload.slice(cursor + 1, cursor + 3))) { bytes.push(parseInt(payload.slice(cursor + 1, cursor + 3), 16)); cursor += 3; }
      if (cursor === at) throw fail('This export contains an invalid data URL.', 'DataError');
      parts.push(new Uint8Array(bytes)); start = cursor;
    }
    return new Blob(parts, { type: mime });
  }
  function interceptDownload(anchor) {
    if (!anchor?.hasAttribute?.('download')) return false;
    const href = String(anchor.href || '');
    let blob;
    try {
      if (href.startsWith('blob:')) blob = blobs.get(href);
      else if (href.startsWith('data:')) blob = dataBlob(href);
      if (!blob) throw fail('This player can save generated files only.');
      saveBlob(blob, anchor.download).catch(error => { if (error.name !== 'AbortError') notice(error.message); });
    } catch (error) { notice(error.message || 'This export could not be saved.'); }
    return true;
  }
  if (typeof HTMLAnchorElement !== 'undefined') {
    const nativeClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { if (!interceptDownload(this)) return nativeClick.call(this); };
    listen(document, 'click', event => {
      const anchor = event.target?.closest?.('a[download]');
      if (anchor && interceptDownload(anchor)) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
  }
  function shareFiles(data) {
    const files = data && Array.isArray(data.files) ? data.files : [];
    if (!files.length || files.length > 4 || !files.every(file => file instanceof Blob) || files.reduce((sum, file) => sum + file.size, 0) > MAX_SAVE_BYTES) return null;
    return files;
  }
  try {
    Object.defineProperty(navigator, 'canShare', { configurable: true, writable: true, value: data => Boolean(shareFiles(data)) });
    Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: data => {
      const files = shareFiles(data);
      if (!files) return Promise.reject(fail('This player supports sharing generated files.'));
      const queuedBytes = [...pendingSaves.values()].reduce((sum, entry) => sum + entry.message.blob.size, 0);
      if (pendingSaves.size + files.length > 4 || queuedBytes + files.reduce((sum, file) => sum + file.size, 0) > MAX_SAVE_BYTES) return Promise.reject(fail('Save or dismiss the waiting files before exporting again.', 'QuotaExceededError'));
      return Promise.all(files.map(file => saveBlob(file, file.name || 'instrument-export'))).then(() => undefined);
    } });
  } catch { /* Blob downloads still use the export bridge. */ }

  function dispose() {
    if (disposed) return;
    panic(); window.dispatchEvent(new CustomEvent('midiroom:dispose')); disposed = true; clearInterval(bridgeTimer);
    for (const request of pendingMIDI.values()) request.reject(fail('The instrument has closed.', 'AbortError'));
    for (const request of pendingSaves.values()) request.reject(fail('The instrument has closed.', 'AbortError'));
    pendingMIDI.clear(); pendingSaves.clear();
    for (const cleanup of cleanups.splice(0)) cleanup();
    for (const context of contexts) { try { Promise.resolve(context.close()).catch(() => {}); } catch { /* Already closed. */ } }
    contexts.clear(); inputStore.clear(); inputCache.clear(); wires.clear(); subscribers.clear();
    for (const url of blobs.keys()) { try { nativeRevokeURL?.(url); } catch { /* Stale URL. */ } }
    blobs.clear(); channel?.close(); channel = null;
  }
  listen(window, 'pagehide', dispose);
  listen(window, 'error', event => notice(event.message ? 'Instrument error: ' + event.message : 'An instrument resource could not load.'), true);
  listen(window, 'unhandledrejection', event => {
    if (event.reason?.name !== 'AbortError') notice('Instrument error: ' + String(event.reason?.message || event.reason || 'An action could not finish.'));
  });

  function receive(event) {
    const message = event.data;
    if (disposed || !message || typeof message !== 'object') return;
    if (message.type === 'midi-state') setMIDIState(message.state);
    else if (message.type === 'routes-state') setRoutesState(message);
    else if (message.type === 'instrument-event') instrumentEvent(message);
    else if (message.type === 'surface-control' && message.version === 1) {
      for (const callback of controlListeners) { try { callback(message); } catch(error) { notice('Surface: '+String(error?.message || error)); } }
    }
    else if (message.type === 'midi' && typeof message.inputId === 'string' && validMessage(message.data)) inputStore.get(message.inputId)?._message(message.data);
    else if (message.type === 'midi-result') {
      if (message.ok === true) { setMIDIState(message.state || { access: true, inputs: [] }); }
      else {
        const pending = pendingMIDI.get(message.requestId);
        if (pending) { pendingMIDI.delete(message.requestId); pending.reject(fail(String(message.error?.message || 'MIDI could not connect.'), String(message.error?.name || 'NotAllowedError'))); }
      }
    } else if (message.type === 'save-result') {
      const pending = pendingSaves.get(message.id);
      if (pending) {
        pendingSaves.delete(message.id);
        if (message.ok === true) pending.resolve();
        else pending.reject(fail(String(message.error?.message || 'Saving was canceled.'), String(message.error?.name || 'AbortError')));
      }
    } else if (message.type === 'panic') panic(message.suspend !== false);
    else if (message.type === 'hardware-panic') releaseInputs(true);
    else if (message.type === 'resume') resumeContexts();
    else if (message.type === 'dispose') dispose();
  }
  function boot(event) {
    if (disposed || channel || event.source !== parent || event.data?.type !== 'midiroom:boot' || event.data.nonce !== nonce || !event.ports?.[0]) return;
    const port = event.ports[0]; if (typeof port.postMessage !== 'function' || typeof port.close !== 'function') return;
    channel = port; clearInterval(bridgeTimer); window.removeEventListener('message', boot);
    channel.onmessage = receive; channel.start?.();
    detectVibeBus(false); send(readyDeclaration());
    if (surfaceProfile) send({type:'surface-describe',profile:surfaceProfile});
    audioState();
    for (const requestId of pendingMIDI.keys()) send({ type: 'request-midi', requestId });
    for (const pending of pendingSaves.values()) send(pending.message);
    for (const message of queuedNotices.splice(0)) send(message);
  }
  listen(window, 'message', boot);
  let attempts = 0;
  function hello() {
    if (disposed || channel || attempts++ > 10) { clearInterval(bridgeTimer); return; }
    parent.postMessage({ type: 'midiroom:ready', nonce }, '*');
  }
  hello(); bridgeTimer = setInterval(hello, 500);
}

/** Safe to place in a script element; no configurable value can terminate the tag. */
export function bootstrapSource(options) {
  const config = JSON.stringify({ nonce: String(options.nonce), supported: Boolean(options.supported) })
    .replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return '(' + childBootstrap.toString() + ')(' + config + ');';
}
