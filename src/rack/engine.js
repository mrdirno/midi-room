// Author: Aldrin Payopay. One AudioContext owns a bounded DSP graph.
import {validateRack, verifyPlugin} from '../../dist/plugin-contract.js';

export function moduleURL(source) {
  // Blob URLs retain the creating context and work with the host's worker-src
  // policy. Callers revoke each URL after admission/module loading settles.
  return URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
}

/** Run a new engine off the UI/audio threads before admitting it to the rack. */
export function preflightPlugin(plugin,runtimeSource,rate,timeout=5000,signal=null) {
  const code=runtimeSource+`\nonmessage=async e=>{try{const {build,rate}=e.data;
    const module=await WebAssembly.compile(Uint8Array.from(atob(build.wasm),c=>c.charCodeAt(0)));
    const engine=new CardRuntime(module,build.metadata,rate,128);
    if(engine.api.getNumInputs(0)!==build.metadata.inputs||engine.api.getNumOutputs(0)!==build.metadata.outputs||engine.api.getSampleRate(0)!==rate)throw Error('Compiled audio shape disagrees with plugin metadata.');
    for(const p of build.metadata.parameters){const value=engine.api.getParamValue(0,p.index);if(!Number.isFinite(value)||Math.abs(value-p.init)>Math.max(1e-6,Math.abs(p.init)*1e-6))throw Error('Compiled parameter default disagrees with plugin metadata.');}
    for(const p of build.metadata.parameters)engine.set(p.index,p.init);
    let peak=0;for(let block=0;block<32;block++){
      for(const input of engine.inputs){input.fill(0);if(block===0)input[0]=0.1;}
      engine.compute(128);for(const channel of engine.outputs)for(const value of channel){
        if(!Number.isFinite(value))throw Error('Non-finite DSP output in preflight.');peak=Math.max(peak,Math.abs(value));}}
    postMessage({ok:true,frames:4096,rate,peak});
  }catch(error){postMessage({ok:false,error:error.message});}};`;
  return new Promise((resolve,reject)=>{
    if(signal?.aborted){reject(new Error('DSP preflight cancelled.'));return;}
    const url=moduleURL(code);
    let worker;
    try{worker=new Worker(url);}catch(error){URL.revokeObjectURL(url);reject(error);return;}
    let settled=false;
    const timer=setTimeout(()=>finish(new Error('DSP preflight exceeded its time budget.')),timeout);
    const abort=()=>finish(new Error('DSP preflight cancelled.'));signal?.addEventListener('abort',abort,{once:true});
    function finish(error,result){if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();URL.revokeObjectURL(url);error?reject(error):resolve(result);}
    worker.onerror=()=>finish(new Error('DSP preflight worker failed.'));
    worker.onmessage=e=>e.data.ok?finish(null,e.data):finish(new Error(e.data.error));
    try{worker.postMessage({build:plugin.engine.build,rate});}catch(error){finish(error);}
  });
}

export function rackPlayingRange(rack,channel=null){
  const mapped=rack.modules.filter(m=>m.plugin.midi.mode==='mono');
  const selected=channel??mapped.find(m=>m.plugin.midi.channel!==null)?.plugin.midi.channel??0;
  const audible=mapped.filter(m=>m.plugin.midi.channel===null||m.plugin.midi.channel===selected);
  let low=0,high=127;
  for(const m of audible){const p=m.plugin.controls.find(p=>p.id===m.plugin.midi.frequency);low=Math.max(low,Math.ceil(69+12*Math.log2(p.min/440)));high=Math.min(high,Math.floor(69+12*Math.log2(p.max/440)));}
  const available=audible.length>0&&low<=high;
  return{channel:selected,low,high,available,root:available?Math.max(low,Math.min(60,high-15)):60};
}

