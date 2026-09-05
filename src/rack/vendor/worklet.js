/* Author: Aldrin Payopay <aldrin.gdf@gmail.com>. No allocations in process(). */
class DspCardProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() { return CARD_PARAMETERS.map((p,i)=>({name:'p'+i,defaultValue:p.init,minValue:p.min,maxValue:p.max,automationRate:'k-rate'})); }
  constructor(options) {
    super();this.engine=new CardRuntime(options.processorOptions.module,CARD_METADATA,sampleRate,2048);
    this.quantum=0;this.keys=CARD_PARAMETERS.map((p,i)=>'p'+i);this.report={kind:'quantum',frames:0};this.port.onmessage=e=>{if(e.data==='reset')this.engine.reset();};
    this.port.postMessage({kind:'ready',sampleRate,capacity:2048});
  }
  process(inputs,outputs,parameters) {
    const output=outputs[0],frames=output?.[0]?.length||0;
    if (!frames||frames>this.engine.capacity) {this.port.postMessage({kind:'fault',message:'Unsupported audio block size.'});return false;}
    for(let i=0;i<CARD_PARAMETERS.length;i++)this.engine.set(CARD_PARAMETERS[i].index,parameters[this.keys[i]][0]);
    const input=inputs[0];
    for(let c=0;c<CARD_METADATA.inputs;c++){
      const source=input?.[c],target=this.engine.inputs[c];
      if(source){for(let i=0;i<frames;i++)target[i]=source[i];}else target.fill(0,0,frames);
    }
    this.engine.compute(frames);
    for(let c=0;c<CARD_METADATA.outputs;c++)for(let i=0;i<frames;i++)if(!Number.isFinite(this.engine.outputs[c][i])){
      for(let channel=0;channel<output.length;channel++)output[channel].fill(0);
      this.port.postMessage({kind:'fault',message:'DSP produced a non-finite sample. Output stopped.'});return false;
    }
    for(let c=0;c<output.length;c++){
      const source=this.engine.outputs[c];
      if(source){for(let i=0;i<frames;i++)output[c][i]=source[i];}else output[c].fill(0);
    }
    // Report only when the actual quantum changes, outside the ordinary steady path.
    if(this.quantum!==frames){this.quantum=frames;this.report.frames=frames;this.port.postMessage(this.report);}
    return true;
  }
}
registerProcessor('dsp-card',DspCardProcessor);
