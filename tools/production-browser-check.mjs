import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),{chromium,webkit}=require('playwright');
const root=path.resolve(new URL('../dist',import.meta.url).pathname),out=path.resolve(new URL('../verification',import.meta.url).pathname);
const prefix='/nested/midi-room/';
const server=http.createServer((req,res)=>{const uri=decodeURIComponent(new URL(req.url,'http://local').pathname);if(!uri.startsWith(prefix)){res.writeHead(404);return res.end();}const name=uri.slice(prefix.length)||'index.html',file=path.resolve(root,name);if(!file.startsWith(root+'/')||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}${prefix}`;
const report={at:new Date().toISOString(),scope:'Real Playwright Chromium and WebKit rendering/audio with scripted trusted pointer/keyboard gestures. No physical hardware MIDI, installed Safari app, iPhone or subjective listening claim.',base,checks:[],errors:[]};
const ids=['triton-rack','improvisator','drum-pad','field-keys','dsp-rack'];if(fs.existsSync(path.join(root,'instruments/lucky-dreamer.html')))ids.push('lucky-dreamer');
async function measure(frame,expression){return frame.evaluate(async expr=>{const c=Function('return ('+expr+')')();if(!c)return {state:'missing'};const a=c.createAnalyser();a.fftSize=2048;const native=AudioNode.prototype.connect;window.__testTap=a;window.__testTapContext=c; // Instruments expose their existing output below.
 let output;try{output=typeof master!=='undefined'?master:typeof MASTER!=='undefined'?MASTER:null;}catch{}
 if(window.MidiRoomRack)output=MidiRoomRack.engine()?.master;
 if(!output&&typeof sum!=='undefined')output=sum;
 if(output)native.call(output,a);const data=new Float32Array(a.fftSize);let peak=0;
 for(let i=0;i<6;i++){await new Promise(r=>setTimeout(r,50));a.getFloatTimeDomainData(data);for(const x of data)peak=Math.max(peak,Math.abs(x));}
 try{output?.disconnect(a);}catch{}a.disconnect();return {state:c.state,time:c.currentTime,peak,sampleRate:c.sampleRate};},expression);}
try{for(const [name,type]of Object.entries({chromium,webkit})){
 const browser=await type.launch({headless:true});
 const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});
 const page=await context.newPage();
 page.on('pageerror',error=>report.errors.push({browser:name,error:error.message}));
 await page.goto(base);await page.locator('[data-instrument]').first().waitFor();
 assert.equal(await page.locator('#instrumentCatalog button').count(),6);
 const native=await page.evaluate(()=>({midi:typeof navigator.requestMIDIAccess,audio:typeof AudioContext,secure:isSecureContext,userAgent:navigator.userAgent}));
 report.checks.push({browser:name,version:browser.version(),check:'catalog and native API availability',...native});
 await page.screenshot({path:path.join(out,`production-${name}-catalog.png`)});
 for(const id of ids){
  try{
   await page.goto(base+'?instrument='+id);await page.waitForSelector('#rackTabs .rack-tab',{timeout:20000});
   const frame=page.frames().find(f=>f.parentFrame());await frame.waitForLoadState('domcontentloaded');
   const beforeErrors=report.errors.length;
   assert.equal(await page.locator('#rackTabs .rack-tab').count(),1);
   const label=await page.locator('#instrumentName').innerText();
   const sandbox=await page.locator('iframe').getAttribute('sandbox');assert.ok(!sandbox.includes('allow-same-origin'));
   let audio,active,stopped;
   if(id==='triton-rack'){
    await frame.waitForFunction(()=>!!window.TritonEngine);
    await frame.locator('#kb').waitFor();
    await frame.locator('#kb [data-note]').nth(5).hover();
    await page.mouse.down();await page.waitForTimeout(120);
    audio=await measure(frame,'TritonEngine.audioContext()');
    await page.mouse.up();
    await frame.locator('#kb').click({position:{x:3,y:3}});
    await page.keyboard.down('a');await page.waitForTimeout(50);active=await frame.evaluate(()=>({activeVoices,keys:cDown.size}));await page.keyboard.up('a');
    await frame.locator('#tritonBpm').focus();await page.keyboard.type('a');assert.equal(await frame.evaluate(()=>cDown.size),0);
   }else if(id==='improvisator'){
    await frame.locator('#spPlay').click();await frame.waitForFunction(()=>SoulPilot.on);
    audio=await measure(frame,'TritonEngine.audioContext()');active=await frame.evaluate(()=>TritonEngine.report());
   }else if(id==='drum-pad'){
    await frame.locator('#pads .pad').first().focus();await page.keyboard.down('Enter');await page.waitForTimeout(100);active=await frame.evaluate(()=>DrumPad.report());await page.keyboard.up('Enter');
    audio=await frame.evaluate(()=>({state:DrumPad.audioContext()?.state,hits:DrumPad.report().hits}));
    assert.ok(active.hits>0);assert.equal(await frame.evaluate(()=>DrumPad.report().held),0);
   }else if(id==='field-keys'){
    await frame.locator('#enable').click();await frame.waitForFunction(()=>FieldKeys.snapshot().enabled);
    await frame.locator('#keys .key').first().focus();await page.keyboard.down('Enter');await page.waitForTimeout(100);active=await frame.evaluate(()=>FieldKeys.snapshot());assert.ok(active.voices.length>0);await page.keyboard.up('Enter');
    audio=await frame.evaluate(()=>({enabled:FieldKeys.snapshot().enabled,held:FieldKeys.snapshot().voices.filter(v=>v.held).length}));assert.equal(audio.held,0);
   }else if(id==='dsp-rack'){
    await frame.locator('#audio').click();await frame.waitForFunction(()=>MidiRoomRack.report().ready,{},{timeout:20000});
    await frame.locator('#keys .key').first().focus();await page.keyboard.down('Enter');
    audio=await measure(frame,'MidiRoomRack.engine().context || context');active=await frame.evaluate(()=>MidiRoomRack.report());await page.keyboard.up('Enter');
   }else if(id==='lucky-dreamer'){
    await frame.waitForFunction(()=>!!window.LuckyCloud);
    assert.equal(await frame.evaluate(()=>LuckyCloud.getState().playing),false,'cloud launch does not autoplay');
    await frame.locator('#dice').click();await frame.waitForFunction(()=>LuckyCloud.getState().playing);
    await frame.waitForFunction(()=>LuckyCloud.getState().time>0.1 && LuckyCloud.getState().stats.peak>0,null,{timeout:20000});active=await frame.evaluate(()=>LuckyCloud.getState());
    assert.equal(active.audioState,'running');assert.equal(active.stats.nonFinite,0);audio={state:active.audioState,mode:active.mode,playing:active.playing,time:active.time,peak:active.stats.peak,nonFinite:active.stats.nonFinite};
   }
   await page.screenshot({path:path.join(out,`production-${name}-${id}.png`)});
   await page.locator('#stopButton').click();await page.waitForTimeout(300);
   if(id==='lucky-dreamer')await frame.waitForFunction(()=>!LuckyCloud.getState().playing&&LuckyCloud.getState().audioState==='suspended');
   stopped=await frame.evaluate(()=>({audioLabel:document.body.innerText.slice(0,70),triton:window.TritonEngine?.report(),pad:window.DrumPad?.report(),field:window.FieldKeys?.snapshot(),rack:window.MidiRoomRack?.report(),lucky:window.LuckyDreamer?.getState()}));
   if(stopped.triton){assert.equal(stopped.triton.soul.on,false);assert.equal(stopped.triton.soul.scheduler,false);assert.equal(stopped.triton.ownedVoices,0);assert.equal(stopped.triton.audio,'suspended');}
   if(stopped.pad){assert.equal(stopped.pad.held,0);assert.equal(stopped.pad.localVoices,0);}
   if(stopped.lucky){assert.equal(stopped.lucky.playing,false);assert.equal(stopped.lucky.audioState,'suspended');assert.equal(stopped.lucky.stats.nonFinite,0);}
   if(stopped.rack)assert.equal(stopped.rack.ready,false);
   if(stopped.field)assert.equal(stopped.field.voices.filter(v=>v.held).length,0);
   report.checks.push({browser:name,check:'nested-path launch + playing + room Stop',id,label,sandbox,audio,active,stopped,pageErrors:report.errors.length-beforeErrors});
   await page.locator('#menuButton').click();await page.locator('#closeInstrument').click();assert.equal(await page.locator('iframe').count(),0);
   console.log('PASS',name,id,JSON.stringify(audio));
  }catch(error){report.errors.push({browser:name,id,error:error.message});console.log('FAIL',name,id,error.message);}
 }
 for(const width of [320,390,768]){await page.setViewportSize({width,height:844});await page.goto(base);const sizes=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(sizes.scroll<=sizes.width);report.checks.push({browser:name,check:'catalog mobile width',...sizes});}
 await context.close();await browser.close();
}}finally{server.close();fs.writeFileSync(path.join(out,'production-browser.json'),JSON.stringify(report,null,2));}
if(report.errors.length)process.exitCode=1;
