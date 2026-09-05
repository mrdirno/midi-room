const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const pw=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const target='file://'+path.resolve(__dirname,'../../../dist/instruments/lucky-dreamer.html');
const output=path.join(__dirname,'browser-evidence');fs.mkdirSync(output,{recursive:true});
const report={at:new Date().toISOString(),scope:'Real worklet audio at the full-band section (bar 11), all 22 styles, desktop Chromium and WebKit, 1.5 seconds per style. This is not a device latency measurement.',runs:[]};
(async()=>{
 for(const kind of ['chromium','webkit']){
  let browser,ctx;const run={browser:kind,errors:[],styles:[]};
  try{
   browser=await pw[kind].launch({headless:true});ctx=await browser.newContext();const page=await ctx.newPage();page.on('pageerror',e=>run.errors.push(e.message));await page.goto(target);await page.click('#play');await page.waitForFunction(()=>LuckyDreamer.getState().mode==='worklet');
   const styles=await page.evaluate(()=>KSTYLE_KEYS);
   for(let i=0;i<styles.length;i++){
    const style=styles[i];await page.evaluate(async ({style,seed})=>{LuckyDreamer.stop();LuckyDreamer.setSeed(seed,{style});await LuckyDreamer.play(10);},{style,seed:(904001+i*7919)>>>0});await page.waitForTimeout(1500);const state=await page.evaluate(()=>LuckyDreamer.getState());run.styles.push({style,seed:state.recipe.seed,playing:state.playing,mode:state.mode,stats:state.stats});assert.equal(state.playing,true,style);assert.equal(state.mode,'worklet',style);assert.equal(state.stats.nonFinite,0,style);assert.equal(state.stats.clamped,0,style);assert.ok(state.stats.peak>0,style);
   }
   await page.evaluate(()=>LuckyDreamer.destroy());assert.deepEqual(run.errors,[]);run.pass=true;
  }catch(error){run.pass=false;run.failure=String(error.stack||error);}
  finally{if(ctx)await ctx.close();if(browser)await browser.close();}
  report.runs.push(run);fs.writeFileSync(path.join(output,'audio-stress.json'),JSON.stringify(report,null,2));console.log(kind,JSON.stringify({pass:run.pass,styles:run.styles.length,fail:run.failure,maxCPU:Math.max(...run.styles.map(s=>s.stats.cpuLoad)),recoveries:Math.max(...run.styles.map(s=>s.stats.recoveries))}));
 }
 if(report.runs.some(r=>!r.pass))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
