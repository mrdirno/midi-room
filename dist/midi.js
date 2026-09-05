/** One native MIDI connection, owned by the player rather than imported documents. */
export function validChannelMessage(value) {
  if (!value || typeof value.length !== 'number' || value.length < 2 || value.length > 3) return false;
  const status = value[0];
  if (!Number.isInteger(status) || status < 0x80 || status > 0xef) return false;
  const length = (status & 0xe0) === 0xc0 ? 2 : 3;
  if (value.length !== length) return false;
  for (let i = 1; i < length; i++) if (!Number.isInteger(value[i]) || value[i] < 0 || value[i] > 127) return false;
  return true;
}

function listen(target, type, listener) {
  if (typeof target.addEventListener === 'function') {
    target.addEventListener(type, listener);
    return () => target.removeEventListener(type, listener);
  }
  const key = 'on' + type, previous = target[key];
  const wrapped = function (event) {
    if (typeof previous === 'function') previous.call(this, event);
    listener(event);
  };
  target[key] = wrapped;
  return () => { if (target[key] === wrapped) target[key] = previous || null; };
}

function metadata(port) {
  return {
    id: String(port.id), name: String(port.name || 'MIDI input'),
    manufacturer: String(port.manufacturer || ''), version: String(port.version || ''),
    state: port.state === 'disconnected' ? 'disconnected' : 'connected',
    connection: String(port.connection || 'closed'), type: 'input'
  };
}

function exception(message, name) {
  return typeof DOMException === 'function' ? new DOMException(message, name) : Object.assign(new Error(message), { name });
}

export class MidiBroker {
  constructor({ requestAccess, queryPermission, supported = true, retryDelays = [300, 1000, 2500], onState = () => {}, onMIDI = () => {}, onPanic = () => {} } = {}) {
    this._requestAccess = requestAccess || (() => navigator.requestMIDIAccess({ sysex: false }));
    this._supported = Boolean(supported);
    this._queryPermission = queryPermission || (() => globalThis.navigator?.permissions?.query({ name: 'midi', sysex: false }));
    this._permission = 'unknown'; this._discovering = null; this._requestEpoch = 0;
    this._retryDelays = retryDelays.filter(delay => Number.isFinite(delay) && delay >= 0).slice(0, 5);
    this._onState = onState; this._onMIDI = onMIDI; this._onPanic = onPanic;
    this._access = null; this._pending = null; this._unlisten = null;
    this._bindings = new Map(); this._selection = 'auto'; this._lastInputId = null;
    this._activityTimer = null;
    this._status = this._supported ? 'idle' : 'unavailable'; this._error = null;
    this._disposed = false; this._refreshing = false; this._refreshAgain = false;
  }

  getState() {
    const devices = this._ports().map(metadata);
    const bindings = [...this._bindings.values()];
    const last = this._bindings.get(this._lastInputId);
    return {
      status: this._status, access: Boolean(this._access), selection: this._selection,
      permission: this._permission,
      devices, inputs: bindings.filter(binding => binding.ready).map(binding => metadata(binding.port)),
      pendingInputs: bindings.filter(binding => binding.opening || binding.retryTimer !== null).map(binding => metadata(binding.port)),
      inputErrors: bindings.filter(binding => binding.failed).map(binding => ({ ...metadata(binding.port), message: binding.error })),
      lastInput: last?.ready ? { ...metadata(last.port), messages: last.messages, notes: last.notes, lastTimestamp: last.lastTimestamp } : null,
      activity: bindings.filter(binding => binding.ready && binding.messages).map(binding => ({ ...metadata(binding.port), messages: binding.messages, notes: binding.notes, lastTimestamp: binding.lastTimestamp })),
      error: this._error
    };
  }

