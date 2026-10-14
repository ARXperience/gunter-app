'use strict';
// WebGL2 resource/dispatch contracts. Native shader and visual checks run separately.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../js/components/gunter-idle-core.js'),'utf8');
const defaults={particleColor:'#b8bec9',energyColor:'#ff452b',glowColor:'#ff6d35',brightness:1,density:1,speed:1,size:1};
let checks=0;
const check=(name,fn)=>{fn();console.log('ok '+(++checks)+' - '+name);};
function environment(options={}) {
    const gl={},names=['VERTEX_SHADER','FRAGMENT_SHADER','COMPILE_STATUS','LINK_STATUS','TEXTURE_2D',
        'TEXTURE_MIN_FILTER','TEXTURE_MAG_FILTER','TEXTURE_WRAP_S','TEXTURE_WRAP_T','NEAREST','LINEAR',
        'CLAMP_TO_EDGE','RGBA32F','RGBA16F','RGBA','FLOAT','HALF_FLOAT','FRAMEBUFFER','COLOR_ATTACHMENT0',
        'FRAMEBUFFER_COMPLETE','TRIANGLES','BLEND','SRC_ALPHA','ONE_MINUS_SRC_ALPHA','ONE'];
    names.forEach((name,i)=>gl[name]=i+1);gl.TEXTURE0=100;
    const live={Program:new Set(),Shader:new Set(),Texture:new Set(),Framebuffer:new Set()};
    const created={Program:[],Shader:[],Texture:[],Framebuffer:[]},draws=[],textures=new Map(),events=[],contexts=[],listeners=new Map();
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
    gl.texImage2D=(type,level,internal,w,h,border,format,dataType)=>{
        assert.ok(Number.isInteger(w)&&Number.isInteger(h)&&w>0&&h>0);
        Object.assign(boundTexture,{w,h,internal,dataType});
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
            time:program.u_time?.[0],density:program.u_density?.[0],initialize:program.u_initialize?.[0],samplers});
    }
    gl.drawArrays=(mode,first,count)=>record(mode,count);
    gl.drawArraysInstanced=(mode,first,count,instances)=>{assert.ok(instances>0&&instances<=5120*95);record(mode,count,instances);};
    const canvas={width:300,height:150,getContext(type,attributes){contexts.push({type,attributes});return options.noWebgl?null:gl;},
        addEventListener(type,cb){listeners.set(type,cb);}};
    const window={dispatchEvent(event){events.push(event);}},document={createElement(tag){assert.equal(tag,'canvas');return canvas;}};
    const context=vm.createContext({window,document,CustomEvent:class{constructor(type,value){this.type=type;this.detail=value.detail;}}});
    vm.runInContext(source,context);
    const core=new window.GunterIdleCore();
    const output=()=>({width:0,height:0,getContext(type){assert.equal(type,'2d');return{clearRect(){},drawImage(value){assert.equal(value,canvas);}};}});
    return {gl,core,options,live,created,draws,contexts,events,listeners,losses:()=>losses,
        render(time=8,config=defaults,w=240,h=240){const target=output();core.renderTo(target,w,h,time,config);return target;},
        lost(){Object.values(live).forEach(set=>set.clear());listeners.get('webglcontextlost')({preventDefault(){}});},
        restored(){listeners.get('webglcontextrestored')();}};
}
function released(env){Object.entries(env.live).forEach(([kind,set])=>assert.equal(set.size,0,kind+' leaked'));}
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
    const e=environment();e.render();const field=e.core.field,builds=e.core.fieldBuilds;
    e.lost();assert.equal(e.core.available,false);assert.equal(e.events.at(-1).detail.available,false);
    assert.throws(()=>e.render(),/contexto WebGL2/);
    e.restored();assert.equal(e.core.available,true);assert.equal(e.events.at(-1).detail.available,true);
    assert.notEqual(e.core.field,field);assert.notEqual(e.core.field.texture,field.texture);
    assert.equal(e.core.fieldTime,null);assert.equal(e.core.fieldDensity,null);
    e.render(8);assert.equal(e.core.fieldBuilds,builds+1);assert.equal(e.core.fieldTime,8);
    assert.equal(e.live.Framebuffer.size,7);assert.equal(e.live.Texture.size,7);
    const restoredField=e.core.field;
    e.core.dispose();e.core.dispose();assert.equal(e.losses(),1);released(e);
    assert.equal(e.live.Texture.has(restoredField.texture),false);assert.equal(e.live.Framebuffer.has(restoredField.framebuffer),false);
    assert.equal(e.core.field,null);assert.equal(e.core.fieldTime,null);assert.equal(e.core.fieldDensity,null);
    assert.throws(()=>e.render(),/disponible/);
});
check('the core does not subscribe to input/media or fetch original footage',()=>{
    assert.doesNotMatch(source,/getUserMedia|AudioContext|pointermove|mousemove|gunter-audio-level|\bfetch\s*\(|gl\.POINTS|createElement\(['"]video/);
    const e=environment();assert.deepEqual([...e.listeners.keys()],['webglcontextlost','webglcontextrestored']);e.core.dispose();released(e);
});
console.log(checks+' GPU material filament checks passed.');
