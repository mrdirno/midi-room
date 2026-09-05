import { bootstrapSource } from './bridge.js';

export const MAX_INSTRUMENT_BYTES = 32 * 1024 * 1024;
export const INSTRUMENT_SANDBOX = 'allow-scripts allow-downloads allow-modals';
export const INSTRUMENT_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval' blob: data:",
  "style-src 'unsafe-inline' blob: data:",
  'img-src blob: data:',
  'font-src blob: data:',
  'media-src blob: data:',
  'connect-src blob: data:',
  'worker-src blob: data:',
  "frame-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

export function safeFilename(name, fallback = 'instrument.html') {
  let value = String(name || '').split(/[\\/]/).pop()
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_').trim();
  if (!value || value === '.' || value === '..') return fallback;
  if (value.length > 140) {
    const extension = value.match(/\.[a-z0-9]{1,8}$/i)?.[0] || '';
    value = value.slice(0, 140 - extension.length) + extension;
  }
  return value;
}

export function validateInstrument(file) {
  if (!file || typeof file.name !== 'string' || typeof file.text !== 'function')
    throw new Error('Choose an HTML instrument.');
  if (!/\.html?$/i.test(file.name))
    throw new Error('Choose an .html instrument file.');
  if (!Number.isFinite(file.size) || file.size < 1)
    throw new Error('This file is empty. Choose another instrument.');
  if (file.size > MAX_INSTRUMENT_BYTES)
    throw new Error('Choose an instrument smaller than 32 MB.');
}

export function validateSource(source) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('This instrument is empty.');
  if (new Blob([source]).size > MAX_INSTRUMENT_BYTES) throw new Error('Choose an instrument smaller than 32 MB.');
  if (!/<(?:!doctype\s+html|html|head|body|script|main|div|section|canvas)\b/i.test(source))
    throw new Error('This file does not contain an HTML instrument.');
}

export function prepareInstrument(source, { nonce, supported, parser = new DOMParser() }) {
  validateSource(source);
  const doc = parser.parseFromString(source, 'text/html');
  // The player's policy must precede every instrument resource and script.
  for (const node of doc.querySelectorAll('base, meta[http-equiv]')) node.remove();
  const policy = doc.createElement('meta');
  policy.httpEquiv = 'Content-Security-Policy';
  policy.content = INSTRUMENT_POLICY;
  const bootstrap = doc.createElement('script');
  bootstrap.textContent = bootstrapSource({ nonce, supported });
  doc.head.prepend(policy, bootstrap);
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}

/** A later selection cancels a pending read without cancelling the active instrument. */
export class LoadSequence {
  #generation = 0;
  next() { const id = ++this.#generation; return () => id === this.#generation; }
  cancel() { this.#generation++; }
}
