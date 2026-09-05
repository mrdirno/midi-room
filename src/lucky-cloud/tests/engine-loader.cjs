// Independent test harness: execute the exact shipped synthesis scripts.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
function script(html, id) {
  const match = html.match(new RegExp('<script[^>]*\\bid=["\\\']' + id + '["\\\'][^>]*>([\\s\\S]*?)<\\/script>'));
  if (!match) throw Error('Missing real shipped script: ' + id);
  return match[1];
}
function load() {
  const html = fs.readFileSync(path.join(root, 'dist/instruments/lucky-dreamer.html'), 'utf8');
  const sources = Object.fromEntries(['engine-src', 'sound-bank-src'].map(id => [id, script(html, id)]));
  const context = {console, performance, Math, Float32Array, Float64Array, Uint8Array, Uint16Array, Uint32Array, Int16Array, ArrayBuffer, DataView};
  vm.createContext(context);
  for (const [id, code] of Object.entries(sources)) vm.runInContext(code, context, {timeout: 15000, filename: id + '.js'});
  if (typeof context.LuckyCloudSoundBank?.build !== 'function') throw Error('Real sound bank is missing');
  return {x: context, html, sourceHashes: Object.fromEntries(Object.entries(sources).map(([id, s]) => [id, sha(s)]))};
}
module.exports = {load, root, sha, script};
