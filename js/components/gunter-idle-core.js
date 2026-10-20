/* GunterIdleCore — GPU-advected material filaments and a shared energy volume.
 * renderTo(canvas, width, height, seconds, config); setPointer(x,y,active);
 * config.transport: {progress,from:[ndcX,ndcY],to:[ndcX,ndcY],fromScale,toScale,bend?,startStrength?}.
 * Transport scales are native core-box sides / the output's smaller side; NDC y points up.
 * config.shape: organic or a GunterCoreForms catalog id (six built-in fallbacks).
 * config.shadowColor controls unlit matter; config.static presents a still target.
 * resetPointer(); setAudioLevel(rms,available); stats(); dispose().
 * No DOM input, media or device capture; audio amplitude is supplied by the owner.
 */
(function () {
    'use strict';
    if (window.GunterIdleCore) return;
    const BASE_FILAMENTS=3840, MAX_FILAMENTS=7680, SIM_HEADS=1280, HISTORY=96, STEP=1/45;
    const HEADER='#version 300 es\nprecision highp float;\nprecision highp int;\n';
    const FIELD=`
        uniform float u_time;
        uniform float u_audio;
        uniform vec3 u_pointer,u_pointerFlow,u_shape,u_flow,u_previousFlow;
        uniform sampler2D u_shapeGuideFrom,u_shapeGuideTo;
        uniform sampler2D u_bio;
        uniform sampler2D u_velocity;
        uniform float u_bioReady,u_visualSize;
        uniform sampler2D u_pathsFrom,u_pathsTo,u_rowsFrom,u_rowsTo;
        uniform vec3 u_pathMode;
        uniform vec3 u_guideMode,u_guideWeights;
        uniform float u_static;
        vec3 worldPoint(vec3 p);
        vec3 viewPoint(vec3 p);
        // The energy is an independently advected 48^3 scalar medium. Sampling
        // stays inside a slice (no atlas seam interpolation), with explicit z
        // interpolation. Its coordinates are material coordinates, not screen
        // pixels, so every view can share this same finite GPU state.
        vec2 bioUV(vec2 xy,float slice) {
            return (vec2(mod(slice,8.0),floor(slice/8.0))*48.0+xy+.5)/vec2(384,288);
        }
        vec4 bioAt(vec3 p) {
            if(u_bioReady<.5||any(greaterThan(abs(p),vec3(.96))))return vec4(0);
            vec3 cell=clamp((p/.96*.5+.5)*47.0,vec3(0),vec3(47));
            float z=floor(cell.z);
            return mix(texture(u_bio,bioUV(cell.xy,z)),texture(u_bio,bioUV(cell.xy,min(47.0,z+1.0))),fract(cell.z));
        }
        vec4 cachedFlow(vec3 p) {
            if(any(greaterThan(abs(p),vec3(.96))))return vec4(0);
            vec3 cell=clamp((p/.96*.5+.5)*47.0,vec3(0),vec3(47));
            float z=floor(cell.z);
            return mix(texture(u_velocity,bioUV(cell.xy,z)),
                texture(u_velocity,bioUV(cell.xy,min(47.0,z+1.0))),fract(cell.z));
        }
        vec3 cachedVelocity(vec3 p) {return cachedFlow(p).xyz;}
        // Compact smoke-roll coordinates. Two local rotations preserve volume;
        // the final bounded shear lets neighbouring puffs lag by different
        // amounts, instead of elongating every particle along the travel axis.
        // Its exact inverse is shared by the volume and material integration.
        vec2 flowRotate(vec2 p,float a) {
            float c=cos(a),s=sin(a);return vec2(c*p.x-s*p.y,s*p.x+c*p.y);
        }
        float rollAngle(vec3 q,float strength) {
            return strength*(1.70+.55*sin(q.x*5.2))*exp(-dot(q.yz,q.yz)*1.4);
        }
        float foldAngle(float z,float strength) {return strength*.38*sin(z*4.1+.8);}
        float puffLag(vec2 yz,float strength) {
            return strength*.16*sin(yz.x*5.7+yz.y*4.3)*exp(-dot(yz,yz)*.8);
        }
        vec3 flowWind(vec3 p,vec3 flow) {
            vec3 q=viewPoint(p);vec2 d=flow.xy,n=vec2(-d.y,d.x);
            if(flow.z<.00001)return p;
            q=vec3(dot(q.xy,d),dot(q.xy,n),q.z);
            q.yz=flowRotate(q.yz,rollAngle(q,flow.z));
            q.xy=flowRotate(q.xy,foldAngle(q.z,flow.z));
            q.x+=puffLag(q.yz,flow.z);
            return worldPoint(vec3(d*q.x+n*q.y,q.z));
        }
        vec3 flowUnwind(vec3 p,vec3 flow) {
            vec3 q=viewPoint(p);vec2 d=flow.xy,n=vec2(-d.y,d.x);
            if(flow.z<.00001)return p;
            q=vec3(dot(q.xy,d),dot(q.xy,n),q.z);
            q.x-=puffLag(q.yz,flow.z);
            q.xy=flowRotate(q.xy,-foldAngle(q.z,flow.z));
            q.yz=flowRotate(q.yz,-rollAngle(q,flow.z));
            return worldPoint(vec3(d*q.x+n*q.y,q.z));
        }
        vec3 flowExtent() {
            // The rotations cannot inflate the body. A 20% margin contains
            // the bounded 0.16-unit lag, without a low-resolution long atlas.
            return vec3(1.0+u_flow.z*.20);
        }
        vec2 closestSegment(vec2 p,vec2 a,vec2 b) {
            vec2 d=b-a;return a+d*clamp(dot(p-a,d)/max(.00001,dot(d,d)),0.0,1.0);
        }
        vec4 stroke(vec2 p,vec2 a,vec2 b,float width) {
            vec2 q=closestSegment(p,a,b);return vec4(q,length(p-q),width);
        }
        vec4 nearerStroke(vec4 a,vec4 b) {return a.z/a.w<b.z/b.w?a:b;}
        vec2 starPoint(float index,float points,float radius,float rotation) {
            float angle=index*6.2831853/points+rotation;
            return vec2(cos(angle),sin(angle))*radius;
        }
        // Small, explicit silhouette catalog. The guides are attractors and
        // volumetric supports for living material, never visible line meshes.
        vec4 shapeGuide(float shape,vec2 p) {
            vec4 guide=vec4(0,0,100,.055);
            if(shape<1.5) {
                // A pentagram with exactly one extreme vertex pointing DOWN.
                for(int i=0;i<5;i++) {
                    float k=float(i);
                    guide=nearerStroke(guide,stroke(p,starPoint(k*2.0,5.0,.77,-1.5707963),
                        starPoint((k+1.0)*2.0,5.0,.77,-1.5707963),.052));
                }
            } else if(shape<2.5) {
                float x=clamp(p.x,-.76,.76),y=.34*(1.0-pow(x/.76,2.0));
                guide=vec4(x,p.y<0.0?-y:y,abs(abs(p.y)-y),.066);
                float radius=max(.0001,length(p));
                guide=nearerStroke(guide,vec4(p/radius*.225,abs(radius-.225),.058));
            } else if(shape<3.5) {
                guide=stroke(p,vec2(-.01,-.40),vec2(.015,.03),.255);
                guide=nearerStroke(guide,stroke(p,vec2(-.20,-.04),vec2(-.48,.21),.095));
                guide=nearerStroke(guide,stroke(p,vec2(-.19,.10),vec2(-.25,.63),.073));
                guide=nearerStroke(guide,stroke(p,vec2(-.035,.15),vec2(-.035,.80),.073));
                guide=nearerStroke(guide,stroke(p,vec2(.12,.12),vec2(.16,.70),.070));
                guide=nearerStroke(guide,stroke(p,vec2(.25,.045),vec2(.34,.49),.065));
            } else if(shape<4.5) {
                guide=stroke(p,vec2(0,-.67),vec2(0,.30),.055);
                guide=nearerStroke(guide,stroke(p,vec2(-.32,.29),vec2(.32,.29),.052));
                guide=nearerStroke(guide,stroke(p,vec2(0,.32),vec2(0,.70),.052));
                guide=nearerStroke(guide,vec4(0,.75,length(p-vec2(0,.75)),.075));
                // Taper the blade into a point, instead of a rounded stick.
                if(p.y<-.48)guide.w=max(.008,.055*clamp((p.y+.83)/.35,0.0,1.0));
            } else {
                for(int i=0;i<8;i++) {
                    float k=float(i),square=step(3.5,k),corner=mod(k,4.0);
                    float angle=.78539816+square*.78539816;
                    guide=nearerStroke(guide,stroke(p,starPoint(corner,4.0,.78,angle),
                        starPoint(corner+1.0,4.0,.78,angle),.052));
                }
            }
            return guide;
        }
        vec4 rawMaterialGuide(vec2 p,bool target) {
            float shape=target?u_shape.y:u_shape.x;
            float mode=target?u_guideMode.y:u_guideMode.x;
            if(mode<.5)return shapeGuide(shape,p);
            // Guides contain nearest material coordinates, not a visible image.
            // Texel centres preserve the catalog's [-1,1], y-up coordinate map.
            vec2 uv=(clamp(p,-1.0,1.0)*.5+.5)*(127.0/128.0)+vec2(.5/128.0);
            return target?texture(u_shapeGuideTo,uv):texture(u_shapeGuideFrom,uv);
        }
        vec4 materialGuide(vec2 p,bool target) {
            vec4 guide=rawMaterialGuide(p,target);
            // Negative distance denotes an authored MATERIAL INTERIOR, not
            // the interior of every closed decorative stroke. Preserve that
            // sign: discarding it reduced hands/wings/eyes to dark outlines.
            // Outside, keep the nearest-stroke guard against false bridges.
            if(guide.z>=0.0)guide.z=max(guide.z,length(p-guide.xy));
            return guide;
        }
        vec4 pathSample(float row,float along,bool target,float t,out vec2 tangent) {
            // One CPU-selected authored stroke per simulation row. Sampling
            // this constant-time assignment never crosses a nearest-guide
            // boundary between separate fingers, tentacles or orbital paths.
            int index=clamp(int(floor(row)),0,1279);
            vec4 route=target?texelFetch(u_rowsTo,ivec2(index,0),0):texelFetch(u_rowsFrom,ivec2(index,0),0);
            float seed=fract(row*.6180339),span=.18+.64*fract(row*.23971);
            float phase=seed+along*span+t*.020;
            phase=route.y>.5?fract(phase):1.0-abs(mod(phase,2.0)-1.0);
            float height=target?u_pathMode.y:u_pathMode.x;
            vec2 uv=vec2((phase*127.0+.5)/128.0,(route.x+.5)/height);
            vec4 path=target?texture(u_pathsTo,uv):texture(u_pathsFrom,uv);
            // Derivative of the authored parameter, NOT the direction of the
            // reflected moving phase: open endpoints cannot flip the offset
            // normal and throw a fibre to the opposite side of a finger.
            float before=route.y>.5?fract(phase-.006):max(0.0,phase-.006);
            float after=route.y>.5?fract(phase+.006):min(1.0,phase+.006);
            vec2 a=vec2((before*127.0+.5)/128.0,uv.y),b=vec2((after*127.0+.5)/128.0,uv.y);
            vec2 start=target?texture(u_pathsTo,a).xy:texture(u_pathsFrom,a).xy;
            vec2 end=target?texture(u_pathsTo,b).xy:texture(u_pathsFrom,b).xy;
            tangent=normalize(end-start+vec2(.00001,.00002));
            return path;
        }
        vec3 guidedPoint(vec3 p,float row,bool target,float t,float along,out vec3 flowTangent) {
            if(along>=0.0&&(target?u_pathMode.y:u_pathMode.x)>.5) {
                vec2 tangent;vec4 path=pathSample(row,along,target,t,tangent);
                flowTangent=worldPoint(vec3(tangent,0));
                vec2 normal=vec2(-tangent.y,tangent.x);
                float grain=fract(row*.56984)*2.0-1.0;
                // The same path texture also carries its signed inward reach.
                // Most fibres spread through the authored body; a minority
                // retain its fine outline/landmarks. No extra particles, image
                // overlays or per-point ray searches are required.
                float body=step(.001,abs(path.w))*step(.28,fract(row*.41421356));
                float filling=clamp(.06+.88*fract(row*.75487766)
                    +.025*sin(along*8.0+t*.29+row),.03,.97);
                float offset=mix(path.z*grain*.82,path.w*filling,body);
                float depth=mix(.035,.055+.11*sin(filling*3.14159265),body);
                vec3 q=vec3(path.xy+normal*offset,
                    sin(row*2.71)*depth+sin(along*13.0+t*.31+row)*.012);
                q.xy+=normal*sin(along*25.0+row+t*.27)*(.006+body*.007);
                return worldPoint(q);
            }
            vec3 q=viewPoint(p);vec4 guide=materialGuide(q.xy,target);
            vec2 normal=normalize(q.xy-guide.xy+vec2(.0001,.0002));
            flowTangent=worldPoint(vec3(-normal.y,normal.x,0));
            float grain=fract(row*.6180339)*2.0-1.0;
            q.xy=guide.xy+normal*guide.w*grain;
            q.z=clamp(q.z,-.19,.19)*.64;
            q+=vec3(sin(q.y*23.0+t*.41+row),cos(q.x*19.0-t*.37+row),sin(row+t*.2))*.014;
            return worldPoint(q);
        }
        vec3 morphGuide(vec3 p,float row,float t,float along,out vec3 flowTangent) {
            vec3 ta=worldPoint(vec3(1,0,0)),tb=ta,a=p,b=p;
            if(u_guideWeights.x>.0001)a=mix(p,guidedPoint(p,row,false,t,along,ta),u_guideWeights.x);
            if(u_guideWeights.y>.0001)b=mix(p,guidedPoint(p,row,true,t,along,tb),u_guideWeights.y);
            flowTangent=normalize(mix(ta*u_guideWeights.x,tb*u_guideWeights.y,u_shape.z)+vec3(.00001,.00002,.00003));
            return mix(a,b,u_shape.z);
        }
        vec3 morphGuide(vec3 p,float row,float t,float along) {
            vec3 tangent;return morphGuide(p,row,t,along,tangent);
        }
        float morphWeight() {return mix(u_guideWeights.x,u_guideWeights.y,u_shape.z);}
        vec4 morphMaterialGuide(vec2 p) {
            // Signed material support is also the membrane's topology. It is
            // never rendered as an image, and a pupil/gap stays an empty hole.
            // Blend the RAW signed fields exactly like blendedGuide's CPU
            // snapshot. The nearest-coordinate max guard is nonlinear and
            // must not change this clip when an in-flight morph is frozen.
            float a=u_guideWeights.x*(1.0-u_shape.z),b=u_guideWeights.y*u_shape.z;
            vec4 guide=vec4(0);
            if(a>.0001)guide+=rawMaterialGuide(p,false)*a;
            if(b>.0001)guide+=rawMaterialGuide(p,true)*b;
            return guide/max(.0001,a+b);
        }
        float shapedDensity(vec3 p,bool target,float t,float textureMatter,vec3 coarse,float fine) {
            vec3 q=viewPoint(p);q.xy+=vec2(sin(q.y*23.0+t*.27),cos(q.x*21.0-t*.31))*.012;
            vec4 guide=materialGuide(q.xy,target);
            float channel=1.0-smoothstep(guide.w*.55,max(.045,guide.w*2.15),guide.z);
            float interior=smoothstep(0.0,.17,-guide.z);
            float thickness=mix(.075,.23,interior);
            float depth=1.0-smoothstep(thickness*.36,thickness+guide.w,abs(q.z));
            // Broad folds and finer ridges share material coordinates. Volume
            // grows inside the silhouette instead of extruding uniform cables.
            float fold=abs(sin(q.x*11.0+q.y*9.0+q.z*17.0
                +coarse.x*4.7+coarse.z*3.9+t*.16));
            float sheets=1.0-smoothstep(.06,.34,fold);
            float ridges=smoothstep(.18,.82,fine);
            return channel*depth*(.32+sheets*sheets*1.65)*(.45+ridges*.65)*(.08+textureMatter*1.60);
        }
        vec3 shapedSupport(vec3 p,bool target) {
            vec3 q=viewPoint(p);vec4 guide=materialGuide(q.xy,target);
            // Gas already inside a body keeps its interior flow. Pulling all
            // samples to nearest edges evacuated its luminous central biomass.
            vec2 xy=guide.z<0.0?q.xy:guide.xy;
            float depth=.075+.13*smoothstep(0.0,.17,-guide.z);
            return worldPoint(vec3(xy,clamp(q.z,-depth,depth)));
        }
        float shapedEnergySupport(vec3 p,bool target) {
            vec3 q=viewPoint(p);vec4 guide=materialGuide(q.xy,target);
            float channel=1.0-smoothstep(guide.w*.35,max(.035,guide.w*1.6),guide.z);
            float interior=smoothstep(0.0,.17,-guide.z);
            // This is only the buried support of the renewal source. Its
            // moving thermal channels come from the same coherent fields as
            // the organic gas, NOT the densest folds of the opaque matter.
            // Squaring signed distance here would extinguish deep interiors.
            float depth=1.0-smoothstep(.025,.075+interior*.12,abs(q.z+.035));
            return channel*depth;
        }
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
        vec3 idleCenter(float t) {
            return vec3(.14*sin(t*.24),.12*cos(t*.27+1.3),.09*sin(t*.19));
        }
        vec3 energyCenter(float t) {
            // Keep the current anchored to the material's own interior. The
            // pointer deforms it within that body, rather than pulling a shell
            // of light out in front of the filaments.
            return idleCenter(t)*.25+worldPoint(vec3(u_pointer.xy*.14,0));
        }
        float bioEnergy(vec3 p) {
            vec4 gas=bioAt(p);
            return gas.r*gas.g;
        }
        vec3 bioGradient(vec3 p) {
            // Read the PREVIOUS energy target. Both independent integrators
            // receive this exact field, never a texture currently being written.
            const float h=.041;
            return vec3(bioEnergy(p+vec3(h,0,0))-bioEnergy(p-vec3(h,0,0)),
                bioEnergy(p+vec3(0,h,0))-bioEnergy(p-vec3(0,h,0)),
                bioEnergy(p+vec3(0,0,h))-bioEnergy(p-vec3(0,0,h)))/(2.0*h);
        }
        float bioRadiance(vec3 p) {
            // A finite local gather of the actual carried gas: no fictitious
            // central light or independent point emitters. Matter between the
            // receiving fold and this neighbourhood attenuates the gather.
            const float h=.145;
            return bioEnergy(p)*.44+(bioEnergy(p+vec3(h,0,0))+bioEnergy(p-vec3(h,0,0))
                +bioEnergy(p+vec3(0,h,0))+bioEnergy(p-vec3(0,h,0))
                +bioEnergy(p+vec3(0,0,h))+bioEnergy(p-vec3(0,0,h)))*.16;
        }
        vec3 energyTransport(vec3 p,float t) {
            vec3 gradient=bioGradient(p);
            float heat=bioEnergy(p);
            vec3 drift=worldPoint(u_pointerFlow)*.10+vec3(0,heat*.025,0);
            // Bounded thermal pressure plus rolling along its gradient bends
            // the nearby fibres as the luminous biomass stretches and folds.
            return gradient/max(1.0,length(gradient))*.055
                +cross(gradient,vec3(.13,.21,.17))*.032+drift*heat;
        }
        float matterDensity(vec3 p,float t) {
            vec3 unused;
            vec4 gas=bioAt(p);
            vec3 q=p-idleCenter(t)*.25;
            vec3 warp=potential(q*1.85+vec3(t*.045,2.1-t*.035,-1.3+t*.025),unused);
            q+=warp*.13;
            // Carried biomass, including its advected tracer, corrugates the
            // intermediate granular coat. It is not a second spherical fog.
            q+=vec3(sin(gas.b*6.1+q.y*4.0),cos(gas.b*5.7+q.z*4.0),sin(gas.b*4.3+q.x*4.0))*gas.r*.026;
            vec3 coarse=potential(q*3.1+vec3(1.7+t*.04,-2.3-t*.03,t*.035),unused);
            float radius=length(q*vec3(.96,1.03,1.10))+coarse.x*.12;
            float envelope=1.0-smoothstep(.54,.72,radius);
            // Anchor the envelope; only nearby folds bend with internal energy.
            vec3 offset=p-energyCenter(t);
            q-=worldPoint(vec3(u_pointer.xy*.24,0))*exp(-dot(offset,offset)/.18)*.22;
            q+=coarse*u_audio*.035*exp(-dot(offset,offset)/.18);
            float foldPhase=q.y*12.4+q.z*6.7+coarse.x*4.5+coarse.z*2.8+t*.14;
            float folds=abs(sin(foldPhase));
            // Narrow level bands are stretched translucent membranes, not
            // broad, fog-filled lobes. The existing coarse field wrinkles the
            // finite enclosing skin; its cavities still expose buried heat.
            float membrane=1.0-smoothstep(.07,.39,folds);
            float skin=1.0-smoothstep(.015,.075,abs(radius-(.55+coarse.z*.045)));
            float packing=(.48+.52*smoothstep(-.25,.60,coarse.y))
                *(.025+membrane*membrane*2.15+skin*.62);
            vec2 hole=q.xy-vec2(-.20,.13);
            hole.x+=.06*sin(q.z*6.0+t*.11);
            float cavity=1.0-.66*exp(-dot(hole/vec2(.13,.19),hole/vec2(.13,.19)));
            float fine=potential(q*7.8+vec3(-3.1+t*.08,4.2-t*.055,t*.065),unused).x*.5+.5;
            float original=envelope*packing*cavity*(.15+fine*fine*1.50)*(.82+gas.r*.45);
            // A silhouette changes support, not the chosen core's material:
            // reuse its already-computed multiscale folds, cavity and grain.
            // Replacing them by a smooth extruded guide lost that composition.
            float textureMatter=packing*cavity*(.15+fine*fine*1.50)*(.82+gas.r*.45);
            float a=u_guideWeights.x<.0001?original:mix(original,shapedDensity(p,false,t,textureMatter,coarse,fine),u_guideWeights.x);
            float b=u_guideWeights.y<.0001?original:mix(original,shapedDensity(p,true,t,textureMatter,coarse,fine),u_guideWeights.y);
            return mix(a,b,u_shape.z);
        }
        vec3 organicVelocity(vec3 p,float t) {
            vec3 q=p-idleCenter(t)*.55,curl,fine,micro;
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
            v+=energyTransport(p,t);
            vec3 local=p-energyCenter(t);
            float influence=u_pointer.z*exp(-dot(local,local)/.16);
            v+=(fine*.12+micro*.055)*influence;
            v+=(fine*.18+micro*.07)*u_audio*exp(-dot(local,local)/.18);
            // The cursor is a local obstacle in real material coordinates,
            // separate from the bounded inertial energy-centre displacement.
            // Repel and curl around it softly; never translate the container.
            vec3 cursor=worldPoint(vec3(u_pointer.xy/max(.01,u_visualSize*.80),0));
            vec3 away=p-cursor;
            float obstacle=u_pointer.z*exp(-dot(away*vec3(1,1,1.6),away*vec3(1,1,1.6))/.032);
            v+=(away/max(.055,length(away))*.085+cross(away,worldPoint(vec3(0,0,1)))*.12)*obstacle;
            return v;
        }
        vec3 velocity(vec3 p,float t,float row,float boundary,float along) {
            // Both independent RK2 integrators sample the same once-per-step
            // 48^3 velocity cache. Expensive curls, thermal gradients and the
            // pointer obstacle are not recomputed per material point/RK stage.
            vec4 carriedFlow=cachedFlow(p);
            vec3 v=carriedFlow.xyz,q=p-idleCenter(t)*.55;
            float outside=max(0.0,length(p*vec3(.94,1.02,1.13))-.87);
            v-=p*outside*3.2*boundary;
            float morph=morphWeight();
            // An attraction field bends existing material trajectories into
            // each silhouette. Tangential/curl flow remains alive inside it.
            if(along>=0.0) {
                // The material forms a loose, folded mantle around the gas.
                // This is a gentle force on the existing fibres, not a hard
                // shell, reset or second velocity field for the energy.
                if(boundary>0.0&&morph<.999) {
                    float radius=max(.035,length(q));
                    float mantle=.65+.065*sin(row*.37+along*7.0)+carriedFlow.a*.025;
                    v+=q/radius*clamp(mantle-radius,-.16,.24)*.48*(1.0-morph)*boundary;
                }
                vec3 tangent;
                vec3 target=morphGuide(p,row,t,along,tangent),error=target-p;
                vec3 normalError=error-tangent*dot(error,tangent);
                // Preserve the cached rolling flow ALONG an authored limb;
                // correct its normal offset strongly without phase-locking
                // every particle to a combed, uniformly moving outline.
                v-=(v-tangent*dot(v,tangent))*.65*morph;
                v+=(normalError*4.2+tangent*dot(error,tangent)*.70)*morph;
            } else if(morph>.0001) {
                // The Eulerian gas has no fibre row/along coordinate, but it
                // must remain in the SAME authored material support. Without
                // this force its renewal drifted out of thin fingers before
                // warming them. Keep tangential curl alive; attract only the
                // nearest-support offset, never paint a luminous contour.
                vec3 a=u_guideWeights.x<.0001?p:mix(p,shapedSupport(p,false),u_guideWeights.x);
                vec3 b=u_guideWeights.y<.0001?p:mix(p,shapedSupport(p,true),u_guideWeights.y);
                v*=1.0-morph*.70;
                v+=(mix(a,b,u_shape.z)-p)*2.4*morph;
            }
            float core=step(.19,fract(row*.56984));
            v+=q/max(.07,length(q))*max(0.0,.19-length(q))*.9*core;
            return v;
        }
        vec3 seedPosition(float row,float along,float t) {
            float plume=mod(floor(row),128.0);
            vec3 seed=hash3(vec3(plume,2.1,6.8))*.5+.5;
            float spread=(fract(row*.6180339)-.5)*.12;
            float u=(along-.5)*(.28+seed.z*seed.z*1.15);
            float angle=seed.x*6.2831853;
            vec3 center=(seed-.5)*vec3(1.02,1.05,.92);
            vec3 p=center+vec3(cos(angle)*u,sin(angle)*u,sin(seed.y*5.1)*u*.45);
            p.y+=.10*sin(u*6.3+seed.z*4.1+t*.13)+spread;
            p.z+=.10*sin(u*5.7+seed.y*4.7-t*.11);
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
    // Material depths travel as overlapping smoke packets, not one affine box.
    // Each packet has its own delayed progress, orbit and contraction. The
    // volume ray uses the exact inverse for that depth: light travels with its
    // matter, with no cloned trail or screen-wide longitudinal stretch.
    const TRANSPORT=`
        uniform vec3 u_transport,u_transportFrom,u_transportTo;
        vec2 riverCurve(float t,vec2 from,vec2 delta,vec2 normal,float bend) {
            return from+delta*t+normal*(4.0*length(delta)*bend*t*(1.0-t));
        }
        float packetProgress(float depth) {
            float p=u_transport.y;
            float envelope=pow(sin(p*3.14159265),2.0);
            float lane=.66*sin(depth*2.6+.7)+.34*sin(depth*4.1-1.1);
            return smoothstep(0.0,1.0,clamp(p+envelope*lane*.19,0.0,1.0));
        }
        vec2 packetCenter(float depth,vec2 from,vec2 delta,vec2 normal) {
            float p=u_transport.y,t=packetProgress(depth);
            float envelope=pow(sin(p*3.14159265),2.0);
            float orbit=sin(depth*4.7-p*4.4)*.080+sin(depth*7.3+p*3.0)*.035;
            return riverCurve(t,from,delta,normal,u_transport.z)
                +normal*length(delta)*envelope*orbit;
        }
        float packetTurn(float depth) {
            return sin(u_transport.y*3.14159265)*sin(depth*3.1-u_transport.y*3.6)*.78;
        }
        vec2 packetRotate(vec2 p,float a) {
            float c=cos(a),s=sin(a);return vec2(c*p.x-s*p.y,s*p.x+c*p.y);
        }
        vec2 transported(vec2 q,vec2 aspect,float depth) {
            if(u_transport.x<.5)return q*aspect;
            float progress=packetProgress(depth);
            float scale=mix(u_transportFrom.z,u_transportTo.z,progress);
            vec2 from=u_transportFrom.xy/aspect,delta=(u_transportTo.xy-u_transportFrom.xy)/aspect;
            float distance=length(delta);
            if(distance<.0001)return (from+q*scale)*aspect;
            vec2 normal=vec2(-delta.y,delta.x)/distance;
            vec2 center=packetCenter(depth,from,delta,normal);
            return (center+packetRotate(q,packetTurn(depth))*scale)*aspect;
        }
        vec2 untransported(vec2 screen,vec2 aspect,float depth) {
            if(u_transport.x<.5)return screen/aspect;
            float progress=packetProgress(depth);
            float scale=mix(u_transportFrom.z,u_transportTo.z,progress);
            vec2 from=u_transportFrom.xy/aspect,delta=(u_transportTo.xy-u_transportFrom.xy)/aspect;
            float distance=length(delta);
            if(distance<.0001)return (screen/aspect-from)/scale;
            vec2 normal=vec2(-delta.y,delta.x)/distance;
            vec2 center=packetCenter(depth,from,delta,normal);
            return packetRotate((screen/aspect-center)/scale,-packetTurn(depth));
        }
        vec2 packetBounds(vec2 aspect) {
            if(u_transport.x<.5)return vec2(0);
            float scale=mix(u_transportFrom.z,u_transportTo.z,packetProgress(0.0));
            vec2 delta=(u_transportTo.xy-u_transportFrom.xy)/aspect;
            float spread=pow(sin(u_transport.y*3.14159265),2.0);
            return (abs(delta)*.44+vec2(length(delta)*.17))*spread/max(.01,scale);
        }
    `;
    const QUAD=HEADER+`
        out vec2 v_uv;
        void main() {
            vec2 p=gl_VertexID==0?vec2(-1,-1):gl_VertexID==1?vec2(3,-1):vec2(-1,3);
            v_uv=p*.5+.5;gl_Position=vec4(p,0,1);
        }
    `;
    // A 48^3 field lives in a 384x288 atlas (8x6 slices). Ray marching and
    // filaments share its density, energy, incident radiance and facing term.
    const MEDIUM=`
        uniform sampler2D u_field;
        vec2 mediumUV(vec2 xy,float slice) {
            vec2 tile=vec2(mod(slice,8.0),floor(slice/8.0));
            return (tile*48.0+xy+.5)/vec2(384,288);
        }
        vec4 mediumAt(vec3 p) {
            p/=flowExtent();
            if(any(greaterThan(abs(p),vec3(.96))))return vec4(0);
            vec3 grid=clamp((p/.96*.5+.5)*47.0,vec3(0),vec3(47));
            float slice=floor(grid.z);
            return mix(texture(u_field,mediumUV(grid.xy,slice)),
                texture(u_field,mediumUV(grid.xy,min(47.0,slice+1.0))),fract(grid.z));
        }
    `;
    const VELOCITY_CACHE=HEADER+FIELD+`
        out vec4 result;
        void main() {
            vec2 cell=floor(gl_FragCoord.xy),tile=floor(cell/48.0);
            vec3 grid=vec3(mod(cell,48.0),tile.x+tile.y*8.0);
            vec3 p=(grid/47.0*2.0-1.0)*.96;
            // Alpha was unused: share previous-gas heat with the mantle,
            // avoiding extra gas texture reads in every fibre RK2 sample.
            result=vec4(organicVelocity(p,u_time),bioEnergy(p));
        }
    `;
    const FIELD_CACHE=HEADER+FIELD+`
        uniform float u_density;
        uniform sampler2D u_shapeSnapshot;
        uniform float u_snapshotWeight;
        out vec4 result;
        void main() {
            vec2 cell=floor(gl_FragCoord.xy),tile=floor(cell/48.0);
            vec3 grid=vec3(mod(cell,48.0),tile.x+tile.y*8.0);
            vec3 p=(grid/47.0*2.0-1.0)*.96*flowExtent();
            // Eulerian support rolls through the same compact material map. The
            // cached volume approximates its density; filaments retain their
            // actual, non-reversible curl trajectory in the history textures.
            p=flowUnwind(p,u_flow);
            vec4 gas=bioAt(p);
            float density=matterDensity(p,u_time),heat=max(0.0,gas.r*gas.g-.035);
            // The gas occupies cavities inside the folded matter. Test a
            // short depth neighbourhood only inside its finite support, so
            // sparse material does not turn into an exposed luminous coating.
            if(heat>.0001) {
                vec3 depth=worldPoint(vec3(0,0,.18));
                float cover=density+matterDensity(p+depth,u_time)+matterDensity(p-depth,u_time);
                heat*=smoothstep(.025,.18,cover);
            }
            vec3 thermalGradient=bioGradient(p);
            vec3 direction=thermalGradient/max(.001,length(thermalGradient));
            vec3 gradient=vec3(density-matterDensity(p+vec3(.055,0,0),u_time),
                density-matterDensity(p+vec3(0,.055,0),u_time),
                density-matterDensity(p+vec3(0,0,.055),u_time));
            vec3 normal=gradient/max(.0001,length(gradient));
            float surface=smoothstep(.025,.22,length(gradient));
            vec3 viewDirection=worldPoint(vec3(0,0,1));
            float grazing=pow(1.0-abs(dot(normal,viewDirection)),3.0);
            float reflection=pow(max(0.0,dot(reflect(-direction,normal),viewDirection)),20.0);
            // Reuse the actual cached material normal and gas gradient. Fine
            // folds catch the interior emitter, with no extra normal marches,
            // point light, screen-space gloss layer or painted outline.
            float facing=mix(.12,.12+.40*abs(dot(normal,direction))
                +grazing*.26+reflection*.72,surface);
            float obstruction=density*.5+matterDensity(p+direction*.055,u_time)
                +matterDensity(p+direction*.115,u_time);
            // Single scattering gathered from the real advected luminous gas.
            // Its moving lobes determine which folds are lit, including their
            // depth/density absorption. There is no old analytic glowing tube.
            float light=bioRadiance(p)*exp(-obstruction*.17*u_density)*1.55;
            result=vec4(density,heat,light,facing);
            if(u_snapshotWeight>.0001)result=mix(result,
                texture(u_shapeSnapshot,gl_FragCoord.xy/vec2(384,288)),u_snapshotWeight);
        }
    `;
    const BIO_SIM=HEADER+FIELD+`
        uniform float u_dt;
        uniform int u_initialize;
        out vec4 result;
        vec2 bioSource(vec3 p,float t) {
            vec3 unused,q=p-energyCenter(t);
            vec3 warp=potential(q*2.7+vec3(1.8+t*.045,-2.9-t*.035,4.1+t*.04),unused);
            q+=warp*.20;
            vec3 coarse=potential(q*3.7+vec3(-2.6+t*.10,1.4-t*.07,t*.08),unused);
            vec3 folds=potential(q*7.6+vec3(4.2-t*.16,-1.3+t*.11,2.1+t*.13),unused);
            float radius=length(q*vec3(.93,1.04,1.08))+coarse.x*.16;
            float body=1.0-smoothstep(.43,.66,radius);
            // Connected lobes are carved by coherent low/mid-frequency fields,
            // not a collection of round emitters. Their saddle points open and
            // close into channels, leaving real dark cavities through the gas.
            float lobes=smoothstep(-.32,.21,coarse.y+folds.x*.44);
            float cavities=smoothstep(-.34,.14,coarse.z+folds.y*.48);
            // A broad irregular substrate connects the hot lobes. Previously
            // multiplying two zero-valued masks severed that gas into spots;
            // advection/cooling then erased their thin connecting saddles.
            // Cavities still thin the substrate rather than filling a sphere.
            float substrate=(.19+.13*smoothstep(-.35,.25,coarse.z))
                *(1.0-.58*(1.0-cavities)*(1.0-lobes));
            // A coherent folded saddle joins the hot chambers. Keeping the
            // renewal in these irregular seams avoids a constellation of
            // isolated glowing balls inside the compact membrane body.
            float conduit=1.0-smoothstep(.08,.34,abs(coarse.y+folds.x*.50));
            float density=body*(substrate*.75+conduit*(.46+cavities*.48)
                +lobes*cavities*(.20+coarse.x*.12));
            float front=smoothstep(-.28,.32,coarse.x+folds.z*.52);
            float thermal=(.28+.72*front)*(.78+folds.y*.22);
            // During a requested transformation the SAME renewal source is
            // redistributed gradually over authored supports. Its temperature
            // and porous folds remain material fields, not an emissive line.
            // Local history still arrives through RK2 and only a fractional
            // source renewal is added per step below; no gas state is reset.
            float texturePacking=.38+.62*lobes*(.45+.55*cavities);
            float seams=1.0-smoothstep(.12,.45,abs(coarse.y+folds.x*.50));
            float channels=(.33+seams*1.10)*texturePacking;
            float a=u_guideWeights.x<.0001?density:mix(density,
                shapedEnergySupport(p,false)*channels,u_guideWeights.x);
            float b=u_guideWeights.y<.0001?density:mix(density,
                shapedEnergySupport(p,true)*channels,u_guideWeights.y);
            density=mix(a,b,u_shape.z);
            return vec2(density,thermal);
        }
        void main() {
            vec2 cell=floor(gl_FragCoord.xy),tile=floor(cell/48.0);
            vec3 grid=vec3(mod(cell,48.0),tile.x+tile.y*8.0);
            vec3 p=(grid/47.0*2.0-1.0)*.96;
            vec2 source=bioSource(p,u_time);
            vec3 unused;
            float grainSeed=potential(p*15.0+vec3(2.7,-4.2,1.6),unused).x*.5+.5;
            if(u_initialize==1){result=vec4(source,grainSeed,1);return;}
            // RK2 backtrace through exactly the velocity field used by the
            // material integrator. The previous ping-pong target is read-only.
            vec3 v=velocity(p,u_time,0.0,1.0,-1.0);
            vec3 back=p-velocity(p-v*u_dt*.5,u_time-u_dt*.5,0.0,1.0,-1.0)*u_dt;
            vec4 previous=bioAt(back);
            float h=1.92/47.0;
            vec2 neighbours=(bioAt(back+vec3(h,0,0)).rg+bioAt(back-vec3(h,0,0)).rg
                +bioAt(back+vec3(0,h,0)).rg+bioAt(back-vec3(0,h,0)).rg
                +bioAt(back+vec3(0,0,h)).rg+bioAt(back-vec3(0,0,h)).rg)/6.0;
            vec2 carried=mix(previous.rg,neighbours,.055);
            // Local renewal and cooling replace only a fraction of the carried
            // gas per second. Regions stretch, split, cool and reconnect rather
            // than being reconstructed as a sine wave on every frame.
            // Relax towards a finite local rest density instead of adding a
            // source every step against an unrelated slower decay. The old
            // .62/.25 ratio accumulated ~2.5x substrate and filled its saddles.
            float restMass=min(1.45,source.r*1.8);
            float mass=mix(carried.r,restMass,1.0-exp(-u_dt*.62))*exp(-u_dt*.06);
            float heat=mix(carried.g,source.g,1.0-exp(-u_dt*(.35+source.r*.65)));
            float support=1.0-smoothstep(.72,.91,length(p*vec3(.94,1.01,1.10)));
            float tracer=mix(previous.b,grainSeed,1.0-exp(-u_dt*.08));
            // A support is an absorption RATE, not an opacity multiplier per
            // simulation step. Multiplying by .8 every 1/45s used to erase a
            // broad outer lobe in a fraction of a second and sever its bridges.
            float boundaryTransmission=exp(-u_dt*(1.0-support)*6.0);
            result=vec4(clamp(mass*boundaryTransmission,0.0,1.8),clamp(heat,0.0,1.0),tracer,1);
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
            float along=float(cell.x)/float(textureSize(u_history,0).x-1);
            vec3 p;
            if(u_initialize==1) {
                p=seedPosition(row,along,u_time);
                float h=.025;
                // Warm a folded material filament, not a cloud or a comet tail.
                for(int k=0;k<6;k++) {
                    float t=u_time+float(k)*h;
                    vec3 v=velocity(p,t,row,0.0,along);
                    p+=velocity(p+v*h*.5,t+h*.5,row,0.0,along)*h;
                }
                p=flowWind(p,u_flow);
            } else {
                p=texelFetch(u_history,cell,0).xyz;
                // Carry existing material through compact rolls, then advect
                // small curls and counter-currents with their own filament
                // phase. This sheds local wisps, not a uniform rubber stretch.
                vec3 rest=flowUnwind(p,u_previousFlow);
                vec3 v=velocity(rest,u_time,row,1.0,along);
                vec3 eddies=vec3(0);
                if(u_flow.z>.0001) {
                    vec3 curl,fine;
                    potential(rest*3.7+vec3(u_time*.27,-u_time*.21,row*.013),curl);
                    potential(rest*10.1+vec3(-u_time*.31,row*.017,u_time*.23),fine);
                    float pocket=.45+.55*sin(row*.57+rest.y*7.0+u_time*.63);
                    vec3 slip=worldPoint(vec3(u_flow.xy,0))*sin(row*.37+rest.z*6.0-u_time*.41)*.095;
                    eddies=(curl*(.16+pocket*.12)+fine*.105+slip)*u_flow.z;
                }
                v+=eddies;
                rest+=(velocity(rest+v*u_dt*.5,u_time+u_dt*.5,row,1.0,along)+eddies)*u_dt;
                p=flowWind(rest,u_flow);
                // Neighbour constraints keep material strands continuous as
                // the velocity field stretches and folds them. No history shift.
                int end=textureSize(u_history,0).x-1;
                vec3 a=texelFetch(u_history,ivec2(max(0,cell.x-1),cell.y),0).xyz-p;
                vec3 b=texelFetch(u_history,ivec2(min(end,cell.x+1),cell.y),0).xyz-p;
                float la=length(a),lb=length(b);
                float spacing=.024*(1.0+u_flow.z*.28);
                p+=a/max(.0001,la)*max(0.0,la-spacing)*.11;
                p+=b/max(.0001,lb)*max(0.0,lb-spacing)*.11;
            }
            result=vec4(p,1);
        }
    `;
    // A folded, perforated material skin complements the low-resolution
    // energy volume. Vertices are procedural: no image, geometry buffers,
    // cloned core or additional simulation texture. Its deformation reads
    // exactly the velocity/heat used by the free material filaments.
    const MEMBRANE_VERTEX=HEADER+FIELD+MEDIUM+TRANSPORT+`
        uniform vec2 u_resolution;
        uniform float u_size;
        out vec3 v_world;
        out vec2 v_surface;
        void main() {
            int cell=gl_VertexID/6,corner=gl_VertexID%6;
            vec2 offset=corner==0?vec2(0,0):corner==1?vec2(1,0):corner==2?vec2(0,1):corner==3?vec2(0,1):corner==4?vec2(1,0):vec2(1,1);
            vec2 uv=(vec2(cell%96,cell/96)+offset)/vec2(96,64);
            float phi=uv.x*6.2831853,theta=uv.y*3.14159265;
            float folds=sin(theta*4.0+sin(phi*3.0)*1.2+u_time*.13);
            float radius=.53+folds*.095+sin(phi*5.0-theta*3.0+u_time*.09)*.038;
            vec3 q=vec3(cos(phi)*sin(theta),sin(phi)*sin(theta),cos(theta))*(radius);
            q.z*=.91;
            float morph=morphWeight();
            if(morph>.0001) {
                // The SAME procedural grid opens into the named material's
                // folded front skin, not a sphere left behind its silhouette.
                // Its signed guide supplies only support/depth; the gas and
                // material coordinates still supply all visible texture.
                vec2 xy=(uv*2.0-1.0)*.96;
                vec4 guide=morphMaterialGuide(xy);
                float interior=smoothstep(0.0,.17,-guide.z);
                vec3 support=worldPoint(vec3(xy,.055+interior*.11));
                vec4 relief=mediumAt(flowWind(support,u_flow));
                // The existing multiscale material field sculpts actual
                // relief. Independent sine sheets produced a regular diamond
                // mesh over every shape instead of the core's irregular folds.
                float fold=relief.r/(.35+relief.r);
                vec3 shaped=vec3(xy,.045+interior*.10+(fold-.35)*.11
                    +clamp(relief.a-.25,-.25,.75)*.025);
                q=mix(q,shaped,morph);
            }
            vec3 p=worldPoint(q);
            p+=cachedVelocity(p)*(.10+bioEnergy(p)*.08);
            p=flowWind(p,u_flow);q=viewPoint(p);
            vec2 aspect=min(u_resolution.x,u_resolution.y)/u_resolution;
            gl_Position=vec4(transported(q.xy*u_size*.80,aspect,q.z),0,1);
            v_world=p;v_surface=vec2(theta,phi);
        }
    `;
    const MEMBRANE_FRAGMENT=HEADER+FIELD+MEDIUM+`
        uniform vec3 u_particle,u_energy,u_glow,u_shadow;
        uniform float u_brightness,u_density,u_debugView;
        in vec3 v_world;
        in vec2 v_surface;
        out vec4 result;
        void main() {
            float morph=morphWeight(),presence=1.0;
            vec3 rest=flowUnwind(v_world,u_flow);
            if(morph>.0001) {
                vec4 guide=morphMaterialGuide(viewPoint(rest).xy);
                float support=1.0-smoothstep(guide.w*.20,max(.012,guide.w*.78),guide.z);
                presence=mix(1.0,support,morph);
                if(presence<.02)discard;
            }
            float pores=sin(v_surface.x*6.0+sin(v_surface.y*3.0)*.5)*sin(v_surface.y*5.0-u_time*.10);
            // Stable material-space micrograins, not periodic diagonal waves.
            // Only the signed support opens an anatomical hole.
            vec3 granular=vec3(0);float microGrain=.5;
            if(morph>.0001){granular=hash3(floor(rest*137.0));microGrain=granular.x*.5+.5;}
            float microErosion=.84+.16*microGrain;
            float film=mix(1.0-smoothstep(.40,.66,pores),microErosion,morph);
            if(film<.02)discard;
            vec3 normal=normalize(cross(dFdx(v_world),dFdy(v_world)));
            if(morph>.0001)normal=normalize(normal+worldPoint(granular)*.16*morph);
            vec3 view=worldPoint(vec3(0,0,1));
            float facing=abs(dot(normal,view)),fresnel=pow(1.0-facing,3.0);
            vec4 material=mediumAt(v_world);
            float heat=u_debugView>1.5?0.0:material.g;
            float light=material.b;
            float buried=0.0,vein=0.0;
            if(morph>.0001&&u_debugView<1.5) {
                vec4 gas=bioAt(rest-worldPoint(vec3(0,0,.14)));
                buried=gas.r*gas.g;
                // Open only locally lit channels between dense folds. The
                // dark top coat otherwise hid nearly all of the real buried
                // gas; there is no global alpha reduction or painted vein.
                float seam=1.0-smoothstep(.06,.24,abs(gas.b-.50));
                vein=smoothstep(.08,.42,buried)*(1.0-smoothstep(.10,.65,material.r))*(.22+seam*.78);
            }
            // The shared field already carries the normal/thermal reflection.
            // Reuse it, instead of twelve gas reads per membrane fragment.
            float specular=pow(clamp(material.a,0.0,1.0),3.0)*min(1.0,light*3.0)*(.25+fresnel*.75);
            float packing=smoothstep(.035,.70,material.r);
            film*=mix(.12+.88*packing,.68+.32*packing,morph);
            vec3 color=u_shadow*(.18+facing*.16+packing*.22)
                +u_particle*(.010+light*.10+fresnel*(.03+light*.28)+specular*.55)
                +u_energy*light*(.18+heat*.25)+u_glow*heat*.24;
            float alpha=film*(.18+packing*.30+fresnel*.40+specular*.08)*presence*u_density;
            vec3 namedColor=u_shadow*(.22+packing*.35+facing*.08)*(1.0-clamp(light*.35,0.0,.55))
                +u_particle*(light*.06+specular*.12)
                +u_energy*(light*(.28+heat*.25)+vein*buried/(.24+buried)*1.50)
                +u_glow*(heat*.22+vein*buried/(.24+buried)*.45);
            namedColor*=.80+.30*microGrain;
            color=mix(color,namedColor,morph);
            // Keep continuous named material; only signed support opens
            // anatomical holes, while density strengthens its dark folds.
            float namedAlpha=film*(.68+packing*.14+fresnel*.04)*presence*u_density*(1.0-vein*.58);
            alpha=mix(alpha,namedAlpha,morph);
            alpha*=gl_FrontFacing?1.0:.50;
            result=vec4(color*u_brightness,clamp(alpha,0.0,.80));
        }
    `;
    const STRAND_VERTEX=HEADER+FIELD+TRANSPORT+`
        uniform sampler2D u_history;
        uniform vec2 u_resolution;
        uniform float u_size;
        out vec3 v_world;
        out float v_cross,v_age,v_depth;
        out vec2 v_grainUV;
        flat out float v_seed,v_granule;
        vec2 projected(vec3 p) {
            vec2 aspect=min(u_resolution.x,u_resolution.y)/u_resolution;
            vec3 view=viewPoint(p);
            return transported(view.xy*u_size*.80,aspect,view.z);
        }
        vec3 presentationPoint(vec3 p,float row,float along) {
            p=flowUnwind(p,u_previousFlow);
            if(u_static>.5&&morphWeight()>.001)p=morphGuide(p,row,u_time,along);
            // A small material-space clearance keeps the living filament
            // mantle outside the inner membrane, including during transport.
            // Authored shapes retain their precise supports and holes.
            vec3 center=idleCenter(u_time)*.25;
            p=center+(p-center)*mix(1.10,1.0,morphWeight());
            return flowWind(p,u_flow);
        }
        void main() {
            int historyLength=textureSize(u_history,0).x;
            int filament=gl_InstanceID/(historyLength-1),segment=gl_InstanceID%(historyLength-1);
            int row=filament/6;
            int id=gl_VertexID;
            bool endpoint=(id==1||id==3);
            float side=id<2?-1.0:1.0;
            int x=segment+(endpoint?1:0);
            vec3 p=texelFetch(u_history,ivec2(x,row),0).xyz;
            vec3 before=texelFetch(u_history,ivec2(max(0,x-1),row),0).xyz;
            vec3 after=texelFetch(u_history,ivec2(min(historyLength-1,x+1),row),0).xyz;
            p=presentationPoint(p,float(row),float(x)/float(historyLength-1));
            before=presentationPoint(before,float(row),float(max(0,x-1))/float(historyLength-1));
            after=presentationPoint(after,float(row),float(min(historyLength-1,x+1))/float(historyLength-1));
            // Microstructure follows material coordinates: it travels with the
            // curve, rather than flickering as unrelated screen-space noise.
            float seed=float(row)+float(filament%6)*37.71;
            float age=float(x)/float(historyLength-1);
            float granule=1.0-step(.76,fract(seed*.6180339));
            vec3 start=endpoint?before:p,end=endpoint?p:after;
            if(granule>.5) {
                // Reuse the same three history reads and the same strip4.
                // Most strips are compact flow-aligned material grains; only
                // a minority retain their short, locally fractured fibres.
                float between=.50+.32*hash3(vec3(seed,float(segment),5.1)).x;
                p=mix(start,end,between);
                age=(float(segment)+between)/float(historyLength-1);
            }
            vec3 fibre=hash3(vec3(seed,2.7,8.2))*mix(.021,.012,morphWeight());
            vec3 irregular=vec3(sin(age*71.0+seed),sin(age*53.0+seed*1.7),sin(age*89.0-seed*.7))*.006;
            p+=fibre+irregular;before+=fibre+irregular;after+=fibre+irregular;
            vec2 tangent=(granule>.5?projected(end)-projected(start):projected(after)-projected(before))*u_resolution;
            tangent/=max(.00001,length(tangent));
            vec2 normal=vec2(-tangent.y,tangent.x);
            float ribbon=materialNoise(age*91.0,seed*.71);
            float beads=smoothstep(.76,.91,ribbon);
            float width=.24+.26*ribbon+beads*.48;
            float alongSide=endpoint?1.0:-1.0;
            float radius=.35+.45*ribbon;
            vec2 grainOffset=(tangent*alongSide*radius+normal*side*radius*.80)*2.0/u_resolution;
            vec2 position=projected(p)+mix(normal*side*width*2.0/u_resolution,grainOffset,granule);
            gl_Position=vec4(position,0,1);
            v_cross=side;v_age=age;v_seed=seed;v_granule=granule;v_grainUV=vec2(alongSide,side);
            v_world=p;v_depth=clamp(.5+viewPoint(p).z*.45,.08,.92);
        }
    `;
    const STRAND_FRAGMENT=HEADER+FIELD+MEDIUM+`
        uniform vec3 u_particle,u_energy,u_glow,u_shadow;
        uniform float u_brightness;
        in vec3 v_world;
        in float v_cross,v_age,v_depth;
        in vec2 v_grainUV;
        flat in float v_seed,v_granule;
        out vec4 result;
        void main() {
            float grainRadius=dot(v_grainUV,v_grainUV);
            if(v_granule>.5&&grainRadius>1.0)discard;
            float edge=mix(1.0-smoothstep(.25,1.0,abs(v_cross)),1.0-smoothstep(.25,1.0,grainRadius),v_granule);
            float fade=pow(max(0.0,sin(v_age*3.14159265)),.55);
            vec4 material=mediumAt(v_world);
            float emission=material.g;
            float incident=clamp(emission*1.7+material.b*.65,0.0,1.0);
            float morph=morphWeight();
            vec3 rest=flowUnwind(v_world,u_flow);
            float buried=bioEnergy(rest-worldPoint(vec3(0,0,.16)));
            float namedCover=smoothstep(.06,.35,buried)
                *(1.0-smoothstep(.015,.20,emission));
            // A transformed body retains porous front fibres: they reveal the
            // same buried gas instead of turning its whole contour into ink.
            // Organic front matter stays dark even when its own voxel is warm.
            // Compare real buried/front heat instead of erasing the coat above
            // a hard front-temperature threshold. Named v196 is unchanged.
            float organicCover=smoothstep(.04,.30,buried)*buried/(.06+buried+emission*.75);
            float frontCover=mix(organicCover,namedCover*.35,morph);
            // Filaments are the foreground material, not another luminous
            // volume: never attenuate them by the already-composited core.
            // Their shading still receives the same gas heat and irradiance.
            float matter=material.r;
            vec3 tint=mix(vec3(1),u_energy,smoothstep(.12,.65,emission+material.b*.45));
            vec3 color=u_shadow*(.16+v_depth*.25)*(1.0-incident)
                +u_particle*tint*(.035+material.b*(.34+material.a*2.2))*(1.0-emission*.65)
                +u_energy*incident*(1.1+u_audio*.70)
                +u_glow*emission*emission*(.35+u_pointer.z*.32+u_audio*1.45);
            float diffuse=material.b/(.40+material.b)*(.12+.65*clamp(material.a,0.0,1.0));
            float localHot=smoothstep(.12,.62,emission)*(.20+.80*clamp(material.a,0.0,1.0));
            vec3 organicColor=u_shadow*(.34+v_depth*.24)
                +u_particle*tint*(.010+diffuse*.20)*(1.0-localHot*.60)
                +u_energy*localHot*(.46+u_audio*.70)
                +u_glow*localHot*emission*(.22+u_pointer.z*.32+u_audio*1.45);
            color=mix(organicColor,color,morph);
            // Front microfibres cover the buried emitter. Keep their shaded
            // material response instead of painting emission over their face.
            vec3 coat=u_shadow*(.32+v_depth*.20)+u_particle*tint*(.025+material.b*(.35+material.a*.90));
            vec3 organicCoat=u_shadow*(.40+v_depth*.20)+u_particle*tint*(.008+diffuse*.10);
            coat=mix(organicCoat,coat,morph);
            color=mix(color,coat,frontCover*.88);
            // Broad erosion creates differently sized wisps; fine coverage
            // turns each wisp into porous, irregular microfibres, not a cable.
            float lengths=3.0+15.0*fract(v_seed*.56984);
            float fragments=.06+.94*smoothstep(.24,.66,materialNoise(v_age*lengths,v_seed+4.1));
            fragments*=.18+.82*smoothstep(.04,.70,matter);
            // Most ribbons break into carried granules, while a smaller
            // fraction stays fibrous. This avoids a uniform cottony veil.
            float granules=smoothstep(.35,.80,materialNoise(v_age*211.0,v_seed*1.31));
            float grain=mix(.35+.65*granules,.12+.88*granules,1.0-v_granule);
            float packing=.30+matter*matter*5.20;
            float alpha=min(.90,edge*fade*(.26+v_depth*.12)*fragments*grain*packing
                *(1.0+frontCover*.75));
            // Hundreds of thousands of strips cannot all retain a nonzero
            // coverage floor: their low-density dust accumulates into a veil.
            // Organic coverage follows actual folded matter and leaves real
            // cavities clear. Only a rare stable subset supplies loose dust.
            float foldCoverage=smoothstep(.10,.60,matter);
            float organicGrain=mix(granules*granules,.04+.96*granules,1.0-v_granule);
            float dust=.004*step(.985,fract(v_seed*.754877))*granules*granules;
            float organicAlpha=min(.90,edge*fade*((.26+v_depth*.12)*fragments*organicGrain
                *(matter*matter*5.20)*foldCoverage*foldCoverage*(1.0+frontCover*.75)+dust));
            alpha=mix(organicAlpha*.90,alpha*.68,morph);
            // Tone-map once here because this sharp foreground pass is after
            // core bloom. Bright fibres retain the chosen hue, not white fog.
            color*=u_brightness;
            float peak=max(color.r,max(color.g,color.b));
            color*=(1.0-exp(-peak*1.35))/max(.0001,peak);
            result=vec4(color,alpha);
        }
    `;
    const VOLUME=HEADER+FIELD+MEDIUM+TRANSPORT+`
        uniform vec2 u_resolution;
        uniform vec3 u_particle,u_energy,u_glow,u_shadow;
        uniform float u_size,u_brightness,u_density;
        uniform float u_debugView;
        in vec2 v_uv;
        out vec4 result;
        void main() {
            if(u_debugView>2.5){result=vec4(0);return;}
            vec2 aspect=min(u_resolution.x,u_resolution.y)/u_resolution;
            vec2 screen=v_uv*2.0-1.0;
            vec2 centerPlane=untransported(screen,aspect,0.0)/(u_size*.80);
            vec2 bounds=vec2(1.02+u_flow.z*.20)+packetBounds(aspect)/(u_size*.80);
            if(any(greaterThan(abs(centerPlane),bounds))){result=vec4(0);return;}
            vec3 color=vec3(0);float opacity=0.0;
            // Fixed per-ray stratification breaks the sampling lattice without
            // frame-random grain or a moving screen-space noise overlay.
            float jitter=hash3(vec3(floor(gl_FragCoord.xy),7.3)).x*.45;
            for(int i=0;i<40;i++) {
                float marchDepth=1.92*flowExtent().z;
                float z=(.5-(float(i)+.5+jitter)/40.0)*marchDepth;
                vec2 xy=untransported(screen,aspect,z)/(u_size*.80);
                vec3 p=worldPoint(vec3(xy,z));
                if(u_debugView>0.5&&u_debugView<1.5) {
                    vec3 rest=flowUnwind(p,u_flow);
                    vec4 gas=bioAt(rest);vec3 unused;
                    float heat=gas.r*gas.g;
                    if(heat<=.015)continue;
                    // The small-grid gas supplies large moving lobes. Fine
                    // erosion is evaluated in its material coordinates and
                    // warped by a tracer actually carried by advection. This
                    // restores granular folds without a video/noise overlay,
                    // screen-space shimmer or a larger simulation texture.
                    vec3 detail=rest*vec3(48.0,57.0,53.0)+gas.b*vec3(2.2,-1.8,1.6);
                    float fine=potential(detail,unused).x*.5+.5;
                    float micro=potential(detail*2.4+vec3(3.7,-1.9,4.1),unused).y*.5+.5;
                    // Continuous thermal response retains variation after the
                    // gas reaches equilibrium. A saturated smoothstep turned
                    // almost every warm sample into the same solid red lobe.
                    float lobes=heat/(.28+heat);
                    float erosion=smoothstep(.18,.76,fine)*(.22+1.35*smoothstep(.28,.72,micro));
                    float mass=gas.r*erosion,stepLength=marchDepth/40.0;
                    float absorption=1.0-exp(-mass*1.20*stepLength);
                    // Emission and extinction share one finite optical depth.
                    // Longer columns self-attenuate instead of adding six
                    // units per ray and clipping all interior microstructure.
                    float emission=absorption*lobes*(1.45+gas.g*.55);
                    vec3 light=u_energy*(1.25+heat*.75+u_audio*.65)
                        +u_glow*heat*(.20+u_audio*.65);
                    color+=(1.0-opacity)*light*emission;
                    opacity+=(1.0-opacity)*absorption;
                    if(opacity>.985)break;
                    continue;
                }
                vec4 material=mediumAt(p);
                vec3 rest=flowUnwind(p,u_flow);
                vec4 gas=bioAt(rest);
                vec3 detail=rest-idleCenter(u_time)*.25;
                vec3 unused;
                float grains=potential(detail*vec3(48.0,57.0,53.0)+gas.b*vec3(2.2,-1.8,1.6),unused).x*.5+.5;
                // Grain stays on the material, never on a screen overlay.
                float grain=.42+1.20*smoothstep(.28,.74,grains);
                float mass=max(0.0,material.r-.12);
                // Resolve thin folded films at ray resolution. The coarse
                // density atlas supplies support; it cannot by itself resolve
                // a membrane thinner than a 48^3 cell without becoming fog.
                float filmPhase=detail.y*12.4+detail.z*6.7
                    +sin(detail.x*5.1+detail.z*3.4+u_time*.14)*1.25+gas.b*.55;
                float film=1.0-smoothstep(.035,.19,abs(sin(filmPhase)));
                float support=smoothstep(.015,.22,material.r);
                float morph=morphWeight();
                mass=max(mass*mix(.24,.95,morph),film*support*.55);
                // A named form has a thinner porous optical coat, not less
                // simulated matter. Leave the organic material response alone.
                float opticalMass=mass*mix(1.0,.92,morph);
                // Beer-Lambert extinction separates porous matter from the
                // emitting gas; front coats partially obscure deeper folds.
                float density=1.0-exp(-opticalMass*opticalMass*grain*18.0*(marchDepth/40.0)*u_density);
                // The organic emitter keeps sparse hot grain peaks instead
                // of lighting every warm gas voxel as a continuous fog. This
                // changes optical response only, never carried gas or audio.
                float organicGrain=.08+1.35*pow(smoothstep(.24,.80,grains),2.0);
                float thermalGrain=mix(organicGrain,.30+1.10*smoothstep(.18,.76,grains),morph);
                float heat=u_debugView>1.5?0.0:material.g*thermalGrain,incident=material.b;
                float face=material.a*material.a;
                vec3 tint=mix(vec3(1),u_energy,smoothstep(.12,.65,heat+incident*.45));
                float unlit=1.0-clamp(incident,0.0,1.0);
                vec3 scattered=u_shadow*(.27+face*.10)*mix(.72+unlit*.28,unlit,morph)
                    +u_particle*tint*incident*(.055+face*mix(.85,.75,morph))*(1.0-heat*.65)
                    +u_energy*incident*.08+u_glow*heat*face*.36
                    +u_particle*incident*face*film*mix(.22,.15,morph);
                // Voice changes the buried emitter, not a global screen flash.
                // A syllable lifts local radiance while pauses restore idle.
                float energyGain=mix(1.90,1.70,morph);
                float whiteHeat=pow(smoothstep(mix(.35,.38,morph),mix(.90,.95,morph),heat),3.0)*mix(.22,.12,morph);
                vec3 emitted=u_energy*(energyGain+u_pointer.z*heat*.28+u_audio*1.70)
                    +u_glow*heat*(.65+u_pointer.z*.28+u_audio*1.45)*mix(.65,.55,morph)
                    +u_particle*whiteHeat;
                // Restore intensity only in hot, narrow channels of the gas
                // already carried by advection. Warm substrate gains nothing;
                // neither its base gain nor the named v196 emitter is changed.
                float hotChannel=smoothstep(.10,.35,material.g)
                    *(1.0-smoothstep(.035,.16,abs(gas.b-.50)))*smoothstep(.34,.78,grains);
                emitted+=(u_energy*2.70+u_glow*.90)*hotChannel*(1.0-morph);
                float emission=1.0-exp(-heat*3.0*(marchDepth/40.0));
                // Emission is accumulated at its buried 3D sample. Only the
                // actual matter extinguishes it; the gas has no front surface.
                color+=(1.0-opacity)*(scattered*density+emitted*emission);
                opacity+=(1.0-opacity)*density;
                if(opacity>.985)break;
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
        uniform float u_materialWeight;
        in vec2 v_uv;out vec4 result;
        void main() {
            vec4 scene=texture(u_image,v_uv);
            vec3 light=scene.rgb+texture(u_bloom,v_uv).rgb*.38;
            // Map energy, not each RGB channel separately: bright red should
            // retain its hue instead of bleaching into peach/white highlights.
            float peak=max(light.r,max(light.g,light.b));
            vec3 color=light*((1.0-exp(-peak*1.35))/max(.0001,peak));
            // Thin named fibres need readable material coverage on light UI
            // backgrounds. This is output coverage, not gas extinction or a
            // brightness multiplier: internal emitted RGB remains unchanged.
            float coverage=1.0-pow(max(0.0,1.0-scene.a),mix(1.4,3.6,u_materialWeight));
            float alpha=max(coverage,max(color.r,max(color.g,color.b)));
            result=vec4(color,alpha);
        }
    `;
    const number=(v,lo,hi,fallback)=>Number.isFinite(v)?Math.max(lo,Math.min(hi,v)):fallback;
    const color=(v,fallback)=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v)?v:fallback;
    const rgb=v=>v.match(/[0-9a-f]{2}/gi).map(c=>parseInt(c,16)/255);
    const SHAPES=Object.freeze({organic:0,pentagram:1,eye:2,hand:3,sword:4,octagram:5});
    const CATALOG_IDS=new Map();
    const knownShape=name=>Object.hasOwn(SHAPES,name)||!!window.GunterCoreForms?.get?.(name);
    const shapeId=name=>{
        if(Object.hasOwn(SHAPES,name))return SHAPES[name];
        if(!CATALOG_IDS.has(name))CATALOG_IDS.set(name,6+CATALOG_IDS.size);
        return CATALOG_IDS.get(name);
    };
    const transportConfig=value=>{
        if(!value||!Number.isFinite(value.progress)||!Array.isArray(value.from)||!Array.isArray(value.to)
            ||value.from.length!==2||value.to.length!==2||![...value.from,...value.to].every(Number.isFinite))return null;
        return {progress:number(value.progress,0,1,0),from:value.from.map(v=>number(v,-2,2,0)),
            to:value.to.map(v=>number(v,-2,2,0)),fromScale:number(value.fromScale,.01,8,1),
            toScale:number(value.toScale,.01,8,1),bend:number(value.bend,-.35,.35,.16),
            startStrength:number(value.startStrength,0,1,0)};
    };
    class GunterIdleCore {
        // Pure inverse of TRANSPORT at the cursor's centre plane. The owner
        // supplies NDC for the actual output canvas, not its CSS container.
        // Keeping this beside the shader prevents a second travel model in
        // the input adapter, especially while the core crosses a wide canvas.
        static unprojectPointer(x,y,width,height,transport) {
            if(![x,y,width,height].every(Number.isFinite)||width<=0||height<=0)return {x:0,y:0};
            const side=Math.min(width,height),ax=side/width,ay=side/height;
            const route=transportConfig(transport);
            if(!route)return {x:x/ax,y:y/ay};
            const p=route.progress,envelope=Math.sin(p*Math.PI)**2;
            const lane=.66*Math.sin(.7)+.34*Math.sin(-1.1);
            const phase=number(p+envelope*lane*.19,0,1,0),t=phase*phase*(3-2*phase);
            const fx=route.from[0]/ax,fy=route.from[1]/ay;
            const dx=(route.to[0]-route.from[0])/ax,dy=(route.to[1]-route.from[1])/ay;
            const distance=Math.hypot(dx,dy),scale=route.fromScale+(route.toScale-route.fromScale)*t;
            let cx=fx+dx*t,cy=fy+dy*t;
            if(distance>=.0001) {
                const orbit=Math.sin(-p*4.4)*.080+Math.sin(p*3.0)*.035;
                const lift=4*distance*route.bend*t*(1-t)+distance*envelope*orbit;
                cx-=dy/distance*lift;cy+=dx/distance*lift;
            }
            const px=(x/ax-cx)/scale,py=(y/ay-cy)/scale;
            const angle=distance<.0001?0:-Math.sin(p*Math.PI)*Math.sin(-p*3.6)*.78;
            return {x:Math.cos(angle)*px-Math.sin(angle)*py,y:Math.sin(angle)*px+Math.cos(angle)*py};
        }
        constructor() {
            this.canvas=document.createElement('canvas');
            this.available=false;this.error='';this.frames=0;this.steps=0;this.fieldBuilds=0;this.bioSteps=0;this.resources=[];
            this.pointerRevision=0;this.resetPointer();
            this.audioRevision=0;this.setAudioLevel(0,false);
            this.shapeState={from:0,to:0,start:0};this.shapeName='organic';
            this.guideFrom={name:'organic',id:0,weight:0,data:null};this.guideTo=this.guideFrom;
            this.guideTextures={};this.pathTextures={};this.guideRevision=0;this.snapshotActive=false;this.shapeSnapshot=null;
            this.currentFlow=[1,0,0];this.historyFlow=[1,0,0];this.flowTime=-1;this.staticPresentation=false;
            this.canvas.addEventListener('webglcontextlost',event=>{
                event.preventDefault();this.available=false;this.error='Se perdió el contexto WebGL2.';
                this.announce();
            });
            this.canvas.addEventListener('webglcontextrestored',()=>{
                if(this.disposed)return;
                this.resources=[];this.targets=null;this.histories=null;this.bioHistories=null;this.velocityField=null;this.field=null;this.fieldTime=null;this.fieldDensity=null;
                this.guideTextures={};this.pathTextures={};this.shapeSnapshot=null;this.snapshotActive=false;
                this.simulationTime=null;this.displayTime=null;
                this.flowTime=-1;
                this.historyFlow=[...this.currentFlow];this.fieldShapeKey=null;this.fieldFlowKey=null;
                this.resetPointer();
                this.setAudioLevel(0,false);
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
                    simulation:this.program(QUAD,SIM),bio:this.program(QUAD,BIO_SIM),velocity:this.program(QUAD,VELOCITY_CACHE),field:this.program(QUAD,FIELD_CACHE),strands:this.program(STRAND_VERTEX,STRAND_FRAGMENT),
                    volume:this.program(QUAD,VOLUME),membrane:this.program(MEMBRANE_VERTEX,MEMBRANE_FRAGMENT),copy:this.program(QUAD,COPY),
                    extract:this.program(QUAD,EXTRACT),blur:this.program(QUAD,BLUR),composite:this.program(QUAD,COMPOSITE)
                };
                this.histories=[];this.histories.push(this.target(HISTORY,SIM_HEADS,true));
                this.histories.push(this.target(HISTORY,SIM_HEADS,true));
                this.bioHistories=[];this.bioHistories.push(this.target(384,288));this.bioHistories.push(this.target(384,288));
                this.bioIndex=0;this.bioReady=false;
                this.field=this.target(384,288);this.fieldTime=null;this.fieldDensity=null;
                this.velocityField=this.target(384,288);
                this.uploadGuide('from',this.guideFrom.data);this.uploadGuide('to',this.guideTo.data);
                this.uploadPaths('from',this.guideFrom.paths);this.uploadPaths('to',this.guideTo.paths);
                this.historyIndex=0;this.simulationTime=null;this.displayTime=null;
                this.historyFlow=[...this.currentFlow];this.fieldShapeKey=null;this.fieldFlowKey=null;
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
        setAudioLevel(rms,available=true) {
            if(this.disposed)return;
            available=available===true&&Number.isFinite(rms);
            const level=available?Math.max(0,Math.min(1,rms)):0;
            if(this.audio?.level!==level||this.audio?.available!==available){
                this.audio={level,available};this.audioRevision++;
            }
        }
        setPointer(x,y,active=true) {
            if(this.disposed)return;
            active=active===true&&Number.isFinite(x)&&Number.isFinite(y);
            x=active?x:0;y=active?y:0;
            const scale=Math.max(1,Math.abs(x),Math.abs(y));x/=scale;y/=scale;
            const radius=Math.hypot(x,y);
            if(scale>1||radius>1){x/=radius;y/=radius;}
            this.pointerTarget={x,y,active:active?1:0};
        }
        resetPointer() {
            const p=this.pointer,target=this.pointerTarget;
            const changed=!!(p&&(p.x||p.y||p.activity||p.vx||p.vy)||target&&(target.x||target.y||target.active));
            this.pointer={x:0,y:0,activity:0,vx:0,vy:0};this.pointerTarget={x:0,y:0,active:0};
            if(changed)this.pointerRevision++;
            return changed;
        }
        advancePointer() {
            const p=this.pointer,target=this.pointerTarget,omega=8,decay=Math.exp(-omega*STEP);
            const before=[p.x,p.y,p.activity,p.vx,p.vy];
            for(const [axis,velocity] of [['x','vx'],['y','vy']]) {
                const d=p[axis]-target[axis],c=p[velocity]+omega*d;
                p[axis]=target[axis]+(d+c*STEP)*decay;
                p[velocity]=(p[velocity]-omega*c*STEP)*decay;
                if(Math.abs(p[axis]-target[axis])<.0001&&Math.abs(p[velocity])<.0001){p[axis]=target[axis];p[velocity]=0;}
            }
            p.activity+=(target.active-p.activity)*(1-Math.exp(-7*STEP));
            if(Math.abs(p.activity-target.active)<.0001)p.activity=target.active;
            if(before.some((v,i)=>v!==[p.x,p.y,p.activity,p.vx,p.vy][i]))this.pointerRevision++;
        }
        interactionUniforms(program) {
            const p=this.pointer;
            this.vector(program,'u_pointer',[p.x,p.y,p.activity]);
            this.vector(program,'u_pointerFlow',[p.vx*.24,p.vy*.24,0]);
            this.scalar(program,'u_audio',this.audio.available?1-Math.exp(-this.audio.level*5):0);
            this.scalar(program,'u_visualSize',this.visualSize||1);
        }
        selectShape(name,time,still) {
            const target=shapeId(name),state=this.shapeState;
            if(name!==this.shapeName) {
                const progress=this.shapeCoefficients(time)[2];
                if(window.GunterCoreForms?.guide) {
                    // Freeze the currently blended attractor, not the nearest
                    // old endpoint. Existing particle history is never reset.
                    this.guideFrom=this.blendedGuide(progress);
                    this.guideTo=this.catalogGuide(name);
                    this.captureShapeSnapshot(progress,still);
                    this.uploadGuide('from',this.guideFrom.data);this.uploadGuide('to',this.guideTo.data);
                    this.uploadPaths('from',this.guideFrom.paths);this.uploadPaths('to',this.guideTo.paths);
                    this.shapeState={from:this.guideFrom.id,to:target,start:time};this.guideRevision++;
                } else {
                    // Minimal six-form fallback for an older/offline document.
                    this.shapeState={from:progress<.5?state.from:state.to,to:target,start:time};
                    this.guideFrom={id:this.shapeState.from,weight:this.shapeState.from>.5?1:0,data:null};
                    this.guideTo={id:target,weight:target>.5?1:0,data:null};
                }
            }
            if(still) {
                this.shapeState={from:target,to:target,start:time};this.snapshotActive=false;
                if(this.guideFrom!==this.guideTo){
                    this.guideFrom=this.guideTo;this.uploadGuide('from',this.guideFrom.data);this.guideRevision++;
                    this.uploadPaths('from',this.guideFrom.paths);
                }
            }
            this.shapeName=name;this.staticPresentation=still;
        }
        catalogGuide(name) {
            const data=name==='organic'?null:window.GunterCoreForms?.guide?.(name,128);
            if(name!=='organic'&&(!data||data.length!==128*128*4))throw new Error('Guía de forma no disponible: '+name);
            const paths=name==='organic'?null:window.GunterCoreForms?.trajectories?.(name,128);
            return {name,id:shapeId(name),weight:name==='organic'?0:1,data,paths};
        }
        blendedGuide(progress) {
            const a=this.guideFrom,b=this.guideTo;
            if(progress>=1)return b;if(progress<=0)return a;
            const wa=a.weight*(1-progress),wb=b.weight*progress,weight=wa+wb;
            if(weight<.00001)return {name:'organic',id:0,weight:0,data:null};
            if(!wa)return {...b,weight};if(!wb)return {...a,weight};
            const data=new Float32Array(128*128*4),mix=wb/weight;
            for(let i=0;i<data.length;i++)data[i]=a.data[i]+(b.data[i]-a.data[i])*mix;
            // History carries the exact in-flight matter; the dominant source
            // path only guides its subsequent velocity, without a reseed or
            // instantaneous projection when a command interrupts a morph.
            return {name:'blended',id:-1,weight,data,paths:mix<.5?a.paths:b.paths};
        }
        uploadGuide(side,data) {
            if(!data||!this.gl)return;
            const gl=this.gl,texture=this.guideTextures[side]||(this.guideTextures[side]=gl.createTexture());
            gl.bindTexture(gl.TEXTURE_2D,texture);
            // Half-float guide storage supports mobile WebGL2 linear sampling
            // without requesting the optional full-float filter extension.
            for(const name of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,name,gl.LINEAR);
            for(const name of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,name,gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,128,128,0,gl.RGBA,gl.FLOAT,data);
        }
        uploadPaths(side,paths) {
            if(!paths||!this.gl)return;
            if(paths.width!==128||!Number.isInteger(paths.height)||paths.height<1||paths.height>128
                ||paths.data.length!==128*paths.height*4||paths.strokes.length!==paths.height)
                throw new Error('Trayectoria de forma no válida.');
            const gl=this.gl,slots=this.pathTextures[side]||(this.pathTextures[side]={});
            const rows=new Float32Array(SIM_HEADS*4);
            for(let i=0;i<SIM_HEADS;i++) {
                const fraction=((i+.5)*.61803398875)%1;
                let lo=0,hi=paths.strokes.length-1;
                while(lo<hi){const middle=(lo+hi)>>1;if(fraction<=paths.strokes[middle].cdf)hi=middle;else lo=middle+1;}
                rows[i*4]=lo;rows[i*4+1]=paths.strokes[lo].closed?1:0;
            }
            for(const [key,data,width,height,filter] of [['paths',paths.data,128,paths.height,gl.LINEAR],['rows',rows,SIM_HEADS,1,gl.NEAREST]]) {
                const texture=slots[key]||(slots[key]=gl.createTexture());
                gl.bindTexture(gl.TEXTURE_2D,texture);
                for(const name of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,name,filter);
                for(const name of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,name,gl.CLAMP_TO_EDGE);
                gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA16F,width,height,0,gl.RGBA,gl.FLOAT,data);
            }
        }
        captureShapeSnapshot(progress,still) {
            this.snapshotActive=false;
            if(still||progress>=1||this.fieldTime===null)return;
            // One reusable GPU snapshot prevents the volume from snapping when
            // a voice command interrupts an unfinished morph. No CPU readback.
            this.shapeSnapshot ||= this.target(384,288);
            const gl=this.gl,p=this.programs.copy;gl.disable(gl.BLEND);this.use(p);
            this.texture(p,'u_image',this.field.texture);this.quad(this.shapeSnapshot);this.snapshotActive=true;
        }
        shapeCoefficients(time) {
            const state=this.shapeState,p=state.from===state.to?1:number((time-state.start)/1.65,0,1,1);
            return [state.from,state.to,p*p*(3-2*p)];
        }
        materialUniforms(program,time) {
            this.vector(program,'u_shape',this.shapeCoefficients(time));
            this.vector(program,'u_guideMode',[this.guideFrom.data?1:0,this.guideTo.data?1:0,0]);
            this.vector(program,'u_guideWeights',[this.guideFrom.weight,this.guideTo.weight,0]);
            const fallback=this.histories[this.historyIndex].texture;
            this.texture(program,'u_shapeGuideFrom',this.guideFrom.data?this.guideTextures.from:fallback,3);
            this.texture(program,'u_shapeGuideTo',this.guideTo.data?this.guideTextures.to:fallback,4);
            this.vector(program,'u_pathMode',[this.guideFrom.paths?.height||0,this.guideTo.paths?.height||0,0]);
            this.texture(program,'u_pathsFrom',this.guideFrom.paths?this.pathTextures.from.paths:fallback,7);
            this.texture(program,'u_pathsTo',this.guideTo.paths?this.pathTextures.to.paths:fallback,8);
            this.texture(program,'u_rowsFrom',this.guideFrom.paths?this.pathTextures.from.rows:fallback,9);
            this.texture(program,'u_rowsTo',this.guideTo.paths?this.pathTextures.to.rows:fallback,10);
            this.vector(program,'u_flow',this.currentFlow);
            this.vector(program,'u_previousFlow',this.historyFlow);
            this.scalar(program,'u_static',this.staticPresentation?1:0);
            this.texture(program,'u_bio',this.bioHistories[this.bioIndex].texture,6);
            this.scalar(program,'u_bioReady',this.bioReady?1:0);
            // The cache builder never binds its own destination as a sampler,
            // even on drivers that retain inactive uniforms during validation.
            this.texture(program,'u_velocity',program===this.programs.velocity?fallback:this.velocityField.texture,11);
        }
        selectFlow(transport,width,height,time) {
            // Same-phase/older avatars present the same material: they must
            // not clear its active roll simply because they have no journey.
            if(time<this.flowTime||!transport&&time===this.flowTime)return;
            this.flowTime=time;
            if(!transport){this.currentFlow=[1,0,0];return;}
            const min=Math.min(width,height),dx=(transport.to[0]-transport.from[0])*width/min,
                dy=(transport.to[1]-transport.from[1])*height/min,distance=Math.hypot(dx,dy);
            // A canonical axis avoids reversing the vortex instantly on the
            // return trip. sin² starts and ends with zero deformation speed.
            const sign=dx<0||dx===0&&dy<0?-1:1;
            const progress=transport.progress;
            const pulse=progress===1?0:Math.min(1,Math.sin(progress*Math.PI)**2
                +transport.startStrength*(1-progress)**2);
            this.currentFlow=distance>.0001?[dx/distance*sign,dy/distance*sign,pulse]:[1,0,0];
        }
        transportUniforms(program,transport) {
            this.vector(program,'u_transport',transport?[1,transport.progress,transport.bend]:[0,0,0]);
            this.vector(program,'u_transportFrom',transport?[...transport.from,transport.fromScale]:[0,0,1]);
            this.vector(program,'u_transportTo',transport?[...transport.to,transport.toScale]:[0,0,1]);
        }
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
                this.targets.energy=this.target(Math.max(1,Math.round(width*.75)),Math.max(1,Math.round(height*.75)));
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
            if(!initialize)this.advancePointer();
            const velocity=this.programs.velocity;
            this.use(velocity);this.scalar(velocity,'u_time',time);
            this.interactionUniforms(velocity);this.materialUniforms(velocity,time);
            gl.disable(gl.BLEND);this.quad(this.velocityField);
            this.use(p);this.scalar(p,'u_time',time);this.scalar(p,'u_dt',STEP);
            this.interactionUniforms(p);
            this.materialUniforms(p,time);
            gl.uniform1i(this.uniform(p,'u_initialize'),initialize?1:0);
            this.texture(p,'u_history',this.histories[this.historyIndex].texture);
            gl.disable(gl.BLEND);this.quad(this.histories[next]);
            this.historyIndex=next;this.steps++;
            this.historyFlow=[...this.currentFlow];
            const bio=this.programs.bio,bioNext=1-this.bioIndex;
            this.use(bio);this.scalar(bio,'u_time',time);this.scalar(bio,'u_dt',STEP);
            this.interactionUniforms(bio);this.materialUniforms(bio,time);
            gl.uniform1i(this.uniform(bio,'u_initialize'),initialize?1:0);
            this.quad(this.bioHistories[bioNext]);this.bioIndex=bioNext;this.bioReady=true;this.bioSteps++;
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
            const density=Math.sqrt(config.density),audio=this.audio.available?1-Math.exp(-this.audio.level*5):0;
            const size=config.size*(1+audio*.04);
            const shapeKey=this.shapeCoefficients(t).join(',')+':'+this.guideRevision,flowKey=this.currentFlow.join(',');
            if(this.fieldTime!==t||this.fieldDensity!==density||this.fieldPointerRevision!==this.pointerRevision||this.fieldAudioRevision!==this.audioRevision
                ||this.fieldShapeKey!==shapeKey||this.fieldFlowKey!==flowKey) {
                const field=this.programs.field;gl.disable(gl.BLEND);this.use(field);
                this.interactionUniforms(field);
                this.materialUniforms(field,t);
                const snapshotWeight=this.snapshotActive?1-this.shapeCoefficients(t)[2]:0;
                this.scalar(field,'u_snapshotWeight',snapshotWeight);
                this.texture(field,'u_shapeSnapshot',this.shapeSnapshot?.texture||this.histories[this.historyIndex].texture,5);
                this.scalar(field,'u_time',t);this.scalar(field,'u_density',density);this.quad(this.field);
                this.fieldTime=t;this.fieldDensity=density;this.fieldPointerRevision=this.pointerRevision;
                this.fieldAudioRevision=this.audioRevision;this.fieldBuilds++;
                this.fieldShapeKey=shapeKey;this.fieldFlowKey=flowKey;
            }
            gl.disable(gl.BLEND);this.use(volume);
            this.interactionUniforms(volume);
            this.materialUniforms(volume,t);
            this.transportUniforms(volume,config.transport);
            this.texture(volume,'u_field',this.field.texture);
            gl.uniform2f(this.uniform(volume,'u_resolution'),this.width,this.height);
            this.scalar(volume,'u_time',t);this.scalar(volume,'u_size',size);this.scalar(volume,'u_brightness',config.brightness);
            this.scalar(volume,'u_density',density);this.vector(volume,'u_particle',rgb(config.particleColor));
            this.scalar(volume,'u_debugView',config.debugView==='energy'?1:config.debugView==='matter'?2:config.debugView==='filaments'?3:0);
            this.vector(volume,'u_energy',rgb(config.energyColor));this.vector(volume,'u_glow',rgb(config.glowColor));
            this.vector(volume,'u_shadow',rgb(config.shadowColor));
            this.quad(this.targets.energy);
            const copy=this.programs.copy;this.use(copy);this.texture(copy,'u_image',this.targets.energy.texture);
            this.quad(this.targets.scene);
            if(config.debugView==='composite'||config.debugView==='matter') {
                const membrane=this.programs.membrane;this.use(membrane);
                this.materialUniforms(membrane,t);this.interactionUniforms(membrane);
                this.transportUniforms(membrane,config.transport);
                this.texture(membrane,'u_field',this.field.texture);
                gl.uniform2f(this.uniform(membrane,'u_resolution'),this.width,this.height);
                this.scalar(membrane,'u_time',t);this.scalar(membrane,'u_size',size);
                this.scalar(membrane,'u_brightness',config.brightness);this.scalar(membrane,'u_density',density);
                this.scalar(membrane,'u_debugView',config.debugView==='matter'?2:0);
                this.vector(membrane,'u_particle',rgb(config.particleColor));this.vector(membrane,'u_energy',rgb(config.energyColor));
                this.vector(membrane,'u_glow',rgb(config.glowColor));this.vector(membrane,'u_shadow',rgb(config.shadowColor));
                gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
                gl.drawArrays(gl.TRIANGLES,0,96*64*6);gl.disable(gl.BLEND);
            }
            const extract=this.programs.extract;this.use(extract);this.texture(extract,'u_image',this.targets.scene.texture);this.quad(this.targets.a);
            const blur=this.programs.blur;this.use(blur);this.texture(blur,'u_image',this.targets.a.texture);
            gl.uniform2f(this.uniform(blur,'u_step'),1.7/this.targets.a.width,0);this.quad(this.targets.b);
            this.texture(blur,'u_image',this.targets.b.texture);gl.uniform2f(this.uniform(blur,'u_step'),0,1.7/this.targets.a.height);this.quad(this.targets.a);
            const composite=this.programs.composite;this.use(composite);
            const morph=this.shapeCoefficients(t)[2];
            this.scalar(composite,'u_materialWeight',this.guideFrom.weight+(this.guideTo.weight-this.guideFrom.weight)*morph);
            this.texture(composite,'u_image',this.targets.scene.texture);this.texture(composite,'u_bloom',this.targets.a.texture,1);this.quad(null);
            // The single filament draw is last, above energy, membrane and
            // their bloom. No subsequent glow pass can blur or hide its grain.
            const strands=this.programs.strands;this.use(strands);
            this.interactionUniforms(strands);
            this.materialUniforms(strands,t);
            this.transportUniforms(strands,config.transport);
            this.texture(strands,'u_history',this.histories[this.historyIndex].texture);
            this.texture(strands,'u_field',this.field.texture,2);
            gl.uniform2f(this.uniform(strands,'u_resolution'),this.width,this.height);
            this.scalar(strands,'u_time',t);this.scalar(strands,'u_size',size);this.scalar(strands,'u_brightness',config.brightness);
            this.vector(strands,'u_particle',rgb(config.particleColor));this.vector(strands,'u_energy',rgb(config.energyColor));
            this.vector(strands,'u_glow',rgb(config.glowColor));
            this.vector(strands,'u_shadow',rgb(config.shadowColor));
            this.activeFilaments=Math.min(MAX_FILAMENTS,Math.round(BASE_FILAMENTS*config.density));
            gl.enable(gl.BLEND);gl.blendFuncSeparate(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA,gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
            this.destination(null);
            if(config.debugView==='composite'||config.debugView==='filaments')
                // Four strip vertices describe the same two-triangle ribbon;
                // +50% fibres now reuse the prior total vertex count.
                gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,this.activeFilaments*(HISTORY-1));
            gl.disable(gl.BLEND);
            this.frames++;
        }
        renderTo(canvas,width,height,seconds=0,config={}) {
            if(!this.available||this.disposed)throw new Error(this.error||'El núcleo GPU no está disponible.');
            config={
                particleColor:color(config?.particleColor,'#b8bec9'),
                energyColor:color(config?.energyColor,color(config?.color,'#ff452b')),
                glowColor:color(config?.glowColor,'#ff6d35'),
                shadowColor:color(config?.shadowColor,'#071423'),
                shape:knownShape(config?.shape)?config.shape:'organic',
                debugView:['energy','matter','filaments'].includes(config?.debugView)?config.debugView:'composite',
                static:config?.static===true||config?.speed===0,
                brightness:number(config?.brightness,.2,2.5,1),density:number(config?.density,.25,2,1),
                speed:number(config?.speed,0,2,1),size:number(config?.size,.7,1.3,1),
                transport:transportConfig(config?.transport)
            };
            width=Math.round(number(width,1,720,512));height=Math.round(number(height,1,720,512));
            const phase=number(seconds,0,1e8,0)*config.speed;
            this.visualSize=config.size*(1+(this.audio.available?1-Math.exp(-this.audio.level*5):0)*.04);
            this.selectShape(config.shape,Math.max(this.displayTime||0,phase),config.static);
            this.selectFlow(config.transport,width,height,phase);
            this.resize(width,height);this.advance(phase);this.draw(config);
            if(canvas.width!==width)canvas.width=width;if(canvas.height!==height)canvas.height=height;
            const output=canvas.getContext('2d');if(!output)throw new Error('No se pudo presentar el núcleo.');
            output.clearRect(0,0,width,height);output.drawImage(this.canvas,0,0,width,height);
        }
        stats() {
            return {renderer:'webgl-filaments',simulation:'gpu-advected-material-filaments',available:this.available,frames:this.frames,
                steps:this.steps,filaments:this.activeFilaments||0,segmentsPerFilament:HISTORY-1,
                time:this.simulationTime,width:this.width,height:this.height,error:this.error,
                volumeGrid:48,volumeSamples:40,fieldBuilds:this.fieldBuilds,bioSteps:this.bioSteps,
                energySimulation:'gpu-semilagrangian-48cubed',interaction:{...this.pointer},audio:{...this.audio},
                velocityCache:'shared-48cubed-per-step',
                shape:this.shapeName,morph:this.shapeCoefficients(this.displayTime||0)[2],flow:[...this.currentFlow],
                transportFlow:'depth-delayed-smoke-packets'};
        }
        release() {
            if(!this.gl)return;
            this.deleteTargets(this.targets);this.targets=null;this.deleteTargets(this.histories);this.histories=null;
            this.deleteTargets(this.bioHistories);this.bioHistories=null;this.bioReady=false;
            this.deleteTargets(this.velocityField?[this.velocityField]:null);this.velocityField=null;
            this.deleteTargets(this.field?[this.field]:null);this.field=null;this.fieldTime=null;this.fieldDensity=null;
            this.deleteTargets(this.shapeSnapshot?[this.shapeSnapshot]:null);this.shapeSnapshot=null;this.snapshotActive=false;
            Object.values(this.guideTextures||{}).forEach(texture=>this.gl.deleteTexture(texture));this.guideTextures={};
            Object.values(this.pathTextures||{}).forEach(slots=>Object.values(slots).forEach(texture=>this.gl.deleteTexture(texture)));this.pathTextures={};
            this.resources.forEach(program=>this.gl.deleteProgram(program));this.resources=[];
        }
        dispose() {
            if(this.disposed)return;
            this.setAudioLevel(0,false);
            this.disposed=true;this.available=false;this.release();this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
            this.canvas.width=this.canvas.height=1;
        }
    }
    window.GunterIdleCore=GunterIdleCore;
})();
