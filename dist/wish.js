import { WISH_CONFIG } from './wish-config.js';

const DRAFT_KEY = 'midi-room.wish-draft.v1';
const TIMEOUT_MS = 12000;
const MAX_LENGTH = 2000;
const bound = new WeakMap();

// The wishing well is a deliberate Send action, independent of music and logs.
// A locally saved draft is never "sent"; no reconnect or background job replays it.
export function bindWishWell(document, options = {}) {
  const form = document.getElementById('wishForm');
  const box = document.getElementById('wishText');
  const send = document.getElementById('wishSubmit');
  const copyButton = document.getElementById('wishCopy');
  const status = document.getElementById('wishStatus');
  if (!form || !box || !send || !copyButton || !status) return null;
  if (bound.has(form)) return bound.get(form);

  const nav = options.navigator || globalThis.navigator || {};
  const fetcher = options.fetch || globalThis.fetch;
  const setTimer = options.setTimeout || globalThis.setTimeout;
  const clearTimer = options.clearTimeout || globalThis.clearTimeout;
  const Abort = options.AbortController || globalThis.AbortController;
  let storage = null;
  try {
    storage = Object.prototype.hasOwnProperty.call(options, 'storage')
      ? options.storage : globalThis.localStorage;
  } catch (_) { /* Blocked storage must not block wishing or copying. */ }
  let pending = null;
  let revision = 0;
  let disposed = false;
  let copying = false;
  const timers = new Set();
  const say = text => { if (!disposed) status.textContent = text; };
  const cap = value => Array.from(String(value || '')).slice(0, MAX_LENGTH).join('');

  function saveDraft() {
    try {
      const value = cap(box.value);
      if (value) storage?.setItem(DRAFT_KEY, value);
      else storage?.removeItem(DRAFT_KEY);
    } catch (_) { /* The visible text remains the fallback. */ }
  }
  try {
    const draft = storage?.getItem(DRAFT_KEY);
    if (!box.value && typeof draft === 'string' && draft) {
      box.value = cap(draft);
      say('Draft restored');
    }
  } catch (_) { /* The app also works with storage disabled. */ }

  function onInput() { revision++; saveDraft(); }
  function selectText() {
    try { box.focus({ preventScroll: true }); } catch (_) { try { box.focus(); } catch (_) {} }
    try { box.select(); box.setSelectionRange(0, box.value.length); } catch (_) {}
  }
  function legacyCopy() {
    selectText();
    try { return typeof document.execCommand === 'function' && document.execCommand('copy') === true; }
    catch (_) { return false; }
  }
  async function copy() {
    if (disposed || copying) return false;
    if (!box.value.trim()) { say('Write your wish first'); selectText(); return false; }
    copying = true;
    copyButton.disabled = true;
    let copied = false;
    try {
      if (typeof nav.clipboard?.writeText === 'function') {
        // Preserve user activation: call the clipboard before awaiting anything.
        await nav.clipboard.writeText(box.value);
        copied = true;
      }
    } catch (_) { /* Embedded browsers often reject this permission. */ }
    if (!disposed) {
      if (!copied) copied = legacyCopy();
      say(copied ? 'Copied' : 'Text selected · touch and hold to copy');
      copyButton.disabled = false;
    }
    copying = false;
    return copied;
  }
  function onCopy(event) { event.preventDefault(); void copy(); }

  async function onSubmit(event) {
    event.preventDefault();
    if (disposed || pending) return;
    const raw = box.value;
    const text = raw.trim();
    const length = Array.from(text).length;
    if (length < 2 || length > MAX_LENGTH) { say('Use 2–2000 characters'); box.focus(); return; }
    if (typeof fetcher !== 'function') { say('Send unavailable · copy your wish'); return; }
    saveDraft();
    const token = { revision, raw, abort: typeof Abort === 'function' ? new Abort() : null, timer: null };
    pending = token;
    send.disabled = true;
    say('Sending…');
    let timedOut = false;
    const deadline = new Promise((_, reject) => {
      token.timer = setTimer(() => {
        timers.delete(token.timer);
        timedOut = true;
        reject(new Error('wish-timeout'));
        try { token.abort?.abort(); } catch (_) {}
      }, TIMEOUT_MS);
      timers.add(token.timer);
    });
    try {
      // Fixed allowlist: imported files, MIDI events, identities and diagnostic
      // data never enrich this payload. A private fragment is not a page URL.
      const request = fetcher(WISH_CONFIG.endpoint, {
        method: 'POST',
        headers: {
          apikey: WISH_CONFIG.anonKey,
          Authorization: 'Bearer ' + WISH_CONFIG.anonKey,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal'
        },
        body: JSON.stringify({
          card_id: WISH_CONFIG.cardId,
          wish: text,
          kind: 'improve',
          lang: 'en',
          page_url: WISH_CONFIG.pageURL
        }),
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        ...(token.abort ? { signal: token.abort.signal } : {})
      });
      const response = await Promise.race([Promise.resolve(request), deadline]);
      if (!response || !response.ok) throw new Error('wish-rejected');
      if (disposed || pending !== token) return;
      // Clearing by value alone loses a new wish typed during the request then
      // edited back to its old value. A revision counter preserves that work.
      const unchanged = revision === token.revision && box.value === token.raw;
      if (unchanged) box.value = '';
      saveDraft();
      say(unchanged ? 'Sent' : 'Sent · new draft kept');
    } catch (_) {
      if (!disposed && pending === token) {
        saveDraft();
        // A timeout may occur after the server inserted the row. We cannot say
        // Failed or resend automatically without risking duplicate submissions.
        say(timedOut ? 'No confirmation · draft kept' : 'Not sent · draft kept');
      }
    } finally {
      if (token.timer !== null) { clearTimer(token.timer); timers.delete(token.timer); }
      if (pending === token) { pending = null; if (!disposed) send.disabled = false; }
    }
  }

  box.addEventListener('input', onInput);
  form.addEventListener('submit', onSubmit);
  copyButton.addEventListener('click', onCopy);
  const controller = {
    copy,
    snapshot: () => ({ pending: !!pending, hasDraft: !!box.value, status: status.textContent }),
    destroy() {
      if (disposed) return;
      disposed = true;
      box.removeEventListener('input', onInput);
      form.removeEventListener('submit', onSubmit);
      copyButton.removeEventListener('click', onCopy);
      try { pending?.abort?.abort(); } catch (_) {}
      for (const timer of timers) clearTimer(timer);
      timers.clear();
      pending = null;
      send.disabled = false;
      copyButton.disabled = false;
      bound.delete(form);
    }
  };
  bound.set(form, controller);
  return controller;
}
