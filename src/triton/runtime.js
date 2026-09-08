/* Aldrin Payopay — TRITON instrument facade. All audio is the original DSP. */
(function () {
  'use strict';
  const owners=new Map(), observers=new Set(), inputs=new Map(), channels=new Map();
  let sequence=0, access=null, connecting=null, midiError=null;
  const status=document.getElementById('tritonStatus');
  const bounded=x=>typeof x==='string'&&x.length>0&&x.length<=160;
  const logStatus=text=>{if(status)status.textContent=text;};
  function busy(){return typeof exporting!=='undefined'&&exporting;}
  function prune(){for(const [key,entry] of owners)if(entry.refs.every(v=>!v||v.killed))owners.delete(key);}
  function voiceProfile(){
    const p=cur||PROGRAMS[state.progIdx], drum=state.mode!=='COMBI'&&p.cat==='DRUMS', kit=p.kit||'std';
    const labels=kit==='perc'?['Low hand drum','Hand slap','Hand slap','Claves','Cowbell','Mid hand drum','Shaker','High hand drum','Shaker','Bongo','Tambourine','Cowbell']:
      ['Kick','Snare','Snare','Clap','Crash','Low tom','Closed hat','Mid tom','Closed hat','High tom','Open hat','Crash'];
    return {version:1,definitionId:'local.triton-rack',definitionVersion:'1',
      profileId:'triton:'+ (state.mode==='COMBI'?'combi:'+state.combiIdx:(p.id||'user'))+':1',
      kind:drum?'drums':'pitched',name:state.mode==='COMBI'?COMBIS[state.combiIdx].name:p.name,
      noteRange:[0,127],recommendedRoot:drum?36:48,preferredTempo:p.tempo,
      voices:drum?(kit==='perc'?[0,2,3,4,5,6,7,9,10]:[0,2,3,5,6,7,9,10,11]).map(k=>({id:kit+':'+k,label:labels[k],note:36+k,channel:9,mode:'oneshot',...((kit!=='perc'&&[6,8,10].includes(k))?{chokeGroup:'hats'}:{})})):[],
      velocity:{min:1,max:127,response:'continuous amplitude'},timing:{unit:'audio-context-seconds',maximumLookahead:10},
      provenance:'TRITON16 supplied oscillator models; twelve pitch-class zones, not General MIDI'};
  }
  function publish(){const m=voiceProfile();for(const fn of observers)fn(m);}
  function release(entry,when,cancel){
    if(!entry)return;
    entry.refs.forEach(v=>{if(!v||v.killed)return;
      if(v._take&&typeof takeCloseEv==='function')takeCloseEv(v._take);
      if(cancel&&v.kill)v.kill();else if(v.release)v.release(when);
    });
  }
  function ensure(){
    if(busy())return false;
    if(!state.powered)quickBoot();
    return !!(state.powered&&ctx);
  }
  function audio(){
    try{if(!ensure())return Promise.resolve(false);return Promise.resolve((ctx.state==='suspended'||ctx.state==='interrupted')?ctx.resume():null).then(()=>ctx.state==='running');}
    catch(error){logStatus('Audio paused: '+error.message);return Promise.resolve(false);}
  }
  /* Channel 9 is the drum channel wherever MIDI is spoken, and dist/instrument-map.json
     says so for this instrument. Honouring it is the whole difference between a cabled
     band arriving as drums and arriving as several hundred notes of whichever keyboard
     patch happens to be loaded — which is what happened, because receive() read the
     channel and noteOn never saw it. The selected patch is NOT changed: a percussion
     note borrows a kit for one hit and gives it straight back.

     Only notes from a room cable, never from hardware. A cable arrives as a virtual
     input whose id starts with 'wire:' (dist/bridge.js), and plenty of keyboards are set
     to channel 10 by default while their player expects the patch they chose — so a
     controller behaves exactly as it did before this existed.

     Two note bands pick the kit, because a note number is the only thing a MIDI cable can
     carry, and they match instrument-map.json exactly — tests/instrument-map.test.mjs
     fails if this copy and that file ever disagree. A player who has already loaded a kit
     keeps it; the borrow happens only when the band asks for the other family. */
  const ROOM_PERCUSSION={channel:9,kits:[{name:'std',low:36,high:47},{name:'perc',low:48,high:59}]};
  function roomPercussion(event){
    if(!event.cabled||event.channel!==ROOM_PERCUSSION.channel||state.mode==='COMBI')return null;
    const band=ROOM_PERCUSSION.kits.find(k=>event.note>=k.low&&event.note<=k.high);
    if(!band)return null;
    if(cur&&cur.cat==='DRUMS'&&((cur.kit||'std')==='perc')===(band.name==='perc'))return null;
    const program=PROGRAMS.find(p=>p.cat==='DRUMS'&&(p.kit||'std')===band.name);
    return program?{program:program,kit:band.name}:null;
  }
  function noteOn(event){
    if(!event||!bounded(event.id)||!bounded(event.routeId)||!Number.isInteger(event.note)||event.note<0||event.note>127||
      typeof event.velocity!=='number'||!Number.isFinite(event.velocity)||event.velocity<=0||event.velocity>1||!ensure())return false;
    const when=event.at==null?ctx.currentTime:event.at;
    if(typeof when!=='number'||!Number.isFinite(when)||when>ctx.currentTime+10)return false;
    prune();if(owners.size>=512)return false;
    const key=event.routeId+'\n'+event.id;
    if(owners.has(key))return false; // Duplicate note IDs never retrigger another voice.
    const percussion=roomPercussion(event);
    const profile=voiceProfile(), zone=percussion?null:profile.voices.find(v=>v.note%12===event.note%12);
    // The open and closed hats cut each other off whichever way the note arrived.
    const group=percussion?(percussion.kit==='std'&&[6,10].includes(((event.note%12)+12)%12)?'hats':null):(zone&&zone.chokeGroup);
    if(group)for(const entry of owners.values())if(entry.group===group&&entry.routeId===event.routeId)release(entry,null,true);
    const refs=[];
    if(percussion){const v=spawnVoice(percussion.program,event.note,event.velocity,when,null);if(v)refs.push(v);}
    else if(state.mode==='COMBI')COMBIS[state.combiIdx].timbres.forEach(tb=>{
      if(event.note>=tb.lo&&event.note<=tb.hi){const v=spawnVoice(PROGRAMS[tb.p],event.note+tb.tr,event.velocity*tb.lvl,when,null);if(v)refs.push(v);}
    });
    else{const v=spawnVoice(cur,event.note,event.velocity,when,null);if(v)refs.push(v);}
    if(!refs.length)return false;
    owners.set(key,{id:event.id,routeId:event.routeId,note:event.note,mode:percussion||profile.kind==='drums'?'oneshot':'gate',group,refs});
    return true;
  }
  function noteOff(event){
    if(!event||!bounded(event.id)||!bounded(event.routeId)||busy())return false;
    const key=event.routeId+'\n'+event.id,entry=owners.get(key);if(!entry)return false;
    if(event.at!=null&&(!Number.isFinite(event.at)||!ctx||event.at>ctx.currentTime+10))return false;
    // Keep the captured sources until their cleanup, including a release
    // already scheduled in the future. A later route close still owns them.
    if(entry.mode==='gate'&&!entry.released){release(entry,event.at,false);entry.released=true;}
    return true;
  }
  function cancelRoute(routeId){
    if(!bounded(routeId)||busy())return false;
    for(const [key,entry] of owners)if(entry.routeId===routeId){release(entry,null,true);owners.delete(key);}
    for(const [key,c] of channels)if(c.route===routeId)channels.delete(key);
    return true;
  }
  function channel(source,ch){const key=source+':'+ch;
    if(!channels.has(key))channels.set(key,{route:'midi:'+key,held:new Map(),sustain:false,pending:[]});return channels.get(key);}
  function receive(bytes,source='injected'){
    if(!bounded(source)||!bytes||bytes.length<2||bytes.length>3)return false;
    const d=Array.from(bytes);if(!d.every(x=>Number.isInteger(x)&&x>=0&&x<=255))return false;
    const command=d[0]&240,ch=d[0]&15,n=d[1],v=d[2]||0;if(n>127||v>127)return false;
    const c=channel(source,ch);
    if(command===144&&v>0){const id='midi-'+(++sequence);const ok=noteOn({id,routeId:c.route,note:n,velocity:v/127,channel:ch,cabled:source==='injected'||source.slice(0,5)==='wire:'});
      if(ok){let held=c.held.get(n);if(!held){held=[];c.held.set(n,held);}held.push(id);}if(typeof ctxEnsure==='function')ctxEnsure();return ok;}
    if(command===128||(command===144&&v===0)){const held=c.held.get(n);if(!held||!held.length)return false;const id=held.shift();if(!held.length)c.held.delete(n);
      if(c.sustain)c.pending.push(id);else noteOff({id,routeId:c.route});return true;}
    if(command===176&&n===64){c.sustain=v>=64;if(!c.sustain)c.pending.splice(0).forEach(id=>noteOff({id,routeId:c.route}));return true;}
    if(command===176&&(n===120||n===123))return cancelRoute(c.route);
    if(command===224){const cents=(((v<<7)|n)-8192)/8192*200;
      for(const entry of owners.values())if(entry.routeId===c.route)for(const voice of entry.refs)if(voice.oscs)voice.oscs.forEach(o=>{if(o.src.detune)o.src.detune.setTargetAtTime((o.det||0)+cents,ctx.currentTime,.01);});return true;}
    if(command===176&&n===1){for(const entry of owners.values())if(entry.routeId===c.route)for(const voice of entry.refs)if(voice.lgP&&voice.lfoP!=null)voice.lgP.gain.setTargetAtTime(voice.lfoP+(v/127)*35,ctx.currentTime,.05);return true;}
    return false;
  }
  function releaseSource(id){for(let ch=0;ch<16;ch++)cancelRoute('midi:'+id+':'+ch);}
  async function bindInputs(){
    if(!access)return;
    const seen=new Set();
    for(const port of access.inputs.values()){
      const id=String(port.id);if(port.state==='disconnected')continue;seen.add(id);
      if(inputs.get(id)?.port===port)continue;
      if(inputs.has(id)){inputs.get(id).port.onmidimessage=null;releaseSource(id);}
      const binding={port};inputs.set(id,binding);
      try{if(port.open)await port.open();if(inputs.get(id)!==binding)continue;
        port.onmidimessage=event=>{if(inputs.get(id)===binding)receive(event.data,id);};}
      catch(error){if(inputs.get(id)===binding)inputs.delete(id);port.onmidimessage=null;releaseSource(id);midiError=error.message;}
    }
    for(const [id,binding] of inputs)if(!seen.has(id)){binding.port.onmidimessage=null;inputs.delete(id);releaseSource(id);}
    logStatus(midiError?'MIDI: '+midiError:inputs.size+' MIDI input(s) · local tempo '+state.tempo+' BPM');
  }
  function connect(){
    audio();
    if(!navigator.requestMIDIAccess){logStatus('Web MIDI unavailable · touch keys remain playable');return Promise.resolve(false);}
    if(connecting)return connecting;
    midiError=null;
    connecting=(async()=>{try{if(!access)access=await navigator.requestMIDIAccess({sysex:false});access.onstatechange=bindInputs;await bindInputs();return true;}
      catch(error){midiError=error.message;logStatus('MIDI permission: '+error.message);return false;}finally{connecting=null;}})();return connecting;
  }
  const engine=window.TritonEngine={version:1,metadata:voiceProfile,noteOn,noteOff,cancelRoute,audioContext:()=>ctx,audio,connectMidi:connect,midi:receive,
    setTempo:(bpm,options)=>TritonTransport.set(bpm,options),transportState:()=>TritonTransport.snapshot(),
    selectProgram(id){const i=PROGRAMS.findIndex(p=>p.id===id);if(i<0)return false;state.mode='PROG';setProgram(i);return true;},
    subscribeMetadata(fn){if(typeof fn!=='function')throw new TypeError('metadata listener must be a function');observers.add(fn);return()=>observers.delete(fn);},
    panic(){for(const entry of owners.values())release(entry,null,true);owners.clear();channels.clear();return true;},
    report(){prune();return {version:1,definitionId:'local.triton-rack',profile:voiceProfile(),transport:TritonTransport.snapshot(),audio:ctx?.state||'off',
      midi:{available:!!navigator.requestMIDIAccess,connectedInputs:inputs.size,error:midiError},ownedVoices:Array.from(owners.values()).filter(e=>!e.released).length,ownedSourceGroups:owners.size,
      soul:{on:!!window.SoulPilot?.on,scheduler:!!window.SoulPilot?.timer,generation:window.SoulPilot?.generation},
      evidence:'Software state only; no claim of audible output, hardware MIDI or phone testing'};}}
  window._midiInject=bytes=>receive(bytes,'injected');
  const previousProgram=setProgram;setProgram=function(i){const result=previousProgram(i);publish();return result;};
  const previousCombi=setCombi;setCombi=function(i){const result=previousCombi(i);publish();return result;};
  const previousUser=setUserProgram;setUserProgram=function(i){const result=previousUser(i);if(window.SoulPilot?.on&&SoulPilot.refreshAudio)SoulPilot.refreshAudio();publish();return result;};
  TritonTransport.subscribe(snapshot=>{document.getElementById('tritonBpm').value=snapshot.bpm;logStatus(snapshot.bpm+' BPM · local clock · '+snapshot.reason);if(ctx){if(window.SoulPilot?.on)SoulPilot.refreshAudio();else applyFX();}});
  document.getElementById('tritonBpm').addEventListener('change',event=>{if(!engine.setTempo(Number(event.target.value),{reason:'local tempo control'}))event.target.value=state.tempo;});
  document.getElementById('tritonAdopt').addEventListener('click',()=>engine.setTempo(voiceProfile().preferredTempo,{reason:'explicit adopt patch tempo'}));
  document.getElementById('tritonConnect').addEventListener('click',connect);
  const dialog=document.getElementById('tritonReportDialog'),text=document.getElementById('tritonReportText');
  document.getElementById('tritonReport').addEventListener('click',()=>{text.value=JSON.stringify(engine.report(),null,2);if(dialog.showModal)dialog.showModal();else dialog.setAttribute('open','');});
  document.getElementById('tritonReportClose').addEventListener('click',()=>{if(dialog.close)dialog.close();else dialog.removeAttribute('open');document.getElementById('tritonReport').focus();});
  document.getElementById('tritonReportCopy').addEventListener('click',async()=>{try{if(!navigator.clipboard)throw new Error('Select and copy');await navigator.clipboard.writeText(text.value);}catch(_){text.focus();text.select();}});
  function releaseKeys(){
    if(typeof cDown!=='undefined')cDown.clear();
    if(typeof ptrMap!=='undefined')ptrMap.clear();
    engine.panic(); if(typeof allNotesOff==='function')allNotesOff();
  }
  function stopPerformance(){
    if(window.SoulPilot?.stop)SoulPilot.stop(true);
    if(typeof transportStop==='function')transportStop();
    releaseKeys(); if(typeof ctxEnsure?.disarm==='function')ctxEnsure.disarm();
  }
  function dispose(){
    stopPerformance();
    for(const binding of inputs.values()){binding.port.onmidimessage=null;try{Promise.resolve(binding.port.close?.()).catch(()=>{});}catch{}}
    inputs.clear(); if(access)access.onstatechange=null;
    try{if(ctx?.state!=='closed')Promise.resolve(ctx?.close()).catch(()=>{});}catch{}
  }
  window.addEventListener('blur',releaseKeys);
  window.addEventListener('midiroom:panic',stopPerformance);
  window.addEventListener('midiroom:dispose',dispose);
  window.addEventListener('pagehide',dispose);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopPerformance();});
  // Safari can interrupt an existing context. Resume synchronously in the next real gesture.
  function resumeGesture(event){if(event.isTrusted&&ctx&&(ctx.state==='suspended'||ctx.state==='interrupted')){try{ctx.resume().catch(()=>{});}catch{}}}
  window.addEventListener('pointerdown',resumeGesture,true);window.addEventListener('keydown',resumeGesture,true);
})();