  /** Silent discovery: permission must already be granted. Otherwise Play/Connect owns the prompt. */
  discover() {
    if (this._disposed || !this._supported) return Promise.resolve(this.getState());
    if (this._access || this._pending) return this.connect();
    if (this._discovering) return this._discovering;
    const epoch = this._requestEpoch;
    this._discovering = Promise.resolve().then(() => this._queryPermission()).then(permission => {
      if (this._disposed) return this.getState();
      // A slow permission query must never resurrect an older grant after a newer request was denied.
      if (epoch !== this._requestEpoch) return this._pending || this.getState();
      this._permission = ['granted', 'prompt', 'denied'].includes(permission?.state) ? permission.state : 'unknown';
      if (this._permission === 'granted') return this.connect();
      this._emitState(); return this.getState();
    }, () => {
      if (!this._disposed) { this._permission = 'unknown'; this._emitState(); }
      return this.getState();
    }).finally(() => { this._discovering = null; });
    return this._discovering;
  }

  connect() {
    if (this._disposed) return Promise.reject(exception('This MIDI connection has closed.', 'AbortError'));
    if (!this._supported) return Promise.reject(exception('This browser does not expose hardware MIDI.', 'NotSupportedError'));
    if (this._access) {
      this._error = null;
      for (const [id, binding] of this._bindings) if (binding.failed && !binding.opening) {
        clearTimeout(binding.retryTimer); binding.retryTimer = null; binding.retries = 0;
        this._open(binding, id);
      }
      this._refresh(); return Promise.resolve(this.getState());
    }
    if (this._pending) return this._pending;
    this._requestEpoch++;
    this._status = 'requesting'; this._error = null; this._emitState();
    // Call synchronously, keeping the browser's user activation for its permission prompt.
    let request;
    try { request = this._requestAccess({ sysex: false }); }
    catch (error) { request = Promise.reject(error); }
    this._pending = Promise.resolve(request).then(access => {
      if (this._disposed) throw exception('This MIDI connection has closed.', 'AbortError');
      if (!access || !access.inputs || typeof access.inputs.values !== 'function') throw new TypeError('The browser did not provide MIDI inputs.');
      this._access = access; this._status = 'ready'; this._error = null; this._permission = 'granted';
      this._unlisten = listen(access, 'statechange', () => this._refresh());
      this._refresh();
      return this.getState();
    }).catch(error => {
      if (!this._disposed) {
        this._status = ['SecurityError', 'NotAllowedError'].includes(error?.name) ? 'denied' : 'error';
        if (this._status === 'denied') this._permission = 'denied';
        this._error = String(error?.message || 'MIDI could not connect.');
        this._emitState();
      }
      throw error;
    }).finally(() => { this._pending = null; });
    return this._pending;
  }

  setSelection(selection) {
    if (this._disposed) return;
    const next = String(selection || 'auto');
    if (next === this._selection) return;
    this._selection = next;
    this._refresh();
  }

  panic() { if (!this._disposed) this._call(this._onPanic); }

  dispose() {
    if (this._disposed) return;
    this.panic(); this._disposed = true;
    clearTimeout(this._activityTimer); this._activityTimer = null;
    this._unlisten?.(); this._unlisten = null;
    for (const binding of this._bindings.values()) this._detach(binding);
    this._bindings.clear(); this._access = null;
  }

  _ports() {
    if (!this._access) return [];
    try { return [...this._access.inputs.values()].filter(p => p && p.id != null && p.state !== 'disconnected'); }
    catch { return []; }
  }