export class RackNotes {
  constructor(change=()=>{}){this.change=change;this.held=new Map();this.pedals=new Set();this.serial=0;}
  on(id,source,note,velocity=100,channel=0){
    if(typeof id!=='string'||typeof source!=='string'||!Number.isInteger(note)||note<0||note>127||!Number.isInteger(channel)||channel<0||channel>15||!Number.isFinite(velocity)||velocity<=0||velocity>127)return false;
    if(this.held.size>=128){this.clear();return false;}
    if(this.held.has(id))return false;
    this.held.set(id,{id,source,note,velocity,channel,down:true,order:++this.serial});this.change();return true;
  }
  off(id){const n=this.held.get(id);if(!n)return; if(this.pedals.has(n.source+':'+n.channel))n.down=false;else this.held.delete(id);this.change();}
  cancel(source,channel=null){for(const[id,n]of this.held)if(n.source===source&&(channel===null||n.channel===channel))this.held.delete(id);for(const p of this.pedals)if(channel===null?p.startsWith(source+':'):p===source+':'+channel)this.pedals.delete(p);this.change();}
  clear(){this.held.clear();this.pedals.clear();this.change();}
  midi(data,source='midi'){
    if(!Array.isArray(data)&&!ArrayBuffer.isView(data))return;
    if(data.length<3||![...data].every(x=>Number.isInteger(x)&&x>=0&&x<=255))return;
    const [status,note,velocity]=data,type=status&240,channel=status&15;
    if(note>127||velocity>127)return;
    if(type===144&&velocity>0)this.on('midi-'+(++this.serial),source,note,velocity,channel);
    else if(type===128||type===144){const old=[...this.held.values()].find(n=>n.down&&n.source===source&&n.note===note&&n.channel===channel);if(old)this.off(old.id);}
    else if(type===176){
      const pedal=source+':'+channel;
      if(note===64){if(velocity>=64)this.pedals.add(pedal);else{this.pedals.delete(pedal);for(const[id,n]of this.held)if(n.source===source&&n.channel===channel&&!n.down)this.held.delete(id);}this.change();}
      else if(note===120||note===123||note===121)this.cancel(source,channel);
    }
  }
  latest(channel=null){return [...this.held.values()].filter(n=>channel===null||n.channel===channel).sort((a,b)=>b.order-a.order)[0]||null;}
}

