'use strict';
// Numeric comparison only. Never initializes a renderer, opens a browser,
// reads media/references, or changes preferences.
const fs = require('node:fs'), path = require('node:path');
const { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
const numericWindow={},noDom={createElement(){throw Error('No rendering in geometry audit.');}};
for(const file of ['js/dev/gunter-anatomy-cache.js','js/dev/gunter-idle-core-anatomy.js'])
    // Execute only these two local, audited class definitions in the ordinary
    // Node realm: VM cross-realm Math/callback overhead distorts bake timings.
    new Function('window','document',fs.readFileSync(path.join(root,file),'utf8'))(numericWindow,noDom);
const K=numericWindow.GunterIdleCoreAnatomy,C=numericWindow.GunterAnatomyCache;
const names=['hand','eye','phoenix'];
const smooth=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const landmarks={
    hand:{interior:[[0,-.15,0],[-.03,.62,0]],empty:[[-.38,.22,0],[-.15,.40,0],[.09,.40,0],[.37,.30,0]]},
    eye:{interior:[[.17,0,0],[0,.455,0]],empty:[[0,.35,0],[.9,0,0],[0,.8,0]]},
    phoenix:{interior:[[0,.1,0],[.45,.50,0],[.16,-.65,0]],empty:[[.65,.64,0],[.04,-.65,0]]}
};
function sampleVolume(cache,p){
    const {surface,frame}=C.sampleVolume(cache,p);let distance=surface[0],pupil=0;
    if(cache.kind===2){const radius=Math.hypot(p[0]/.1025,p[1]/.10738),floor=.025+.035*Math.min(1,radius*radius);
        distance=Math.max(distance,-Math.max((radius-1)*.1025,floor-p[2]));pupil=1-smooth(1,1.15,radius);}
    return {distance,support:1-smooth(-.020,0,distance),gas:(1-smooth(-.045,-.005,distance))*(1-pupil),frame};
}
function sampleFront(cache,p){
    const f=C.sampleFront(cache,p),coverage=f[1];let z=coverage>.00001?f[0]/coverage:0;
    if(cache.kind===2){const r=Math.hypot(p[0]/.1025,p[1]/.10738),pupil=1-smooth(1,1.15,r);
        if(pupil>0&&coverage>0)z=Math.min(z,.025+.035*Math.min(1,r*r));}
    return {z,coverage};
}
const results=[];
for(const [i,name] of names.entries()){
    const start=performance.now();
    const cache=C.build(i+1,{volume:(_,p)=>K.sampleFormVolume(name,p),front:(_,p)=>K.sampleFormFront(name,p,true)});
    const buildMilliseconds=performance.now()-start;
    let maxDistanceError=0,maxInteriorFrontError=0,squared=0,count=0,signErrorsAwayFromBoundary=0,worstFront=null;
    for(let j=0;j<1200;j++){
        const p=[(((j*.61803398875)%1)*2-1)*.9,(((j*.41421356237+.23)%1)*2-1)*.9,(((j*.73205080757+.41)%1)*2-1)*.32];
        const exact=K.sampleFormVolume(name,p),sample=sampleVolume(cache,p),error=Math.abs(sample.distance-exact.distance);
        maxDistanceError=Math.max(maxDistanceError,error);squared+=error*error;count++;
        if(Math.abs(exact.distance)>.015&&(sample.distance<0)!==(exact.distance<0))signErrorsAwayFromBoundary++;
        const front=K.sampleFormFront(name,p),cached=sampleFront(cache,p);
        if(front.coverage===1&&cached.coverage>.999&&Math.abs(front.z-cached.z)>maxInteriorFrontError){
            maxInteriorFrontError=Math.abs(front.z-cached.z);worstFront={point:p,exact:front,cached};}
    }
    const points={};let landmarkFailures=0;
    for(const [expectation,list] of Object.entries(landmarks[name]))for(const p of list){
        const v=sampleVolume(cache,p),f=sampleFront(cache,p),inside=expectation==='interior';
        const okay=inside?v.distance<0&&f.coverage>.5:v.support===0&&v.gas===0&&f.coverage<.5;
        points[p.join(',')]={expectation,passed:okay,distance:v.distance,gas:v.gas,front:f};if(!okay)landmarkFailures++;
    }
    const pupilColumn=name==='eye'?[-.1,0,.025,.1,.25].map(z=>({z,...sampleVolume(cache,[0,0,z])})):[];
    const pupilPassed=pupilColumn.every(p=>p.gas===0);
    const row={name,buildMilliseconds,bytes:cache.volume.byteLength+cache.front.byteLength,metrics:cache.metrics,
        comparisons:count,maxDistanceError,rmsDistanceError:Math.sqrt(squared/count),maxInteriorFrontError,
        signErrorsAwayFromBoundary,landmarkFailures,points,pupilPassed,worstFront};
    results.push(row);console.log(JSON.stringify(row));
}
const report={checkedAt:new Date().toISOString(),noBrowser:true,noRenderer:true,executionContext:'ordinary-node-realm',
    gridXY:C.GRID_XY,gridZ:C.GRID_Z,frontResolution:C.FRONT_WIDTH,results,
    status:results.every(r=>r.landmarkFailures===0&&r.pupilPassed&&r.signErrorsAwayFromBoundary===0
        &&r.maxDistanceError<.025&&r.rmsDistanceError<.004&&r.maxInteriorFrontError<.03)?'PASS':'FAIL',
    limitation:'Float32 CPU sampler comparison, not GPU half-float readback, a rendered frame or reference fidelity.'};
fs.mkdirSync(path.join(root,'output'),{recursive:true});
fs.writeFileSync(path.join(root,'output/anatomy-cache-audit.json'),JSON.stringify(report,null,2));
console.log(report.status+': geometric cache landmarks and pupil audit.');
process.exitCode=report.status==='PASS'?0:1;
