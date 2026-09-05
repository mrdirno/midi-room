// Author: Aldrin Payopay. Private-port TRITON target adapter; no transport adoption.
(() => {
  const sdk=window.MidiRoom,engine=window.TritonEngine;
  if(sdk?.controlVersion!==1||!engine)return;
  sdk.declare({name:document.body.dataset.instrument==='improvisator'?'Improvisator':'TRITON Rack',send:[],receive:['midi']});
  sdk.describe(engine.metadata()); engine.subscribeMetadata(m=>sdk.describe(m));
  sdk.onControl(event=>{
    if(event.action==='cancel')engine.cancelRoute(event.routeId);
    else if(event.action==='note-off')engine.noteOff({id:event.id,routeId:event.routeId});
    else if(event.action==='note-on') {
      // The host verifies assignment, sender, binding and per-hit ownership.
      // Do not restart transport or alter the patch when input arrives.
      engine.noteOn({id:event.id,routeId:event.routeId,note:event.note,velocity:event.velocity/127});
    }
  });
  // v1 virtual MIDI still enters through TRITON's gesture-connected MIDI input.
  // No SDK MIDI listener here: simultaneous SDK and virtual delivery doubles notes.
})();
