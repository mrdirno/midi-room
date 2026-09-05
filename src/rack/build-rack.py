#!/usr/bin/env python3
"""Author: Aldrin Payopay. Assemble the shared DSP rack from pinned local code."""
from pathlib import Path
import json,re

root=Path(__file__).resolve().parents[2]
source=root/'src/rack'
def js(value):
    return json.dumps(value,ensure_ascii=True).replace('<','\\u003c')
def plugin(name,midi=None):
    build=json.loads((source/'vendor'/f'{name}.json').read_text())
    return {'format':'midi-room.plugin/1','id':name,'version':'1.0.0','name':build['card']['name'],'author':build['card']['author'],
      'role':'instrument' if build['metadata']['inputs']==0 else 'effect','engine':{'type':'faust-wasm/1','build':build},
      'midi':midi or {'mode':'none','channel':None},'requirements':['audio-worklet','wasm']}
bloom=plugin('bloom-oscillator',{'mode':'mono','channel':None,'frequency':'/Bloom_Oscillator/frequency'})
drive=plugin('soft-drive')
rack={'format':'midi-room.rack/1','version':1,'name':'DSP Rack','modules':[
    {'instanceId':'bloom-one','plugin':bloom,'values':{},'bypass':False},
    {'instanceId':'drive-one','plugin':drive,'values':{},'bypass':False}]}
scripts='const RACK_RUNTIME_SOURCE='+js((source/'vendor/wasm.js').read_text())+';\nconst RACK_WORKLET_SOURCE='+js((source/'vendor/worklet.js').read_text())+';\nconst RACK_EXAMPLES='+js({'bloom':bloom,'drive':drive})+';\n'
for p in [root/'dist/plugin-contract.js',source/'engine.js',source/'ui.js']:
    code=p.read_text();code=re.sub(r'^import .+;\n','',code,flags=re.M);code=re.sub(r'^export (?=(?:async )?(?:const|function|class)\b)','',code,flags=re.M)
    if re.search(r'^\s*(?:import|export)\s',code,re.M):raise ValueError('Unsupported module: '+str(p))
    scripts+=code+'\n'
scripts=re.sub(r'</script',r'<\\/script',scripts,flags=re.I)
page=(source/'rack.html').read_text().replace('<!--RACK_STATE-->',js(rack)).replace('<!--RACK_SCRIPTS-->','<script>\n'+scripts+'\n</script>')
(root/'dist/instruments/dsp-rack.html').write_text(page)
print('Built shared DSP Rack with pinned Bloom + Soft Drive engines')
