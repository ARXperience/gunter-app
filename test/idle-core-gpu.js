'use strict';
// WebGL2 resource/dispatch contracts. Native shader and visual checks run separately.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../js/components/gunter-idle-core.js'),'utf8');
const defaults={particleColor:'#b8bec9',energyColor:'#ff452b',glowColor:'#ff6d35',brightness:1,density:1,speed:1,size:1};
const STEP=1/45;
let checks=0;
const check=(name,fn)=>{fn();console.log('ok '+(++checks)+' - '+name);};
function environment(options={}) {
    const gl={},names=['VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS','TEXTURE_2D',
        'TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER','TEXTURE_WRAP_S','TEXTURE_WRAP_T','NEAREST','LINEAR',
        'CLAMP_TO_EDGE','RGBA32F','RGBA16F','RGBA','FLOAT','HALF_FLOAT','FRAMEBUFFER','COLOR_ATTACHMENT0',
        'FRAMEBUFFER_COMPLETE','TRIANGLES','BLEND','SRC_ALPHA','ONE_MINUS_SRC_ALPHA','ONE'];
    names.forEach((name,i)=>gl[name]=i+1);gl.TEXTURE0=100;
    const live={Program:new Set(),Shader:new Set(),Texture:new Set(),Framebuffer:new Set()};
    const created={Program:[],Shader:[],Texture:[],Framebuffer:[]},draws=[],textures=new Map(),events=[],contexts=[],listeners=new Map(),uploads=[];
    let sequence=0,program,framebuffer,unit=0,boundTexture,viewport,losses=0;
    for(const kind of Object.keys(live)) {
        gl['create'+kind]=()=>{const resource={kind,id:++sequence};live[kind].add(resource);created[kind].push(resource);return resource;};
        gl['delete'+kind]=resource=>{if(resource)assert.ok(live[kind].delete(resource),kind+' deleted once');};
    }
    gl.shaderSource=(shader,text)=>{shader.source=text;};
    gl.compileShader=()=>{};
    gl.getShaderParameter=()=>!options.failShader;gl.getShaderInfoLog=()=> 'compile diagnostic';
    gl.attachShader=(p,s)=>{(p.shaders||=[]).push(s);};gl.linkProgram=()=>{};
    gl.getProgramParameter=()=>!options.failLink;gl.getProgramInfoLog=()=> 'link diagnostic';
    gl.useProgram=p=>{program=p;};
    gl.getUniformLocation=(p,name)=>({p,name});
    for(const method of ['uniform1f','uniform1i','uniform2f','uniform3fv'])gl[method]=(loc,...value)=>{
        loc.p[loc.name]=Array.isArray(value[0])?Array.from(value[0]):value;
        assert.ok(loc.p[loc.name].every(Number.isFinite),'finite uniform');
    };
    gl.activeTexture=value=>{unit=value-gl.TEXTURE0;};gl.bindTexture=(type,value)=>{boundTexture=value;textures.set(unit,value);};
    gl.texParameteri=()=>{};
    gl.texImage2D=(type,level,internal,w,h,border,format,dataType,data)=>{
        assert.ok(Number.isInteger(w)&&Number.isInteger(h)&&w>0&&h>0);
        Object.assign(boundTexture,{w,h,internal,dataType});
        if(data)uploads.push({texture:boundTexture,data,w,h,internal,dataType});
    };
    gl.bindFramebuffer=(type,value)=>{framebuffer=value;};
    gl.framebufferTexture2D=(type,attachment,target,texture)=>{framebuffer.texture=texture;};
    gl.checkFramebufferStatus=()=>created.Framebuffer.length===options.failFramebufferAt?-1:gl.FRAMEBUFFER_COMPLETE;
    gl.viewport=(...v)=>{viewport=v;};
    gl.enable=gl.disable=()=>{};gl.blendFuncSeparate=(...value)=>{gl.blend=value;};
    gl.getExtension=name=>name==='EXT_color_buffer_float'?(options.noFloat?null:{}):name==='WEBGL_lose_context'?{loseContext(){losses++;}}:null;
    function record(mode,count,instances=0) {
        assert.equal(mode,gl.TRIANGLES);assert.ok(count===3||count===6);
        const samplers={};
        for(const name of ['u_history','u_image','u_bloom','u_volume','u_field'])if(program[name]) {
            const samplerUnit=program[name][0],texture=textures.get(samplerUnit);
            assert.ok(Number.isInteger(samplerUnit)&&samplerUnit>=0,'valid sampler unit');
            assert.ok(live.Texture.has(texture),'sampler reads a live texture');
            assert.notEqual(texture,framebuffer?.texture,'no framebuffer texture feedback for '+name);
            samplers[name]={unit:samplerUnit,texture};
        }
        draws.push({program,framebuffer,texture:framebuffer?.texture,count,instances,viewport:viewport.slice(),
            time:program.u_time?.[0],density:program.u_density?.[0],initialize:program.u_initialize?.[0],samplers,
            pointer:program.u_pointer?.slice(),pointerFlow:program.u_pointerFlow?.slice()});
    }
    gl.drawArrays=(mode,first,count)=>record(mode,count);
    gl.drawArraysInstanced=(mode,first,count,instances)=>{assert.ok(instances>0&&instances<=5120*95);record(mode,count,instances);};
    const canvas={width:300,height:150,getContext(type,attributes){contexts.push({type,attributes});return options.noWebgl?null:gl;},
        addEventListener(type,cb){listeners.set(type,cb);}};
    const window={dispatchEvent(event){events.push(event);},GunterCoreForms:options.catalog},document={createElement(tag){assert.equal(tag,'canvas');return canvas;}};
    const context=vm.createContext({window,document,CustomEvent:class{constructor(type,value){this.type=type;this.detail=value.detail;}}});
    if(options.realCatalog)vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../js/components/gunter-core-forms.js'),'utf8'),context);
    vm.runInContext(source,context);
    const core=new window.GunterIdleCore();
    const output=()=>({width:0,height:0,getContext(type){assert.equal(type,'2d');return{clearRect(){},drawImage(value){assert.equal(value,canvas);}};}});
    return {gl,core,options,live,created,draws,contexts,events,listeners,uploads,losses:()=>losses,
        render(time=8,config=defaults,w=240,h=240){const target=output();core.renderTo(target,w,h,time,config);return target;},
        lost(){Object.values(live).forEach(set=>set.clear());listeners.get('webglcontextlost')({preventDefault(){}});},
        restored(){listeners.get('webglcontextrestored')();}};
}
function released(env){Object.entries(env.live).forEach(([kind,set])=>assert.equal(set.size,0,kind+' leaked'));}
function interaction(core) {
    const state=core.stats().interaction;
    assert.ok(state,'interaction is observable without accessing private pointer state');
    assert.deepEqual(Object.keys(state).sort(),['activity','vx','vy','x','y']);
    const result=Object.fromEntries(Object.entries(state));
    assert.ok(Object.values(result).every(Number.isFinite),'interaction remains finite');
    assert.ok(Math.hypot(result.x,result.y)<=1+1e-12,'interaction stays inside the normalized disc');
    assert.ok(result.activity>=0&&result.activity<=1,'activity stays normalized');
    return result;
}
function near(actual,expected,message,tolerance=1e-10) {
    assert.ok(Math.abs(actual-expected)<=tolerance,message+': '+actual+' ≈ '+expected);
}
function neutral(core) {assert.deepEqual(interaction(core),{x:0,y:0,activity:0,vx:0,vy:0});}
function advanceSteps(env,count) {
    for(let i=0;i<count;i++)env.render(env.core.simulationTime+STEP);
}
function assertPointerDraw(draw,state) {
    assert.ok(draw,'the pass was dispatched');
    assert.deepEqual(draw.pointer,[state.x,state.y,state.activity],'pass receives current interaction');
    assert.deepEqual(draw.pointerFlow,[state.vx*.24,state.vy*.24,0],'pass receives shared pointer flow');
}
check('one transparent WebGL2 compositor uses floating material state and no point/buffer geometry',()=>{
    const e=environment();assert.ok(e.core.available);assert.equal(e.contexts.length,1);
    assert.equal(e.contexts[0].type,'webgl2');assert.equal(e.contexts[0].attributes.alpha,true);
    assert.equal(e.core.histories.length,2);
    for(const target of e.core.histories){assert.equal(target.width,96);assert.equal(target.height,1280);assert.equal(target.texture.internal,e.gl.RGBA32F);}
    e.render();assert.equal(e.core.stats().simulation,'gpu-advected-material-filaments');
    assert.equal(e.core.stats().segmentsPerFilament,95);e.core.dispose();released(e);
});
check('density changes real ribbon instance counts at 25, 100 and 200 percent',()=>{
    const e=environment();
    for(const [density,count] of [[.25,640],[1,2560],[2,5120]]) {
        e.render(8,{...defaults,density});
        const draw=e.draws.filter(d=>d.instances).at(-1);
        assert.equal(draw.count,6);assert.equal(draw.instances,count*95);assert.equal(e.core.stats().filaments,count);
    }
    e.core.dispose();released(e);
});
check('GPU state ping-pongs with fixed-step advection and never reads its destination',()=>{
    const e=environment();e.render(8);const steps=e.core.steps,time=e.core.simulationTime;
    e.render(8.1);assert.ok(e.core.steps>steps);assert.ok(e.core.simulationTime>time);
    const simulations=e.draws.filter(d=>d.program===e.core.programs.simulation.program);
    assert.equal(simulations[0].initialize,1);assert.ok(simulations.slice(1).every(d=>d.initialize===0));
    assert.equal(simulations[1].texture,e.core.histories[0].texture);
    assert.equal(simulations[2].texture,e.core.histories[1].texture);
    assert.equal(e.core.programs.simulation.program.u_dt[0],1/45);
    const after=e.core.steps,display=e.core.displayTime;
    e.render(8.1);e.render(4);assert.equal(e.core.steps,after);assert.equal(e.core.displayTime,display);
    e.core.dispose();released(e);
});
check('presentation resize retains advected material and allocates only presentation targets',()=>{
    const e=environment();e.render(8);const histories=e.core.histories.slice(),field=e.core.field,steps=e.core.steps;
    const builds=e.core.fieldBuilds;
    e.render(8,defaults,510,320);
    assert.equal(e.core.steps,steps);assert.equal(e.core.histories[0],histories[0]);assert.equal(e.core.histories[1],histories[1]);
    assert.equal(e.core.field,field);assert.equal(e.core.fieldBuilds,builds);
    assert.equal(e.live.Framebuffer.size,7);assert.equal(e.live.Texture.size,7);
    e.core.dispose();released(e);
});
check('particle, energy and emissive colors independently reach both matter and filament shaders',()=>{
    const e=environment();e.render(8,{...defaults,particleColor:'#00ff00',energyColor:'#0000ff',glowColor:'#ff0000'});
    for(const name of ['strands','volume']) {
        const p=e.core.programs[name].program;
        assert.deepEqual(Array.from(p.u_particle),[0,1,0]);assert.deepEqual(Array.from(p.u_energy),[0,0,1]);
        assert.deepEqual(Array.from(p.u_glow),[1,0,0]);
    }
    const field=e.core.programs.field.program;
    for(const name of ['u_particle','u_energy','u_glow'])assert.equal(field[name],undefined,'cached medium is color independent');
    e.core.dispose();released(e);
});
check('one fixed floating atlas supplies density, energy, irradiance and facing to both render passes',()=>{
    const e=environment();e.render();
    const field=e.core.field,stats=e.core.stats();
    assert.equal(stats.volumeGrid,48);assert.ok(Number.isInteger(stats.volumeSamples)&&stats.volumeSamples>0);
    assert.equal(field.width,384);assert.equal(field.height,288);assert.equal(field.texture.internal,e.gl.RGBA16F);
    assert.equal(field.width*field.height,stats.volumeGrid**3);
    const build=e.draws.find(d=>d.program===e.core.programs.field.program);
    assert.equal(build.texture,field.texture);assert.deepEqual(build.viewport,[0,0,384,288]);
    assert.equal(build.time,e.core.displayTime);assert.equal(build.density,1);
    assert.deepEqual(Object.keys(build.samplers),[],'atlas construction does not sample its destination');
    const shader=e.core.programs.field.program.shaders.find(s=>s.source.includes('out vec4 result')).source;
    assert.match(shader,/result\s*=\s*vec4\(density,heat,light,facing\)/);
    const volume=e.draws.find(d=>d.program===e.core.programs.volume.program),strands=e.draws.find(d=>d.instances);
    assert.equal(volume.samplers.u_field.unit,0);assert.equal(volume.samplers.u_field.texture,field.texture);
    assert.equal(strands.samplers.u_field.unit,2);assert.equal(strands.samplers.u_field.texture,field.texture);
    assert.equal(strands.samplers.u_history.unit,0);
    assert.equal(strands.samplers.u_history.texture,e.core.histories[e.core.historyIndex].texture);
    assert.equal(strands.samplers.u_volume.unit,1);assert.equal(strands.samplers.u_volume.texture,e.core.targets.energy.texture);
    assert.equal(e.core.targets.energy.texture.internal,e.gl.RGBA16F);
    assert.equal(e.live.Framebuffer.size,7);assert.equal(e.live.Texture.size,7);
    const fragment=e.core.programs.strands.program.shaders.find(s=>s.source.includes('uniform sampler2D u_volume')).source;
    assert.match(fragment,/texture\(u_volume,gl_FragCoord.xy\/u_resolution\)/);
    for(const name of ['strands','volume']) {
        const cached=e.core.programs[name].program.shaders.find(s=>s.source.includes('vec4 mediumAt')).source;
        assert.match(cached,/texture\(u_field,/);assert.match(cached,/vec4 material=mediumAt\(/);
    }
    e.core.dispose();released(e);
});
check('the connected energy support stays anchored inside material and is buried by actual depth density',()=>{
    const e=environment();
    const field=e.core.programs.field.program.shaders.find(s=>s.source.includes('out vec4 result')).source;
    const center=field.match(/vec3 energyCenter\(float t\)\s*\{([\s\S]*?)\n        \}/)[1];
    assert.match(center,/idleCenter\(t\)\*\.25\+worldPoint\(vec3\(u_pointer\.xy\*\.14,0\)\)/,
        'the current follows the material center with a bounded internal excursion');
    assert.match(field,/energyCurve\(clamp\(energyFrame\(p,t\)\.x,-\.27,\.27\),t\)/,
        'incident light and matter transport share the shortened connected source');
    assert.match(field,/float support=exp\(-pow\(radial,2\.2\)\)\*\(1\.0-smoothstep\(\.9,1\.45,radial\)\)/,
        'the emitting tube has finite 3D support rather than a luminous tail outside the body');
    assert.match(field,/if\(heat>\.0001\)\s*\{\s*vec3 depth=worldPoint\(vec3\(0,0,\.18\)\);\s*float cover=density\+matterDensity\(p\+depth,u_time\)\+matterDensity\(p-depth,u_time\);\s*heat\*=smoothstep\(\.025,\.18,cover\);/,
        'only the emitter neighbourhood pays for actual front/back material containment');
    assert.match(field,/result=vec4\(density,heat,light,facing\)/,'both visible passes receive the contained heat');
    e.core.dispose();released(e);
});
check('buried gas emits within the depth march while only matter extinguishes it and front fibres cover it',()=>{
    const e=environment();
    const volume=e.core.programs.volume.program.shaders.find(s=>s.source.includes('vec4 material=mediumAt(p)')).source;
    const extinction=volume.match(/float density=([^;]+);/)[1];
    assert.match(extinction,/mass\*mass\*grain/);assert.doesNotMatch(extinction,/material\.g|heat|emission/,
        'the energy support cannot create an opaque glowing front shell');
    assert.match(volume,/color\+=\(1\.0-opacity\)\*\(scattered\*density\+emitted\*emission\)/,
        'emission passes through the opacity already accumulated in front of its 3D sample');
    assert.match(volume,/opacity\+=\(1\.0-opacity\)\*density/);
    const strands=e.core.programs.strands.program.shaders.find(s=>s.source.includes('uniform sampler2D u_volume')).source;
    assert.match(strands,/vec3 source=flowWind\(energySource\(flowUnwind\(v_world,u_flow\),u_time\),u_flow\)/);
    assert.match(strands,/viewPoint\(v_world-source\)\.z/,
        'a filament covers the energy according to its 3D position relative to the current');
    assert.match(strands,/color=mix\(color,coat,frontCover\*\.88\)/,'front microfibres keep their shaded material color');
    assert.match(strands,/transmission=mix\(transmission,1\.0,frontCover\*\.85\)/,
        'the full column must not erase fibres lying in front of the energy');
    assert.match(strands,/\*\(1\.0\+frontCover\*\.75\)\)\*transmission/,'front material has visible covering alpha');
    e.core.dispose();released(e);
});
check('avatars reuse the atlas across colors, brightness, size, resolution and older timestamps',()=>{
    const e=environment(),first=e.render(8),field=e.core.field,steps=e.core.steps;
    const builds=e.core.fieldBuilds,created=e.created.Texture.length;
    const colors={...defaults,particleColor:'#194c7f',energyColor:'#00ff00',glowColor:'#0000ff'};
    const second=e.render(8,colors);assert.notEqual(first,second,'each avatar has its own output canvas');
    e.render(8,{...colors,size:1.3,brightness:2},510,320);
    e.render(4,{...colors,size:.7,brightness:.2},510,320);
    assert.equal(e.core.field,field);assert.equal(e.core.fieldBuilds,builds);assert.equal(e.core.stats().fieldBuilds,builds);
    assert.equal(e.core.steps,steps);assert.equal(e.core.displayTime,8);
    assert.equal(e.created.Texture.length,created+4,'only resized presentation targets are reallocated');
    assert.equal(e.draws.filter(d=>d.program===e.core.programs.field.program).length,1);
    assert.deepEqual(Array.from(e.core.programs.volume.program.u_particle),[25/255,76/255,127/255]);
    assert.equal(e.core.programs.volume.program.u_size[0],.7);assert.equal(e.core.programs.volume.program.u_brightness[0],.2);
    e.core.dispose();released(e);
});
check('the atlas rebuilds for display phase and square-root density without reallocating GPU resources',()=>{
    const e=environment();e.render(8);const field=e.core.field,created=e.created.Texture.length,steps=e.core.steps;
    assert.equal(e.core.fieldBuilds,1);
    e.render(8.005);assert.equal(e.core.steps,steps,'display phase can advance between simulation steps');
    assert.equal(e.core.fieldTime,8.005);assert.equal(e.core.fieldBuilds,2);
    for(const density of [.25,2]) {
        const before=e.core.fieldBuilds,expected=Math.sqrt(density);
        e.render(8.005,{...defaults,density});
        assert.equal(e.core.fieldBuilds,before+1);assert.equal(e.core.fieldDensity,expected);
        const build=e.draws.filter(d=>d.program===e.core.programs.field.program).at(-1);
        const volume=e.draws.filter(d=>d.program===e.core.programs.volume.program).at(-1);
        assert.equal(build.density,expected);assert.equal(volume.density,expected);
        e.render(8.005,{...defaults,density});assert.equal(e.core.fieldBuilds,before+1);
    }
    assert.equal(e.core.field,field);assert.equal(e.created.Texture.length,created);
    e.core.dispose();released(e);
});
check('pointer targets use an 8 rad/s critically damped response only on fixed GPU advection steps',()=>{
    const e=environment(),target={x:.75,y:-.5},omega=8;
    neutral(e.core);e.core.setPointer(target.x,target.y);neutral(e.core);
    e.render(8);neutral(e.core);
    assertPointerDraw(e.draws.find(d=>d.program===e.core.programs.simulation.program),interaction(e.core));
    const steps=e.core.steps;
    e.render(8.005);e.render(8.005,{...defaults,brightness:2});e.render(4);
    neutral(e.core);assert.equal(e.core.steps,steps,'initialization, presentation and older avatars do not integrate pointer motion');
    let previousActivity=0;
    for(let i=1;i<=60;i++) {
        advanceSteps(e,1);
        const state=interaction(e.core),elapsed=i*STEP,decay=Math.exp(-omega*elapsed);
        const response=1-(1+omega*elapsed)*decay;
        near(state.x,target.x*response,'critical x displacement');
        near(state.y,target.y*response,'critical y displacement');
        near(state.vx,target.x*omega*omega*elapsed*decay,'critical x velocity');
        near(state.vy,target.y*omega*omega*elapsed*decay,'critical y velocity');
        assert.ok(state.activity>=previousActivity,'activation approaches its target monotonically');
        if(i===1)assert.ok(state.activity>0&&state.activity<1,'activation also starts smoothly');
        previousActivity=state.activity;
        assert.ok(state.x>=0&&state.x<=target.x,'approach does not overshoot x');
        assert.ok(state.y<=0&&state.y>=target.y,'approach does not overshoot y');
    }
    assert.equal(e.core.steps,steps+60);
    e.core.dispose();released(e);
});
check('pointer coordinates clamp radially and invalid inputs select a finite inactive target',()=>{
    const e=environment();e.render(8);
    const response=1-(1+8*STEP)*Math.exp(-8*STEP);
    e.core.setPointer(3,4);neutral(e.core);advanceSteps(e,1);
    let state=interaction(e.core);
    near(state.x,.6*response,'radial normalization preserves x direction');
    near(state.y,.8*response,'radial normalization preserves y direction');
    e.core.resetPointer();e.core.setPointer(1e308,-1e308);advanceSteps(e,1);
    state=interaction(e.core);
    near(state.x,Math.SQRT1_2*response,'large finite coordinates do not overflow');
    near(state.y,-Math.SQRT1_2*response,'large finite coordinates preserve direction');
    for(const [x,y] of [[NaN,.5],[.5,NaN],[Infinity,.5],[.5,-Infinity],['.5',.5],[.5,undefined]]) {
        e.core.resetPointer();e.core.setPointer(x,y);advanceSteps(e,1);neutral(e.core);
    }
    e.core.setPointer(.8,-.6,false);advanceSteps(e,1);neutral(e.core);
    e.core.dispose();released(e);
});
check('leaving or invalidating the pointer returns smoothly to neutral without resetting material history',()=>{
    for(const leave of [core=>core.setPointer(.4,.3,false),core=>core.setPointer(NaN,.3)]) {
        const e=environment();e.render(8);e.core.setPointer(.8,-.6);advanceSteps(e,90);
        const before=interaction(e.core),histories=e.core.histories.slice(),steps=e.core.steps;
        const builds=e.core.fieldBuilds,created=e.created.Texture.length;
        assert.ok(before.activity>.99);
        leave(e.core);assert.deepEqual(interaction(e.core),before,'exit changes the target without teleporting material');
        e.render(e.core.displayTime);assert.equal(e.core.fieldBuilds,builds,'an unintegrated target does not invalidate the atlas');
        advanceSteps(e,90);
        const after=interaction(e.core);
        assert.ok(after.activity<before.activity&&Math.hypot(after.x,after.y)<Math.hypot(before.x,before.y));
        for(const value of Object.values(after))near(value,0,'pointer settles after exit',1e-5);
        assert.equal(e.core.steps,steps+90);assert.deepEqual(e.core.histories,histories);
        assert.equal(e.created.Texture.length,created);
        assert.equal(e.draws.filter(d=>d.program===e.core.programs.simulation.program&&d.initialize===1).length,1);
        e.core.dispose();released(e);
    }
});
check('all four GPU material passes share pointer uniforms and avatars never advance them twice',()=>{
    const e=environment();e.render(8);e.core.setPointer(.6,.8);advanceSteps(e,1);
    const state=interaction(e.core),steps=e.core.steps,builds=e.core.fieldBuilds,history=e.core.historyIndex;
    for(const name of ['simulation','field','volume','strands']) {
        const draw=e.draws.filter(d=>d.program===e.core.programs[name].program).at(-1);
        assertPointerDraw(draw,state);
    }
    const histories=e.core.histories.slice(),field=e.core.field,created=e.created.Texture.length;
    const framebuffers=e.created.Framebuffer.length,programs=e.created.Program.length;
    const time=e.core.displayTime;
    e.render(time,{...defaults,particleColor:'#00ff00',brightness:2,size:.7});
    e.render(time-.1,{...defaults,energyColor:'#0000ff'});
    e.core.setPointer(-.8,.6);e.render(time);
    assert.deepEqual(interaction(e.core),state,'same and older avatars preserve one shared inertial state');
    assert.equal(e.core.steps,steps);assert.equal(e.core.historyIndex,history);assert.equal(e.core.fieldBuilds,builds);
    assert.deepEqual(e.core.histories,histories);assert.equal(e.core.field,field);
    assert.equal(e.created.Texture.length,created);assert.equal(e.core.stats().filaments,2560);
    advanceSteps(e,1);
    assert.equal(e.core.steps,steps+1);assert.equal(e.core.fieldBuilds,builds+1);
    const next=interaction(e.core);assert.notDeepEqual(next,state);
    for(const name of ['simulation','field','volume','strands'])assertPointerDraw(e.draws.filter(d=>d.program===e.core.programs[name].program).at(-1),next);
    assert.equal(e.created.Texture.length,created);assert.equal(e.created.Framebuffer.length,framebuffers);
    assert.equal(e.created.Program.length,programs);assert.equal(e.core.stats().filaments,2560);
    assert.equal(e.live.Framebuffer.size,7);assert.equal(e.live.Texture.size,7);
    e.core.dispose();released(e);
});
check('resetPointer clears inertia immediately and invalidates a same-phase atlas exactly once',()=>{
    const e=environment();e.render(8);
    assert.equal(e.core.resetPointer(),false,'an already neutral pointer does not change');
    e.core.setPointer(.5,-.8);
    assert.equal(e.core.resetPointer(),true,'a pending target also counts as changed');neutral(e.core);
    e.core.setPointer(.5,-.8);advanceSteps(e,12);
    const histories=e.core.histories.slice(),field=e.core.field,created=e.created.Texture.length;
    const time=e.core.displayTime,steps=e.core.steps,builds=e.core.fieldBuilds,history=e.core.historyIndex;
    assert.equal(e.core.resetPointer(),true);neutral(e.core);
    assert.equal(e.core.resetPointer(),false,'repeated reset is idempotent');
    e.render(time);assert.equal(e.core.fieldBuilds,builds+1,'reset rebuilds cached pointer material at the same phase');
    for(const name of ['field','volume','strands'])assertPointerDraw(e.draws.filter(d=>d.program===e.core.programs[name].program).at(-1),interaction(e.core));
    e.render(time);assert.equal(e.core.fieldBuilds,builds+1,'neutral material is cached for subsequent avatars');
    assert.equal(e.core.steps,steps);assert.equal(e.core.historyIndex,history);assert.deepEqual(e.core.histories,histories);
    assert.equal(e.core.field,field);assert.equal(e.created.Texture.length,created);
    advanceSteps(e,1);neutral(e.core);
    assertPointerDraw(e.draws.filter(d=>d.program===e.core.programs.simulation.program).at(-1),interaction(e.core));
    assert.equal(e.draws.filter(d=>d.program===e.core.programs.simulation.program&&d.initialize===1).length,1);
    e.core.dispose();released(e);
});
check('finite input bounds and the legacy energy color alias remain supported',()=>{
    const e=environment();let out=e.render(NaN,{density:999,brightness:Infinity,size:-10},NaN,Infinity);
    assert.equal(out.width,512);assert.equal(out.height,512);assert.equal(e.core.stats().filaments,5120);
    assert.equal(e.core.programs.strands.program.u_size[0],.7);assert.equal(e.core.programs.strands.program.u_brightness[0],1);
    e.render(0,{color:'#ff0000',density:-4},10000,-5);
    assert.equal(e.core.stats().width,720);assert.equal(e.core.stats().height,1);assert.equal(e.core.stats().filaments,640);
    assert.deepEqual(Array.from(e.core.programs.strands.program.u_energy),[1,0,0]);
    e.core.dispose();released(e);
});
check('missing WebGL2 or floating target capability reports the requirement without faking a renderer',()=>{
    for(const options of [{noWebgl:true},{noFloat:true}]) {
        const e=environment(options);assert.equal(e.core.available,false);assert.match(e.core.error,/WebGL2/);
        assert.throws(()=>e.render(),/WebGL2/);e.core.dispose();released(e);
    }
});
check('shader/link and framebuffer failures release partial allocations with truthful diagnostics',()=>{
    for(const [options,message] of [[{failShader:true},/compile diagnostic/],[{failLink:true},/link diagnostic/],
        [{failFramebufferAt:2},/buffer GPU/],[{failFramebufferAt:3},/buffer GPU/]]) {
        const e=environment(options);assert.equal(e.core.available,false);assert.match(e.core.error,message);released(e);
        assert.equal(e.core.field,null);
    }
    const e=environment();e.options.failFramebufferAt=4;
    const field=e.core.field;
    assert.throws(()=>e.render(),/buffer GPU/);assert.equal(e.live.Framebuffer.size,3);assert.equal(e.core.field,field);
    e.options.failFramebufferAt=0;assert.doesNotThrow(()=>e.render());e.core.dispose();released(e);
});
check('context loss recreates the atlas, invalidates its cache and releases all resources on disposal',()=>{
    const e=environment();e.render();e.core.setPointer(.7,.4);advanceSteps(e,12);
    assert.ok(interaction(e.core).activity>0);
    const field=e.core.field,builds=e.core.fieldBuilds;
    e.lost();assert.equal(e.core.available,false);assert.equal(e.events.at(-1).detail.available,false);
    assert.throws(()=>e.render(),/contexto WebGL2/);
    e.restored();assert.equal(e.core.available,true);assert.equal(e.events.at(-1).detail.available,true);
    neutral(e.core);
    assert.notEqual(e.core.field,field);assert.notEqual(e.core.field.texture,field.texture);
    assert.equal(e.core.fieldTime,null);assert.equal(e.core.fieldDensity,null);
    e.render(8);assert.equal(e.core.fieldBuilds,builds+1);assert.equal(e.core.fieldTime,8);
    advanceSteps(e,1);neutral(e.core);
    assert.equal(e.live.Framebuffer.size,7);assert.equal(e.live.Texture.size,7);
    const restoredField=e.core.field;
    e.core.dispose();e.core.dispose();assert.equal(e.losses(),1);released(e);
    assert.equal(e.live.Texture.has(restoredField.texture),false);assert.equal(e.live.Framebuffer.has(restoredField.framebuffer),false);
    assert.equal(e.core.field,null);assert.equal(e.core.fieldTime,null);assert.equal(e.core.fieldDensity,null);
    assert.throws(()=>e.render(),/disponible/);
});
check('Measured RMS reaches all GPU passes, scales mildly, reuses resources and invalidates only changed audio',()=>{
    const e=environment();e.render(8);const histories=e.core.histories.slice(),field=e.core.field,steps=e.core.steps;
    e.core.setAudioLevel(.25,true);e.render(8);const amplitude=1-Math.exp(-.25*5),builds=e.core.fieldBuilds;
    assert.deepEqual(JSON.parse(JSON.stringify(e.core.stats().audio)),{level:.25,available:true});
    for(const key of ['simulation','field','volume','strands']){
        if(key==='simulation')continue;
        assert.equal(e.core.programs[key].program.u_audio[0],amplitude);
    }
    for(const key of ['volume','strands'])assert.equal(e.core.programs[key].program.u_size[0],1+amplitude*.04);
    e.core.setAudioLevel(.25,true);e.render(8);assert.equal(e.core.fieldBuilds,builds);
    e.render(8.1);assert.equal(e.core.programs.simulation.program.u_audio[0],amplitude);
    assert.equal(e.core.histories[0],histories[0]);assert.equal(e.core.histories[1],histories[1]);assert.equal(e.core.field,field);
    assert.equal(e.live.Framebuffer.size,7);assert.ok(e.core.steps>steps);
    e.core.setAudioLevel(0,false);e.render(8.1);assert.equal(e.core.programs.volume.program.u_audio[0],0);
    assert.equal(e.core.programs.strands.program.u_size[0],1);e.core.dispose();released(e);
});
check('combined inertial pointer and measured audio retain one contained medium and the existing GPU budget',()=>{
    const e=environment();e.render(8);const created=e.created.Texture.length,field=e.core.field;
    e.core.setAudioLevel(1,true);
    for(const [x,y] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        e.core.setPointer(x,y);advanceSteps(e,45);
        const state=interaction(e.core);
        for(const name of ['simulation','field','volume','strands']) {
            const draw=e.draws.filter(d=>d.program===e.core.programs[name].program).at(-1);
            assertPointerDraw(draw,state);
            assert.equal(draw.program.u_audio[0],1-Math.exp(-5));
        }
        const builds=e.core.fieldBuilds;
        e.render(e.core.displayTime,{...defaults,particleColor:'#137a99',energyColor:'#00ff00',glowColor:'#ff0000'});
        assert.equal(e.core.fieldBuilds,builds,'color changes reuse the same contained medium at the same phase');
    }
    assert.equal(e.core.field,field);assert.equal(e.created.Texture.length,created);
    assert.equal(e.live.Framebuffer.size,7);assert.equal(e.live.Texture.size,7);
    assert.equal(e.core.stats().volumeGrid,48);assert.equal(e.core.stats().volumeSamples,40);
    e.core.dispose();released(e);
});
check('voice radiance modulates the buried energy and illuminated fibres, not a timed screen pulse',()=>{
    const e=environment();e.render(8);
    const volume=e.core.programs.volume.program.shaders.find(shader=>shader.source.includes('vec3 emitted=')).source;
    const strands=e.core.programs.strands.program.shaders.find(shader=>shader.source.includes('vec3 coat=')).source;
    assert.match(volume,/u_energy\*\(2\.4\+u_pointer\.z\*heat\*\.28\+u_audio\*1\.70\)/);
    assert.match(volume,/color\+=\(1\.0-opacity\)\*\(scattered\*density\+emitted\*emission\)/);
    assert.match(strands,/u_glow\*emission\*emission\*\(\.35\+u_pointer\.z\*\.32\+u_audio\*1\.45\)/);
    for(const level of [0,.03,.15,0]) {
        e.core.setAudioLevel(level,true);e.render(8);
        assert.equal(e.core.programs.volume.program.u_audio[0],1-Math.exp(-level*5));
    }
    assert.equal(e.core.programs.volume.program.u_audio[0],0,'silence restores idle radiance');
    assert.equal(e.live.Framebuffer.size,7);e.core.dispose();released(e);
});
check('Invalid, absent or muted samples cannot leave invented audio amplitude across restore/dispose',()=>{
    const e=environment();e.render(8);
    for(const level of [NaN,Infinity,'1',undefined]){
        e.core.setAudioLevel(level);e.render(8);assert.equal(e.core.programs.volume.program.u_audio[0],0);
        assert.equal(e.core.stats().audio.available,false);
    }
    e.core.setAudioLevel(20,true);e.render(8);assert.equal(e.core.stats().audio.level,1);
    assert.ok(e.core.programs.volume.program.u_size[0]<=1.04);
    e.lost();e.restored();e.render(8);assert.equal(e.core.stats().audio.level,0);assert.equal(e.core.stats().audio.available,false);
    e.core.setAudioLevel(.7);e.core.dispose();assert.equal(e.core.stats().audio.level,0);released(e);
});
check('depth-delayed smoke packets share coherent per-depth volume and filament paths without clones',()=>{
    const e=environment();e.render(8,defaults,640,400);
    const histories=e.core.histories.slice(),field=e.core.field,steps=e.core.steps,builds=e.core.fieldBuilds;
    const created=e.created.Texture.length,programs=e.created.Program.length;
    const transport={progress:0,from:[.4,.5],to:[-.85,-.7],fromScale:1,toScale:.20,bend:.18};
    for(const progress of [0,.15,.5,.85,1]) {
        e.render(8,{...defaults,transport:{...transport,progress}},640,400);
        for(const name of ['volume','strands']) {
            const p=e.core.programs[name].program;
            assert.deepEqual(Array.from(p.u_transport),[1,progress,.18]);
            assert.deepEqual(Array.from(p.u_transportFrom),[.4,.5,1]);
            assert.deepEqual(Array.from(p.u_transportTo),[-.85,-.7,.20]);
        }
        assert.equal(e.core.stats().filaments,2560,'transport reuses actual density, not extra ghost copies');
    }
    const vertex=e.core.programs.strands.program.shaders.find(s=>s.source.includes('int filament=')).source;
    const volume=e.core.programs.volume.program.shaders.find(s=>s.source.includes('vec3 emitted=')).source;
    assert.match(vertex,/return transported\(view\.xy\*u_size\*\.80,aspect,view\.z\)/);
    assert.match(volume,/vec2 xy=untransported\(screen,aspect,z\)\/\(u_size\*\.80\)/);
    const mapping=vertex.slice(vertex.indexOf('vec2 riverCurve'),vertex.indexOf('uniform sampler2D u_history'));
    assert.ok(volume.includes(mapping),'volume and matter share the exact same packet mapping');
    assert.equal((mapping.match(/float progress=packetProgress\(depth\)/g)||[]).length,2,
        'forward and inverse use each material layer’s delayed phase');
    assert.match(mapping,/p\+envelope\*lane\*\.19/,'different layers leave/arrive at different times');
    assert.match(mapping,/packetRotate\(\(screen\/aspect-center\)\/scale,-packetTurn\(depth\)\)/,'each rolling packet has an exact per-depth inverse');
    assert.doesNotMatch(mapping,/determinant|potential\(|for\(/,'no iterative screen solver or noise-heavy per-ray warp');
    const simulation=e.core.programs.simulation.program.shaders.find(s=>s.source.includes('uniform float u_dt')).source;
    assert.match(simulation,/vec3 rest=flowUnwind\(p,u_previousFlow\)/,'GPU history retains its previous roll coordinates');
    assert.match(simulation,/p=flowWind\(rest,u_flow\)/,'the new deformed coordinates are stored in the existing history texture');
    assert.match(simulation,/potential\(rest\*3\.7/,'the current locally advects through multi-scale curl');
    assert.match(simulation,/vec3 eddies=\(curl\*\(\.16\+pocket\*\.12\)\+fine\*\.105\+slip\)\*u_flow\.z/);
    assert.match(simulation,/rest\+=\(velocity\(rest\+v\*u_dt\*\.5,u_time\+u_dt\*\.5,row,1\.0\)\+eddies\)\*u_dt/,
        'small counter-currents are integrated, not rendered as duplicate trails');
    assert.match(volume,/p\/=flowExtent\(\)/,'the volume atlas samples the same compact rolled matter bounds');
    assert.equal(e.core.histories[0],histories[0]);assert.equal(e.core.histories[1],histories[1]);
    assert.equal(e.core.field,field);assert.equal(e.core.steps,steps);assert.ok(e.core.fieldBuilds>builds,'new material bounds invalidate the same atlas');
    assert.equal(e.created.Texture.length,created);assert.equal(e.created.Program.length,programs);
    e.render(8.1,{...defaults,transport},640,400);
    assert.ok(e.core.steps>steps,'the same fixed-step curl advection continues during transport');
    e.core.dispose();released(e);
});
check('smoke roll maps have a bounded lag and exact reverse order for volume/fibre correspondence',()=>{
    const e=environment(),shader=e.core.programs.simulation.program.shaders.find(s=>s.source.includes('uniform float u_dt')).source;
    const field=shader.slice(shader.indexOf('vec2 flowRotate'),shader.indexOf('vec2 closestSegment'));
    assert.doesNotMatch(field,/3\.2|3\.3|dot\(q\.xy,d\)\s*\*\s*\(1\.0\+/,'no uniform longitudinal scale remains');
    assert.match(field,/return vec3\(1\.0\+u_flow\.z\*\.20\)/,'atlas extent grows by at most 20%, not 330%');
    assert.match(field,/q\.yz=flowRotate\(q\.yz,rollAngle\(q,flow\.z\)\)/);
    assert.match(field,/q\.xy=flowRotate\(q\.xy,foldAngle\(q\.z,flow\.z\)\)/);
    assert.match(field,/q\.x\+=puffLag\(q\.yz,flow\.z\)/);
    assert.match(field,/q\.x-=puffLag\(q\.yz,flow\.z\);\s*q\.xy=flowRotate\(q\.xy,-foldAngle\(q\.z,flow\.z\)\);\s*q\.yz=flowRotate\(q\.yz,-rollAngle\(q,flow\.z\)\)/);
    // Numerical fixture of those material-local rotations: radial rolls keep
    // their radius, and the final shear can add at most 0.16 core units.
    const rotate=([x,y],a)=>[Math.cos(a)*x-Math.sin(a)*y,Math.sin(a)*x+Math.cos(a)*y];
    const roll=(q,s)=>s*(1.70+.55*Math.sin(q[0]*5.2))*Math.exp(-(q[1]**2+q[2]**2)*1.4);
    const fold=(z,s)=>s*.38*Math.sin(z*4.1+.8);
    const lag=(q,s)=>s*.16*Math.sin(q[1]*5.7+q[2]*4.3)*Math.exp(-(q[1]**2+q[2]**2)*.8);
    for(const strength of [0,.15,.5,1])for(let i=0;i<120;i++) {
        const p=[Math.sin(i*1.7)*.7,Math.cos(i*2.1)*.7,Math.sin(i*.83)*.7],q=p.slice();
        [q[1],q[2]]=rotate([q[1],q[2]],roll(q,strength));
        [q[0],q[1]]=rotate([q[0],q[1]],fold(q[2],strength));q[0]+=lag(q,strength);
        assert.ok(Math.abs(Math.hypot(...q)-Math.hypot(...p))<=.16*strength+1e-12,'compact, not axis-stretched');
        q[0]-=lag(q,strength);[q[0],q[1]]=rotate([q[0],q[1]],-fold(q[2],strength));
        [q[1],q[2]]=rotate([q[1],q[2]],-roll(q,strength));
        q.forEach((value,axis)=>near(value,p[axis],'inverse material coordinate',1e-12));
    }
    e.core.dispose();released(e);
});
check('transport pulse settles at exact endpoints, reverses without axis flips and carries interrupted roll strength',()=>{
    const e=environment(),route={from:[.4,.5],to:[-.85,-.7],fromScale:1,toScale:.2,bend:.18};
    e.render(8,{...defaults,transport:{...route,progress:0}},640,400);
    assert.equal(e.core.stats().flow[2],0);assert.equal(e.core.stats().transportFlow,'depth-delayed-smoke-packets');
    e.render(8,{...defaults,transport:{...route,progress:1e-4}},640,400);
    assert.ok(e.core.stats().flow[2]/1e-4<.001,'zero initial deformation velocity');
    e.render(8,{...defaults,transport:{...route,progress:.4}},640,400);
    const flow=Array.from(e.core.stats().flow),steps=e.core.steps,builds=e.core.fieldBuilds;
    e.render(8);e.render(4);assert.deepEqual(Array.from(e.core.stats().flow),flow,'same/older avatar does not clear shared rolls');
    assert.equal(e.core.steps,steps);assert.equal(e.core.fieldBuilds,builds);
    e.render(8,{...defaults,transport:{...route,from:route.to,to:route.from,progress:0,startStrength:flow[2]}},640,400);
    assert.deepEqual(Array.from(e.core.stats().flow),flow,'interrupted return starts with the same internal roll');
    for(const startStrength of [-8,NaN,Infinity,'1',8]) {
        e.render(8,{...defaults,transport:{...route,progress:0,startStrength}},640,400);
        assert.equal(e.core.stats().flow[2],startStrength===8?1:0,'optional starting strength is finite and clamped');
    }
    e.render(8,{...defaults,transport:{...route,progress:1,startStrength:1}},640,400);
    assert.equal(e.core.stats().flow[2],0,'the arrival always settles into idle coordinates');
    e.core.dispose();released(e);
});
check('packet trajectories have independent timing, exact endpoints and a finite analytic inverse',()=>{
    const smooth=v=>{v=Math.max(0,Math.min(1,v));return v*v*(3-2*v);};
    const rotate=([x,y],a)=>[Math.cos(a)*x-Math.sin(a)*y,Math.sin(a)*x+Math.cos(a)*y];
    const route={from:[.4,.5],to:[-.85,-.7],fromScale:1,toScale:.2,bend:.18};
    function packet(progress,depth) {
        const delta=route.to.map((v,i)=>v-route.from[i]),distance=Math.hypot(...delta),normal=[-delta[1]/distance,delta[0]/distance];
        const envelope=Math.sin(progress*Math.PI)**2,lane=.66*Math.sin(depth*4.3+.7)+.34*Math.sin(depth*8.1-1.1);
        const t=smooth(progress+envelope*lane*.19),orbit=Math.sin(depth*11.1-progress*4.4)*.080+Math.sin(depth*17.3+progress*3)*.035;
        const center=route.from.map((v,i)=>v+delta[i]*t+normal[i]*distance*(4*route.bend*t*(1-t)+envelope*orbit));
        return {center,scale:route.fromScale+(route.toScale-route.fromScale)*t,
            turn:Math.sin(progress*Math.PI)*Math.sin(depth*5.1-progress*3.6)*.78,t};
    }
    const phases=[];
    for(const progress of [0,.00001,.17,.5,.83,.99999,1])for(let i=0;i<30;i++) {
        const depth=-1.1+i*2.2/29,state=packet(progress,depth),point=[Math.sin(i*2.3)*.7,Math.cos(i*1.7)*.7];
        const rotated=rotate(point,state.turn),screen=rotated.map((v,k)=>v*state.scale+state.center[k]);
        const recovered=rotate(screen.map((v,k)=>(v-state.center[k])/state.scale),-state.turn);
        recovered.forEach((v,k)=>near(v,point[k],'packet inverse',1e-12));
        if(progress===0||progress===1){
            const expected=progress===0?route.from:route.to;
            state.center.forEach((v,k)=>near(v,expected[k],'exact packet endpoint',1e-12));
            near(state.turn,0,'no residual rotation at either endpoint',1e-12);
        }
        if(progress===.5)phases.push(state.t);
    }
    assert.ok(Math.max(...phases)-Math.min(...phases)>.35,'material packets are not attached to one shared center');
    assert.ok(packet(.00001,.4).t/.00001<.001,'departure velocity tends to zero');
    assert.ok((1-packet(.99999,.4).t)/.00001<.001,'arrival velocity tends to zero');
});
check('the fourth color independently tints unlit matter and front coats without rebuilding the colorless atlas',()=>{
    const e=environment();e.render(8);const builds=e.core.fieldBuilds,created=e.created.Texture.length;
    e.render(8,{...defaults,shadowColor:'#1188ee'});
    for(const name of ['strands','volume']) {
        assert.deepEqual(Array.from(e.core.programs[name].program.u_shadow),[17/255,136/255,238/255]);
        const fragment=e.core.programs[name].program.shaders.find(s=>s.source.includes('uniform vec3 u_particle')).source;
        assert.match(fragment,/u_shadow\*/,'unlit matter uses the supplied RGB, not an implicit black scalar');
    }
    assert.equal(e.core.fieldBuilds,builds);assert.equal(e.created.Texture.length,created);
    e.render(8,{...defaults,shadowColor:'red'});
    assert.deepEqual(Array.from(e.core.programs.volume.program.u_shadow),[7/255,20/255,35/255]);
    e.core.dispose();released(e);
});
check('shape attractors morph retained material and the shared volume without re-seeding or allocating new resources',()=>{
    const e=environment();e.render(8);const histories=e.core.histories.slice(),field=e.core.field,created=e.created.Texture.length;
    e.render(8,{...defaults,shape:'eye'});
    assert.equal(e.core.stats().shape,'eye');assert.equal(e.core.stats().morph,0);
    assert.deepEqual(Array.from(e.core.programs.volume.program.u_shape),[0,2,0]);
    e.render(8.825,{...defaults,shape:'eye'});
    near(e.core.stats().morph,.5,'smooth morph midpoint');
    for(const name of ['simulation','field','volume','strands']) {
        const shape=e.core.programs[name].program.u_shape;
        assert.equal(shape[0],0);assert.equal(shape[1],2);assert.ok(shape[2]>0&&shape[2]<1);
    }
    e.render(9.7,{...defaults,shape:'eye'});assert.equal(e.core.stats().morph,1);
    e.render(9.72,{...defaults,shape:'hand'});assert.equal(e.core.stats().shape,'hand');
    assert.equal(e.core.draws,undefined);assert.equal(e.core.histories[0],histories[0]);assert.equal(e.core.histories[1],histories[1]);
    assert.equal(e.core.field,field);assert.equal(e.created.Texture.length,created);
    assert.equal(e.draws.filter(d=>d.program===e.core.programs.simulation.program&&d.initialize===1).length,1);
    const shader=e.core.programs.simulation.program.shaders.find(s=>s.source.includes('uniform float u_dt')).source;
    assert.match(shader,/v\+=\(morphGuide\(p,row,t\)-p\)\*3\.4\*morph/,'silhouettes are material velocity attractors');
    assert.match(shader,/starPoint\(k\*2\.0,5\.0,\.77,-1\.5707963\)/,'pentagram extreme points start downwards');
    e.core.dispose();released(e);
});
check('all basic silhouettes are available at a frozen phase and reduced motion requires no extra loop',()=>{
    const e=environment();e.render(8);const steps=e.core.steps,created=e.created.Texture.length;
    for(const [shape,id] of Object.entries({organic:0,pentagram:1,eye:2,hand:3,sword:4,octagram:5})) {
        const builds=e.core.fieldBuilds;
        e.render(8,{...defaults,shape,static:true});
        assert.equal(e.core.stats().shape,shape);assert.deepEqual(Array.from(e.core.programs.volume.program.u_shape),[id,id,1]);
        assert.equal(e.core.programs.strands.program.u_static[0],1);
        assert.ok(e.core.fieldBuilds>=builds);const after=e.core.fieldBuilds;
        e.render(8,{...defaults,shape,static:true});assert.equal(e.core.fieldBuilds,after,'same frozen shape reuses the atlas');
    }
    e.render(8,{...defaults,shape:'sword',speed:0});assert.equal(e.core.programs.strands.program.u_static[0],1);
    assert.equal(e.core.steps,steps);assert.equal(e.created.Texture.length,created);
    e.render(8,{...defaults,shape:'unknown',static:true});assert.equal(e.core.stats().shape,'organic');
    e.core.dispose();released(e);
});
function testCatalog() {
    const calls=[],guides=new Map(),ids=new Set(['organic','lotus','dragon','eye']);
    return {calls,get(id){return ids.has(id)?{id}:undefined;},guide(id,size){
        assert.equal(size,128);calls.push(id);if(id==='organic')return null;
        if(!guides.has(id)){
            const data=new Float32Array(size*size*4),offset=id==='dragon'?.24:id==='lotus'?-.24:0;
            for(let y=0;y<size;y++)for(let x=0;x<size;x++){
                const i=(y*size+x)*4,px=x/(size-1)*2-1,py=y/(size-1)*2-1;
                data[i]=offset;data[i+1]=Math.max(-.8,Math.min(.8,py));data[i+2]=Math.abs(px-offset);data[i+3]=.05;
            }
            guides.set(id,data);
        }
        return guides.get(id);
    }};
}
check('catalog forms lazily upload only selected fixed-size material guides and reuse GPU resources',()=>{
    const catalog=testCatalog(),e=environment({catalog});e.render(8);
    assert.deepEqual(catalog.calls,[],'no catalog texture builds at startup');
    const histories=e.core.histories.slice(),field=e.core.field;
    e.render(8,{...defaults,shape:'lotus'});
    assert.equal(e.core.stats().shape,'lotus');assert.equal(e.core.stats().morph,0);
    assert.deepEqual(catalog.calls,['lotus']);assert.equal(e.uploads.length,1);
    assert.equal(e.uploads[0].w,128);assert.equal(e.uploads[0].h,128);assert.equal(e.uploads[0].internal,e.gl.RGBA16F);
    const guideTexture=e.uploads[0].texture;
    for(const name of ['field','volume','strands']){
        const program=e.core.programs[name].program;
        assert.deepEqual(Array.from(program.u_guideMode),[0,1,0]);
        assert.deepEqual(Array.from(program.u_guideWeights),[0,1,0]);
        assert.equal(program.u_shapeGuideFrom[0],3);assert.equal(program.u_shapeGuideTo[0],4);
    }
    e.render(8.4,{...defaults,shape:'lotus'});assert.equal(e.uploads.length,1,'animation never uploads guides per frame');
    e.render(8.4,{...defaults,shape:'dragon'});
    assert.equal(e.core.stats().morph,0);assert.notEqual(e.core.shapeState.from,e.core.shapeState.to);
    assert.ok(e.core.programs.field.program.u_guideWeights[0]>0&&e.core.programs.field.program.u_guideWeights[0]<1,
        'interrupted organic attraction is retained, not rounded to an old endpoint');
    assert.equal(e.core.guideTextures.to,guideTexture,'target storage is replaced in place');
    assert.equal(e.core.programs.field.program.u_snapshotWeight[0],1,'the first interrupted volume is exactly the previous atlas');
    const snapshot=e.core.shapeSnapshot,textureCount=e.created.Texture.length;
    e.render(8.6,{...defaults,shape:'dragon'});
    assert.ok(e.core.programs.field.program.u_snapshotWeight[0]<1);
    e.render(8.6,{...defaults,shape:'eye'});
    assert.equal(e.core.shapeSnapshot,snapshot);assert.equal(e.created.Texture.length,textureCount,'repeated interruptions reuse two guides and one snapshot');
    assert.equal(e.core.histories[0],histories[0]);assert.equal(e.core.histories[1],histories[1]);assert.equal(e.core.field,field);
    assert.equal(e.draws.filter(d=>d.program===e.core.programs.simulation.program&&d.initialize===1).length,1,'no particle history reseed');
    e.render(10.3,{...defaults,shape:'eye'});assert.equal(e.core.stats().morph,1);
    assert.equal(e.core.programs.field.program.u_snapshotWeight[0],0);
    e.core.dispose();released(e);
});
check('catalog guides survive context restore, static presentation snaps only when requested and cleanup is complete',()=>{
    const e=environment({catalog:testCatalog()});e.render(8,{...defaults,shape:'dragon',static:true});
    assert.equal(e.core.stats().morph,1);assert.equal(e.core.programs.strands.program.u_static[0],1);
    const previous=e.core.guideTextures.to;
    e.lost();e.restored();e.render(8,{...defaults,shape:'dragon',static:true});
    assert.notEqual(e.core.guideTextures.to,previous);assert.ok(e.live.Texture.has(e.core.guideTextures.to));
    e.render(8,{...defaults,shape:'not-a-shape',static:true});assert.equal(e.core.stats().shape,'organic');
    assert.deepEqual(Array.from(e.core.programs.field.program.u_guideWeights),[0,0,0]);
    e.core.dispose();e.core.dispose();released(e);
});
check('the real catalog reaches the renderer as selected material guides, not texture overlays or a GLSL branch per form',()=>{
    const e=environment({realCatalog:true});e.render(8);
    for(const shape of ['butterfly','hourglass','pentagram']) {
        const prior=e.core.histories[0];e.render(8,{...defaults,shape,static:true});
        assert.equal(e.core.stats().shape,shape);assert.equal(e.core.stats().morph,1);
        assert.equal(e.core.histories[0],prior);
        const data=e.core.guideTo.data;
        assert.equal(data.length,128*128*4);assert.ok(data.every(Number.isFinite));
        assert.equal(e.core.programs.strands.program.u_guideMode[1],1);
    }
    const shader=e.core.programs.field.program.shaders.find(s=>s.source.includes('vec4 materialGuide')).source;
    assert.match(shader,/texture\(u_shapeGuideTo,uv\)/);assert.match(shader,/guide\.z=max\(guide\.z,length\(p-guide\.xy\)\)/);
    assert.doesNotMatch(shader,/butterfly|hourglass/,'the new catalog does not enlarge the shader branch tree');
    assert.equal(e.core.stats().filaments,2560);e.core.dispose();released(e);
});
check('river state is per presentation, resets for other avatars and rejects nonfinite geometry',()=>{
    const e=environment(),valid={progress:.5,from:[.2,.4],to:[-.8,-.7],fromScale:1.1,toScale:.2};
    e.render(8,{...defaults,transport:valid});
    assert.deepEqual(Array.from(e.core.programs.volume.program.u_transport),[1,.5,.16]);
    for(const transport of [undefined,null,{...valid,progress:NaN},{...valid,from:[NaN,0]},
        {...valid,to:[0,Infinity]},{...valid,from:[0]},{...valid,to:['0',0]}]) {
        e.render(8,{...defaults,transport});
        for(const name of ['volume','strands']) {
            const p=e.core.programs[name].program;
            assert.deepEqual(Array.from(p.u_transport),[0,0,0]);
            assert.deepEqual(Array.from(p.u_transportFrom),[0,0,1]);
            assert.deepEqual(Array.from(p.u_transportTo),[0,0,1]);
        }
    }
    e.render(8,{...defaults,transport:{...valid,progress:50,from:[-99,99],to:[99,-99],fromScale:-10,toScale:100,bend:100}});
    const p=e.core.programs.volume.program;
    assert.deepEqual(Array.from(p.u_transport),[1,1,.35]);
    assert.deepEqual(Array.from(p.u_transportFrom),[-2,2,.01]);
    assert.deepEqual(Array.from(p.u_transportTo),[2,-2,8]);
    e.render(8,{...defaults,transport:{...valid,bend:-.18}});
    assert.deepEqual(Array.from(p.u_transport),[1,.5,-.18],'the river can bend into available space above the lower dock');
    e.render(8);assert.deepEqual(Array.from(p.u_transport),[0,0,0],'a normal avatar never inherits the river');
    e.core.dispose();released(e);
});
check('the core does not subscribe to input/media or fetch original footage',()=>{
    assert.doesNotMatch(source,/getUserMedia|AudioContext|pointermove|mousemove|gunter-audio-level|\bfetch\s*\(|gl\.POINTS|createElement\(['"]video/);
    const e=environment();assert.deepEqual([...e.listeners.keys()],['webglcontextlost','webglcontextrestored']);e.core.dispose();released(e);
});
console.log(checks+' GPU material filament checks passed.');
