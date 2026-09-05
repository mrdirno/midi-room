// Locks pin the UI tonal frame. Render the actual inherited Part with that
// contract, identical test RNG and trigger; do not confuse a new world mix
// with the gain of the preserved drum itself.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {load, sha} = require('./engine-loader.cjs');
const {x, sourceHashes} = load();
const tables = x.buildWavetables(), bank = x.LuckyCloudSoundBank;
const rows = [], failures = [];
function measure(spec, rate, slot) {
  const part = new x.Part(rate, x.makeRng(0x5eeda11), spec, tables);
  part.hit(slot, .78);
  const total = Math.round(rate * .8), pcm = new Float32Array(total * 2);
  let peak = 0, energy = 0, nonFinite = 0;
  for (let pos = 0; pos < total; pos += 128) {
    const n = Math.min(128, total-pos), L = new Float32Array(n), R = new Float32Array(n);
    part.render(L, R, n, new Float32Array(n));
    for (let i = 0; i < n; i++) {
      pcm[2*(pos+i)] = L[i]; pcm[2*(pos+i)+1] = R[i];
      if (!Number.isFinite(L[i]) || !Number.isFinite(R[i])) nonFinite++;
      else {peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); energy += L[i]*L[i]+R[i]*R[i];}
    }
  }
  return {pcmSha256:sha(Buffer.from(pcm.buffer)), peak, rms:Math.sqrt(energy/(2*total)), nonFinite,
    partGain:part.gain, slotGain:part.drum.lvl[slot], kitGain:spec.p.gain, patch:spec.patch};
}
for (const style of ['knock', 'miami', 'bap']) {
  const original = bank.build(948216731, {style});
  for (const [lane, slot] of [['kick',0], ['snare',1], ['hat',2]]) {
    const captured = bank.capture(original, lane);
    const changed = bank.build(67312111, {style, frame:{style, bpm:original.bpm, tonic:original.tonic},
      soundBank:{version:'1.0.0', palette:'glass', lanes:{}}, locks:{[lane]:captured}});
    const spec = world => world.roster.find(p => p.id === world.laneParts[lane]);
    for (const rate of [44100,48000]) {
      const before = measure(spec(original), rate, slot), after = measure(spec(changed), rate, slot);
      const row = {style,lane,rate,before,after}; rows.push(row);
      try {
        assert.equal(after.partGain*after.slotGain*after.kitGain, before.partGain*before.slotGain*before.kitGain, 'effective gain is unchanged');
        assert.equal(after.pcmSha256,before.pcmSha256,'isolated locked drum renders identically');
        assert.equal(before.nonFinite+after.nonFinite,0);
        assert.ok(before.rms>0);
      } catch(error) {failures.push({style,lane,rate,message:error.message});}
    }
  }
}
const report = {at:new Date().toISOString(),sourceHashes,
  scope:'Actual Part/Kit output, fixed RNG and identical trigger, original seed948216731 to67312111 with UI-pinned style/tempo/key and a new glass palette.',
  limits:['This isolates preserved drum voice/gain, not the surrounding new composition or its global mix.', 'No subjective listening claim.'],
  cases:rows.length,rows,failures,pass:failures.length===0};
const dest=path.join(__dirname,'evidence/locked-drum-pcm.json');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({cases:rows.length,failures,pass:report.pass}));if(failures.length)process.exitCode=1;
