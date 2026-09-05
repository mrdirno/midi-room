#!/usr/bin/env python3
"""Aldrin Payopay — reproducible, counted repairs of the exact TRITON16 handoff."""
from pathlib import Path
import hashlib
import json
import re

root = Path(__file__).resolve().parent
project = root.parent.parent
source = root / 'inherited-runtime.html'
provenance = json.loads((root / 'inherited-runtime.provenance.json').read_text())
raw = source.read_bytes()
assert hashlib.sha256(raw).hexdigest() == provenance['public_sha256'], 'Inherited runtime changed; review provenance before building'
html = raw.decode()
patches = []

def replace(old, new, count=1):
    global html
    found = html.count(old)
    if found != count:
        raise RuntimeError(f'Expected {count}, found {found}: {old[:110]}')
    html = html.replace(old, new)
    patches.append({'anchor': old[:110], 'count': count})

replace('let activeVoices=0, voiceList=[]', (root/'transport.js').read_text()+'\nlet activeVoices=0, voiceList=[]')
replace('state.tempo=Math.min(240,Math.max(40,state.tempo+d));', 'TritonTransport.set(Math.min(240,Math.max(40,state.tempo+d)),{reason:"rack tempo control"});')
replace('if(!dreaming) state.tempo=cur.tempo||100;', 'TritonTransport.preference(cur.tempo||100,"factory patch preference");', 2)
replace('state.tempo=cur.tempo||100;', 'TritonTransport.preference(cur.tempo||100,"user patch preference");')
replace('state.tempo=(typeof p.tempo==="number"&&isFinite(p.tempo))? p.tempo : (state.tempo||100);', 'TritonTransport.preference(p.tempo,"Dream song preference");')
replace('if(cur.arpDefault && !dreaming){ Object.assign(state.arp,cur.arpDefault); }\n  else if(!dreaming){ state.arp.on=false; }', '/* Patch preferences never arm or disarm the live arpeggiator. */')
replace('state.arp.on=false; latchSet.clear();\n  syncLeds(); if(dreaming', 'latchSet.clear();\n  syncLeds(); if(dreaming')
replace('if(cur.arpDefault){ Object.assign(state.arp,cur.arpDefault); } else { state.arp.on=false; }', '/* User patches preserve the explicit arpeggiator state too. */')

# Tempo expression is retained in note microtiming and velocity, with a fixed
# bar clock in both implementations (SoulComposer is the active constructor).
replace('bar.bpm = clamp(this.settings.bpm * (1 + shape * this.settings.humanize), 34, 132);', 'bar.bpm = this.settings.bpm; /* transport owns BPM; expression stays in notes */')
replace('bar.bpm=clamp(this.settings.bpm*(1+shape*this.settings.humanize),34,132);', 'bar.bpm=this.settings.bpm; /* transport owns BPM; expression stays in notes */')
replace('var settings=Object.assign({},K.PRESETS.reference,K.LOCKED_PERFORMANCE||{});', 'var settings=Object.assign({},K.PRESETS.reference,K.LOCKED_PERFORMANCE||{},{bpm:state.tempo});')
replace('id="spTempo" type="range" min="34" max="132" value="132"', 'id="spTempo" type="range" min="40" max="240" value="132"')
replace('state.tempo=+bar.bpm.toFixed(2);', '/* A planned bar cannot write shared tempo. */')
replace('settings.mode=p.mode;Object.assign(settings,K.LOCKED_PERFORMANCE||K.PRESETS.reference);', 'settings.mode=p.mode; /* Harmonic character retains tempo and performance controls. */')
replace('settings[key]=isBpm?v:v/100;', 'if(isBpm){TritonTransport.set(v,{reason:"Soul tempo control"});return;}settings[key]=v/100;')
replace('function soulStart(fresh){\n', 'function soulStart(fresh){\n  if(SP.on)return true; /* Proven donor fix: one scheduler per conductor. */\n  SP.startRequest=(SP.startRequest||0)+1;SP.startPending=false;\n')
replace('function soulStop(silent){\n', 'function soulStop(silent){\n  SP.startRequest=(SP.startRequest||0)+1;SP.startPending=false;\n')
replace("if(SP.on){soulStop(false);return;}\n  if(ctx&&ctx.state==='suspended'&&ctx.resume){ctx.resume().then(function(){soulStart(false);});return;}", "if(SP.on||SP.startPending){soulStop(false);return;}\n  if(ctx&&ctx.state==='suspended'&&ctx.resume){var request=(SP.startRequest||0)+1;SP.startRequest=request;SP.startPending=true;ctx.resume().then(function(){if(SP.startRequest===request&&SP.startPending)soulStart(false);},function(ex){if(SP.startRequest===request){SP.startPending=false;setStatus('Audio paused: '+ex.message);}});return;}")
replace("spawnVoice(p,e.pitch,vel,when,dur,SP.pans[role]);SP.diagnostics.notes++;", "var voice=spawnVoice(p,e.pitch,vel,when,dur,SP.pans[role]);if(voice){voice._conductor='soul';}SP.diagnostics.notes++;")
replace("allNotesOff();if(typeof takeStop==='function')takeStop();\n  if(typeof TAKE", "voiceList.slice().forEach(function(v){if(v._conductor==='soul'&&v.kill)v.kill();});if(typeof takeStop==='function')takeStop();\n  if(typeof TAKE")
replace('SP.selfTest=function(){', '''SP.start=soulStart;SP.stop=soulStop;SP.toggle=toggle;SP.chooseCharacter=applyCharacter;SP.chooseScene=selectScene;SP.refreshAudio=applySoulFX;
SP.retime=function(){settings.bpm=state.tempo;if(SP.composer){SP.composer.updateSettings(settings);if(SP.composer.pending)SP.composer.pending.length=0;}
  if(SP.on){SP.generation++;voiceList.slice().forEach(function(v){if(v._conductor==='soul'&&v.kill)v.kill();});SP.clock.stop();SP.clock.start(ctx.currentTime);tick();}syncControls();};
TritonTransport.subscribe(SP.retime);
SP.selfTest=function(){''')