  _refresh() {
    if (this._disposed) return;
    if (this._refreshing) { this._refreshAgain = true; return; }
    this._refreshing = true;
    try {
      const ports = this._ports();
      let selected;
      // Auto means every connected controller is playable; enumeration order is never a routing decision.
      if (this._selection === 'all' || this._selection === 'auto') selected = ports;
      else selected = ports.filter(p => String(p.id) === this._selection);
      const desired = new Map(selected.map(p => [String(p.id), p]));
      const removed = [...this._bindings].filter(([id, binding]) => desired.get(id) !== binding.port);
      // Release the old sources while the child's old input map still exists.
      if (removed.length) this.panic();
      for (const [id, binding] of removed) {
        this._bindings.delete(id); this._detach(binding);
        if (this._lastInputId === id) this._lastInputId = null;
      }
      for (const [id, port] of desired) {
        if (this._bindings.has(id)) continue;
        const binding = { port, remove: null, ready: false, failed: false, opening: false, error: null, retries: 0, retryTimer: null, messages: 0, notes: 0, lastTimestamp: null };
        this._bindings.set(id, binding);
        this._open(binding, id);
      }
      this._updatePortError();
      this._emitState();
    } finally {
      this._refreshing = false;
      if (this._refreshAgain) { this._refreshAgain = false; queueMicrotask(() => this._refresh()); }
    }
  }

  _detach(binding) {
    clearTimeout(binding.retryTimer); binding.retryTimer = null;
    binding.remove?.(); binding.remove = null; binding.ready = false;
    try { Promise.resolve(binding.port.close?.()).catch(() => {}); } catch { /* Device may have gone away. */ }
  }

  _open(binding, id) {
    if (this._disposed || binding.opening || this._bindings.get(id) !== binding) return;
    binding.opening = true; binding.failed = false; binding.error = null;
    if (!binding.remove) binding.remove = listen(binding.port, 'midimessage', event => {
      if (this._disposed || !binding.ready || this._bindings.get(id) !== binding || !validChannelMessage(event?.data)) return;
      const timestamp = Number.isFinite(event.receivedTime) ? event.receivedTime : performance.now();
      const sourceChanged = this._lastInputId !== id;
      binding.messages++;
      if ((event.data[0] & 0xf0) === 0x90 && event.data[2] > 0) binding.notes++;
      binding.lastTimestamp = timestamp; this._lastInputId = id;
      this._call(this._onMIDI, { inputId: id, inputName: String(binding.port.name || 'MIDI input'), data: Array.from(event.data), timestamp });
      // Compact UI only needs a source-name change; note/CC streams must not rebuild controls.
      if (sourceChanged && this._activityTimer === null) {
        this._activityTimer = setTimeout(() => { this._activityTimer = null; if (!this._disposed) this._emitState(); }, 100);
        this._activityTimer?.unref?.();
      }
    });
    const failed = error => {
      if (this._disposed || this._bindings.get(id) !== binding) return;
      binding.opening = false; binding.failed = true; binding.ready = false; binding.remove?.(); binding.remove = null;
      binding.error = String(error?.message || 'This MIDI input could not open.');
      if (binding.retries < this._retryDelays.length && binding.port.state !== 'disconnected') {
        const delay = this._retryDelays[binding.retries++];
        binding.retryTimer = setTimeout(() => {
          binding.retryTimer = null;
          if (this._disposed || this._bindings.get(id) !== binding) return;
          if (binding.port.state === 'disconnected') { this._refresh(); return; }
          this._open(binding, id);
        }, delay);
        binding.retryTimer?.unref?.();
      }
      this._updatePortError(); this._emitState();
    };
    try {
      Promise.resolve(binding.port.open?.()).then(() => {
        binding.opening = false;
        if (this._disposed || this._bindings.get(id) !== binding) {
          // A late open must not revive a removed source, or close a replacement using that same native port.
          if (![...this._bindings.values()].some(current => current.port === binding.port)) {
            try { Promise.resolve(binding.port.close?.()).catch(() => {}); } catch { /* Gone. */ }
          }
          return;
        }
        if (binding.port.state === 'disconnected') { this._refresh(); return; }
        binding.ready = true;
        this._updatePortError();
        this._emitState();
      }, failed);
    } catch (error) { failed(error); }
  }

  _updatePortError() {
    if (this._access) this._error = [...this._bindings.values()].find(binding => binding.failed)?.error || null;
  }

  _emitState() { this._call(this._onState, this.getState()); }
  _call(callback, value) { try { callback(value); } catch (error) { globalThis.console?.error('MIDI Room callback failed.', error); } }
}
