'use strict';
// WebGL2 resource/dispatch contracts. Native shader and visual checks run separately.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../js/components/gunter-idle-core.js'),'utf8');
const defaults={particleColor:'#b8bec9',energyColor:'#ff452b',glowColor:'#ff6d35',brightness:1,density:1,speed:1,size:1};
const STEP=1/45;
let checks=0;
const filter=process.argv[2]?new RegExp(process.argv[2]):null;
const check=(name,fn)=>{if(filter&&!filter.test(name))return;fn();console.log('ok '+(++checks)+' - '+name);};
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
        assert.equal(mode,gl.TRIANGLES);assert.ok(count===3||count===6||count===96*64*6);
        const samplers={};
        const pathSamplers=['u_pathsFrom','u_rowsFrom','u_pathsTo','u_rowsTo'].filter(name=>program.u_pathMode?.[name.endsWith('From')?0:1]>0);
        for(const name of ['u_history','u_image','u_bloom','u_volume','u_field','u_bio','u_velocity',...pathSamplers])if(program[name]) {
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
    assert.equal(e.live.Framebuffer.size,10);assert.equal(e.live.Texture.size,10);
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
    assert.deepEqual(Object.keys(build.samplers),['u_bio','u_velocity'],'all conservatively bound shared samplers avoid the matter atlas destination');
    const shader=e.core.programs.field.program.shaders.find(s=>s.source.includes('out vec4 result')).source;
    assert.match(shader,/result\s*=\s*vec4\(density,heat,light,facing\)/);
    const volume=e.draws.find(d=>d.program===e.core.programs.volume.program),strands=e.draws.find(d=>d.instances);
    assert.equal(volume.samplers.u_field.unit,0);assert.equal(volume.samplers.u_field.texture,field.texture);
    assert.equal(strands.samplers.u_field.unit,2);assert.equal(strands.samplers.u_field.texture,field.texture);
    assert.equal(strands.samplers.u_history.unit,0);
    assert.equal(strands.samplers.u_history.texture,e.core.histories[e.core.historyIndex].texture);
    assert.equal(strands.samplers.u_volume.unit,1);assert.equal(strands.samplers.u_volume.texture,e.core.targets.energy.texture);
    assert.equal(e.core.targets.energy.texture.internal,e.gl.RGBA16F);
    assert.equal(e.live.Framebuffer.size,10);assert.equal(e.live.Texture.size,10);
    const fragment=e.core.programs.strands.program.shaders.find(s=>s.source.includes('uniform sampler2D u_volume')).source;
    assert.match(fragment,/texture\(u_volume,gl_FragCoord.xy\/u_resolution\)/);
    for(const name of ['strands','volume']) {
        const cached=e.core.programs[name].program.shaders.find(s=>s.source.includes('vec4 mediumAt')).source;
        assert.match(cached,/texture\(u_field,/);assert.match(cached,/vec4 material=mediumAt\(/);
    }
    e.core.dispose();released(e);
});
check('real advected biomass supplies composite heat, irradiance and thermal coupling without an analytic tube',()=>{
    const e=environment();
    const field=e.core.programs.field.program.shaders.find(s=>s.source.includes('out vec4 result')).source;
    const center=field.match(/vec3 energyCenter\(float t\)\s*\{([\s\S]*?)\n        \}/)[1];
    assert.match(center,/idleCenter\(t\)\*\.25\+worldPoint\(vec3\(u_pointer\.xy\*\.14,0\)\)/,
        'the current follows the material center with a bounded internal excursion');
    assert.match(field,/vec4 gas=bioAt\(p\);\s*float density=matterDensity\(p,u_time\),heat=max\(0\.0,gas\.r\*gas\.g-\.035\)/,
        'the compositor samples the independent carried density and temperature');
    assert.match(field,/light=bioRadiance\(p\)\*exp\(-obstruction\*\.17\*u_density\)/,
        'local irradiance comes from neighbouring gas with density absorption');
    assert.match(field,/vec3 gradient=bioGradient\(p\)/,'the energy gradient participates in the shared velocity field');
    assert.doesNotMatch(field,/energyCurve|energyHeat|energySource/,'no analytic bent emitter remains');
    assert.match(field,/if\(heat>\.0001\)\s*\{\s*vec3 depth=worldPoint\(vec3\(0,0,\.18\)\);\s*float cover=density\+matterDensity\(p\+depth,u_time\)\+matterDensity\(p-depth,u_time\);\s*heat\*=smoothstep\(\.025,\.18,cover\);/,
        'only the emitter neighbourhood pays for actual front/back material containment');
    assert.match(field,/result=vec4\(density,heat,light,facing\)/,'both visible passes receive the contained heat');
    e.core.dispose();released(e);
});
check('buried gas emits within the depth march while only matter extinguishes it and front fibres cover it',()=>{
    const e=environment();
    const volume=e.core.programs.volume.program.shaders.find(s=>s.source.includes('vec4 material=mediumAt(p)')).source;
    const extinction=volume.match(/float density=([^;]+);/)[1];
    assert.match(extinction,/opticalMass\*opticalMass\*grain/);assert.doesNotMatch(extinction,/material\.g|heat|emission/,
        'the energy support cannot create an opaque glowing front shell');
    assert.match(volume,/color\+=\(1\.0-opacity\)\*\(scattered\*density\+emitted\*emission\)/,
        'emission passes through the opacity already accumulated in front of its 3D sample');
    assert.match(volume,/opacity\+=\(1\.0-opacity\)\*density/);
    const strands=e.core.programs.strands.program.shaders.find(s=>s.source.includes('uniform sampler2D u_volume')).source;
    assert.match(strands,/buried=bioEnergy\(rest-worldPoint\(vec3\(0,0,\.16\)\)\)/,
        'a filament covers actual luminous gas lying behind its 3D location');
    assert.match(strands,/color=mix\(color,coat,frontCover\*\.88\)/,'front microfibres keep their shaded material color');
    assert.match(strands,/transmission=mix\(transmission,1\.0,frontTransmission\*\.85\)/,
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
    assert.equal(e.live.Framebuffer.size,10);assert.equal(e.live.Texture.size,10);
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
        [{failFramebufferAt:2},/buffer GPU/],[{failFramebufferAt:3},/buffer GPU/],[{failFramebufferAt:4},/buffer GPU/],
        [{failFramebufferAt:5},/buffer GPU/],[{failFramebufferAt:6},/buffer GPU/]]) {
        const e=environment(options);assert.equal(e.core.available,false);assert.match(e.core.error,message);released(e);
        assert.equal(e.core.field,null);
    }
    const e=environment();e.options.failFramebufferAt=7;
    const field=e.core.field;
    assert.throws(()=>e.render(),/buffer GPU/);assert.equal(e.live.Framebuffer.size,6);assert.equal(e.core.field,field);
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
    assert.equal(e.live.Framebuffer.size,10);assert.equal(e.live.Texture.size,10);
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
    assert.equal(e.live.Framebuffer.size,10);assert.ok(e.core.steps>steps);
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
    assert.equal(e.live.Framebuffer.size,10);assert.equal(e.live.Texture.size,10);
    assert.equal(e.core.stats().volumeGrid,48);assert.equal(e.core.stats().volumeSamples,40);
    e.core.dispose();released(e);
});
check('voice radiance modulates the buried energy and illuminated fibres, not a timed screen pulse',()=>{
    const e=environment();e.render(8);
    const volume=e.core.programs.volume.program.shaders.find(shader=>shader.source.includes('vec3 emitted=')).source;
    const strands=e.core.programs.strands.program.shaders.find(shader=>shader.source.includes('vec3 coat=')).source;
    assert.match(volume,/u_energy\*\(2\.1\+bodyWeight\*2\.1\+u_pointer\.z\*heat\*\.28\+u_audio\*1\.70\)/);
    assert.match(volume,/color\+=\(1\.0-opacity\)\*\(scattered\*density\+emitted\*emission\)/);
    assert.match(strands,/u_glow\*emission\*emission\*\(\.35\+u_pointer\.z\*\.32\+u_audio\*1\.45\)/);
    for(const level of [0,.03,.15,0]) {
        e.core.setAudioLevel(level,true);e.render(8);
        assert.equal(e.core.programs.volume.program.u_audio[0],1-Math.exp(-level*5));
    }
    assert.equal(e.core.programs.volume.program.u_audio[0],0,'silence restores idle radiance');
    assert.equal(e.live.Framebuffer.size,10);e.core.dispose();released(e);
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
    assert.match(simulation,/if\(u_flow\.z>\.0001\)\s*\{\s*vec3 curl,fine/,'idle skips both zero-weight travel curls');
    assert.match(simulation,/eddies=\(curl\*\(\.16\+pocket\*\.12\)\+fine\*\.105\+slip\)\*u_flow\.z/);
    assert.match(simulation,/rest\+=\(velocity\(rest\+v\*u_dt\*\.5,u_time\+u_dt\*\.5,row,1\.0,along\)\+eddies\)\*u_dt/,
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
        const envelope=Math.sin(progress*Math.PI)**2,lane=.66*Math.sin(depth*2.6+.7)+.34*Math.sin(depth*4.1-1.1);
        const t=smooth(progress+envelope*lane*.19),orbit=Math.sin(depth*4.7-progress*4.4)*.080+Math.sin(depth*7.3+progress*3)*.035;
        const center=route.from.map((v,i)=>v+delta[i]*t+normal[i]*distance*(4*route.bend*t*(1-t)+envelope*orbit));
        return {center,scale:route.fromScale+(route.toScale-route.fromScale)*t,
            turn:Math.sin(progress*Math.PI)*Math.sin(depth*3.1-progress*3.6)*.78,t};
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
    assert.ok(Math.max(...phases)-Math.min(...phases)>.28,'material packets are not attached to one shared center, without dense high-frequency layers');
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
    assert.match(shader,/v\+=\(morphGuide\(p,row,t,along\)-p\)\*4\.2\*morph/,'silhouettes are per-segment material velocity attractors');
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
check('authored paths assign one stable stroke to each fibre with constant-time GPU lookup and bounded storage',()=>{
    const e=environment({realCatalog:true});e.render(8);
    const histories=e.core.histories.slice();
    e.render(8,{...defaults,shape:'jellyfish'});
    const paths=e.core.guideTo.paths,slots=e.core.pathTextures.to;
    assert.equal(paths.width,128);assert.ok(paths.height>1&&paths.height<=128);
    assert.equal(slots.paths.w,128);assert.equal(slots.paths.h,paths.height);
    assert.equal(slots.rows.w,1280);assert.equal(slots.rows.h,1);
    const assignments=e.uploads.find(upload=>upload.texture===slots.rows).data;
    const seen=new Set();
    for(let row=0;row<1280;row++) {
        const id=assignments[row*4];seen.add(id);
        assert.ok(Number.isInteger(id)&&id>=0&&id<paths.height);
        assert.equal(assignments[row*4+1],paths.strokes[id].closed?1:0);
    }
    assert.equal(seen.size,paths.height,'the row assignments cover the independent authored strokes');
    const simulation=e.core.programs.simulation.program.shaders.find(s=>s.source.includes('uniform float u_dt')).source;
    const sampling=simulation.slice(simulation.indexOf('vec4 pathSample'),simulation.indexOf('vec3 guidedPoint'));
    assert.match(sampling,/texelFetch\(u_rowsTo,ivec2\(index,0\),0\)/);
    assert.match(sampling,/route\.y>\.5\?fract\(phase\):1\.0-abs\(mod\(phase,2\.0\)-1\.0\)/,
        'only closed strokes wrap; open limbs reflect without artificial closing segments');
    assert.doesNotMatch(sampling,/for\s*\(|while\s*\(|materialGuide/,'no scan or nearest-neighbour crossing per GPU sample');
    assert.match(sampling,/tangent=normalize\(end-start\+vec2/,'normal follows the authored increasing parameter even during a reflected return');
    assert.match(sampling,/max\(0\.0,phase-\.006\)/);assert.match(sampling,/min\(1\.0,phase\+\.006\)/);
    assert.doesNotMatch(simulation,/pathSample\(row,along\+\.008/,'return direction never flips the strand offset normal');
    const created=e.created.Texture.length;e.render(8.1,{...defaults,shape:'jellyfish'});
    assert.equal(e.created.Texture.length,created,'path textures are not uploaded per frame');
    const oldTo=e.core.pathTextures.to;e.render(8.1,{...defaults,shape:'hand'});
    const max=e.created.Texture.length;e.render(8.2,{...defaults,shape:'eye'});
    assert.equal(e.core.pathTextures.to,oldTo);assert.equal(e.created.Texture.length,max,'interruptions reuse both path/assignment slots');
    assert.equal(e.core.histories[0],histories[0]);
    e.lost();e.restored();e.render(8.2,{...defaults,shape:'eye'});
    assert.ok(e.live.Texture.has(e.core.pathTextures.to.paths));assert.ok(e.live.Texture.has(e.core.pathTextures.to.rows));
    e.core.dispose();released(e);
});
check('gas and material read the same previous energy field and a size-correct local pointer obstacle',()=>{
    const e=environment();e.render(8);e.core.setPointer(.3,-.2);e.render(8.1,{...defaults,size:.7});
    const material=e.draws.filter(d=>d.program===e.core.programs.simulation.program);
    const energy=e.draws.filter(d=>d.program===e.core.programs.bio.program);
    assert.equal(material.length,energy.length);
    for(let i=0;i<material.length;i++)assert.equal(material[i].samplers.u_bio.texture,energy[i].samplers.u_bio.texture,
        'the two independent integrators read exactly the same prior luminous medium');
    for(const name of ['simulation','bio','field','volume','strands'])assert.equal(e.core.programs[name].program.u_visualSize[0],.7);
    const shader=e.core.programs.simulation.program.shaders.find(s=>s.source.includes('uniform float u_dt')).source;
    assert.match(shader,/u_pointer\.xy\/max\(\.01,u_visualSize\*\.80\)/,'cursor position is not the tiny energy-centre offset');
    assert.match(shader,/away=p-cursor/);assert.match(shader,/obstacle=u_pointer\.z\*exp/,'repulsion has compact smooth falloff');
    assert.match(shader,/cross\(away,worldPoint\(vec3\(0,0,1\)\)\)/,'flow slips around the pointer rather than translating the object');
    e.core.dispose();released(e);
});
check('one shared velocity atlas is built per fixed step and both RK2 integrators reuse it without feedback',()=>{
    const e=environment();e.render(8);const cache=e.core.velocityField,created=e.created.Texture.length;
    assert.equal(cache.width,384);assert.equal(cache.height,288);assert.equal(cache.texture.internal,e.gl.RGBA16F);
    e.core.setPointer(.25,-.2);e.render(8.1);
    const builds=e.draws.filter(d=>d.program===e.core.programs.velocity.program);
    const material=e.draws.filter(d=>d.program===e.core.programs.simulation.program);
    const gas=e.draws.filter(d=>d.program===e.core.programs.bio.program);
    assert.equal(builds.length,e.core.steps);assert.equal(builds.length,material.length);assert.equal(builds.length,gas.length);
    for(let i=0;i<builds.length;i++) {
        assert.equal(builds[i].texture,cache.texture);
        assert.notEqual(builds[i].samplers.u_velocity.texture,cache.texture,'builder never samples its own destination even with conservative bindings');
        assert.equal(material[i].samplers.u_velocity.texture,cache.texture);
        assert.equal(gas[i].samplers.u_velocity.texture,cache.texture);
        assert.equal(material[i].samplers.u_velocity.unit,11);assert.equal(gas[i].samplers.u_velocity.unit,11);
        assert.equal(builds[i].samplers.u_bio.texture,material[i].samplers.u_bio.texture,'common flow uses the same previous biomass');
        assert.ok(e.draws.indexOf(builds[i])<e.draws.indexOf(material[i])&&e.draws.indexOf(material[i])<e.draws.indexOf(gas[i]));
    }
    const simulation=e.core.programs.simulation.program.shaders.find(s=>s.source.includes('uniform float u_dt')).source;
    const velocity=simulation.slice(simulation.indexOf('vec3 velocity('),simulation.indexOf('vec3 seedPosition'));
    assert.match(velocity,/vec3 v=cachedVelocity\(p\)/);assert.doesNotMatch(velocity,/potential\(|energyTransport\(|bioGradient\(/,
        'individual RK stages no longer recompute the expensive common flow');
    const builder=e.core.programs.velocity.program.shaders.find(s=>s.source.includes('result=vec4(organicVelocity')).source;
    assert.match(builder,/result=vec4\(organicVelocity\(p,u_time\),1\)/);
    assert.equal(e.core.stats().velocityCache,'shared-48cubed-per-step');assert.equal(e.created.Texture.length,created);
    const count=builds.length;e.render(e.core.displayTime);assert.equal(e.draws.filter(d=>d.program===e.core.programs.velocity.program).length,count,
        'other views of the same state never build an extra velocity cache');
    e.lost();e.restored();e.render(8.1);assert.notEqual(e.core.velocityField,cache);assert.ok(e.live.Texture.has(e.core.velocityField.texture));
    e.core.dispose();released(e);
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
check('the independent energy volume ping-pongs a bounded 48 cubed state through the shared velocity field',()=>{
    const e=environment();e.render(8);const initial=e.core.bioHistories.slice(),created=e.created.Texture.length;
    assert.equal(initial.length,2);assert.notEqual(initial[0],e.core.field);
    for(const target of initial) {
        assert.equal(target.width,384);assert.equal(target.height,288);assert.equal(target.texture.internal,e.gl.RGBA16F);
    }
    const before=e.core.bioSteps;e.render(8.1);
    assert.ok(e.core.bioSteps>before);assert.equal(e.core.bioSteps,e.core.steps);
    const builds=e.draws.filter(d=>d.program===e.core.programs.bio.program);
    assert.equal(builds[0].initialize,1);assert.ok(builds.slice(1).every(d=>d.initialize===0));
    assert.notEqual(builds[1].samplers.u_bio.texture,builds[1].texture,'advection reads the prior target');
    assert.notEqual(builds[1].texture,builds[2].texture,'energy storage alternates');
    assert.equal(e.created.Texture.length,created,'no per-frame energy allocation');
    const fragment=e.core.programs.bio.program.shaders.find(s=>s.source.includes('vec2 bioSource')).source;
    assert.match(fragment,/back=p-velocity\(p-v\*u_dt\*\.5/,'RK2 follows the same velocity() as matter');
    assert.match(fragment,/previous=bioAt\(back\)/,'energy is advected from actual prior density and temperature');
    assert.match(fragment,/mass=mix\(carried\.r,restMass,1\.0-exp\(-u_dt\*\.62\)\)\*exp\(-u_dt\*\.06\)/,'bounded local relaxation/cooling retain history');
    assert.match(fragment,/coarse\.y\+folds\.x/,'multi-scale scalar saddles form lobes, not separate point emitters');
    assert.match(fragment,/tracer=mix\(previous\.b,grainSeed/,'material detail carries an advected tracer, not a screen texture');
    const volume=e.core.programs.volume.program.shaders.find(s=>s.source.includes('u_debugView')).source;
    assert.match(volume,/rest\*vec3\(48\.0,57\.0,53\.0\)\+gas\.b/,'fine grain uses material coordinates warped by the transported tracer');
    assert.match(volume,/lobes=heat\/\(\.28\+heat\)/,'local thermal transfer remains continuous instead of saturating into uniform fog');
    assert.match(volume,/emission=absorption\*lobes\*\(1\.45\+gas\.g\*\.55\)/,'isolated energy shares optical depth for emission and extinction');
    assert.equal(e.core.stats().energySimulation,'gpu-semilagrangian-48cubed');
    e.core.dispose();released(e);
});
check('the biomass substrate connects lobes and absorbs boundary gas by seconds, not by frame count',()=>{
    const e=environment();e.render(8);
    const shader=e.core.programs.bio.program.shaders.find(s=>s.source.includes('vec2 bioSource')).source;
    assert.match(shader,/density=body\*\(substrate\*\.75\+conduit\*\(\.46\+cavities\*\.48\)/,
        'a finite porous substrate and connected saddle survive between hot chambers');
    assert.match(shader,/boundaryTransmission=exp\(-u_dt\*\(1\.0-support\)\*6\.0\)/);
    assert.match(shader,/mass\*boundaryTransmission/);assert.doesNotMatch(shader,/clamp\(mass\*support/);
    assert.match(shader,/shapedEnergySupport\(p,false\)\*channels/);
    assert.match(shader,/shapedEnergySupport\(p,true\)\*channels/);
    assert.match(shader,/density=mix\(a,b,u_shape\.z\)/,'morph redistributes the fractional renewal source instead of painting emissive contour lines');
    assert.match(shader,/else if\(morph>\.0001\)/,'Eulerian energy receives support attraction without requiring a fibre row');
    assert.match(shader,/mix\(p,shapedSupport\(p,false\),u_guideWeights\.x\)/);
    assert.match(shader,/mix\(p,shapedSupport\(p,true\),u_guideWeights\.y\)/);
    assert.match(shader,/xy=guide\.z<0\.0\?q\.xy:guide\.xy/,'gas stays inside the body rather than collapsing to its contour');
    assert.match(shader,/v\*=1\.0-morph\*\.70;\s*v\+=\(mix\(a,b,u_shape\.z\)-p\)\*2\.4\*morph/,
        'the gas remains near thin authored supports while retaining tangential flow');
    assert.match(shader,/restMass=min\(1\.45,source\.r\*1\.8\)/,'source restoration has a finite calibrated target rather than accumulating each step');
    for(const sourceMass of [.05,.3,.7,1.1]) {
        const target=Math.min(1.45,sourceMass*1.8);let mass=sourceMass;
        for(let step=0;step<45*120;step++)mass=(mass+(target-mass)*(1-Math.exp(-STEP*.62)))*Math.exp(-STEP*.06);
        assert.ok(mass<=target&&mass>=0,'two-minute density stays bounded by the local target');
        assert.ok(mass<sourceMass*1.8,'the former ~2.5x source/cooling accumulation is impossible');
    }
    // Exact exponential absorption has identical one-second survival at any
    // integrator subdivision. In contrast, the previous .8^step mask erased it.
    for(const support of [.2,.5,.8,1]) {
        const expected=Math.exp(-(1-support)*6);
        for(const steps of [15,30,45,90])near(Math.exp(-(1-support)*6/steps)**steps,expected,'boundary survival independent of subdivision',1e-12);
    }
    assert.ok(Math.exp(-.2*6)>.25&&.8**45<.00005,'the outer connecting gas has a finite lifetime rather than disappearing per step');
    e.core.dispose();released(e);
});
check('four isolated debug views filter presentation only and never save preferences or reset simulation',()=>{
    const e=environment();e.render(8);const histories=e.core.histories.slice(),bio=e.core.bioHistories.slice(),created=e.created.Texture.length;
    for(const [debugView,value,filaments] of [['energy',1,false],['matter',2,false],['filaments',3,true],['composite',0,true],['invalid',0,true]]) {
        const count=e.draws.filter(d=>d.instances).length;
        e.render(8,{...defaults,debugView});
        assert.equal(e.core.programs.volume.program.u_debugView[0],value);
        assert.equal(e.draws.filter(d=>d.instances).length,count+(filaments?1:0));
    }
    assert.equal(e.core.histories[0],histories[0]);assert.equal(e.core.bioHistories[0],bio[0]);
    assert.equal(e.created.Texture.length,created);assert.equal(e.core.steps,1);
    e.core.dispose();released(e);
});
check('cursor inverse matches the travelling centre plane without a second model in the input owner',()=>{
    const e=environment(),Core=e.core.constructor;
    const route={from:[.1,.2],to:[-.8,-.6],fromScale:1.2,toScale:.22,bend:.16};
    for(const [width,height] of [[600,320],[320,600],[400,400]])for(const p of [0,.17,.5,.83,1]) {
        const aspect=[Math.min(width,height)/width,Math.min(width,height)/height];
        const envelope=Math.sin(p*Math.PI)**2,lane=.66*Math.sin(.7)+.34*Math.sin(-1.1);
        const phase=Math.max(0,Math.min(1,p+envelope*lane*.19)),t=phase*phase*(3-2*phase);
        const delta=route.to.map((v,i)=>(v-route.from[i])/aspect[i]),distance=Math.hypot(...delta);
        const orbit=Math.sin(-p*4.4)*.080+Math.sin(p*3)*.035;
        const lift=4*distance*route.bend*t*(1-t)+distance*envelope*orbit;
        const center=route.from.map((v,i)=>v/aspect[i]+delta[i]*t+(i===0?-delta[1]:delta[0])/distance*lift);
        const angle=Math.sin(p*Math.PI)*Math.sin(-p*3.6)*.78,scale=route.fromScale+(route.toScale-route.fromScale)*t;
        const local=[.24,-.31],screen=[center[0]+(Math.cos(angle)*local[0]-Math.sin(angle)*local[1])*scale,
            center[1]+(Math.sin(angle)*local[0]+Math.cos(angle)*local[1])*scale].map((v,i)=>v*aspect[i]);
        const point=Core.unprojectPointer(...screen,width,height,{...route,progress:p});
        near(point.x,local[0],'x inverse');near(point.y,local[1],'y inverse');
    }
    assert.deepEqual({...Core.unprojectPointer(NaN,0,400,400,route)},{x:0,y:0});
    assert.deepEqual({...Core.unprojectPointer(.25,-.25,600,300,null)},{x:.5,y:-.25});
    e.core.dispose();released(e);
});
check('signed material bodies spread existing fibres through volume and retain porous local illumination',()=>{
    const e=environment({realCatalog:true});e.render(8,{...defaults,shape:'hand'});
    assert.ok(e.core.guideTo.data.some((value,i)=>i%4===2&&value<0),'the selected guide includes a real interior');
    assert.ok(e.core.guideTo.paths.data.some((value,i)=>i%4===3&&Math.abs(value)>.02),'the same path texture carries interior reach');
    const simulation=e.core.programs.simulation.program.shaders.find(s=>s.source.includes('uniform float u_dt')).source;
    assert.match(simulation,/if\(guide\.z>=0\.0\)guide\.z=max/,'the sampler must not erase the signed interior');
    assert.match(simulation,/offset=mix\(path\.z\*grain\*\.82,path\.w\*filling,body\)/,'existing rows occupy the body instead of all piling onto its border');
    assert.match(simulation,/interior=smoothstep\(0\.0,\.17,-guide\.z\)/,'material thickness grows inside authored regions');
    assert.match(simulation,/textureMatter=packing\*cavity\*\(\.15\+fine\*fine\*1\.50\)\*\(\.82\+gas\.r\*\.45\)/,
        'named supports reuse the organic core material folds, cavities and fine grain');
    assert.match(simulation,/shapedDensity\(p,false,t,textureMatter\)/);assert.match(simulation,/shapedDensity\(p,true,t,textureMatter\)/);
    assert.match(simulation,/shapedSupport\(p,false\)/);assert.match(simulation,/shapedSupport\(p,true\)/);
    const fragment=e.core.programs.strands.program.shaders.find(s=>s.source.includes('out vec4 result')).source;
    assert.match(fragment,/frontCover\*=1\.0-morphWeight\(\)\*\.65/,'the front coat reveals buried energy instead of becoming opaque ink');
    assert.match(fragment,/alpha\*=mix\(\.42,\.68,morphWeight\(\)\)/,'organic microfibres frame the films instead of obscuring them');
    assert.match(fragment,/frontTransmission=frontCover/,'optical bypass survives the reduction of the shaded front coat');
    assert.match(fragment,/transmission=mix\(transmission,1\.0,frontTransmission\*\.85\)/);
    const gas=e.core.programs.bio.program.shaders.find(s=>s.source.includes('vec2 bioSource')).source;
    assert.match(gas,/shapedEnergySupport\(p,false\)\*channels/);
    assert.match(gas,/seams=1\.0-smoothstep\(\.12,\.45,abs\(coarse\.y\+folds\.x\*\.50\)\)/,'coherent gas seams are independent of the opaque matter folds');
    assert.doesNotMatch(gas,/shapedDensity\(p,false,t\)\*texturePacking/,'the brightest gas is not renewed exclusively inside the densest opaque folds');
    const volume=e.core.programs.volume.program.shaders.find(s=>s.source.includes('u_debugView')).source;
    assert.match(volume,/opticalMass=mass\*mix\(1\.0,\.72,morphWeight\(\)\)/,'porosity changes optical depth only for transformed matter');
    assert.match(volume,/opticalMass\*opticalMass\*grain\*18\.0/);
    assert.equal(e.core.stats().filaments,2560,'body detail does not increase particle count');
    e.core.dispose();released(e);
});
check('named silhouettes inherit live colors density brightness speed and size without new geometry or state resets',()=>{
    const e=environment({realCatalog:true});
    const first={...defaults,shape:'eye',static:true,shadowColor:'#122748'};
    e.render(8,first);const histories=e.core.histories.slice(),bio=e.core.bioHistories.slice(),paths=e.core.pathTextures.to;
    const created=e.created.Texture.length,steps=e.core.steps;
    const config={...first,particleColor:'#4060cc',energyColor:'#20ddff',glowColor:'#bb44dd',shadowColor:'#301240',
        brightness:1.6,density:1.8,size:1.2};
    e.render(8,config);
    for(const name of ['volume','strands']) {
        const p=e.core.programs[name].program;
        for(const [uniform,color] of [['u_particle',config.particleColor],['u_energy',config.energyColor],['u_glow',config.glowColor],['u_shadow',config.shadowColor]]) {
            assert.deepEqual(Array.from(p[uniform]),color.match(/[a-f0-9]{2}/g).map(v=>parseInt(v,16)/255));
        }
        assert.equal(p.u_brightness[0],1.6);assert.equal(p.u_size[0],1.2);
    }
    assert.equal(e.core.stats().filaments,4608);assert.equal(e.core.steps,steps);
    assert.equal(e.core.histories[0],histories[0]);assert.equal(e.core.bioHistories[0],bio[0]);
    assert.equal(e.core.pathTextures.to,paths);assert.equal(e.created.Texture.length,created);
    e.render(12,{...config,static:false,speed:.7});
    assert.equal(e.core.shapeName,'eye');assert.ok(e.core.steps>steps,'speed reaches the existing simulation clock');
    assert.equal(e.core.histories[0],histories[0]);
    e.core.dispose();released(e);
});
check('named optical porosity preserves organic extinction and does not reduce simulated matter or gas',()=>{
    const e=environment();
    const volume=e.core.programs.volume.program.shaders.find(s=>s.source.includes('vec4 material=mediumAt(p)')).source;
    assert.match(volume,/mass=max\(0\.0,material\.r-\.12\)/,'physical matter is unchanged');
    assert.match(volume,/opticalMass=mass\*mix\(1\.0,\.72,morphWeight\(\)\)/,'only the displayed optical coat becomes porous');
    assert.match(volume,/density=1\.0-exp\(-opticalMass\*opticalMass\*grain\*18\.0\*\(marchDepth\/40\.0\)\*u_density\)/);
    assert.match(volume,/thermalGrain=mix\(\.30\+1\.10\*smoothstep\(\.18,\.76,grains\),\s*\.08\+2\.40\*pow\(smoothstep\(\.30,\.72,grains\),2\.0\),morphWeight\(\)\)/,
        'named energy retains local granular peaks rather than lifting the whole body as smooth fog');
    for(const name of ['simulation','bio','field']) {
        const shader=e.core.programs[name].program.shaders.map(s=>s.source).join('\n');
        assert.doesNotMatch(shader,/opticalMass/,'presentation-only porosity never enters shared material/gas histories');
    }
    for(const mass of [0,.06,.3,.9])for(const grain of [.08,.8,1.9]) {
        const original=1-Math.exp(-mass*mass*grain*18*(1.92/40));
        let previous=original;
        for(const weight of [0,.2,.5,.8,1]) {
            const opticalMass=mass*(1+(0.72-1)*weight);
            const opacity=1-Math.exp(-opticalMass*opticalMass*grain*18*(1.92/40));
            if(weight===0)near(opacity,original,'organic optical depth remains exactly unchanged');
            assert.ok(Number.isFinite(opacity)&&opacity>=0&&opacity<=1,'finite nonnegative extinction');
            assert.ok(opacity<=previous+1e-12,'named coat thins continuously, never becomes more opaque');previous=opacity;
        }
    }
    const strands=e.core.programs.strands.program.shaders.find(s=>s.source.includes('uniform sampler2D u_volume')).source;
    assert.ok(strands.indexOf('frontTransmission=frontCover')<strands.indexOf('frontCover*=1.0-morphWeight()*.65'),
        'transmission keeps the original front-facing coverage before shading attenuation');
    assert.match(strands,/transmission=mix\(transmission,1\.0,frontTransmission\*\.85\)/);
    const composite=e.core.programs.composite.program.shaders.find(s=>s.source.includes('u_materialWeight')).source;
    assert.match(composite,/coverage=1\.0-pow\(max\(0\.0,1\.0-scene\.a\),mix\(1\.4,3\.6,u_materialWeight\)\)/);
    e.render(8,{...defaults,shape:'organic',static:true});
    assert.equal(e.core.programs.composite.program.u_materialWeight[0],0,'organic output coverage is unchanged');
    e.render(8,{...defaults,shape:'hand',static:true});
    assert.equal(e.core.programs.composite.program.u_materialWeight[0],1,'named fibres remain legible over light backgrounds');
    e.core.dispose();released(e);
});
check('signed interior gas support uses buried coherent channels independently of opaque matter folds',()=>{
    const e=environment();
    const shader=e.core.programs.bio.program.shaders.find(s=>s.source.includes('vec2 bioSource')).source;
    const support=shader.match(/float shapedEnergySupport\(vec3 p,bool target\)\s*\{([\s\S]*?)\n        \}/)[1];
    assert.match(support,/channel=1\.0-smoothstep\(guide\.w\*\.35,max\(\.035,guide\.w\*1\.6\),guide\.z\)/,
        'negative material distance retains full lateral support, not a squared-distance rim');
    assert.match(support,/interior=smoothstep\(0\.0,\.17,-guide\.z\)/);
    assert.match(support,/depth=1\.0-smoothstep\(\.025,\.075\+interior\*\.12,abs\(q\.z\+\.035\)\)/,
        'energy occupies a bounded depth shifted inside the material rather than a front-facing sticker');
    assert.match(support,/return channel\*depth/);
    assert.doesNotMatch(support,/pow\(guide\.z|shapedDensity|texturePacking/);
    const renewal=shader.slice(shader.indexOf('vec2 bioSource'),shader.indexOf('void main()',shader.indexOf('vec2 bioSource')));
    assert.match(renewal,/seams=1\.0-smoothstep\(\.12,\.45,abs\(coarse\.y\+folds\.x\*\.50\)\)/);
    assert.match(renewal,/channels=\(\.33\+seams\*1\.10\)\*texturePacking/,'finite substrate keeps connecting saddles alive between thermal channels');
    assert.match(renewal,/shapedEnergySupport\(p,false\)\*channels/);assert.match(renewal,/shapedEnergySupport\(p,true\)\*channels/);
    assert.doesNotMatch(renewal,/shapedDensity|matterDensity/,'source is not tied to the most opaque folds');
    assert.match(shader,/previous=bioAt\(back\)/,'existing carried gas supplies the next RK2 step');
    assert.match(shader,/mass=mix\(carried\.r,restMass,1\.0-exp\(-u_dt\*\.62\)\)/,'renewal remains fractional rather than resetting history');
    e.core.dispose();released(e);
});
check('compact membranes use narrow material bands and a wrinkled enclosing skin without extra field samples',()=>{
    const e=environment();e.render(8);
    const shader=e.core.programs.field.program.shaders.find(s=>s.source.includes('float matterDensity')).source;
    const matter=shader.slice(shader.indexOf('float matterDensity'),shader.indexOf('vec3 organicVelocity'));
    assert.match(matter,/envelope=1\.0-smoothstep\(\.54,\.72,radius\)/,'the underlying body is compact rather than a diffuse enclosing fog');
    assert.match(matter,/folds=abs\(sin\(foldPhase\)\)/);
    assert.match(matter,/membrane=1\.0-smoothstep\(\.07,\.39,folds\)/,'finite narrow bands form the translucent folded sheets');
    assert.match(matter,/skin=1\.0-smoothstep\(\.015,\.075,abs\(radius-\(\.55\+coarse\.z\*\.045\)\)\)/,
        'outer membrane follows irregular matter coordinates, not a smooth screen-space circle');
    assert.match(matter,/membrane\*membrane\*2\.15\+skin\*\.62/);
    assert.equal((matter.match(/potential\(/g)||[]).length,3,'existing coarse/warp/fine fields are reused, not multiplied');
    assert.match(matter,/shapedDensity\(p,false,t,textureMatter\)/);assert.match(matter,/shapedDensity\(p,true,t,textureMatter\)/,
        'requested silhouettes inherit the same membrane material');
    const gas=e.core.programs.bio.program.shaders.find(s=>s.source.includes('vec2 bioSource')).source;
    const renewal=gas.slice(gas.indexOf('vec2 bioSource'),gas.indexOf('void main()',gas.indexOf('vec2 bioSource')));
    assert.match(renewal,/body=1\.0-smoothstep\(\.43,\.66,radius\)/);
    assert.match(renewal,/conduit=1\.0-smoothstep\(\.08,\.34,abs\(coarse\.y\+folds\.x\*\.50\)\)/);
    assert.match(renewal,/substrate\*\.75\+conduit\*\(\.46\+cavities\*\.48\)/,'structured heat connects chambers instead of isolated round emitters');
    assert.equal((renewal.match(/potential\(/g)||[]).length,3,'the existing advected gas keeps its noise budget');
    assert.equal(e.core.stats().volumeGrid,48);assert.equal(e.core.stats().volumeSamples,40);
    assert.equal(e.core.stats().filaments,2560);assert.equal(e.live.Framebuffer.size,10);
    e.core.dispose();released(e);
});
check('membrane optics reuse cached normals and actual internal light with independent configured colors',()=>{
    const e=environment();e.render(8);
    const field=e.core.programs.field.program.shaders.find(s=>s.source.includes('out vec4 result')).source;
    assert.match(field,/normal=gradient\/max\(\.0001,length\(gradient\)\)/);
    assert.match(field,/grazing=pow\(1\.0-abs\(dot\(normal,viewDirection\)\),3\.0\)/,'thin folds have a normal-derived grazing response');
    assert.match(field,/reflection=pow\(max\(0\.0,dot\(reflect\(-direction,normal\),viewDirection\)\),20\.0\)/,
        'specular response reflects the real thermal gradient, not an invented point light');
    assert.match(field,/result=vec4\(density,heat,light,facing\)/,'same fixed atlas carries the membrane lighting');
    const volume=e.core.programs.volume.program.shaders.find(s=>s.source.includes('vec4 material=mediumAt(p)')).source;
    const march=volume.slice(volume.indexOf('void main()'));
    assert.equal((march.match(/potential\(/g)||[]).length,3,'no additional normal/radiance ray-march noise calls');
    assert.match(volume,/grain=\.42\+1\.20\*smoothstep\(\.28,\.74,grains\)/,'porous film coverage does not dissolve every fold into puff-like grains');
    assert.match(volume,/u_shadow\*\(\.27\+face\*\.10\)/);assert.match(volume,/u_particle\*tint\*incident/);
    assert.match(volume,/u_energy\*\(2\.1\+bodyWeight\*2\.1\+u_pointer\.z\*heat\*\.28\+u_audio\*1\.70\)/);
    assert.match(volume,/u_glow\*heat\*\(\.65\+u_pointer\.z\*\.28\+u_audio\*1\.45\)/,
        'hotter interior highlights still use the configured emissive color');
    assert.match(volume,/scattered\*density\+emitted\*emission/,'semi-transparent material and buried heat remain separate coupled systems');
    e.core.dispose();released(e);
});
check('procedural membrane surface shares gas velocity transport and configured material without extra textures',()=>{
    const e=environment();e.render(8);
    const p=e.core.programs.membrane.program;
    const vertex=p.shaders.find(s=>s.source.includes('v_surface')&&s.source.includes('gl_VertexID')).source;
    const fragment=p.shaders.find(s=>s.source.includes('gl_FrontFacing')).source;
    assert.match(vertex,/cachedVelocity\(p\)\*\(\.10\+bioEnergy\(p\)\*\.08\)/);
    assert.match(vertex,/p=flowWind\(p,u_flow\)/);assert.match(vertex,/transported\(q\.xy\*u_size\*\.80,aspect,q\.z\)/);
    assert.match(fragment,/normal=normalize\(cross\(dFdx\(v_world\),dFdy\(v_world\)\)\)/);
    assert.match(fragment,/light=material\.b/);assert.match(fragment,/presence=1\.0-morphWeight\(\)/);
    assert.equal(e.draws.filter(d=>d.program===p).at(-1).count,96*64*6);
    assert.equal(e.live.Texture.size,10);assert.equal(e.live.Framebuffer.size,10);
    const before=e.draws.filter(d=>d.program===p).length;
    e.render(8,{...defaults,debugView:'energy'});assert.equal(e.draws.filter(d=>d.program===p).length,before);
    e.render(8,{...defaults,particleColor:'#aabbcc',energyColor:'#336699',glowColor:'#993366',shadowColor:'#112233',brightness:1.3,density:1.44});
    assert.deepEqual(Array.from(p.u_energy),[.2,.4,.6]);assert.equal(p.u_brightness[0],1.3);assert.equal(p.u_density[0],1.2);
    assert.deepEqual(Array.from(p.u_particle),[170/255,187/255,204/255]);
    assert.deepEqual(Array.from(p.u_glow),[153/255,51/255,102/255]);
    assert.deepEqual(Array.from(p.u_shadow),[17/255,34/255,51/255]);
    e.core.dispose();released(e);
});
console.log(checks+' GPU material filament checks passed.');