# Adopt the donor's narrowly justified sound-source cancellation repair.
# Sources capture their creation context; live/offline context swaps cannot
# retime an old source. Stop must silence future notes before their onset.
replace('const t=Math.max(when,ctx.currentTime), out=ctx.createGain(); out.gain.value=0;', 'const voiceCtx=ctx,t=Math.max(when,ctx.currentTime),out=ctx.createGain();out.gain.value=0;')
replace('const stops=[], nodes=[];', 'const stops=[],transients=[],nodes=[];')
replace('g.connect(f1); s.start(t); s.stop(t+.3);', 'g.connect(f1); s.start(t); s.stop(t+.3);transients.push(s);')
replace('g.connect(f1); s.start(t); s.stop(t+.1);', 'g.connect(f1); s.start(t); s.stop(t+.1);transients.push(s);')
replace('const n0=Math.max(ctx.currentTime,t); holdEnv(n0);\n    out.gain.setTargetAtTime(0.0001,n0,.02);\n    stops.forEach(s=>{try{s.stop(n0+.12);}catch(e){}});', '''const n0=voiceCtx.currentTime;
    if(n0<t){out.gain.cancelScheduledValues(n0);out.gain.setValueAtTime(0,n0);stops.concat(transients).forEach(s=>{try{s.stop(n0);}catch(e){}});}
    else{holdEnv(n0);out.gain.setTargetAtTime(0.0001,n0,.02);stops.concat(transients).forEach(s=>{try{s.stop(n0+.12);}catch(e){}});}''')
replace('const r=Math.max(.03,prog.aEG.r), tr=Math.max(rt||ctx.currentTime,ctx.currentTime);', 'if(voiceCtx.currentTime<t&&(!rt||rt<t)){v.kill();return;}\n    const r=Math.max(.03,prog.aEG.r), tr=Math.max(rt||voiceCtx.currentTime,voiceCtx.currentTime);')
replace('Math.max(0,(st-ctx.currentTime)*1000)+80);', 'Math.max(0,(st-voiceCtx.currentTime)*1000)+80);')
replace('const v={units,note,t,killed:false,oscs:oscRefs,baseHz,lgP,lfoP:prog.lfo.pitch,_take:_tk||null};', 'const v={units,note,t,killed:false,oscs:oscRefs,baseHz,lgP,lfoP:prog.lfo.pitch,_take:_tk||null,_off:(typeof exporting!=="undefined"&&exporting)};')
replace('if(prog.cat==="DRUMS"){ drumHit(note,vel,when,prog.kit||"std"); return null; }', 'if(prog.cat==="DRUMS"){return drumHit(note,vel,when,prog.kit||"std");}')
a=html.index('function drumHit(note,vel,when,kit){')
b=html.index('\n</script>',a)
drums=html[a:b]
drums=drums.replace('const t=Math.max(when,ctx.currentTime), k=((note%12)+12)%12, o=drumOut();', "const sourceCtx=ctx,sources=[],t=Math.max(when,ctx.currentTime),k=((note%12)+12)%12,o=ctx.createGain();o.connect(drumOut());\n  function tracked(method){const node=sourceCtx[method]();sources.push(node);return node;}")
drums=drums.replace('ctx.createOscillator()',"tracked('createOscillator')").replace('ctx.createBufferSource()',"tracked('createBufferSource')")
drums=drums.replace('v.kill=()=>{ if(!v.killed){ v.killed=true; unreg(v); } };', 'v.kill=()=>{if(!v.killed){v.killed=true;o.gain.cancelScheduledValues(sourceCtx.currentTime);o.gain.setValueAtTime(0,sourceCtx.currentTime);sources.forEach(s=>{try{s.stop(sourceCtx.currentTime);}catch(_){}});unreg(v);}};')
drums=drums.replace('setTimeout(v.kill,1400)', 'setTimeout(v.kill,Math.max(2200,(t-sourceCtx.currentTime)*1000+2200))')
drums=drums.replace('pulseAt(when); return;', 'pulseAt(when); return v;').replace('  pulseAt(when);\n}', '  pulseAt(when); return v;\n}')
html=html[:a]+drums+html[b:]
replace('const v={units:1,t,killed:false};\n  v.kill=()=>{ if(!v.killed){ v.killed=true; unreg(v); } };', '''const v={units:1,t,killed:false,_ctx:ctx};
  v.kill=()=>{if(!v.killed){v.killed=true;
    try{g.gain.cancelScheduledValues(v._ctx.currentTime);g.gain.setValueAtTime(0,v._ctx.currentTime);src.stop(v._ctx.currentTime);}catch(_){}
    unreg(v);}};''',3)

