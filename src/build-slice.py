#!/usr/bin/env python3
"""Author: Aldrin Payopay. Build independent instruments and portable MIDI Room."""
from pathlib import Path
import base64
import json
import re
import subprocess
import sys

root=Path(__file__).resolve().parents[1]
dist=root/'dist'
def canonical_surface(page, instrument):
    if page.count('<head>')!=1:raise ValueError('Expected one surface document head: '+instrument)
    return page.replace('<head>', '<head>\n<link rel="canonical" href="https://persona500.com/midi-room/instruments/'+instrument+'.html">',1)
(dist/'instruments').mkdir(parents=True,exist_ok=True)
(dist/'instruments/field-keys.html').write_text(canonical_surface((root/'src/surface/field-keys.html').read_text(),'field-keys'))
subprocess.run([sys.executable,str(root/'src/triton/build-triton.py')],check=True)
if (root/'src/lucky/build-lucky.py').exists(): subprocess.run([sys.executable,str(root/'src/lucky/build-lucky.py')],check=True)
router=(dist/'surface-router.js').read_text()
mapping=router[:router.index('/** Private-port identities')]
mapping=re.sub(r'^export ', '', mapping, flags=re.M)
pad=(root/'src/surface/pad.html').read_text().replace('<!--PAD_SCRIPT-->','<script>\n'+mapping+'\n'+(root/'src/surface/pad.js').read_text()+'\n</script>')
(dist/'instruments/drum-pad.html').write_text(canonical_surface(pad,'drum-pad'))
subprocess.run([sys.executable,str(root/'src/rack/build-rack.py')],check=True)
for instrument in ['triton-rack','improvisator','lucky-dreamer','drum-pad','field-keys','dsp-rack']:
    head=(dist/'instruments'/f'{instrument}.html').read_text().split('</head>',1)[0]
    canonical=f'<link rel="canonical" href="https://persona500.com/midi-room/instruments/{instrument}.html">'
    if head.count('rel="canonical"')!=1 or canonical not in head:
        raise ValueError('Standalone canonical missing or ambiguous: '+instrument)

def module(filename,exports,prelude=''):
    source=(dist/filename).read_text()
    source=re.sub(r'^import .+;\n','',source,flags=re.M)
    source=re.sub(r'^export (?=(?:async )?(?:const|function|class)\b)','',source,flags=re.M)
    if re.search(r'^\s*(?:import|export)\s',source,re.M):raise ValueError('Unsupported module: '+filename)
    return '(function(){\n'+prelude+'\n'+source+'\nreturn {'+exports+'};\n})();\n'

page=(dist/'index.html').read_text().replace('data-default-instrument="catalog"','data-default-instrument="triton" data-portable="true"').replace('href="./"','href="#"')
icon=base64.b64encode((dist/'icon.svg').read_bytes()).decode()
page=page.replace('href="./icon.svg"',f'href="data:image/svg+xml;base64,{icon}"').replace('  <link rel="manifest" href="./manifest.webmanifest">\n','').replace('  <link rel="apple-touch-icon" href="./icon-192.png">\n','').replace('  <link rel="stylesheet" href="./style.css">','<style>\n'+(dist/'style.css').read_text()+'\n</style>').replace('  <script type="module" src="./app.js"></script>\n','')
script='(function(){\n"use strict";\n'
for name,filename,exports,prelude in [
('catalogModule','catalog.js','BUILTINS,instrumentRoute',''),
('midiModule','midi.js','MidiBroker',''),('bridgeModule','bridge.js','bootstrapSource',''),
('loaderModule','loader.js','INSTRUMENT_SANDBOX,LoadSequence,prepareInstrument,safeFilename,validateInstrument','const {bootstrapSource}=bridgeModule;'),
('busModule','instrument-bus.js','InstrumentBus,validateInstrumentEvent',''),
('instrumentMapModule','instrument-map.js','MAP_FORMAT,busTranslator,describeRoute,resolveSlot,translateMIDI,validateInstrumentMap',''),
('surfaceModule','surface-router.js','SurfaceRouter,FocusRouter,validateProfile',''),
('pluginModule','plugin-contract.js','extractPlugin,validatePlugin,validateRack,verifyPlugin',''),
('wishConfigModule','wish-config.js','WISH_CONFIG',''),('wishModule','wish.js','bindWishWell','const {WISH_CONFIG}=wishConfigModule;')]:
    script+='const '+name+'='+module(filename,exports,prelude)
    script+='const {'+exports+'}='+name+';\n'
script+='globalThis.INSTRUMENT_MAP_MODULE=instrumentMapModule;\n'+re.sub(r'^import .+;\n','',(dist/'app.js').read_text(),flags=re.M)+'\n})();'
script=re.sub(r'</script',r'<\\/script',script,flags=re.I)
embedded='<script id="instrumentMap" type="application/json">'+json.dumps(json.loads((dist/'instrument-map.json').read_text()),ensure_ascii=True).replace('<','\\u003c')+'</script>\n'
for id,name in [('bundledTriton','triton-rack.html'),('bundledImprovisator','improvisator.html'),('bundledLuckyDreamer','lucky-dreamer.html'),('bundledDrumPad','drum-pad.html'),('bundledFieldKeys','field-keys.html'),('bundledDSPRack','dsp-rack.html')]:
    if not (dist/'instruments'/name).exists(): continue
    encoded=json.dumps((dist/'instruments'/name).read_text(),ensure_ascii=True).replace('<','\\u003c')
    embedded+='<script id="'+id+'" type="application/json">'+encoded+'</script>\n'
page=page.replace('</body>',embedded+'<script>\n'+script+'\n</script>\n</body>')
if re.search(r'<(?:script|link)\b[^>]+(?:src|href)="(?:/|\./)',page):raise ValueError('Portable external dependency')
(dist/'midi-room-local.html').write_text(page)
print('Built independent TRITON, Drum Pad and portable MIDI Room')

subprocess.run([sys.executable,str(root/'src/build-offline.py')],check=True)
