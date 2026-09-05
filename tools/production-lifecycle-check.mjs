import {createRequire} from 'node:module';import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium,webkit}=require('playwright');
const root=new URL('../dist/',import.meta.url).pathname,out=new URL('../verification/',import.meta.url).pathname;
const server=http.createServer((req,res)=>{let file=path.join(root,decodeURIComponent(new URL(req.url,'http://x').pathname).replace(/^\/midi-room\//,''));if(file===root)file+='index.html';if(!file.startsWith(root)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}/midi-room/`;
const report={at:new Date().toISOString(),scope:'Real browser engine checks with scripted touch/keyboard; no physical phone or installed Safari claim.',checks:[],errors:[]};
try{for(const [name,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,acceptDownloads:true});const page=await context.newPage();page.on('pageerror',e=>report.errors.push({browser:name,error:e.message}));
 try{
  for(const id of ['triton-rack','improvisator','drum-pad','field-keys','dsp-rack','lucky-dreamer']){
   await page.goto(base+'#instrument='+id);await page.waitForFunction(label=>document.querySelector('#instrumentName')?.textContent===label,({'triton-rack':'TRITON Rack',improvisator:'Improvisator','drum-pad':'Drum Pad','field-keys':'Field Keys','dsp-rack':'DSP Rack','lucky-dreamer':'Lucky Dreamer'})[id]);const f=page.frames().find(f=>f.parentFrame());await f.waitForLoadState();
   const geometry=await f.evaluate(()=>({inner:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(geometry.scroll<=geometry.inner+1,id+' mobile overflow '+JSON.stringify(geometry));
   let result;
   if(id==='triton-rack'){await f.locator('#kb [data-note]').nth(5).tap();await page.waitForTimeout(120);result=await f.evaluate(()=>({audio:TritonEngine.audioContext()?.state,powered:state.powered,held:ptrMap.size}));assert.equal(result.audio,'running');assert.equal(result.held,0);}
   if(id==='improvisator'){await f.locator('#spPlay').tap();await f.waitForFunction(()=>SoulPilot.on);result=await f.evaluate(()=>TritonEngine.report());assert.equal(result.audio,'running');}
   if(id==='drum-pad'){await f.locator('#pads .pad').first().tap();await page.waitForTimeout(120);result=await f.evaluate(()=>({audio:DrumPad.audioContext()?.state,...DrumPad.report()}));assert.equal(result.audio,'running');assert.ok(result.hits>0,'first touch must trigger a hit');}
   if(id==='field-keys'){await f.locator('#enable').tap();await f.waitForFunction(()=>FieldKeys.snapshot().enabled);await f.locator('#keys .key').first().tap();result=await f.evaluate(()=>FieldKeys.snapshot());assert.equal(result.enabled,true);}
   if(id==='dsp-rack'){await f.locator('#audio').tap();await f.waitForFunction(()=>MidiRoomRack.report().ready);await f.locator('#keys .key').first().tap();result=await f.evaluate(()=>MidiRoomRack.report());assert.equal(result.ready,true);}
   if(id==='lucky-dreamer'){await f.waitForFunction(()=>!!window.LuckyCloud);assert.equal(await f.evaluate(()=>LuckyCloud.getState().playing),false);await f.locator('#dice').tap();await f.waitForFunction(()=>LuckyCloud.getState().audioState==='running'&&LuckyCloud.getState().stats?.peak>0,null,{timeout:20000});result=await f.evaluate(()=>LuckyCloud.getState());assert.equal(result.stats.nonFinite,0);}
   await page.locator('#stopButton').tap();
   if(id==='lucky-dreamer'){
    await f.waitForFunction(()=>!LuckyCloud.getState().playing&&LuckyCloud.getState().audioState==='suspended');
    await f.locator('#bSave').tap();await f.locator('#svMidi').tap();await page.locator('#saveTray .save-row').waitFor();
    const saveText=await page.locator('#saveTray').innerText();assert.match(saveText,/\.mid/);report.checks.push({browser:name,check:'cloud-created MIDI reaches opaque parent save tray',saveText});
   }
   report.checks.push({browser:name,check:'390px real touch + hash launch',id,geometry,result});console.log('PASS touch',name,id);
  }
  // A generated creation export travels from the opaque frame to the parent save tray.
  await page.goto(base+'?instrument=drum-pad');await page.waitForSelector('#rackTabs .rack-tab');const pad=page.frames()[1];await pad.locator('#save').tap();await pad.locator('#record').tap();await pad.locator('[data-close="saveDialog"]').tap();await pad.locator('#pads .pad').first().tap();await pad.locator('#save').tap();await pad.locator('#record').tap();await pad.locator('#saveMidi').tap();
  await page.locator('#saveTray .save-row').waitFor();const saveText=await page.locator('#saveTray').innerText();assert.match(saveText,/drum-pad-take.mid/);report.checks.push({browser:name,check:'created MIDI export reaches parent save tray',saveText});
  // Verify imported HTML has neither parent-origin access nor outbound fetch access.
  let outbound=0;await context.route('https://example.invalid/**',route=>{outbound++;route.abort();});
  const fixture=`<!doctype html><html><body><button id="sound">Play</button><script>window.check={};try{check.parent=parent.document.title}catch(e){check.parent='blocked'}try{localStorage.setItem('probe','x');check.storage='allowed'}catch(e){check.storage='blocked'}fetch('https://example.invalid/no-upload').then(()=>check.fetch='allowed',()=>check.fetch='blocked');document.getElementById('sound').onclick=()=>{window.audio=new AudioContext();const o=audio.createOscillator();o.connect(audio.destination);o.start();};<\/script></body></html>`;
  await page.locator('#fileInput').setInputFiles({name:'isolation-check.html',mimeType:'text/html',buffer:Buffer.from(fixture)});await page.waitForFunction(()=>document.querySelector('#instrumentName').textContent.includes('isolation-check'));const imported=page.frames().find(f=>f.parentFrame());await imported.waitForFunction(()=>window.check?.fetch);
  const isolation=await imported.evaluate(()=>window.check);assert.equal(isolation.parent,'blocked');assert.equal(isolation.storage,'blocked');assert.equal(isolation.fetch,'blocked');assert.equal(outbound,0);
  await imported.locator('#sound').tap();await imported.waitForFunction(()=>audio.state==='running');await page.locator('#stopButton').tap();await imported.waitForFunction(()=>audio.state==='suspended');
  report.checks.push({browser:name,check:'real imported sandbox + CSP + AudioContext stop',isolation,outbound});
  // Existing notes must not restart just because the parent resumes a context.
  await page.goto(base+'?instrument=improvisator');await page.waitForSelector('#rackTabs .rack-tab');const soul=page.frames()[1];await soul.locator('#spPlay').tap();await soul.waitForFunction(()=>SoulPilot.on);await page.locator('#stopButton').tap();await page.locator('#rackTabs .rack-tab').tap();await page.waitForTimeout(1100);const noRestart=await soul.evaluate(()=>TritonEngine.report());assert.equal(noRestart.soul.on,false);assert.equal(noRestart.soul.scheduler,false);report.checks.push({browser:name,check:'stopped conductor stays stopped after context resume',state:noRestart});
 }catch(e){report.errors.push({browser:name,error:e.message});console.log('FAIL',name,e.message);}
 finally{await context.close();await browser.close();}
}}finally{server.close();fs.writeFileSync(path.join(out,'production-lifecycle.json'),JSON.stringify(report,null,2));}
if(report.errors.length)process.exitCode=1;
