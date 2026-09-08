import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const portable = fs.readFileSync(new URL('../dist/midi-room-local.html', import.meta.url), 'utf8');
test('portable raw-text script boundaries preserve the complete original instrument and valid executable code', () => {
  const scripts = [...portable.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const builtins = ['bundledTriton','bundledImprovisator','bundledDrumPad','bundledFieldKeys','bundledDSPRack'];
  if(fs.existsSync(new URL('../dist/instruments/lucky-dreamer.html',import.meta.url))) builtins.push('bundledLuckyDreamer');
  // The instruments, the note map they agree on, and the one executable block.
  assert.equal(scripts.length,builtins.length+2);
  for(const id of builtins)assert.ok(scripts.some(s=>s[1].includes(id)),id);
  const map = scripts.find(s => s[1].includes('instrumentMap'));
  assert.ok(map,'instrumentMap');
  assert.deepEqual(JSON.parse(map[2]), JSON.parse(fs.readFileSync(new URL('../dist/instrument-map.json', import.meta.url),'utf8')));
  // Found by name, not by being the first JSON block: the map used to take that place.
  const data = scripts.find(s => s[1].includes('bundledTriton'));
  assert.equal(JSON.parse(data[2]), fs.readFileSync(new URL('../dist/instruments/triton-rack.html', import.meta.url), 'utf8'));
  const field = scripts.find(s => s[1].includes('bundledFieldKeys'));
  assert.equal(JSON.parse(field[2]), fs.readFileSync(new URL('../dist/instruments/field-keys.html', import.meta.url), 'utf8'));
  const pad = scripts.find(s => s[1].includes('bundledDrumPad'));
  assert.equal(JSON.parse(pad[2]), fs.readFileSync(new URL('../dist/instruments/drum-pad.html', import.meta.url), 'utf8'));
  const rack = scripts.find(s => s[1].includes('bundledDSPRack'));
  assert.equal(JSON.parse(rack[2]), fs.readFileSync(new URL('../dist/instruments/dsp-rack.html', import.meta.url), 'utf8'));
  const executable = scripts.filter(s => !s[1].includes('application/json'));
  for (const s of executable) new vm.Script(s[2]);
  assert.equal(/<script\b[^>]*\bsrc=|<link\b[^>]*\brel="(?:stylesheet|manifest)"/i.test(portable), false);
});
