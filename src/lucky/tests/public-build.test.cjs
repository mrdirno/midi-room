const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
test('preserved legacy sources reproduce the previous public artifact without private references',()=>{
 const parent=path.resolve(__dirname,'..'),root=path.resolve(__dirname,'../../..');
 const temp=fs.mkdtempSync(path.join(__dirname,'.public-build-'));
 try{
  const dest=path.join(temp,'src/lucky');fs.mkdirSync(dest,{recursive:true});
  for(const file of ['engine.original.js','original-provenance.json','composition.js','audio-runtime.js','player.js','player.html','build-legacy.py'])fs.copyFileSync(path.join(parent,file),path.join(dest,file));
  cp.execFileSync('python3',[path.join(dest,'build-legacy.py')],{stdio:'pipe'});
  const actual=fs.readFileSync(path.join(temp,'dist/instruments/lucky-dreamer.html')),expected='8601bc4db9f437bd121337f6c4ee8c5d6e1f1bc2cb0465e424351aa5ea99f9a3';assert.equal(require('node:crypto').createHash('sha256').update(actual).digest('hex'),expected);
  assert.equal(fs.existsSync(path.join(temp,'reference')),false);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});
