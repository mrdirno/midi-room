/* Author: Aldrin Payopay <aldrin.gdf@gmail.com>. Shared offline/worklet Wasm engine. */
(function(root) {
  'use strict';
  class CardRuntime {
    constructor(module, metadata, rate, capacity=2048) {
      if (!Number.isInteger(capacity)||capacity<1||capacity>8192) throw Error('Block capacity must be 1–8192.');
      if (!Number.isInteger(rate)||rate<8000||rate>192000) throw Error('Sample rate must be 8000–192000.');
      const math = {abs:Math.abs,acos:Math.acos,asin:Math.asin,atan:Math.atan,atan2:Math.atan2,ceil:Math.ceil,cos:Math.cos,cosh:Math.cosh,exp:Math.exp,exp2:x=>2**x,exp10:x=>10**x,floor:Math.floor,fmod:(a,b)=>a%b,log:Math.log,log10:Math.log10,log2:Math.log2,max:Math.max,min:Math.min,pow:Math.pow,round:x=>x<0?-Math.round(-x):Math.round(x),sin:Math.sin,sinh:Math.sinh,sqrt:Math.sqrt,tan:Math.tan,tanh:Math.tanh,trunc:Math.trunc,copysign:(a,b)=>Math.abs(a)*(b<0||Object.is(b,-0)?-1:1)};
      const env = {};
      for (const item of WebAssembly.Module.imports(module)) {
        const name=item.name.replace(/^_/,'').replace(/f$/,'');
        if (item.module!=='env'||item.kind!=='function'||!Object.hasOwn(math,name)) throw Error('Unsupported Wasm import: '+item.module+'.'+item.name);
        env[item.name]=math[name];
      }
      this.api = new WebAssembly.Instance(module,{env}).exports;
      this.metadata=metadata;this.capacity=capacity;
      const aligned=(metadata.size+15)&~15;
      this.ins=aligned;this.outs=this.ins+metadata.inputs*4;
      let at=this.outs+metadata.outputs*4;
      const needed=at+(metadata.inputs+metadata.outputs)*capacity*4;
      if (needed>16*1024*1024) throw Error('Audio heap exceeds 16 MiB.');
      const pages=Math.ceil(needed/65536)-this.api.memory.buffer.byteLength/65536;
      if (pages>0) this.api.memory.grow(pages);
      this.heap=new Int32Array(this.api.memory.buffer);
      this.inputs=[];this.outputs=[];
      for (let i=0;i<metadata.inputs;i++){this.heap[(this.ins>>2)+i]=at;this.inputs.push(new Float32Array(this.api.memory.buffer,at,capacity));at+=capacity*4;}
      for (let i=0;i<metadata.outputs;i++){this.heap[(this.outs>>2)+i]=at;this.outputs.push(new Float32Array(this.api.memory.buffer,at,capacity));at+=capacity*4;}
      this.api.init(0,rate);
    }
    set(index,value) { this.api.setParamValue(0,index,value); }
    reset() { this.api.instanceClear(0); }
    compute(frames) {
      if (!Number.isInteger(frames)||frames<1||frames>this.capacity) throw Error('Unsupported block size.');
      this.api.compute(0,frames,this.ins,this.outs);
    }
  }
  root.CardRuntime=CardRuntime;
})(globalThis);