# Replace eager, unscoped Web MIDI ownership with the same route-aware API
# used by the host. Connection is only requested by a real button gesture.
a=html.index('/* ---- Web MIDI in: notes, bend, mod wheel, sustain pedal ---- */')
b=html.index('/*EXPORT-UTILS-BEGIN*/',a)
html=html[:a]+'/* Web MIDI ownership is installed by triton-runtime below. */\n\n'+html[b:]
replace('</head>', '<style>'+ (root/'runtime.css').read_text()+'</style>\n</head>')
replace('<body class="soulMode">', '<body class="soulMode">\n'+(root/'runtime.html').read_text())
extra=(root/'runtime.js').read_text()
adapter=root/'room-target.js'
if adapter.exists(): extra+='\n'+adapter.read_text()
replace('</body>', '<script id="triton-runtime">\n'+extra+'\n</script>\n</body>')
# Keyboard input belongs to instruments, never to text fields or dialogs.
replace('if(e.repeat||e.metaKey||e.ctrlKey||e.altKey) return;', 'if(e.repeat||e.metaKey||e.ctrlKey||e.altKey||e.target.closest?.("input,textarea,select,[contenteditable=true],dialog[open]")) return;')
html=html.replace('ctx.state==="suspended"','(ctx.state==="suspended"||ctx.state==="interrupted")').replace("ctx.state==='suspended'","(ctx.state==='suspended'||ctx.state==='interrupted')")
# Keep source notes in the repository, not in the public instrument document.
html=re.sub(r'<!--(?!\[if)[\s\S]*?-->', '', html)
html=html.replace('</head>','<style>'+(root/'views.css').read_text()+'</style></head>')
html=re.sub(r'<title>.*?</title>', '<title>TRITON Rack · MIDI Room</title>', html,count=1)
out=project/'dist/instruments/triton-rack.html'
out.parent.mkdir(parents=True,exist_ok=True)
html=html.replace('<body class="soulMode">','<body class="soulMode engineOpen" data-instrument="triton-rack">')
out.write_text(html)
improvisator=html.replace('<body class="soulMode engineOpen" data-instrument="triton-rack">','<body class="soulMode" data-instrument="improvisator">').replace('<title>TRITON Rack · MIDI Room</title>','<title>Improvisator · MIDI Room</title>').replace('<h1>KORG TRITON-Rack</h1>','<h1>Improvisator ∞</h1>').replace('<strong>TRITON Rack</strong>','<strong>Improvisator</strong>')
(project/'dist/instruments/improvisator.html').write_text(improvisator)
proof={'originalSourceSha256':provenance['original_sha256'],'source':source.name,'sourceSha256':hashlib.sha256(raw).hexdigest(),'artifact':str(out.relative_to(project)), 'artifactSha256':hashlib.sha256(out.read_bytes()).hexdigest(),'bytes':out.stat().st_size,'countedPatches':patches,'donorChanges':['idempotent Soul start','cancel future pitched/drum source audio, including transients'],'notAdopted':['Ensemble conductor','Ensemble sound defaults','LiveKeys UI','unverified history claims']}
(project/'verification').mkdir(exist_ok=True)
(project/'verification/triton-build.json').write_text(json.dumps(proof,indent=2)+'\n')
print(f'Built {out}: {out.stat().st_size} bytes')
