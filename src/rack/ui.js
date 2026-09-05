// Author: Aldrin Payopay. Shared DSP rack UI; standalone and opaque-room use.
const $=id=>document.getElementById(id);
let rack=validateRack(JSON.parse($('room-rack-state').textContent));
let audio=null,context=null,generation=0,frame=0,importSerial=0,midiAccess=null;
let playingChannel=0;
let playingRange={available:false,root:60,low:0,high:127};
const ports=new Map(),keyOwners=new Map();
const status=(message,error=false)=>{$('status').textContent=message;$('status').classList.toggle('error',error);};
function snapshot(){return validateRack(rack);}
function updateProfile(){
  window.MidiRoom?.declare({name:rack.name,send:[],receive:['midi']});
  playingRange=rackPlayingRange(rack,$('channel').value===''?null:+$('channel').value);playingChannel=playingRange.channel;
  const {low,high,root,available}=playingRange;
  for(const[i,button]of [...$('keys').children].entries()){const note=root+i;button.dataset.note=String(note);button.textContent=['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][note%12]+(Math.floor(note/12)-1);button.setAttribute('aria-label','Play MIDI note '+note);button.disabled=!audio?.ready||!available||note>high;}
  if(available)window.MidiRoom?.describe({version:1,definitionId:'midi-room-dsp-rack',definitionVersion:'1',profileId:'pitched-'+(++importSerial),name:rack.name.slice(0,80),kind:'pitched',voices:[],noteRange:[low,high],recommendedRoot:root,recommendedChannel:playingChannel});
  else window.MidiRoom?.describe({version:1,definitionId:'midi-room-dsp-rack',definitionVersion:'1',profileId:'unmapped-'+(++importSerial),name:rack.name.slice(0,80),kind:'drums',voices:[]});
}
function stop(message='Stopped. Enable audio to play again.'){
  generation++;cancelAnimationFrame(frame);frame=0;audio?.dispose();audio=null;
  const old=context;context=null;if(old&&old.state!=='closed')old.close().catch(()=>{});
  keyOwners.clear();for(const b of $('keys').children){b.classList.remove('on');b.disabled=true;}
  $('audio').disabled=false;$('audio').textContent='Enable audio';$('meter').textContent='Audio off';if(message)status(message);
}
async function enable(){
  stop('Checking plugins…');const ticket=generation;$('audio').disabled=true;
  try{
    if(!rack.modules.length)throw Error('Add an instrument first.');
    const AC=window.AudioContext||window.webkitAudioContext;const candidate=new AC({latencyHint:'interactive'});context=candidate;
    await candidate.resume();
    if(ticket!==generation)return;
    const engine=new RackAudio(candidate,snapshot(),{runtimeSource:RACK_RUNTIME_SOURCE,workletSource:RACK_WORKLET_SOURCE,onFault:message=>stop(message),onQuantum:n=>{if(ticket===generation)$('meter').textContent=`${candidate.sampleRate} Hz · ${n} samples per block · ${engine.entries.length} modules`;}});audio=engine;
    await engine.initialize();
    if(ticket!==generation){engine.dispose();return;}
    engine.master.gain.value=+$('volume').value;
    $('audio').textContent='Audio enabled';updateProfile();
    status(rack.modules.some(m=>m.plugin.audio.inputs===0)?'Ready. Play the keys, connect MIDI, or use Drum Pad in MIDI Room.':'Effects ready. Add an instrument to feed them.');
    const samples=new Float32Array(engine.analyser.fftSize);let counter=0;
    function meter(){if(audio!==engine||engine.disposed)return;if(++counter%20===0){engine.analyser.getFloatTimeDomainData(samples);let peak=0;for(const x of samples)peak=Math.max(peak,Math.abs(x));$('meter').dataset.peak=String(peak);}frame=requestAnimationFrame(meter);}meter();
  }catch(error){if(ticket===generation){stop('');status(error.message,true);}}
}
function render(){
  $('title').textContent=rack.name;document.title=rack.name+' · MIDI Room';$('modules').replaceChildren();
  for(const item of rack.modules){
    const plugin=item.plugin,section=document.createElement('article');section.className='module';section.dataset.instance=item.instanceId;
    const head=document.createElement('div');head.className='module-head';const heading=document.createElement('h2');heading.textContent=plugin.name;
    const info=document.createElement('small');info.textContent=`${plugin.role} · ${plugin.audio.inputs} in / ${plugin.audio.outputs} out · ${plugin.midi.mode==='mono'?'Mono MIDI':plugin.audio.inputs?'Audio effect':'Continuous generator'}`;heading.append(info);head.append(heading);section.append(head);
    const actions=document.createElement('div');actions.className='module-actions';
    const bypass=document.createElement('button');bypass.textContent=item.bypass?'Bypassed':'Bypass';bypass.setAttribute('aria-pressed',String(item.bypass));bypass.onclick=()=>{item.bypass=!item.bypass;audio?.bypass(item.instanceId,item.bypass);bypass.textContent=item.bypass?'Bypassed':'Bypass';bypass.setAttribute('aria-pressed',String(item.bypass));};
    const remove=document.createElement('button');remove.textContent='Remove';remove.onclick=()=>{stop('Module removed. Enable audio to play the revised rack.');rack.modules=rack.modules.filter(m=>m!==item);render();updateProfile();};
    actions.append(bypass,remove);section.append(actions);
    const controls=document.createElement('div');controls.className='controls';
    for(const p of plugin.controls){const group=document.createElement('div');group.className='control';const label=document.createElement('label'),input=document.createElement('input'),value=document.createElement('output');
      input.id=item.instanceId+'-'+controls.children.length;input.type='range';input.min=p.min;input.max=p.max;input.step=p.step;input.value=item.values[p.id]??p.init;input.dataset.parameter=p.id;label.htmlFor=input.id;label.textContent=p.label;value.textContent=input.value;
      input.oninput=()=>{const v=+input.value;item.values[p.id]=v;value.textContent=input.value;try{audio?.parameter(item.instanceId,p.id,v);}catch(error){status(error.message,true);}};
      label.append(value);group.append(label,input);controls.append(group);
    }section.append(controls);$('modules').append(section);
  }
  $('routing').textContent=rack.modules.length?rack.modules.map(m=>m.plugin.name+(m.bypass?' (bypass)':'')).join(' → ')+' · generators mix, effects run in order':'Empty rack. Add a compatible instrument or effect.';
}
function add(plugin){
  const item={instanceId:'module-'+crypto.randomUUID(),plugin,values:{},bypass:false};
  const modules=[...rack.modules];const firstEffect=modules.findIndex(m=>m.plugin.audio.inputs>0);
  if(plugin.audio.inputs===0&&firstEffect>=0)modules.splice(firstEffect,0,item);else modules.push(item);
  const next=validateRack({...rack,modules});stop('Plugin added. Enable audio to play.');rack=next;render();updateProfile();
}
async function importFile(file){
  if(!file)return;const ticket=++importSerial;
  try{
    if(file.size>16*1024*1024)throw Error('Choose a plugin or rack smaller than 16 MiB.');
    const source=await file.text();let parsed;try{parsed=JSON.parse(source);}catch{}
    if(parsed?.format==='midi-room.rack/1'){
      const next=validateRack(parsed);for(const item of next.modules){await verifyPlugin(item.plugin);await preflightPlugin(item.plugin,RACK_RUNTIME_SOURCE,context?.sampleRate||48000);}if(ticket!==importSerial)return;
      stop('Rack loaded. Enable audio to play.');rack=next;render();updateProfile();
    }else{
      const plugin=extractPlugin(source,file.name);if(plugin.engine.type!=='faust-wasm/1')throw Error('Open this HTML instrument in a separate MIDI Room slot. Audio rack use needs a compiled DSP adapter.');
      await verifyPlugin(plugin);await preflightPlugin(plugin,RACK_RUNTIME_SOURCE,context?.sampleRate||48000);if(ticket!==importSerial)return;add(plugin);
    }
  }catch(error){if(ticket===importSerial)status(error.message,true);}
}
function save(){const blob=new Blob([JSON.stringify(snapshot(),null,2)+'\n'],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='midi-room.midirack.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);status('Rack file prepared with plugin binaries, settings and build identities.');}
async function connectMIDI(){
  try{
    if(typeof navigator.requestMIDIAccess!=='function')throw Error('This browser does not expose hardware MIDI. Touch playing is ready.');
    midiAccess=await navigator.requestMIDIAccess({sysex:false});
    async function sync(){
      for(const[id,port]of ports)if(!midiAccess.inputs.has(id)||midiAccess.inputs.get(id)!==port||port.state==='disconnected'){port.onmidimessage=null;ports.delete(id);audio?.notes.cancel(id);}
      for(const[id,port]of midiAccess.inputs){if(port.state==='disconnected'||ports.get(id)===port)continue;try{await port.open();if(midiAccess.inputs.get(id)!==port||port.state==='disconnected')continue;ports.set(id,port);port.onmidimessage=e=>{if(ports.get(id)===port)audio?.notes.midi(e.data,id);};}catch{status('A MIDI input could not open. Connect again to retry.',true);}}
    }midiAccess.onstatechange=sync;await sync();status(ports.size?'MIDI connected. Enable audio if needed.':'MIDI allowed. Plug in a controller.');
  }catch(error){status(error.message,true);}
}
for(let i=0;i<16;i++){const button=document.createElement('button');button.className='key';button.dataset.note=String(60+i);button.disabled=true;
  button.onpointerdown=e=>{e.preventDefault();if(!audio?.ready)return;button.setPointerCapture(e.pointerId);const id='touch-'+e.pointerId;keyOwners.set(e.pointerId,id);audio.notes.on(id,'touch',+button.dataset.note,100,playingChannel);button.classList.add('on');};
  const release=e=>{const id=keyOwners.get(e.pointerId);if(id)audio?.notes.off(id);keyOwners.delete(e.pointerId);button.classList.remove('on');};button.onpointerup=release;button.onpointercancel=release;button.onlostpointercapture=release;
  button.onkeydown=e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat){e.preventDefault();audio?.notes.on('key-'+i,'keyboard',+button.dataset.note,100,playingChannel);button.classList.add('on');}};button.onkeyup=e=>{if(e.key===' '||e.key==='Enter'){e.preventDefault();audio?.notes.off('key-'+i);button.classList.remove('on');}};button.onblur=()=>{audio?.notes.off('key-'+i);button.classList.remove('on');};$('keys').append(button);
}
for(let channel=0;channel<16;channel++)$('channel').add(new Option(String(channel+1),String(channel)));
$('channel').onchange=()=>{audio?.notes.clear();keyOwners.clear();for(const b of $('keys').children)b.classList.remove('on');updateProfile();};
$('audio').onclick=enable;$('stop').onclick=()=>stop();$('midi').onclick=connectMIDI;
$('volume').oninput=()=>{$('volume-value').textContent=Math.round(+$('volume').value*100)+'%';audio?.master?.gain.setTargetAtTime(+$('volume').value,context.currentTime,.01);};
$('import').onclick=()=>{$('file').value='';$('file').click();};$('file').onchange=()=>importFile($('file').files[0]);$('save').onclick=save;
$('bloom').onclick=()=>{try{add(validatePlugin(RACK_EXAMPLES.bloom));}catch(e){status(e.message,true);}};$('drive').onclick=()=>{try{add(validatePlugin(RACK_EXAMPLES.drive));}catch(e){status(e.message,true);}};
$('clear').onclick=()=>{stop();rack={format:'midi-room.rack/1',version:1,name:'DSP Rack',modules:[]};render();updateProfile();};
$('report').onclick=()=>{$('report-text').value=JSON.stringify({format:'midi-room.rack-report/1',time:new Date().toISOString(),modules:rack.modules.map(m=>({id:m.plugin.id,version:m.plugin.version,instanceId:m.instanceId,role:m.plugin.role,sourceHash:m.plugin.engine.build.sourceHash})),audio:audio?.report()||{ready:false},scope:'Local software state and bounded DSP preflight; physical audio/MIDI latency and phone verification are separate.'},null,2);};
window.addEventListener('midiroom:panic',()=>stop());window.addEventListener('pagehide',()=>stop(''));document.addEventListener('visibilitychange',()=>{if(document.hidden)stop('Paused while hidden.');});
window.MidiRoom?.onControl(e=>{if(e.action==='cancel')audio?.notes.cancel(e.routeId);else if(e.action==='note-off')audio?.notes.off(e.id);else if(e.action==='note-on')audio?.notes.on(e.id,e.routeId,e.note,e.velocity,e.channel);});
// Virtual inputs deliver both hardware and routed MIDI exactly once. No duplicate SDK listener.
render();updateProfile();window.MidiRoomRack=Object.freeze({snapshot,report:()=>audio?.report()||{ready:false},engine:()=>audio,stop,enable,importFile});
