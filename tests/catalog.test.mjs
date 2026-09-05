import test from 'node:test';
import assert from 'node:assert/strict';
import {BUILTINS,instrumentRoute} from '../dist/catalog.js';
test('six canonical routes and hash aliases resolve only the shipped catalog',()=>{
 assert.equal(BUILTINS.length,6);assert.equal(new Set(BUILTINS.map(x=>x.id)).size,6);
 for(const item of BUILTINS){for(const query of ['?instrument=','?plugin=','#instrument=','#plugin='])assert.equal(instrumentRoute('https://host.test/nested/midi-room/'+query+item.id).instrument.id,item.id);assert.equal(new URL('./instruments/'+item.file,'https://host.test/nested/midi-room/').pathname,'/nested/midi-room/instruments/'+item.file);}
 for(const bad of ['../private','https://evil.test','%2Fetc%2Fpasswd','unknown','<script>'])assert.equal(instrumentRoute('https://host.test/midi-room/?instrument='+bad).instrument,null);
 assert.equal(instrumentRoute('file:///tmp/midi-room-local.html#instrument=triton-rack').instrument.id,'triton-rack');assert.equal(instrumentRoute('https://host.test/midi-room/').requested,null);
});