export class RackAudio {
  constructor(context,rack,{runtimeSource,workletSource,onFault=()=>{},onQuantum=()=>{}}){
    this.context=context;this.rack=validateRack(rack);this.runtimeSource=runtimeSource;this.workletSource=workletSource;
    this.onFault=onFault;this.onQuantum=onQuantum;this.entries=[];this.nodes=[];this.disposed=false;this.ready=false;this.receipts=[];
    this.abortController=new AbortController();
    this.notes=new RackNotes(()=>this.updateNotes());
  }
  track(node){this.nodes.push(node);return node;}
  async initialize(){
    if(!this.context.audioWorklet)throw Error('This browser needs AudioWorklet on localhost or HTTPS to play DSP racks.');
    try{
      const context=this.context, mix=this.track(context.createGain());
      const sources=this.rack.modules.filter(m=>m.plugin.audio.inputs===0);
      mix.gain.value=1/Math.max(1,sources.length); this.mix=mix;
      for(let i=0;i<this.rack.modules.length;i++){
        const item=this.rack.modules[i],plugin=item.plugin;
        for(const required of plugin.requirements){
          if(required==='web-midi'&&typeof navigator.requestMIDIAccess!=='function')throw Error('This plugin requires Web MIDI, unavailable in this browser.');
          if(required==='midi-room-control/1'&&globalThis.MidiRoom?.controlVersion!==1)throw Error('This plugin requires MIDI Room surface controls. Open it inside MIDI Room.');
        }
        const integrity=await verifyPlugin(plugin);if(this.disposed)throw Error('Rack initialization cancelled.');
        const probe=await preflightPlugin(plugin,this.runtimeSource,context.sampleRate,5000,this.abortController.signal);
        if(this.disposed)throw Error('Rack initialization cancelled.');
        this.receipts.push({instanceId:item.instanceId,integrity,probe});
        const build=plugin.engine.build,meta=build.metadata,name='room-dsp-'+i+'-'+crypto.randomUUID();
        const code='const CARD_METADATA='+JSON.stringify(meta)+';\nconst CARD_PARAMETERS=CARD_METADATA.parameters;\n'+this.runtimeSource+'\n'+this.workletSource.replace("registerProcessor('dsp-card',DspCardProcessor)",'registerProcessor('+JSON.stringify(name)+',DspCardProcessor)');
        const module=await WebAssembly.compile(Uint8Array.from(atob(build.wasm),c=>c.charCodeAt(0)));
        if(this.disposed)throw Error('Rack initialization cancelled.');
        const workletURL=moduleURL(code);
        try{
          try{await context.audioWorklet.addModule(workletURL);}
          catch(error){
            // WebKit can reject blob:null worklets in an opaque frame with a
            // CORS error. Its inline worklet path retains sandbox isolation.
            await context.audioWorklet.addModule('data:text/javascript;charset=utf-8,'+encodeURIComponent(code));
          }
        }finally{URL.revokeObjectURL(workletURL);}
        if(this.disposed)throw Error('Rack initialization cancelled.');
        const node=this.track(new AudioWorkletNode(context,name,{numberOfInputs:meta.inputs?1:0,numberOfOutputs:1,outputChannelCount:[meta.outputs],channelCount:Math.max(1,meta.inputs),channelCountMode:'explicit',processorOptions:{module}}));
        node.onprocessorerror=()=>this.fault('A DSP processor stopped. The rack was muted.');
        node.port.onmessage=e=>{if(this.disposed)return;if(e.data?.kind==='fault')this.fault(e.data.message);else if(e.data?.kind==='quantum')this.onQuantum(e.data.frames);};
        const entry={item,node,gate:null,wet:null,dry:null,parameters:new Map(meta.parameters.map((p,n)=>[p.id,{spec:p,param:node.parameters.get('p'+n)}]))};
        for(const[id,{spec,param}]of entry.parameters)param.setValueAtTime(item.values[id]??spec.init,context.currentTime);
        if(meta.inputs===0){entry.gate=this.track(context.createGain());entry.gate.gain.value=plugin.midi.mode==='mono'||item.bypass?0:1;node.connect(entry.gate).connect(mix);}
        this.entries.push(entry);
      }
      let tail=mix;
      for(const entry of this.entries.filter(e=>e.item.plugin.audio.inputs>0)){
        const dry=this.track(context.createGain()),wet=this.track(context.createGain()),sum=this.track(context.createGain());
        dry.gain.value=entry.item.bypass?1:0;wet.gain.value=entry.item.bypass?0:1;
        tail.connect(dry).connect(sum);tail.connect(entry.node).connect(wet).connect(sum);entry.dry=dry;entry.wet=wet;tail=sum;
      }
      // Bound the rack's final amplitude; monitor level remains separate from plugin state.
      const limiter=this.track(context.createWaveShaper());limiter.curve=Float32Array.from({length:4097},(_,i)=>Math.tanh((i/4096*2-1)*1.2));
      this.master=this.track(context.createGain());this.master.gain.value=.35;
      this.analyser=this.track(context.createAnalyser());this.analyser.fftSize=2048;
      tail.connect(limiter).connect(this.master).connect(this.analyser).connect(context.destination);
      this.ready=true;this.updateNotes();return this;
    }catch(error){this.dispose();throw error;}
  }
  fault(message){if(this.disposed)return;this.dispose();this.onFault(String(message));}
  updateNotes(){
    if(!this.ready||this.disposed)return;const time=this.context.currentTime;
    for(const entry of this.entries){const plugin=entry.item.plugin;if(plugin.midi.mode!=='mono')continue;
      const note=this.notes.latest(plugin.midi.channel),frequency=note?440*2**((note.note-69)/12):0;
      const mapping=entry.parameters.get(plugin.midi.frequency),valid=note&&frequency>=mapping.spec.min&&frequency<=mapping.spec.max&&!entry.item.bypass;
      if(valid)mapping.param.setValueAtTime(frequency,time);
      if(plugin.midi.gate)entry.parameters.get(plugin.midi.gate).param.setValueAtTime(valid?1:0,time);
      entry.gate?.gain.setTargetAtTime(valid?note.velocity/127:0,time,valid ? .008 : .015);
    }
  }
  parameter(instanceId,id,value){
    const entry=this.entries.find(e=>e.item.instanceId===instanceId),mapping=entry?.parameters.get(id);
    if(!mapping||!Number.isFinite(value)||value<mapping.spec.min||value>mapping.spec.max)throw Error('Parameter value is outside this plugin’s declared range.');
    entry.item.values[id]=value;if(!this.disposed)mapping.param.setValueAtTime(value,this.context.currentTime);
  }
  bypass(instanceId,enabled){
    const entry=this.entries.find(e=>e.item.instanceId===instanceId);if(!entry||typeof enabled!=='boolean')return;
    entry.item.bypass=enabled;const time=this.context.currentTime;
    if(entry.dry){entry.dry.gain.setTargetAtTime(enabled?1:0,time,.01);entry.wet.gain.setTargetAtTime(enabled?0:1,time,.01);}
    else if(entry.item.plugin.midi.mode==='none')entry.gate.gain.setTargetAtTime(enabled?0:1,time,.01);
    this.updateNotes();
  }
  panic(){this.notes.clear();if(this.master)this.master.gain.setValueAtTime(0,this.context.currentTime);}
  dispose(){if(this.disposed)return;this.abortController.abort();this.panic();this.disposed=true;this.ready=false;for(const entry of this.entries){entry.node.onprocessorerror=null;entry.node.port.onmessage=null;entry.node.port.close();}for(const node of this.nodes)try{node.disconnect();}catch{}this.nodes=[];}
  report(){return{ready:this.ready,disposed:this.disposed,rate:this.context.sampleRate,contextState:this.context.state,held:this.notes.held.size,modules:this.entries.length,baseLatency:this.context.baseLatency??null,outputLatency:this.context.outputLatency??null,receipts:this.receipts};}
}
