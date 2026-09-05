// Author: Aldrin Payopay. Test-only original source loader; no browser dependencies.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
module.exports = function load(extra = true) {
  const root = path.resolve(__dirname, '../../..');
  const engine = fs.readFileSync(path.join(root, 'src/lucky/engine.original.js'), 'utf8');
  if (crypto.createHash('sha256').update(engine).digest('hex') !== '7a2e62e9a15777bd5b096ea85a1c9731795288990dfe06095da8e447c8936ef4') throw Error('Runtime original changed');
  const originalPath=path.join(root, 'reference/lucky-dreamer/luckydreamer_aug_27_2.html');
  if(fs.existsSync(originalPath)){
    const source=fs.readFileSync(originalPath,'utf8');
    if(crypto.createHash('sha256').update(source).digest('hex')!=='ebde63754bc6d8db762b11a5d89abb604ac242af6ca06149ccd109f9f1b054ac')throw Error('Original changed');
    if(source.match(/<script id="engine-src">([\s\S]*?)<\/script>/)[1]!==engine)throw Error('Runtime extraction mismatch');
  }
  const context = {console, performance, Math, Float32Array, Float64Array, Uint8Array, Uint16Array, Uint32Array, Int16Array, ArrayBuffer, DataView};
  vm.createContext(context);
  vm.runInContext(engine, context, {timeout: 15000});
  if (extra) for(const file of ['composition.js','audio-runtime.js']) vm.runInContext(fs.readFileSync(path.join(root, 'src/lucky', file), 'utf8'), context, {timeout: 15000});
  return context;
};
