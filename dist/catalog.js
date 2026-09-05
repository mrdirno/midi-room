/** The public launch contract. Every entry names a shipped, self-contained instrument. */
export const BUILTINS = Object.freeze([
  {id:'triton-rack',name:'TRITON Rack',file:'triton-rack.html',embedded:'bundledTriton',role:'instrument',mark:'▤',description:'A playable rack of keys, bass, drums and textures.'},
  {id:'lucky-dreamer',name:'Lucky Dreamer',file:'lucky-dreamer.html',embedded:'bundledLuckyDreamer',role:'instrument',mark:'⚄',description:'Roll a band. Keep what lands.'},
  {id:'improvisator',name:'Improvisator',file:'improvisator.html',embedded:'bundledImprovisator',role:'instrument',mark:'∞',description:'An evolving performance through the TRITON voice engine.'},
  {id:'drum-pad',name:'Drum Pad',file:'drum-pad.html',embedded:'bundledDrumPad',role:'hybrid',mark:'▦',description:'Sixteen pads. Play a local kit or another room instrument.'},
  {id:'field-keys',name:'Field Keys',file:'field-keys.html',embedded:'bundledFieldKeys',role:'hybrid',mark:'♬',description:'A touch keyboard that follows shared key and scale.'},
  {id:'dsp-rack',name:'DSP Rack',file:'dsp-rack.html',embedded:'bundledDSPRack',role:'instrument',mark:'≋',description:'Bloom oscillator into Soft Drive. Shape the sound.'},
]);
export function instrumentRoute(url) {
  const location = new URL(url, 'https://midi-room.invalid/');
  const hash = new URLSearchParams(location.hash.replace(/^#/, ''));
  const requested = location.searchParams.get('instrument') || location.searchParams.get('plugin') || hash.get('instrument') || hash.get('plugin');
  const id = requested === 'triton' ? 'triton-rack' : requested;
  return {requested, instrument: BUILTINS.find(item => item.id === id) || null};
}
