/* GunterIdleCore: dependency-free, time-driven WebGL filament compositor.
 * Public API: new GunterIdleCore(); renderTo(canvas, w, h, seconds, config);
 * dispose(). One compositor can draw every avatar without extra GPU contexts.
 * No media, input, microphone, model, network or assistant-state dependencies.
 */
(function () {
    'use strict';
    if (window.GunterIdleCore) return;
    const VERTEX = `
        precision highp float;
        attribute vec4 a_seed;
        attribute float a_path;
        uniform float u_time, u_size;
        uniform mediump float u_layer, u_resolution;
        uniform vec2 u_aspect;
        varying mediump float v_heat, v_opacity, v_depth;
        varying mediump vec3 v_ember;
        vec3 hash(vec3 p) {
            p = fract(p * vec3(.1031, .1030, .0973));
            p += dot(p, p.yxz + 33.33);
            return fract((p.xxy + p.yzz) * p.zyx) * 2.0 - 1.0;
        }
        // Analytic derivatives of a smooth vector-potential noise field.
        // curl(A) = (dAz/dy-dAy/dz, dAx/dz-dAz/dx, dAy/dx-dAx/dy).
        vec3 turbulence(vec3 p, out vec3 curl) {
            vec3 i = floor(p), f = fract(p);
            vec3 u = f*f*f*(f*(f*6.0-15.0)+10.0);
            vec3 du = 30.0*f*f*(f-1.0)*(f-1.0);
            vec3 a=hash(i), b=hash(i+vec3(1,0,0)), c=hash(i+vec3(0,1,0)), d=hash(i+vec3(1,1,0));
            vec3 e=hash(i+vec3(0,0,1)), g=hash(i+vec3(1,0,1)), h=hash(i+vec3(0,1,1)), j=hash(i+vec3(1,1,1));
            vec3 dx=mix(mix(b-a,d-c,u.y),mix(g-e,j-h,u.y),u.z)*du.x;
            vec3 dy=mix(mix(c-a,d-b,u.x),mix(h-e,j-g,u.x),u.z)*du.y;
            vec3 dz=mix(mix(e-a,g-b,u.x),mix(h-c,j-d,u.x),u.y)*du.z;
            curl=vec3(dy.z-dz.y,dz.x-dx.z,dx.y-dy.x);
            return mix(mix(mix(a,b,u.x),mix(c,d,u.x),u.y),mix(mix(e,g,u.x),mix(h,j,u.x),u.y),u.z);
        }
        void main() {
            float t=u_time*.38;
            float inner=step(1.5,u_layer);
            float flowTime=t*(1.0+inner*.38);
            // Short streamlets orbit through folded sheets at different rates;
            // the bulk stays anchored while material circulates through it.
            float a=a_seed.x*6.2831853 + a_path*(.38+a_seed.w*1.8) + flowTime*.26;
            float b=a_seed.y*6.2831853 + sin(a*1.65+flowTime*.43)*.64
                + a_path*.95 + flowTime*(.63+.18*sin(a_seed.x*6.2831853));
            float r=.41+.12*a_seed.z;
            float tube=.24+.13*a_seed.w;
            vec3 p=vec3((r+tube*cos(b))*cos(a), (r+tube*cos(b))*sin(a), tube*sin(b));
            p.y*=1.06;
            if(inner>.5) p*=.26+.48*a_seed.z;
            vec3 curl, fine;
            vec3 field=turbulence(p*2.2+vec3(flowTime*.31,-flowTime*.24,flowTime*.17),curl);
            p+=field*.12+curl*(.092-inner*.035);
            // Smaller counterflow folds the plumes, rather than moving a whole
            // torus as one object. Both noise octaves are spatially coherent.
            vec3 grain=turbulence(p*5.3+vec3(7.2-flowTime*.21,-3.1+flowTime*.44,flowTime*.36),fine);
            p+=grain*.036+fine*(.024-inner*.008);
            if(u_layer>.5&&inner<.5) p+=hash(vec3(a_seed.xy*91.0,a_path*337.0))*.018;
            // Transported heat pockets flare locally and at unequal rhythms;
            // no global breathing/pulsing multiplier or permanent hot ball.
            float ember=field.x*.57+grain.z*.30+field.y*.24;
            ember+=sin(flowTime*5.7+dot(p,vec3(4.2,-3.6,2.8)))*.17;
            ember+=sin(flowTime*9.1-dot(p,vec3(2.1,4.7,-3.2)))*.10;
            v_heat=smoothstep(-.21,.53,ember);
            // Keep fragment-phase precision stable during long idle sessions.
            v_ember=p*9.0+vec3(mod(flowTime*.8,6.2831853),
                -mod(flowTime*.6,6.2831853),mod(flowTime*.5,6.2831853));
            // Slow, small view drift leaves the faster internal flow readable.
            float yaw=.28+sin(t*.13)*.08, pitch=.24+sin(t*.11)*.05;
            p.xz=mat2(cos(yaw),-sin(yaw),sin(yaw),cos(yaw))*p.xz;
            p.yz=mat2(cos(pitch),-sin(pitch),sin(pitch),cos(pitch))*p.yz;
            p.y+=sin(t*.42)*.016;
            float perspective=1.0/(1.0-p.z*.18);
            gl_Position=vec4(p.xy*u_aspect*u_size*perspective*.64, 0.0, 1.0);
            v_depth=clamp(.56+p.z*.45, .22,.88);
            float ends=smoothstep(0.0,.12,a_path)*(1.0-smoothstep(.82,1.0,a_path));
            float plume=.60+.40*smoothstep(-.4,.65,grain.y+field.z*.3);
            v_opacity=ends*(.32+.68*a_seed.z)*(.48+v_depth*.63)*mix(plume,1.0,inner);
            gl_PointSize=inner>.5 ? u_resolution*(.055+.045*a_seed.w) : 1.1+a_seed.w*.55;
        }
    `;
    const FILAMENT = `
        precision mediump float;
        uniform vec3 u_color, u_glow;
        uniform float u_brightness, u_layer, u_resolution;
        varying mediump float v_heat, v_opacity, v_depth;
        varying mediump vec3 v_ember;
        void main() {
            vec3 smoke=mix(vec3(.40,.42,.46),vec3(.75,.75,.72),v_depth);
            vec3 col=mix(smoke,u_color,v_heat*.09);
            float alpha=v_opacity*.029*min(1.5,u_resolution/600.0);
            if(u_layer>.5) {
                vec2 d=gl_PointCoord*2.0-1.0;
                float radius=dot(d,d);
                if(radius>1.0) discard;
                // A pixel-sized point covers more of a small canvas. Normalize
                // its energy so miniatures/mobile do not burn into a white blob.
                float coverage=min(2.0,pow(u_resolution/600.0,2.0));
                alpha=v_opacity*exp(-radius*3.0)*.33*coverage;
                if(u_layer>1.5) {
                    float heat=v_heat*v_heat;
                    col=mix(pow(u_color,vec3(1.45)),u_glow,heat*.16);
                    float fold=sin(d.x*4.2+v_ember.x+sin(d.y*3.7+v_ember.y))
                        +sin(d.y*5.1-v_ember.z)*.55;
                    float wisp=.48+.52*smoothstep(-1.1,.9,fold);
                    alpha=v_opacity*exp(-radius*4.5)*wisp*(.006+heat*.20);
                }
            }
            gl_FragColor=vec4(col*u_brightness,alpha);
        }
    `;
    const QUAD = `
        attribute vec2 a_position;
        varying mediump vec2 v_uv;
        void main(){v_uv=a_position*.5+.5;gl_Position=vec4(a_position,0,1);}
    `;
    const EXTRACT = `
        precision mediump float;
        varying mediump vec2 v_uv;
        uniform sampler2D u_image;
        void main(){
            vec4 c=texture2D(u_image,v_uv);
            float peak=max(c.r,max(c.g,c.b));
            float chroma=peak-min(c.r,min(c.g,c.b));
            gl_FragColor=vec4(c.rgb*smoothstep(.10,.48,peak)*smoothstep(.025,.18,chroma),0.0);
        }
    `;
    const BLUR = `
        precision mediump float;
        varying mediump vec2 v_uv;
        uniform sampler2D u_image;
        uniform vec2 u_step;
        void main(){
            vec3 c=texture2D(u_image,v_uv).rgb*.227027;
            c+=texture2D(u_image,v_uv+u_step*1.384615).rgb*.316216;
            c+=texture2D(u_image,v_uv-u_step*1.384615).rgb*.316216;
            c+=texture2D(u_image,v_uv+u_step*3.230769).rgb*.070270;
            c+=texture2D(u_image,v_uv-u_step*3.230769).rgb*.070270;
            gl_FragColor=vec4(c,0.0);
        }
    `;
    const COMPOSITE = `
        precision mediump float;
        varying mediump vec2 v_uv;
        uniform sampler2D u_image, u_bloom;
        uniform vec3 u_glow;
        void main(){
            vec4 s=texture2D(u_image,v_uv);
            vec3 bloom=texture2D(u_bloom,v_uv).rgb;
            float energy=max(bloom.r,max(bloom.g,bloom.b));
            vec3 light=bloom*.55+u_glow*energy*.35;
            vec3 color=1.0-exp(-(s.rgb+light)*1.45);
            // Premultiplied RGBA including the bloom halo, not a black backing.
            // Neutral smoke retains silhouette contrast on light backgrounds.
            float coverage=1.0-pow(max(0.0,1.0-s.a),1.7);
            float alpha=max(coverage,max(color.r,max(color.g,color.b)));
            gl_FragColor=vec4(color,alpha);
        }
    `;
    const MAX_CURVES = 1860, STEPS = 88;
    function randomFactory() {
        let value=0x47554e54;
        return () => { value=(Math.imul(1664525,value)+1013904223)>>>0; return value/4294967296; };
    }
    function filaments() {
        const values=new Float32Array(MAX_CURVES*(STEPS-1)*2*5), random=randomFactory();
        // Interleaved sibling streamlets form dense plumes and soft empty gaps.
        // Every density prefix still spans the entire volume, not one quadrant.
        const plumes=Array.from({length:120},()=>[random(),random(),random(),random()]);
        const wrap=value=>value-Math.floor(value);
        let offset=0;
        for(let curve=0;curve<MAX_CURVES;curve++) {
            const plume=plumes[curve%plumes.length];
            const seed=curve%3===0 ? [random(),random(),random(),random()]
                : [wrap(plume[0]+(random()-.5)*.055),wrap(plume[1]+(random()-.5)*.09),
                    .18+plume[2]*.65+random()*.15,.08+plume[3]*.76+random()*.15];
            for(let step=0;step<STEPS-1;step++) for(const point of [step,step+1]) {
                values.set(seed,offset); values[offset+4]=point/(STEPS-1); offset+=5;
            }
        }
        return values;
    }
    function innerDust() {
        const values=new Float32Array(1800*5), random=randomFactory();
        for(let i=0;i<values.length;i+=5) values.set([random(),random(),random(),random(),.12+random()*.70],i);
        return values;
    }
    const rgb=value => /^#[0-9a-f]{6}$/i.test(value || '') ? value.match(/[0-9a-f]{2}/gi).map(c=>parseInt(c,16)/255) : [1,.27,.17];
    class GunterIdleCore {
        constructor() {
            this.canvas=document.createElement('canvas');
            this.available=false; this.error=''; this.frames=0; this.resources=[];
            this.canvas.addEventListener('webglcontextlost',event=>{
                event.preventDefault(); this.available=false; this.error='El contexto WebGL se perdió.';
                window.dispatchEvent(new CustomEvent('gunter-idle-core-availability',{detail:{available:false,error:this.error}}));
            });
            this.canvas.addEventListener('webglcontextrestored',()=>{
                if(this.disposed) return;
                this.resources=[]; this.targets=null; this.width=this.height=0; this.initialize();
                window.dispatchEvent(new CustomEvent('gunter-idle-core-availability',{detail:{available:this.available,error:this.error}}));
            });
            this.initialize();
        }
        initialize() {
            try {
                const gl=this.gl=this.canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,
                    antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false,powerPreference:'low-power'});
                if(!gl) throw new Error('WebGL no está disponible en este dispositivo.');
                this.programs={filament:this.program(VERTEX,FILAMENT),extract:this.program(QUAD,EXTRACT),
                    blur:this.program(QUAD,BLUR),composite:this.program(QUAD,COMPOSITE)};
                this.filamentBuffer=this.buffer(filaments()); this.dustBuffer=this.buffer(innerDust());
                this.quadBuffer=this.buffer(new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]));
                this.available=true; this.error='';
            } catch(error) { this.available=false; this.error=error.message; this.release(); }
        }
        buffer(data) {
            const gl=this.gl, buffer=gl.createBuffer();
            this.resources.push(['Buffer',buffer]); gl.bindBuffer(gl.ARRAY_BUFFER,buffer); gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
            return buffer;
        }
        program(vertex,fragment) {
            const gl=this.gl, shaders=[];
            const compile=(type,source)=>{
                const shader=gl.createShader(type); shaders.push(shader); gl.shaderSource(shader,source); gl.compileShader(shader);
                if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw new Error('Shader: '+gl.getShaderInfoLog(shader));
                return shader;
            };
            const program=gl.createProgram(); this.resources.push(['Program',program]);
            try {
                gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex)); gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));
                gl.linkProgram(program);
                if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error('WebGL: '+gl.getProgramInfoLog(program));
            } finally { shaders.forEach(shader=>gl.deleteShader(shader)); }
            return {program,uniforms:new Map()};
        }
        uniform(program,name) {
            if(!program.uniforms.has(name)) program.uniforms.set(name,this.gl.getUniformLocation(program.program,name));
            return program.uniforms.get(name);
        }
        target(width,height) {
            const gl=this.gl, texture=gl.createTexture(), framebuffer=gl.createFramebuffer();
            gl.bindTexture(gl.TEXTURE_2D,texture);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
            gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
            if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE) {
                gl.deleteTexture(texture); gl.deleteFramebuffer(framebuffer); throw new Error('El dispositivo no permite el buffer de emisión.');
            }
            return {texture,framebuffer,width,height};
        }
        resize(width,height) {
            if(this.width===width&&this.height===height) return;
            const gl=this.gl;
            this.clearTargets(); this.width=this.height=0;
            this.canvas.width=width; this.canvas.height=height; this.targets={};
            try {
                this.targets.scene=this.target(width,height);
                this.targets.a=this.target(Math.max(1,Math.ceil(width/2)),Math.max(1,Math.ceil(height/2)));
                this.targets.b=this.target(this.targets.a.width,this.targets.a.height);
                this.width=width; this.height=height;
            } catch(error) { this.clearTargets(); throw error; }
            gl.bindFramebuffer(gl.FRAMEBUFFER,null);
        }
        use(program) { this.gl.useProgram(program.program); }
        texture(program,name,texture,unit=0) {
            const gl=this.gl; gl.activeTexture(gl.TEXTURE0+unit); gl.bindTexture(gl.TEXTURE_2D,texture); gl.uniform1i(this.uniform(program,name),unit);
        }
        quad(program,destination) {
            const gl=this.gl;
            gl.bindFramebuffer(gl.FRAMEBUFFER,destination?.framebuffer || null);
            gl.viewport(0,0,destination?.width || this.width,destination?.height || this.height);
            gl.bindBuffer(gl.ARRAY_BUFFER,this.quadBuffer);
            const position=gl.getAttribLocation(program.program,'a_position');
            gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
            gl.drawArrays(gl.TRIANGLES,0,6); gl.disableVertexAttribArray(position);
        }
        draw(config,seconds) {
            const gl=this.gl, p=this.programs.filament, count=Math.round(MAX_CURVES*.55*config.density)*(STEPS-1)*2;
            gl.bindFramebuffer(gl.FRAMEBUFFER,this.targets.scene.framebuffer); gl.viewport(0,0,this.width,this.height);
            gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); gl.enable(gl.BLEND);
            gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
            this.use(p);
            gl.uniform1f(this.uniform(p,'u_time'),seconds*config.speed);
            gl.uniform1f(this.uniform(p,'u_size'),config.size);
            gl.uniform1f(this.uniform(p,'u_resolution'),Math.min(this.width,this.height));
            gl.uniform2f(this.uniform(p,'u_aspect'),Math.min(this.width,this.height)/this.width,Math.min(this.width,this.height)/this.height);
            gl.uniform3fv(this.uniform(p,'u_color'),rgb(config.color)); gl.uniform3fv(this.uniform(p,'u_glow'),rgb(config.glowColor));
            gl.uniform1f(this.uniform(p,'u_brightness'),config.brightness);
            const seed=gl.getAttribLocation(p.program,'a_seed'), path=gl.getAttribLocation(p.program,'a_path');
            gl.enableVertexAttribArray(seed); gl.enableVertexAttribArray(path);
            const bind=buffer=>{
                gl.bindBuffer(gl.ARRAY_BUFFER,buffer); gl.vertexAttribPointer(seed,4,gl.FLOAT,false,20,0); gl.vertexAttribPointer(path,1,gl.FLOAT,false,20,16);
            };
            bind(this.filamentBuffer); gl.uniform1f(this.uniform(p,'u_layer'),0); gl.drawArrays(gl.LINES,0,Math.min(count,MAX_CURVES*(STEPS-1)*2));
            gl.uniform1f(this.uniform(p,'u_layer'),1); gl.drawArrays(gl.POINTS,0,Math.min(count,MAX_CURVES*(STEPS-1)*2));
            bind(this.dustBuffer); gl.uniform1f(this.uniform(p,'u_layer'),2); gl.drawArrays(gl.POINTS,0,Math.round(1000*config.density));
            gl.disableVertexAttribArray(seed); gl.disableVertexAttribArray(path); gl.disable(gl.BLEND);
            const extract=this.programs.extract; this.use(extract); this.texture(extract,'u_image',this.targets.scene.texture); this.quad(extract,this.targets.a);
            const blur=this.programs.blur; this.use(blur); this.texture(blur,'u_image',this.targets.a.texture);
            gl.uniform2f(this.uniform(blur,'u_step'),2/this.targets.a.width,0); this.quad(blur,this.targets.b);
            this.texture(blur,'u_image',this.targets.b.texture); gl.uniform2f(this.uniform(blur,'u_step'),0,2/this.targets.a.height); this.quad(blur,this.targets.a);
            const composite=this.programs.composite; this.use(composite);
            this.texture(composite,'u_image',this.targets.scene.texture); this.texture(composite,'u_bloom',this.targets.a.texture,1);
            gl.uniform3fv(this.uniform(composite,'u_glow'),rgb(config.glowColor)); this.quad(composite,null);
            this.frames++;
        }
        renderTo(canvas,width,height,seconds=0,config={}) {
            if(!this.available||this.disposed) throw new Error(this.error || 'El núcleo WebGL no está disponible.');
            const number=(value,low,high,fallback)=>Number.isFinite(value)?Math.max(low,Math.min(high,value)):fallback;
            config={color:config?.color || '#ff452b',glowColor:config?.glowColor || '#ff6d35',
                brightness:number(config?.brightness,.2,2.5,1),density:number(config?.density,.35,1.8,1),
                speed:number(config?.speed,0,2,1),size:number(config?.size,.7,1.3,1)};
            width=number(width,1,720,512); height=number(height,1,720,512);
            width=Math.max(1,Math.min(720,Math.round(width))); height=Math.max(1,Math.min(720,Math.round(height)));
            this.resize(width,height); this.draw(config,Number.isFinite(seconds)?seconds:0);
            if(canvas.width!==width) canvas.width=width;
            if(canvas.height!==height) canvas.height=height;
            const output=canvas.getContext('2d');
            if(!output) throw new Error('No se pudo presentar el núcleo.');
            output.clearRect(0,0,width,height); output.drawImage(this.canvas,0,0,width,height);
        }
        clearTargets() {
            for(const target of Object.values(this.targets || {})) {
                this.gl.deleteFramebuffer(target.framebuffer); this.gl.deleteTexture(target.texture);
            }
            this.targets=null;
        }
        release() {
            if(!this.gl) return;
            this.clearTargets(); for(const [kind,resource] of this.resources) this.gl['delete'+kind](resource); this.resources=[];
        }
        stats() { return {renderer:'webgl-filaments',available:this.available,frames:this.frames,width:this.width,height:this.height,error:this.error}; }
        dispose() {
            if(this.disposed) return;
            this.disposed=true; this.available=false; this.release(); this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
            this.canvas.width=this.canvas.height=1;
        }
    }
    window.GunterIdleCore=GunterIdleCore;
})();
