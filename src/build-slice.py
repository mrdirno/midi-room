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
(dist/'instruments').mkdir(parents=True,exist_ok=True)
(dist/'instruments/field-keys.html').write_text((root/'src/surface/field-keys.html').read_text())
subprocess.run([sys.executable,str(root/'src/triton/build-triton.py')],check=True)
if (root/'src/lucky/build-lucky.py').exists(): subprocess.run([sys.executable,str(root/'src/lucky/build-lucky.py')],check=True)
router=(dist/'surface-router.js').read_text()
mapping=router[:router.index('/** Private-port identities')]
mapping=re.sub(r'^export ', '', mapping, flags=re.M)
pad=(root/'src/surface/pad.html').read_text().replace('<!--PAD_SCRIPT-->','<script>\n'+mapping+'\n'+(root/'src/surface/pad.js').read_text()+'\n</script>')
(dist/'instruments/drum-pad.html').write_text(pad)
subprocess.run([sys.executable,str(root/'src/rack/build-rack.py')],check=True)

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
('surfaceModule','surface-router.js','SurfaceRouter,FocusRouter,validateProfile',''),
('pluginModule','plugin-contract.js','extractPlugin,validatePlugin,validateRack,verifyPlugin',''),
('wishConfigModule','wish-config.js','WISH_CONFIG',''),('wishModule','wish.js','bindWishWell','const {WISH_CONFIG}=wishConfigModule;')]:
    script+='const '+name+'='+module(filename,exports,prelude)
    script+='const {'+exports+'}='+name+';\n'
script+=re.sub(r'^import .+;\n','',(dist/'app.js').read_text(),flags=re.M)+'\n})();'
script=re.sub(r'</script',r'<\\/script',script,flags=re.I)
embedded=''
for id,name in [('bundledTriton','triton-rack.html'),('bundledImprovisator','improvisator.html'),('bundledLuckyDreamer','lucky-dreamer.html'),('bundledDrumPad','drum-pad.html'),('bundledFieldKeys','field-keys.html'),('bundledDSPRack','dsp-rack.html')]:
    if not (dist/'instruments'/name).exists(): continue
    encoded=json.dumps((dist/'instruments'/name).read_text(),ensure_ascii=True).replace('<','\\u003c')
    embedded+='<script id="'+id+'" type="application/json">'+encoded+'</script>\n'
page=page.replace('</body>',embedded+'<script>\n'+script+'\n</script>\n</body>')
if re.search(r'<(?:script|link)\b[^>]+(?:src|href)="(?:/|\./)',page):raise ValueError('Portable external dependency')
(dist/'midi-room-local.html').write_text(page)
print('Built independent TRITON, Drum Pad and portable MIDI Room')

subprocess.run([sys.executable,str(root/'src/build-offline.py')],check=True)
