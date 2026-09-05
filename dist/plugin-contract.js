/* Author: Aldrin Payopay <aldrin.gdf@gmail.com>. MIDI Room plugin intake v1. */
export const PLUGIN_LIMITS = Object.freeze({fileBytes:32*1024*1024,jsonBytes:16*1024*1024,wasmBytes:4*1024*1024,stateBytes:8*1024*1024,heapBytes:16*1024*1024,wasmMaximumBytes:64*1024*1024,parameters:64,modules:8,generators:4,effects:4});
const encoder=new TextEncoder();
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
function assert(ok,message){if(!ok)throw new Error(message);}
function object(v,label){assert(v&&typeof v==='object'&&!Array.isArray(v)&&(Object.getPrototypeOf(v)===Object.prototype||Object.getPrototypeOf(v)===null),label+' must be a JSON object.');return v;}
function string(v,label,max=120){assert(typeof v==='string'&&v.trim()&&v.length<=max,label+' must be a nonempty string of at most '+max+' characters.');return v;}
function id(v,label='Plugin id'){assert(typeof v==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(v),label+' must use 1–64 lowercase letters, numbers or hyphens, starting with a letter.');return v;}
function keys(v,allowed,label){object(v,label);for(const key of Object.keys(v))assert(allowed.includes(key),'Unsupported '+label+' field: '+key+'.');}
function safeJSON(v,max=PLUGIN_LIMITS.jsonBytes){let nodes=0;function visit(x,depth){assert(++nodes<=16000&&depth<=24,'JSON nesting or node budget exceeded.');if(x===null||typeof x==='boolean'||typeof x==='string')return;if(typeof x==='number'){assert(Number.isFinite(x),'JSON numbers must be finite.');return;}assert(typeof x==='object','Only JSON data is accepted.');if(!Array.isArray(x))object(x,'Value');for(const k of Object.keys(x)){assert(!['__proto__','prototype','constructor'].includes(k),'Reserved JSON key: '+k+'.');const d=Object.getOwnPropertyDescriptor(x,k);assert(d&&own(d,'value'),'JSON accessors are unsupported.');visit(d.value,depth+1);}}visit(v,0);const text=JSON.stringify(v);assert(encoder.encode(text).length<=max,'JSON exceeds '+max+' bytes.');return JSON.parse(text);}
function version(v){assert(typeof v==='string'&&/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(v)&&v.length<=64,'Plugin version must be semantic version major.minor.patch.');return v;}
function hash(v,label){assert(typeof v==='string'&&/^[a-f0-9]{64}$/.test(v),label+' must be a lowercase SHA-256 digest.');return v;}
function validateBuild(b){
  keys(b,['format','card','sourceHash','metadata','wasm','nativeC','nativeHeader','hashes','compiler'],'DSP build');
  assert(b.format==='gauntlet.dsp-build/1','Unsupported DSP build format; expected gauntlet.dsp-build/1.');
  keys(b.card,['format','id','name','author','language','source'],'DSP card');
  assert(b.card.format==='gauntlet.dsp-card/1'&&b.card.language==='faust','Expected a Faust gauntlet.dsp-card/1.');
  id(b.card.id,'DSP card id');string(b.card.name,'DSP name');string(b.card.author,'DSP author');string(b.card.source,'DSP source',65536);
  hash(b.sourceHash,'Card identity');string(b.nativeC,'Native C',8*1024*1024);string(b.nativeHeader,'Native header',1024*1024);string(b.compiler,'Compiler',256);
  keys(b.hashes,['source','c','header','wasm'],'DSP hashes');for(const k of ['source','c','header','wasm'])hash(b.hashes[k],k+' hash');
  assert(typeof b.wasm==='string'&&b.wasm.length>0&&b.wasm.length<=Math.ceil(PLUGIN_LIMITS.wasmBytes/3)*4&&b.wasm.length%4===0&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b.wasm),'Wasm must be base64 of at most 4 MiB.');
  const m=object(b.metadata,'DSP metadata');
  assert(Number.isInteger(m.size)&&m.size>0&&m.size<=PLUGIN_LIMITS.stateBytes,'DSP state exceeds 8 MiB or is invalid.');
  assert(Number.isInteger(m.inputs)&&m.inputs>=0&&m.inputs<=2&&Number.isInteger(m.outputs)&&m.outputs>=1&&m.outputs<=2,'Use 0–2 inputs and 1–2 outputs.');
  assert(Array.isArray(m.parameters)&&m.parameters.length<=PLUGIN_LIMITS.parameters,'Use at most 64 controls.');
  const addresses=new Set(),offsets=new Set();
  for(const p of m.parameters){
    keys(p,['id','label','index','varname','min','max','init','step','meta'],'parameter');
    assert(typeof p.id==='string'&&/^\/[A-Za-z0-9_./ -]{1,255}$/.test(p.id)&&!addresses.has(p.id),'Duplicate or invalid parameter address.');addresses.add(p.id);
    string(p.label,'Control label');
    assert(Number.isInteger(p.index)&&p.index>=0&&p.index%4===0&&p.index+4<=m.size&&!offsets.has(p.index),'Duplicate, unaligned or out-of-state parameter offset.');offsets.add(p.index);
    assert([p.min,p.max,p.init,p.step].every(Number.isFinite)&&p.min<p.max&&p.min<=p.init&&p.init<=p.max&&p.step>0&&p.step<=p.max-p.min,'Invalid parameter bounds: '+p.id+'.');
    if(p.meta!==undefined){object(p.meta,'Parameter metadata');assert(Object.keys(p.meta).length<=32,'Too many parameter metadata keys.');for(const [k,v]of Object.entries(p.meta)){string(k,'Metadata key',128);string(v,'Metadata value',512);}}
  }
  assert(Array.isArray(m.ui),'DSP metadata.ui must be an array.');let count=0;const seen=new Set();
  function walk(items,depth){assert(depth<=12,'DSP UI nesting exceeds 12 levels.');for(const item of items){assert(++count<=256,'DSP UI exceeds 256 nodes.');object(item,'UI item');if(['vgroup','hgroup','tgroup'].includes(item.type)){assert(Array.isArray(item.items),'UI groups need items.');walk(item.items,depth+1);continue;}
    assert(['hslider','vslider','nentry','button','checkbox'].includes(item.type),'Unsupported Faust UI item: '+item.type+'.');
    assert(!seen.has(item.address),'Duplicate UI control address.');seen.add(item.address);const p=m.parameters.find(p=>p.id===item.address);assert(p&&p.index===item.index,'UI address/offset does not match parameters.');
    const button=item.type==='button'||item.type==='checkbox';assert(p.min===(button?0:item.min)&&p.max===(button?1:item.max)&&p.init===(button?0:item.init)&&p.step===(button?1:item.step),'UI bounds do not match parameters: '+p.id+'.');
  }}walk(m.ui,0);assert(seen.size===m.parameters.length,'Every parameter must have exactly one UI control.');
  return b;
}
export function validateValues(parameters,values={}){object(values,'Parameter values');const result={};for(const [k,v]of Object.entries(values)){const p=parameters.find(p=>p.id===k);assert(p,'Unknown parameter: '+k+'.');assert(Number.isFinite(v)&&v>=p.min&&v<=p.max,'Out-of-range parameter: '+k+'.');result[k]=v;}return result;}
export function validatePlugin(value){
  const v=safeJSON(value);keys(v,['format','id','version','name','role','engine','midi','audio','controls','requirements','author','license','description','legacy'],'plugin');
  assert(v.format==='midi-room.plugin/1','Unsupported plugin format; expected midi-room.plugin/1.');
  id(v.id);version(v.version);string(v.name,'Plugin name');assert(['instrument','effect','hybrid','controller'].includes(v.role),'Unsupported plugin role.');
  keys(v.engine,['type','build'],'engine');assert(['faust-wasm/1','html-sandbox/1'].includes(v.engine.type),'Unsupported engine: '+v.engine.type+'. Native VST/AU/C and FPGA modules require an explicit adapter.');
  const result={format:v.format,id:v.id,version:v.version,name:v.name,role:v.role,engine:v.engine};
  for(const k of ['author','license','description'])if(v[k]!==undefined)result[k]=string(v[k],k,k==='description'?1024:120);
  const requirements=v.requirements??[];assert(Array.isArray(requirements)&&requirements.length<=8,'Requirements must be an array of at most eight names.');for(const r of requirements)assert(['audio-worklet','wasm','web-midi','midi-room-control/1'].includes(r),'Unsupported required capability: '+r+'.');assert(new Set(requirements).size===requirements.length,'Duplicate required capability.');result.requirements=requirements;
  const midi=v.midi??{mode:'none',channel:null};keys(midi,['mode','channel','frequency','gate'],'MIDI');assert(midi.channel===null||(Number.isInteger(midi.channel)&&midi.channel>=0&&midi.channel<=15),'MIDI channel must be null (omni) or zero-based 0–15.');
  if(v.engine.type==='faust-wasm/1'){
    const b=validateBuild(v.engine.build),m=b.metadata;assert(v.role!=='controller','A Faust DSP module cannot have the controller role.');assert(v.role!=='effect'||m.inputs>0,'Effects need audio input.');assert(v.role!=='instrument'||m.inputs===0,'An instrument with audio input must declare the hybrid role.');
    result.audio={inputs:m.inputs,outputs:m.outputs,routing:'shared-rack'};result.controls=m.parameters.map(p=>({...p}));
    assert(['none','mono'].includes(midi.mode),'Faust MIDI mode must be none or mono.');
    if(midi.mode==='mono'){
      assert(m.inputs===0,'Mono MIDI voices must be generators with zero audio inputs.');const frequency=m.parameters.find(p=>p.id===midi.frequency);assert(frequency&&frequency.min>0,'Mono MIDI requires an explicit positive frequency parameter address.');
      if(midi.gate!==undefined){const gate=m.parameters.find(p=>p.id===midi.gate);assert(gate&&gate.min<=0&&gate.max>=1&&midi.gate!==midi.frequency,'Gate must be a distinct parameter accepting 0 and 1.');}
    }else assert(midi.frequency===undefined&&midi.gate===undefined,'MIDI parameter mappings require mono mode.');
  }else{
    assert(v.engine.build===undefined,'HTML sandbox descriptors cannot contain a DSP build.');assert(['none','web-midi'].includes(midi.mode),'HTML MIDI mode must be none or web-midi.');assert(midi.frequency===undefined&&midi.gate===undefined,'HTML MIDI uses messages, not host parameter offsets.');
    result.audio={routing:v.role==='controller'?'none':'isolated'};result.controls=[];
    if(v.legacy!==undefined){assert(v.legacy===true,'Legacy flag must be true.');result.legacy=true;}
  }
  if(v.audio!==undefined)assert(Object.keys(v.audio).length===Object.keys(result.audio).length&&Object.entries(result.audio).every(([k,x])=>v.audio[k]===x),'Declared audio capability disagrees with the engine.');
  if(v.controls!==undefined)assert(JSON.stringify(v.controls)===JSON.stringify(result.controls),'Controls must exactly match the compiled DSP metadata; bounds cannot be overridden.');
  result.midi={...midi};return result;
}
export function createPluginFromBuild(build,options={}){const b=validateBuild(safeJSON(build));keys(options,['id','version','name','role','midi'],'build adapter options');return validatePlugin({format:'midi-room.plugin/1',id:options.id??b.card.id,version:options.version??'1.0.0',name:options.name??b.card.name,author:b.card.author,role:options.role??(b.metadata.inputs===0?'instrument':'effect'),engine:{type:'faust-wasm/1',build:b},midi:options.midi??{mode:'none',channel:null},requirements:['audio-worklet','wasm']});}
function scripts(source,idValue){return [...source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].filter(m=>new RegExp('(?:^|\\s)id\\s*=\\s*["\']'+idValue+'["\']','i').test(m[1])).map(m=>{assert(/(?:^|\s)type\s*=\s*["']application\/json["']/i.test(m[1]),idValue+' must use type="application/json".');return m[2];});}
export function extractPlugin(source,filename='plugin.json'){
  assert(typeof source==='string'&&encoder.encode(source).length<=PLUGIN_LIMITS.fileBytes,'Choose a file at most 32 MiB.');
  const trimmed=source.trim();if(trimmed.startsWith('{')){assert(encoder.encode(source).length<=PLUGIN_LIMITS.jsonBytes,'Plugin JSON exceeds 16 MiB.');const v=JSON.parse(source);return v.format==='gauntlet.dsp-build/1'?createPluginFromBuild(v):validatePlugin(v);}
  assert(/\.html?$/i.test(filename)||/^<!doctype\s+html|^<html\b/i.test(trimmed),'Unsupported file. Choose a plugin/rack JSON or self-contained HTML. Native code requires an adapter.');
  const manifests=scripts(source,'midi-room-plugin'),builds=scripts(source,'dsp-build');assert(manifests.length<=1&&builds.length<=1,'Duplicate embedded plugin/build declarations.');
  if(manifests.length){assert(builds.length===0,'Use one authoritative plugin declaration; do not also embed dsp-build.');return validatePlugin(JSON.parse(manifests[0]));}
  if(builds.length)return createPluginFromBuild(JSON.parse(builds[0]));
  const stem=filename.split(/[\\/]/).pop().replace(/\.html?$/i,'').toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,55);
  return validatePlugin({format:'midi-room.plugin/1',id:'legacy-'+(stem||'instrument'),version:'0.0.0',name:filename.split(/[\\/]/).pop().slice(0,120)||'Legacy HTML',role:'instrument',engine:{type:'html-sandbox/1'},midi:{mode:'none',channel:null},legacy:true,description:'Legacy HTML: no declared contract. MIDI and sound behavior need a sandbox compatibility test.'});
}
export function validateRack(value){
  const v=safeJSON(value);keys(v,['format','version','name','modules'],'rack');assert(v.format==='midi-room.rack/1'&&v.version===1,'Unsupported rack version; expected midi-room.rack/1 version 1.');string(v.name,'Rack name');assert(Array.isArray(v.modules)&&v.modules.length<=PLUGIN_LIMITS.modules,'Use at most eight rack modules.');
  const ids=new Set();let generators=0,effects=0;const modules=v.modules.map(item=>{keys(item,['instanceId','plugin','values','bypass'],'rack module');id(item.instanceId,'Instance id');assert(!ids.has(item.instanceId),'Duplicate rack instance id.');ids.add(item.instanceId);const plugin=validatePlugin(item.plugin);assert(plugin.engine.type==='faust-wasm/1','HTML/controller plugins run in isolated sandboxes and cannot join the shared DSP audio rack.');if(plugin.audio.inputs===0){generators++;assert(effects===0,'List generators before effects: generators mix, then effects process serially.');}else effects++;assert(item.bypass===undefined||typeof item.bypass==='boolean','Bypass must be boolean.');return {instanceId:item.instanceId,plugin,values:validateValues(plugin.controls,item.values??{}),bypass:item.bypass??false};});
  assert(generators<=PLUGIN_LIMITS.generators&&effects<=PLUGIN_LIMITS.effects,'Use at most four generators and four effects.');return{format:v.format,version:1,name:v.name,modules};
}
function wasmBytes(base64){const binary=atob(base64),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);assert(bytes.length<=PLUGIN_LIMITS.wasmBytes,'Wasm exceeds 4 MiB.');return bytes;}
async function digest(value){const bytes=typeof value==='string'?encoder.encode(value):value;return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');}
function checkWasmSections(bytes){
  assert(bytes.length>=8&&[0,97,115,109,1,0,0,0].every((n,i)=>bytes[i]===n),'Expected WebAssembly binary version 1.');let at=8,memoryCount=0;
  function uint(end){let value=0,shift=0;for(let i=0;i<5;i++){assert(at<end,'Truncated Wasm integer.');const byte=bytes[at++];assert(i<4||(byte&240)===0,'Wasm integer overflow.');value+=(byte&127)*2**shift;if(!(byte&128))return value;shift+=7;}throw Error('Invalid Wasm integer.');}
  while(at<bytes.length){const section=bytes[at++],length=uint(bytes.length),end=at+length;assert(end<=bytes.length,'Truncated Wasm section.');assert(section!==8,'Wasm start functions are unsupported; initialization belongs to the audio runtime.');if(section===5){memoryCount=uint(end);assert(memoryCount===1,'Use exactly one internal Wasm memory.');const flags=uint(end);assert(flags===0||flags===1,'Shared or 64-bit Wasm memory is unsupported.');const initial=uint(end),maximum=flags===1?uint(end):null;assert(initial>0&&initial<=256&&maximum!==null&&maximum>=initial&&maximum<=1024,'Wasm memory needs an explicit maximum at most 64 MiB and initial memory at most 16 MiB.');assert(at===end,'Unexpected Wasm memory declaration.');}at=end;}
  assert(memoryCount===1,'The Faust adapter needs one internal Wasm memory.');
}
export async function verifyPlugin(value){
  const plugin=validatePlugin(value);if(plugin.engine.type==='html-sandbox/1')return{format:'midi-room.compatibility/1',pluginId:plugin.id,pluginVersion:plugin.version,engine:plugin.engine.type,status:plugin.legacy?'legacy-unverified':'declared',rackCompatible:false,hashes:{},checks:['Descriptor parsed without executing HTML'],limitations:['HTML behavior and audio/MIDI need sandbox tests; audio remains isolated.']};
  const b=plugin.engine.build,bytes=wasmBytes(b.wasm),checks={source:b.card.source,c:b.nativeC,header:b.nativeHeader,wasm:bytes};const hashes={};for(const [key,data]of Object.entries(checks)){hashes[key]=await digest(data);assert(hashes[key]===b.hashes[key],'SHA-256 mismatch: '+key+'.');}
  const canonicalCard={format:b.card.format,id:b.card.id,name:b.card.name,author:b.card.author,language:b.card.language,source:b.card.source};assert(await digest(JSON.stringify(canonicalCard))===b.sourceHash,'SHA-256 mismatch: card identity.');
  checkWasmSections(bytes);const module=await WebAssembly.compile(bytes),imports=WebAssembly.Module.imports(module),exports=WebAssembly.Module.exports(module);
  const math=new Set(['abs','acos','asin','atan','atan2','ceil','cos','cosh','exp','exp2','exp10','floor','fmod','log','log10','log2','max','min','pow','round','sin','sinh','sqrt','tan','tanh','trunc','copysign']);
  assert(imports.length<=64,'Too many Wasm imports.');for(const i of imports)assert(i.module==='env'&&i.kind==='function'&&math.has(i.name.replace(/^_/,'').replace(/f$/,'')),'Unsupported Wasm import: '+i.module+'.'+i.name+'.');
  for(const name of ['compute','getNumInputs','getNumOutputs','getParamValue','getSampleRate','init','instanceClear','instanceConstants','instanceInit','instanceResetUserInterface','setParamValue'])assert(exports.some(e=>e.name===name&&e.kind==='function'),'Missing Faust Wasm export: '+name+'.');assert(exports.some(e=>e.name==='memory'&&e.kind==='memory'),'Missing Wasm memory export.');
  return{format:'midi-room.compatibility/1',pluginId:plugin.id,pluginVersion:plugin.version,engine:plugin.engine.type,status:'artifact-verified',rackCompatible:true,hashes,checks:['Source, C, header, Wasm and card identity hashes match','Bounded metadata and supported Wasm ABI','Wasm compiled without instantiation'],wasm:{bytes:bytes.length,imports,exports},limitations:['Hashes establish artifact identity, not trust, DSP correctness or real-time safety.','No audio render, MIDI behavior, timing or native/FPGA parity was measured by intake.','Run only reviewed DSP: a worklet isolates audio execution but cannot guarantee deadlines for hostile or pathological code.']};
}
