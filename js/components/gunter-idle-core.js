/* GunterIdleCore — GPU-advected material filaments and a shared energy volume.
 * renderTo(canvas, width, height, seconds, config); stats(); dispose().
 * WebGL2 only. No point sprites, media, input, device capture or assistant state.
 */
(function () {
    'use strict';
    if (window.GunterIdleCore) return;
    const BASE_FILAMENTS=2560, MAX_FILAMENTS=5120, SIM_HEADS=1280, HISTORY=96, STEP=1/45;
    const HEADER='#version 300 es\nprecision highp float;\nprecision highp int;\n';
    const FIELD=`
        uniform float u_time;
        vec3 hash3(vec3 p) {
            p=fract(p*vec3(.1031,.1030,.0973)); p+=dot(p,p.yxz+33.33);
            return fract((p.xxy+p.yzz)*p.zyx)*2.0-1.0;
        }
        float materialNoise(float x,float seed) {
            float cell=floor(x),f=fract(x);
            float a=hash3(vec3(cell,seed,3.7)).x*.5+.5;
            float b=hash3(vec3(cell+1.0,seed,3.7)).x*.5+.5;
            return mix(a,b,f*f*(3.0-2.0*f));
        }
        vec3 potential(vec3 p,out vec3 curl) {
            vec3 i=floor(p),f=fract(p);
            vec3 u=f*f*f*(f*(f*6.0-15.0)+10.0),du=30.0*f*f*(f-1.0)*(f-1.0);
            vec3 a=hash3(i),b=hash3(i+vec3(1,0,0)),c=hash3(i+vec3(0,1,0)),d=hash3(i+vec3(1,1,0));
            vec3 e=hash3(i+vec3(0,0,1)),g=hash3(i+vec3(1,0,1)),h=hash3(i+vec3(0,1,1)),j=hash3(i+vec3(1,1,1));
            vec3 dx=mix(mix(b-a,d-c,u.y),mix(g-e,j-h,u.y),u.z)*du.x;
            vec3 dy=mix(mix(c-a,d-b,u.x),mix(h-e,j-g,u.x),u.z)*du.y;
            vec3 dz=mix(mix(e-a,g-b,u.x),mix(h-c,j-d,u.x),u.y)*du.z;
            curl=vec3(dy.z-dz.y,dz.x-dx.z,dx.y-dy.x);
            return mix(mix(mix(a,b,u.x),mix(c,d,u.x),u.y),mix(mix(e,g,u.x),mix(h,j,u.x),u.y),u.z);
        }
        vec3 energyCenter(float t) {
            return vec3(.075*sin(t*.29),.055*sin(t*.23+1.3),.065*cos(t*.19));
        }
        // This same connected, folded volume illuminates the strands and is
        // integrated by the volume pass. There are no independent light blobs.
        float energyRadius(vec3 p,float t) {
            vec3 q=p-energyCenter(t);
            q.x+=.23*sin(q.y*5.3+t*.43)+.09*sin(q.z*6.1-t*.27);
            q.y+=.18*sin(q.z*5.0-t*.36);
            q.z+=.15*sin(q.x*5.8+t*.31);
            return length(q/vec3(.52,.43,.45));
        }
        float matterDensity(vec3 p,float t) {
            vec3 unused;
            float coarse=potential(p*3.2+vec3(t*.04,-t*.03,t*.02),unused).x*.5+.5;
            float folds=.5+.5*sin(p.y*8.2+p.z*5.4+sin(p.x*6.1)+t*.21);
            float envelope=1.0-smoothstep(.54,.94,length(p*vec3(.98,1.02,1.14)));
            return envelope*smoothstep(.25,.70,coarse*.62+folds*.38);
        }
        float energyHeat(vec3 p,float t) {
            float r=energyRadius(p,t);
            float fold=sin(p.x*6.3+p.z*4.9+sin(p.y*5.1+t*.35)*1.2-t*.54);
            float ridge=exp(-fold*fold*15.0);
            float wave=sin(p.x*8.2-p.y*6.8+p.z*4.1-t*1.85);
            float flow=.16+.84*smoothstep(-.4,.8,wave);
            return exp(-r*r*1.0)*(.025+.975*ridge)*flow;
        }
        vec3 velocity(vec3 p,float t,float row,float boundary) {
            vec3 q=p-energyCenter(t)*.55,curl,fine,micro;
            potential(q*2.05+vec3(t*.055,-t*.045,t*.035),curl);
            potential(q*5.8+vec3(4.3-t*.23,-2.1+t*.19,t*.21),fine);
            potential(q*12.4+vec3(-5.7+t*.37,3.4-t*.31,t*.41),micro);
            float r=max(.08,length(q.xy));
            vec2 radial=q.xy/r;
            float region=.5+.5*sin(q.x*3.7+q.z*2.6-t*.22)*cos(q.y*3.3+.7);
            float compression=.5+.5*sin(q.y*7.1-q.z*5.6+t*.71);
            vec3 toroidal=vec3(-q.y,q.x,0.0)*.16;
            vec3 poloidal=vec3(-q.z*radial,(r-.46))*.24;
            vec3 v=((toroidal+poloidal)*(.35+region*.65)
                +curl*(.18+region*.18)+fine*(.12+compression*.10)+micro*.10)*.62;
            // Mild converging/diverging pulses coexist with slow large eddies.
            // They change spacing and folds, not merely the object's rotation.
            v+=q*sin(t*.83+q.x*4.2-q.z*3.4)*.035;
            float outside=max(0.0,length(p*vec3(.94,1.02,1.13))-.87);
            v-=p*outside*3.2*boundary;
            float core=step(.19,fract(row*.56984));
            v+=q/max(.07,length(q))*max(0.0,.19-length(q))*.9*core;
            return v;
        }
        vec3 seedPosition(float row,float along,float t) {
            float plume=mod(floor(row),128.0);
            vec3 seed=hash3(vec3(plume,2.1,6.8))*.5+.5;
            float spread=(fract(row*.6180339)-.5)*.18;
            float a=seed.x*6.2831853+(along-.5)*(.38+2.3*seed.z*seed.z)+spread+t*.065;
            float b=seed.y*6.2831853+sin(a*2.3+t*.12)*.72+sin(a*5.0)*.15+spread*2.0;
            float tube=.17+.25*seed.z,major=.34+.10*sin(a*2.1)+.045*sin(b*2.3);
            vec3 p=vec3((major+tube*cos(b))*cos(a),(major+tube*cos(b))*sin(a),tube*sin(b));
            p.z+=.08*sin(a*3.0+b*2.0);
            vec3 curl,warp=potential(p*2.0+vec3(t*.1,2.4,-1.2),curl);
            p+=warp*.12+curl*.045;
            return p;
        }
        vec3 viewPoint(vec3 p) {
            p.xz=mat2(.9689124,-.247404,.247404,.9689124)*p.xz;
            p.yz=mat2(.9838437,-.1790296,.1790296,.9838437)*p.yz;
            return p;
        }
        vec3 worldPoint(vec3 p) {
            p.yz=mat2(.9838437,.1790296,-.1790296,.9838437)*p.yz;
            p.xz=mat2(.9689124,.247404,-.247404,.9689124)*p.xz;
            return p;
        }
    `;
    const QUAD=HEADER+`
        out vec2 v_uv;
        void main() {
            vec2 p=gl_VertexID==0?vec2(-1,-1):gl_VertexID==1?vec2(3,-1):vec2(-1,3);
            v_uv=p*.5+.5;gl_Position=vec4(p,0,1);
        }
    `;
    const SIM=HEADER+FIELD+`
        uniform sampler2D u_history;
        uniform float u_dt;
        uniform int u_initialize;
        out vec4 result;
        void main() {
            ivec2 cell=ivec2(gl_FragCoord.xy);
            float row=float(cell.y)+.5;
            vec3 p;
            if(u_initialize==1) {
                float along=float(cell.x)/float(textureSize(u_history,0).x-1);
                p=seedPosition(row,along,u_time);
                float h=.025;
                // Warm a folded material filament, not a cloud or a comet tail.
                for(int k=0;k<6;k++) {
                    float t=u_time+float(k)*h;
                    vec3 v=velocity(p,t,row,0.0);
                    p+=velocity(p+v*h*.5,t+h*.5,row,0.0)*h;
                }
            } else {
                p=texelFetch(u_history,cell,0).xyz;
                vec3 v=velocity(p,u_time,row,1.0);
                p+=velocity(p+v*u_dt*.5,u_time+u_dt*.5,row,1.0)*u_dt;
                // Neighbour constraints keep material strands continuous as
                // the velocity field stretches and folds them. No history shift.
                int end=textureSize(u_history,0).x-1;
                vec3 a=texelFetch(u_history,ivec2(max(0,cell.x-1),cell.y),0).xyz-p;
                vec3 b=texelFetch(u_history,ivec2(min(end,cell.x+1),cell.y),0).xyz-p;
                float la=length(a),lb=length(b);
                p+=a/max(.0001,la)*max(0.0,la-.024)*.11;
                p+=b/max(.0001,lb)*max(0.0,lb-.024)*.11;
            }
            result=vec4(p,1);
        }
    `;
    const STRAND_VERTEX=HEADER+FIELD+`
        uniform sampler2D u_history;
        uniform vec2 u_resolution;
        uniform float u_size;
        out vec3 v_world;
        out float v_cross,v_age,v_depth;
        flat out float v_seed;
        vec2 projected(vec3 p) {
            vec2 aspect=min(u_resolution.x,u_resolution.y)/u_resolution;
            return viewPoint(p).xy*aspect*u_size*.80;
        }
        void main() {
            int historyLength=textureSize(u_history,0).x;
            int filament=gl_InstanceID/(historyLength-1),segment=gl_InstanceID%(historyLength-1);
            int row=filament/4;
            int id=gl_VertexID;
            bool endpoint=(id==1||id==4||id==5);
            float side=(id==0||id==1||id==4)?-1.0:1.0;
            int x=segment+(endpoint?1:0);
            vec3 p=texelFetch(u_history,ivec2(x,row),0).xyz;
            vec3 before=texelFetch(u_history,ivec2(max(0,x-1),row),0).xyz;
            vec3 after=texelFetch(u_history,ivec2(min(historyLength-1,x+1),row),0).xyz;
            // Microstructure follows material coordinates: it travels with the
            // curve, rather than flickering as unrelated screen-space noise.
            float seed=float(row)+float(filament%4)*37.71;
            float age=float(x)/float(historyLength-1);
            vec3 fibre=hash3(vec3(seed,2.7,8.2))*.012;
            vec3 irregular=vec3(sin(age*71.0+seed),sin(age*53.0+seed*1.7),sin(age*89.0-seed*.7))*.006;
            p+=fibre+irregular;before+=fibre+irregular;after+=fibre+irregular;
            vec2 tangent=(projected(after)-projected(before))*u_resolution;
            tangent/=max(.00001,length(tangent));
            vec2 normal=vec2(-tangent.y,tangent.x);
            float width=.18+.30*materialNoise(age*18.0,seed);
            vec2 position=projected(p)+normal*side*width*2.0/u_resolution;
            gl_Position=vec4(position,0,1);
            v_cross=side;v_age=age;v_seed=seed;
            v_world=p;v_depth=clamp(.5+viewPoint(p).z*.45,.08,.92);
        }
    `;
    const STRAND_FRAGMENT=HEADER+FIELD+`
        uniform vec3 u_particle,u_energy,u_glow;
        uniform float u_brightness;
        uniform sampler2D u_volume;
        uniform vec2 u_resolution;
        in vec3 v_world;
        in float v_cross,v_age,v_depth;
        flat in float v_seed;
        out vec4 result;
        void main() {
            float edge=1.0-smoothstep(.25,1.0,abs(v_cross));
            float fade=pow(max(0.0,sin(v_age*3.14159265)),.55);
            float emission=energyHeat(v_world,u_time);
            float incident=clamp(emission*4.0,0.0,1.0);
            // Reuse the ray-marched column extinction, instead of tracing
            // procedural density again for every subpixel fibre fragment.
            float column=clamp(texture(u_volume,gl_FragCoord.xy/u_resolution).a/.72,0.0,.96);
            float depth=clamp((.90-viewPoint(v_world).z)/1.8,0.0,1.0);
            float transmission=pow(1.0-column,depth*2.0);
            float matter=matterDensity(v_world,u_time);
            vec3 color=u_particle*(.21+v_depth*.27)*(.50+matter*.50)
                +u_energy*incident*3.0+u_glow*incident*incident*.55;
            color*=transmission;
            // Broad erosion creates differently sized wisps; fine coverage
            // turns each wisp into porous, irregular microfibres, not a cable.
            float lengths=3.0+15.0*fract(v_seed*.56984);
            float fragments=smoothstep(.20,.58,materialNoise(v_age*lengths,v_seed+4.1));
            float grain=.06+.94*smoothstep(.24,.78,materialNoise(v_age*167.0,v_seed*1.31));
            float packing=.45+matter*matter*5.50;
            float alpha=min(.85,edge*fade*(.20+v_depth*.10)*fragments*grain*packing);
            result=vec4(color*u_brightness,alpha);
        }
    `;
    const VOLUME=HEADER+FIELD+`
        uniform vec2 u_resolution;
        uniform vec3 u_energy,u_glow;
        uniform float u_size,u_brightness;
        in vec2 v_uv;
        out vec4 result;
        void main() {
            vec2 aspect=min(u_resolution.x,u_resolution.y)/u_resolution;
            vec2 xy=(v_uv*2.0-1.0)/(aspect*u_size*.80);
            vec3 color=vec3(0);float opacity=0.0;
            for(int i=0;i<20;i++) {
                float z=.90-(float(i)+.5)*.09;
                vec3 p=worldPoint(vec3(xy,z));
                float heat=energyHeat(p,u_time),matter=matterDensity(p,u_time);
                float density=matter*.12;
                vec3 light=u_energy*heat*3.5+u_glow*heat*heat*.40;
                color+=(1.0-opacity)*light*density;
                opacity+=(1.0-opacity)*density;
            }
            result=vec4(color*u_brightness,opacity*.72);
        }
    `;
    const COPY=HEADER+`
        uniform sampler2D u_image;
        in vec2 v_uv;out vec4 result;
        void main(){result=texture(u_image,v_uv);}
    `;
    const EXTRACT=HEADER+`
        uniform sampler2D u_image;
        in vec2 v_uv;out vec4 result;
        void main() {
            vec3 c=texture(u_image,v_uv).rgb;
            float peak=max(c.r,max(c.g,c.b));
            result=vec4(c*smoothstep(.18,.65,peak),0);
        }
    `;
    const BLUR=HEADER+`
        uniform sampler2D u_image;uniform vec2 u_step;
        in vec2 v_uv;out vec4 result;
        void main() {
            vec3 c=texture(u_image,v_uv).rgb*.227027;
            c+=texture(u_image,v_uv+u_step*1.384615).rgb*.316216;
            c+=texture(u_image,v_uv-u_step*1.384615).rgb*.316216;
            c+=texture(u_image,v_uv+u_step*3.230769).rgb*.070270;
            c+=texture(u_image,v_uv-u_step*3.230769).rgb*.070270;
            result=vec4(c,0);
        }
    `;
    const COMPOSITE=HEADER+`
        uniform sampler2D u_image,u_bloom;
        in vec2 v_uv;out vec4 result;
        void main() {
            vec4 scene=texture(u_image,v_uv);
            vec3 light=scene.rgb+texture(u_bloom,v_uv).rgb*.38;
            // Map energy, not each RGB channel separately: bright red should
            // retain its hue instead of bleaching into peach/white highlights.
            float peak=max(light.r,max(light.g,light.b));
            vec3 color=light*((1.0-exp(-peak*1.35))/max(.0001,peak));
            float coverage=1.0-pow(max(0.0,1.0-scene.a),1.4);
            float alpha=max(coverage,max(color.r,max(color.g,color.b)));
            result=vec4(color,alpha);
        }
    `;
    const number=(v,lo,hi,fallback)=>Number.isFinite(v)?Math.max(lo,Math.min(hi,v)):fallback;
    const color=(v,fallback)=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v)?v:fallback;
    const rgb=v=>v.match(/[0-9a-f]{2}/gi).map(c=>parseInt(c,16)/255);
    class GunterIdleCore {
        constructor() {
            this.canvas=document.createElement('canvas');
            this.available=false;this.error='';this.frames=0;this.steps=0;this.resources=[];
            this.canvas.addEventListener('webglcontextlost',event=>{
                event.preventDefault();this.available=false;this.error='Se perdió el contexto WebGL2.';
                this.announce();
            });
            this.canvas.addEventListener('webglcontextrestored',()=>{
                if(this.disposed)return;
                this.resources=[];this.targets=null;this.histories=null;this.simulationTime=null;this.displayTime=null;
                this.width=this.height=0;this.initialize();this.announce();
            });
            this.initialize();
        }
        announce() {
            window.dispatchEvent(new CustomEvent('gunter-idle-core-availability',{detail:{available:this.available,error:this.error}}));
        }
        initialize() {
            try {
                const gl=this.gl=this.canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:true,
                    antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false,powerPreference:'low-power'});
                if(!gl||!gl.getExtension('EXT_color_buffer_float'))
                    throw new Error('El núcleo requiere WebGL2 y texturas flotantes renderizables (EXT_color_buffer_float).');
                this.programs={
                    simulation:this.program(QUAD,SIM),strands:this.program(STRAND_VERTEX,STRAND_FRAGMENT),
                    volume:this.program(QUAD,VOLUME),copy:this.program(QUAD,COPY),
                    extract:this.program(QUAD,EXTRACT),blur:this.program(QUAD,BLUR),composite:this.program(QUAD,COMPOSITE)
                };
                this.histories=[];this.histories.push(this.target(HISTORY,SIM_HEADS,true));
                this.histories.push(this.target(HISTORY,SIM_HEADS,true));
                this.historyIndex=0;this.simulationTime=null;this.displayTime=null;
                this.available=true;this.error='';
            } catch(error) {this.error=error.message;this.available=false;this.release();}
        }
        program(vertex,fragment) {
            const gl=this.gl,shaders=[],program=gl.createProgram();this.resources.push(program);
            const compile=(type,source)=>{
                const shader=gl.createShader(type);shaders.push(shader);gl.shaderSource(shader,source);gl.compileShader(shader);
                if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS))throw new Error('Shader: '+gl.getShaderInfoLog(shader));
                return shader;
            };
            try {
                gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));
                gl.linkProgram(program);
                if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('WebGL2: '+gl.getProgramInfoLog(program));
            }finally{shaders.forEach(shader=>gl.deleteShader(shader));}
            return {program,uniforms:new Map()};
        }
        uniform(program,name) {
            if(!program.uniforms.has(name))program.uniforms.set(name,this.gl.getUniformLocation(program.program,name));
            return program.uniforms.get(name);
        }
        use(program){this.gl.useProgram(program.program);}
        scalar(program,name,value){this.gl.uniform1f(this.uniform(program,name),value);}
        vector(program,name,value){this.gl.uniform3fv(this.uniform(program,name),value);}
        texture(program,name,texture,unit=0) {
            const gl=this.gl;gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);
            gl.uniform1i(this.uniform(program,name),unit);
        }
        target(width,height,simulation=false) {
            const gl=this.gl,texture=gl.createTexture(),framebuffer=gl.createFramebuffer();
            gl.bindTexture(gl.TEXTURE_2D,texture);
            const filter=simulation?gl.NEAREST:gl.LINEAR;
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,filter);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,filter);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D,0,simulation?gl.RGBA32F:gl.RGBA16F,width,height,0,gl.RGBA,simulation?gl.FLOAT:gl.HALF_FLOAT,null);
            gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
            if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) {
                gl.deleteTexture(texture);gl.deleteFramebuffer(framebuffer);throw new Error('No se pudo crear el buffer GPU de filamentos/emisión.');
            }
            return {texture,framebuffer,width,height};
        }
        deleteTargets(targets) {
            for(const target of Object.values(targets||{})){
                this.gl.deleteFramebuffer(target.framebuffer);this.gl.deleteTexture(target.texture);
            }
        }
        resize(width,height) {
            if(this.width===width&&this.height===height)return;
            this.deleteTargets(this.targets);this.targets={};this.width=this.height=0;
            this.canvas.width=width;this.canvas.height=height;
            try {
                this.targets.scene=this.target(width,height);
                const ew=Math.max(1,Math.round(width*.5)),eh=Math.max(1,Math.round(height*.5));
                this.targets.energy=this.target(ew,eh);
                this.targets.a=this.target(ew,eh);this.targets.b=this.target(ew,eh);
                this.width=width;this.height=height;
            }catch(error){this.deleteTargets(this.targets);this.targets=null;throw error;}
        }
        destination(target) {
            const gl=this.gl;gl.bindFramebuffer(gl.FRAMEBUFFER,target?.framebuffer||null);
            gl.viewport(0,0,target?.width||this.width,target?.height||this.height);
        }
        quad(target){this.destination(target);this.gl.drawArrays(this.gl.TRIANGLES,0,3);}
        simulate(time,initialize=false) {
            const gl=this.gl,p=this.programs.simulation,next=1-this.historyIndex;
            this.use(p);this.scalar(p,'u_time',time);this.scalar(p,'u_dt',STEP);
            gl.uniform1i(this.uniform(p,'u_initialize'),initialize?1:0);
            this.texture(p,'u_history',this.histories[this.historyIndex].texture);
            gl.disable(gl.BLEND);this.quad(this.histories[next]);
            this.historyIndex=next;this.steps++;
        }
        advance(time) {
            if(this.simulationTime===null||time-this.simulationTime>4){
                this.simulate(time,true);this.simulationTime=time;
            }
            while(this.simulationTime+STEP<=time+1e-7){
                this.simulate(this.simulationTime);this.simulationTime+=STEP;
            }
            // Another avatar must never rewind the shared material history.
            this.displayTime=Math.max(this.displayTime||0,this.simulationTime,time);
        }
        draw(config) {
            const gl=this.gl,t=this.displayTime,volume=this.programs.volume;
            gl.disable(gl.BLEND);this.use(volume);
            gl.uniform2f(this.uniform(volume,'u_resolution'),this.width,this.height);
            this.scalar(volume,'u_time',t);this.scalar(volume,'u_size',config.size);this.scalar(volume,'u_brightness',config.brightness);
            this.vector(volume,'u_energy',rgb(config.energyColor));this.vector(volume,'u_glow',rgb(config.glowColor));
            this.quad(this.targets.energy);
            const copy=this.programs.copy;this.use(copy);this.texture(copy,'u_image',this.targets.energy.texture);
            this.quad(this.targets.scene);
            const strands=this.programs.strands;this.use(strands);
            this.texture(strands,'u_history',this.histories[this.historyIndex].texture);
            this.texture(strands,'u_volume',this.targets.energy.texture,1);
            gl.uniform2f(this.uniform(strands,'u_resolution'),this.width,this.height);
            this.scalar(strands,'u_time',t);this.scalar(strands,'u_size',config.size);this.scalar(strands,'u_brightness',config.brightness);
            this.vector(strands,'u_particle',rgb(config.particleColor));this.vector(strands,'u_energy',rgb(config.energyColor));
            this.vector(strands,'u_glow',rgb(config.glowColor));
            this.activeFilaments=Math.round(BASE_FILAMENTS*config.density);
            gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
            this.destination(this.targets.scene);
            gl.drawArraysInstanced(gl.TRIANGLES,0,6,this.activeFilaments*(HISTORY-1));gl.disable(gl.BLEND);
            const extract=this.programs.extract;this.use(extract);this.texture(extract,'u_image',this.targets.scene.texture);this.quad(this.targets.a);
            const blur=this.programs.blur;this.use(blur);this.texture(blur,'u_image',this.targets.a.texture);
            gl.uniform2f(this.uniform(blur,'u_step'),1.7/this.targets.a.width,0);this.quad(this.targets.b);
            this.texture(blur,'u_image',this.targets.b.texture);gl.uniform2f(this.uniform(blur,'u_step'),0,1.7/this.targets.a.height);this.quad(this.targets.a);
            const composite=this.programs.composite;this.use(composite);
            this.texture(composite,'u_image',this.targets.scene.texture);this.texture(composite,'u_bloom',this.targets.a.texture,1);this.quad(null);
            this.frames++;
        }
        renderTo(canvas,width,height,seconds=0,config={}) {
            if(!this.available||this.disposed)throw new Error(this.error||'El núcleo GPU no está disponible.');
            config={
                particleColor:color(config?.particleColor,'#b8bec9'),
                energyColor:color(config?.energyColor,color(config?.color,'#ff452b')),
                glowColor:color(config?.glowColor,'#ff6d35'),
                brightness:number(config?.brightness,.2,2.5,1),density:number(config?.density,.25,2,1),
                speed:number(config?.speed,0,2,1),size:number(config?.size,.7,1.3,1)
            };
            width=Math.round(number(width,1,720,512));height=Math.round(number(height,1,720,512));
            this.resize(width,height);this.advance(number(seconds,0,1e8,0)*config.speed);this.draw(config);
            if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;
            const output=canvas.getContext('2d');if(!output)throw new Error('No se pudo presentar el núcleo.');
            output.clearRect(0,0,width,height);output.drawImage(this.canvas,0,0,width,height);
        }
        stats() {
            return {renderer:'webgl-filaments',simulation:'gpu-advected-material-filaments',available:this.available,frames:this.frames,
                steps:this.steps,filaments:this.activeFilaments||0,segmentsPerFilament:HISTORY-1,
                time:this.simulationTime,width:this.width,height:this.height,error:this.error};
        }
        release() {
            if(!this.gl)return;
            this.deleteTargets(this.targets);this.targets=null;this.deleteTargets(this.histories);this.histories=null;
            this.resources.forEach(program=>this.gl.deleteProgram(program));this.resources=[];
        }
        dispose() {
            if(this.disposed)return;
            this.disposed=true;this.available=false;this.release();this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
            this.canvas.width=this.canvas.height=1;
        }
    }
    window.GunterIdleCore=GunterIdleCore;
})();
