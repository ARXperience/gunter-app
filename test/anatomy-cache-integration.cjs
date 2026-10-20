'use strict';
// Real analytic geometry + real async builder, with no renderer construction,
// canvas, GPU, browser, media or application preferences.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const window={},document={createElement(){throw Error('No DOM in geometry integration test.');}};
for(const file of ['js/dev/gunter-anatomy-cache.js','js/dev/gunter-idle-core-anatomy.js'])
    new Function('window','document',fs.readFileSync(path.join(__dirname,'..',file),'utf8'))(window,document);
const K=window.GunterIdleCoreAnatomy,C=window.GunterAnatomyCache;
function receiver(){
    const state={anatomyCache:new Map(),anatomyPreparations:new Map(),
        validateAnatomyCache:K.prototype.validateAnatomyCache,prepareAnatomy:K.prototype.prepareAnatomy};
    Object.defineProperty(state,'gl',{get(){throw Error('Preparation must not access GPU.');}});
    return state;
}
(async()=>{
    const state=receiver();let yields=0,progress=0,last=0;
    const pending=state.prepareAnatomy('hand',{
        schedule:()=>new Promise(resolve=>setImmediate(()=>{yields++;resolve();})),
        onProgress(value){assert.ok(value.fraction>=last);last=value.fraction;progress++;}
    });
    assert.equal(state.prepareAnatomy('hand'),pending,'actual geometry preparation is deduplicated');
    assert.equal(state.anatomyCache.size,0,'no partial result before the first host yield');
    const baked=await pending;
    assert.equal(yields,1537);assert.equal(progress,1536);assert.equal(last,1);
    assert.equal(state.anatomyCache.get(1),baked);assert.equal(state.anatomyPreparations.size,0);
    assert.ok(C.sampleVolume(baked,[0,-.15,0]).surface[0]<0,'actual palm interior preserved');
    for(const p of [[-.38,.22,0],[-.15,.40,0],[.09,.40,0],[.37,.30,0]])
        assert.ok(C.sampleVolume(baked,p).surface[0]>0,'actual finger valley stays empty '+p);
    console.log('ok 1 - real hand preparation yields, deduplicates, publishes once and retains geometry');
    const controller=new AbortController(),cancelled=receiver();let callbacks=0;
    const job=cancelled.prepareAnatomy('phoenix',{signal:controller.signal,batchSize:32,
        schedule:()=>new Promise(resolve=>setImmediate(resolve)),onProgress(){callbacks++;controller.abort();}});
    await assert.rejects(job,{name:'AbortError'});
    assert.equal(callbacks,1);assert.equal(cancelled.anatomyCache.size,0);assert.equal(cancelled.anatomyPreparations.size,0);
    console.log('ok 2 - real phoenix cancellation stops after one bounded batch without GPU work');
    console.log('2 real geometry preparation integration checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
