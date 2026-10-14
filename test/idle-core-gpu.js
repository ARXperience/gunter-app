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
        for(const name of ['u_history','u_image','u_bloom','u_volume'])if(program[name])
            assert.notEqual(textures.get(program[name][0]),framebuffer?.texture,'no framebuffer texture feedback');
        draws.push({program,framebuffer,texture:framebuffer?.texture,count,instances,viewport:viewport.slice(),
            time:program.u_time?.[0],initialize:program.u_initialize?.[0]});
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
    const e=environment();e.render(8);const histories=e.core.histories.slice(),steps=e.core.steps;
    e.render(8,defaults,510,320);
    assert.equal(e.core.steps,steps);assert.equal(e.core.histories[0],histories[0]);assert.equal(e.core.histories[1],histories[1]);
    assert.equal(e.live.Framebuffer.size,6);assert.equal(e.live.Texture.size,6);
    e.core.dispose();released(e);
});
check('particle, energy and emissive colors are independent shader uniforms',()=>{
    const e=environment();e.render(8,{...defaults,particleColor:'#00ff00',energyColor:'#0000ff',glowColor:'#ff0000'});
    const p=e.core.programs.strands.program;
    assert.deepEqual(Array.from(p.u_particle),[0,1,0]);assert.deepEqual(Array.from(p.u_energy),[0,0,1]);assert.deepEqual(Array.from(p.u_glow),[1,0,0]);
    assert.deepEqual(Array.from(e.core.programs.volume.program.u_energy),[0,0,1]);
    e.core.dispose();released(e);
});
check('filament depth attenuation reuses the existing integrated volume without extra targets',()=>{
    const e=environment();e.render();
    assert.equal(e.core.programs.strands.program.u_volume[0],1);
    assert.equal(e.core.targets.energy.texture.internal,e.gl.RGBA16F);
    assert.equal(e.live.Framebuffer.size,6);assert.equal(e.live.Texture.size,6);
    const fragment=e.core.programs.strands.program.shaders.find(s=>s.source.includes('uniform sampler2D u_volume')).source;
    assert.match(fragment,/texture\(u_volume,gl_FragCoord.xy\/u_resolution\)/);
    assert.match(fragment,/pow\(1\.0-column,depth\*2\.0\)/);
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
        [{failFramebufferAt:2},/buffer GPU/]]) {
        const e=environment(options);assert.equal(e.core.available,false);assert.match(e.core.error,message);released(e);
    }
    const e=environment();e.options.failFramebufferAt=4;
    assert.throws(()=>e.render(),/buffer GPU/);assert.equal(e.live.Framebuffer.size,2);
    e.options.failFramebufferAt=0;assert.doesNotThrow(()=>e.render());e.core.dispose();released(e);
});
check('context loss restores material resources and final disposal is idempotent',()=>{
    const e=environment();e.render();e.lost();assert.equal(e.core.available,false);assert.equal(e.events.at(-1).detail.available,false);
    e.restored();assert.equal(e.core.available,true);e.render(10);assert.equal(e.events.at(-1).detail.available,true);
    e.core.dispose();e.core.dispose();assert.equal(e.losses(),1);released(e);
    assert.throws(()=>e.render(),/disponible/);
});
check('the core does not subscribe to input/media or fetch original footage',()=>{
    assert.doesNotMatch(source,/getUserMedia|AudioContext|pointermove|mousemove|gunter-audio-level|\bfetch\s*\(|gl\.POINTS|createElement\(['"]video/);
    const e=environment();assert.deepEqual([...e.listeners.keys()],['webglcontextlost','webglcontextrestored']);e.core.dispose();released(e);
});
console.log(checks+' GPU material filament checks passed.');
