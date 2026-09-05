const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
test('public runtime-only sources reproduce standalone output without the private reference tree',()=>{
 const parent=path.resolve(__dirname,'..'),root=path.resolve(__dirname,'../../..');
 const temp=fs.mkdtempSync(path.join(__dirname,'.public-build-'));
 try{
  const dest=path.join(temp,'src/lucky');fs.mkdirSync(dest,{recursive:true});
  for(const file of ['engine.original.js','original-provenance.json','composition.js','audio-runtime.js','player.js','player.html','build-lucky.py'])fs.copyFileSync(path.join(parent,file),path.join(dest,file));
  cp.execFileSync('python3',[path.join(dest,'build-lucky.py')],{stdio:'pipe'});
  const actual=fs.readFileSync(path.join(temp,'dist/instruments/lucky-dreamer.html')),expected=fs.readFileSync(path.join(root,'dist/instruments/lucky-dreamer.html'));assert.deepEqual(actual,expected);
  assert.equal(fs.existsSync(path.join(temp,'reference')),false);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
