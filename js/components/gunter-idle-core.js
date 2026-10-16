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
    const BASE_FILAMENTS=2560, MAX_FILAMENTS=5120, SIM_HEADS=1280, HISTORY=96, STEP=1/45;
    const HEADER='#version 300 es\nprecision highp float;\nprecision highp int;\n';
    const FIELD=`
        uniform float u_time;
        uniform float u_audio;
        uniform vec3 u_pointer,u_pointerFlow,u_shape,u_flow,u_previousFlow;
        uniform sampler2D u_shapeGuideFrom,u_shapeGuideTo;
        uniform vec3 u_guideMode,u_guideWeights;
        uniform float u_static;
        vec3 worldPoint(vec3 p);
        vec3 viewPoint(vec3 p);
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
        vec4 materialGuide(vec2 p,bool target) {
            float shape=target?u_shape.y:u_shape.x;
            float mode=target?u_guideMode.y:u_guideMode.x;
            if(mode<.5)return shapeGuide(shape,p);
            // Guides contain nearest material coordinates, not a visible image.
            // Texel centres preserve the catalog's [-1,1], y-up coordinate map.
            vec2 uv=(clamp(p,-1.0,1.0)*.5+.5)*(127.0/128.0)+vec2(.5/128.0);
            vec4 guide=target?texture(u_shapeGuideTo,uv):texture(u_shapeGuideFrom,uv);
            // Preserve sampled distance across Voronoi boundaries: averaging
            // two nearest points must not invent a luminous bridge between
            // separated fingers, wings or orbital strokes.
            guide.z=max(guide.z,length(p-guide.xy));
            return guide;
        }
        vec3 guidedPoint(vec3 p,float row,bool target,float t) {
            vec3 q=viewPoint(p);vec4 guide=materialGuide(q.xy,target);
            vec2 normal=normalize(q.xy-guide.xy+vec2(.0001,.0002));
            float grain=fract(row*.6180339)*2.0-1.0;
            q.xy=guide.xy+normal*guide.w*grain;
            q.z=clamp(q.z,-.19,.19)*.64;
            q+=vec3(sin(q.y*23.0+t*.41+row),cos(q.x*19.0-t*.37+row),sin(row+t*.2))*.014;
            return worldPoint(q);
        }
        vec3 morphGuide(vec3 p,float row,float t) {
            vec3 a=u_guideWeights.x<.0001?p:mix(p,guidedPoint(p,row,false,t),u_guideWeights.x);
            vec3 b=u_guideWeights.y<.0001?p:mix(p,guidedPoint(p,row,true,t),u_guideWeights.y);
            return mix(a,b,u_shape.z);
        }
        float morphWeight() {return mix(u_guideWeights.x,u_guideWeights.y,u_shape.z);}
        float shapedDensity(vec3 p,bool target,float t) {
            vec3 q=viewPoint(p);q.xy+=vec2(sin(q.y*23.0+t*.27),cos(q.x*21.0-t*.31))*.012;
            vec4 guide=materialGuide(q.xy,target);
            float channel=1.0-smoothstep(guide.w*.55,guide.w*2.15,guide.z);
            float depth=1.0-smoothstep(.075,.28,abs(q.z));
            float fold=.48+.52*sin(q.x*31.0+q.y*27.0+q.z*22.0+t*.28);
            return channel*depth*(.35+fold*1.20);
        }
        float shapedHeat(vec3 p,bool target,float t) {
            vec3 q=viewPoint(p);vec4 guide=materialGuide(q.xy,target);
            float channel=exp(-pow(guide.z/max(.018,guide.w*.54),2.0));
            return channel*exp(-q.z*q.z/.006)*(.56+.24*sin(q.y*6.0+q.x*4.0-t*.75));
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
        vec3 energyFrame(vec3 p,float t) {
            vec3 q=p-energyCenter(t);
            float a=.62+.24*sin(t*.17),c=cos(a),s=sin(a);
            q.xy=mat2(c,-s,s,c)*q.xy;
            return q;
        }
        vec3 energyWorld(vec3 q,float t) {
            float a=.62+.24*sin(t*.17),c=cos(a),s=sin(a);
            q.xy=mat2(c,s,-s,c)*q.xy;
            return q+energyCenter(t);
        }
        vec3 energyCurve(float along,float t) {
            // Deform one connected current. Audio changes its material flow,
            // never spawns separate emitters or starts a synthetic pulse clock.
            return vec3(along,(.15*sin(along*5.0-t*.45)+.06*sin(along*9.0+t*.18))*(1.0+u_audio*.18),
                .10*sin(along*4.5+t*.23)*(1.0+u_audio*.12));
        }
        vec3 energySource(vec3 p,float t) {
            vec3 original=energyWorld(energyCurve(clamp(energyFrame(p,t).x,-.27,.27),t),t);
            vec2 q=viewPoint(p).xy;
            vec3 a=u_guideWeights.x<.0001?original:mix(original,worldPoint(vec3(materialGuide(q,false).xy,0)),u_guideWeights.x);
            vec3 b=u_guideWeights.y<.0001?original:mix(original,worldPoint(vec3(materialGuide(q,true).xy,0)),u_guideWeights.y);
            return mix(a,b,u_shape.z);
        }
        // A single thick, bent support carries a travelling pulse. Its floor
        // never switches off into isolated spots; the same current drives matter.
        float energyHeat(vec3 p,float t) {
            vec3 q=energyFrame(p,t);
            float along=clamp(q.x,-.27,.27);
            vec3 d=q-energyCurve(along,t);
            d.y+=.035*sin(q.z*8.3+t*.31);
            d.z+=.030*sin(q.y*7.1-t*.27);
            float radius=(.145+.018*sin(along*6.8-t*.48))*(1.0+u_audio*.06);
            float radial=length(d*vec3(1.0,1.05,1.12))/radius;
            // A finite support leaves a material coat on every side of the
            // current, including at the limits of inertial pointer/audio input.
            float support=exp(-pow(radial,2.2))*(1.0-smoothstep(.9,1.45,radial));
            float pulse=.67+.33*sin(along*5.4-t*.82);
            float original=support*pulse*(1.0+u_audio*.12);
            float a=u_guideWeights.x<.0001?original:mix(original,shapedHeat(p,false,t),u_guideWeights.x);
            float b=u_guideWeights.y<.0001?original:mix(original,shapedHeat(p,true,t),u_guideWeights.y);
            return mix(a,b,u_shape.z);
        }
        vec3 energyTransport(vec3 p,float t) {
            float along=clamp(energyFrame(p,t).x,-.27,.27);
            vec3 tangent=normalize(vec3(1.0,(.75*cos(along*5.0-t*.45)+.54*cos(along*9.0+t*.18))*(1.0+u_audio*.18),
                .45*cos(along*4.5+t*.23)*(1.0+u_audio*.12)));
            vec3 direction=energyWorld(tangent,t)-energyCenter(t);
            vec3 offset=p-energySource(p,t);
            vec3 drift=vec3(.0336*cos(t*.24),-.0324*sin(t*.27+1.3),.0171*cos(t*.19));
            drift+=worldPoint(u_pointerFlow)*.45;
            return energyHeat(p,t)*(drift+direction*(.12+u_audio*.05)+cross(direction,offset)*.18);
        }
        float matterDensity(vec3 p,float t) {
            vec3 unused;
            vec3 q=p-idleCenter(t)*.25;
            vec3 warp=potential(q*1.85+vec3(t*.045,2.1-t*.035,-1.3+t*.025),unused);
            q+=warp*.18;
            vec3 coarse=potential(q*3.1+vec3(1.7+t*.04,-2.3-t*.03,t*.035),unused);
            float radius=length(q*vec3(.96,1.03,1.10))+coarse.x*.12;
            float envelope=1.0-smoothstep(.60,.81,radius);
            // Anchor the envelope; only nearby folds bend with internal energy.
            vec3 offset=p-energyCenter(t);
            q-=worldPoint(vec3(u_pointer.xy*.24,0))*exp(-dot(offset,offset)/.18)*.22;
            q+=coarse*u_audio*.035*exp(-dot(offset,offset)/.18);
            float folds=.5+.5*sin(q.y*11.8+q.z*5.3+coarse.x*4.5+coarse.z*2.8+t*.14);
            // Finite folded coats with sparse matter between them, rather than
            // a uniformly filled sphere. The warped envelope leaves cavities.
            float packing=(.40+.60*smoothstep(-.25,.60,coarse.y))
                *(.025+1.75*pow(smoothstep(.40,.84,folds),2.0));
            vec2 hole=q.xy-vec2(-.20,.13);
            hole.x+=.06*sin(q.z*6.0+t*.11);
            float cavity=1.0-.66*exp(-dot(hole/vec2(.13,.19),hole/vec2(.13,.19)));
            float fine=potential(q*7.8+vec3(-3.1+t*.08,4.2-t*.055,t*.065),unused).x*.5+.5;
            float original=envelope*packing*cavity*(.15+fine*fine*1.50);
            float a=u_guideWeights.x<.0001?original:mix(original,shapedDensity(p,false,t),u_guideWeights.x);
            float b=u_guideWeights.y<.0001?original:mix(original,shapedDensity(p,true,t),u_guideWeights.y);
            return mix(a,b,u_shape.z);
        }
        vec3 velocity(vec3 p,float t,float row,float boundary) {
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
            float outside=max(0.0,length(p*vec3(.94,1.02,1.13))-.87);
            v-=p*outside*3.2*boundary;
            float morph=morphWeight();
            // An attraction field bends existing material trajectories into
            // each silhouette. Tangential/curl flow remains alive inside it.
            v*=1.0-morph*.74;
            v+=(morphGuide(p,row,t)-p)*3.4*morph;
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
            float lane=.66*sin(depth*4.3+.7)+.34*sin(depth*8.1-1.1);
            return smoothstep(0.0,1.0,clamp(p+envelope*lane*.19,0.0,1.0));
        }
        vec2 packetCenter(float depth,vec2 from,vec2 delta,vec2 normal) {
            float p=u_transport.y,t=packetProgress(depth);
            float envelope=pow(sin(p*3.14159265),2.0);
            float orbit=sin(depth*11.1-p*4.4)*.080+sin(depth*17.3+p*3.0)*.035;
            return riverCurve(t,from,delta,normal,u_transport.z)
                +normal*length(delta)*envelope*orbit;
        }
        float packetTurn(float depth) {
            return sin(u_transport.y*3.14159265)*sin(depth*5.1-u_transport.y*3.6)*.78;
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
            float density=matterDensity(p,u_time),heat=energyHeat(p,u_time);
            // The gas occupies cavities inside the folded matter. Test a
            // short depth neighbourhood only inside its finite support, so
            // sparse material does not turn into an exposed luminous coating.
            if(heat>.0001) {
                vec3 depth=worldPoint(vec3(0,0,.18));
                float cover=density+matterDensity(p+depth,u_time)+matterDensity(p-depth,u_time);
                heat*=smoothstep(.025,.18,cover);
            }
            vec3 source=energySource(p,u_time),delta=source-p;
            float distance=length(delta);
            vec3 direction=delta/max(.001,distance);
            vec3 gradient=vec3(density-matterDensity(p+vec3(.055,0,0),u_time),
                density-matterDensity(p+vec3(0,.055,0),u_time),
                density-matterDensity(p+vec3(0,0,.055),u_time));
            vec3 normal=gradient/max(.0001,length(gradient));
            float surface=smoothstep(.025,.22,length(gradient));
            float facing=mix(.15,.20+.65*abs(dot(normal,direction))
                +.15*max(0.0,dot(normal,worldPoint(vec3(0,0,1)))),surface);
            float obstruction=density*.5+matterDensity(mix(p,source,.35),u_time)
                +matterDensity(mix(p,source,.70),u_time);
            // Three-tap single-scattering approximation towards the connected
            // emitter, cached once per phase; no uniform ambient light source.
            float light=energyHeat(source,u_time)*exp(-obstruction*distance*1.25*u_density)
                /(1.0+distance*distance*8.0);
            result=vec4(density,heat,light,facing);
            if(u_snapshotWeight>.0001)result=mix(result,
                texture(u_shapeSnapshot,gl_FragCoord.xy/vec2(384,288)),u_snapshotWeight);
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
                p=flowWind(p,u_flow);
            } else {
                p=texelFetch(u_history,cell,0).xyz;
                // Carry existing material through compact rolls, then advect
                // small curls and counter-currents with their own filament
                // phase. This sheds local wisps, not a uniform rubber stretch.
                vec3 rest=flowUnwind(p,u_previousFlow);
                vec3 v=velocity(rest,u_time,row,1.0);
                vec3 curl,fine;
                potential(rest*3.7+vec3(u_time*.27,-u_time*.21,row*.013),curl);
                potential(rest*10.1+vec3(-u_time*.31,row*.017,u_time*.23),fine);
                float pocket=.45+.55*sin(row*.57+rest.y*7.0+u_time*.63);
                vec3 slip=worldPoint(vec3(u_flow.xy,0))*sin(row*.37+rest.z*6.0-u_time*.41)*.095;
                vec3 eddies=(curl*(.16+pocket*.12)+fine*.105+slip)*u_flow.z;
                v+=eddies;
                rest+=(velocity(rest+v*u_dt*.5,u_time+u_dt*.5,row,1.0)+eddies)*u_dt;
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
    const STRAND_VERTEX=HEADER+FIELD+TRANSPORT+`
        uniform sampler2D u_history;
        uniform vec2 u_resolution;
        uniform float u_size;
        out vec3 v_world;
        out float v_cross,v_age,v_depth;
        flat out float v_seed;
        vec2 projected(vec3 p) {
            vec2 aspect=min(u_resolution.x,u_resolution.y)/u_resolution;
            vec3 view=viewPoint(p);
            return transported(view.xy*u_size*.80,aspect,view.z);
        }
        vec3 presentationPoint(vec3 p,float row) {
            p=flowUnwind(p,u_previousFlow);
            if(u_static>.5&&morphWeight()>.001)p=morphGuide(p,row,u_time);
            return flowWind(p,u_flow);
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
            p=presentationPoint(p,float(row));before=presentationPoint(before,float(row));after=presentationPoint(after,float(row));
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
    const STRAND_FRAGMENT=HEADER+FIELD+MEDIUM+`
        uniform vec3 u_particle,u_energy,u_glow,u_shadow;
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
            vec4 material=mediumAt(v_world);
            float emission=material.g;
            float incident=clamp(emission*1.7+material.b*.65,0.0,1.0);
            vec3 source=flowWind(energySource(flowUnwind(v_world,u_flow),u_time),u_flow);
            float frontCover=smoothstep(.06,.23,viewPoint(v_world-source).z)
                *(1.0-smoothstep(.015,.20,emission));
            // Reuse the ray-marched column extinction, instead of tracing
            // procedural density again for every subpixel fibre fragment.
            float column=clamp(texture(u_volume,gl_FragCoord.xy/u_resolution).a/.72,0.0,.96);
            float depth=clamp((.90-viewPoint(v_world).z)/1.8,0.0,1.0);
            float transmission=pow(1.0-column,depth*2.0);
            transmission=mix(transmission,1.0,frontCover*.85);
            float matter=material.r;
            vec3 tint=mix(vec3(1),u_energy,smoothstep(.12,.65,emission+material.b*.45));
            vec3 color=u_shadow*(.20+v_depth*.28)*(1.0-incident)
                +u_particle*tint*material.b*(.55+material.a*2.0)*(1.0-emission*.65)
                +u_energy*incident*(1.1+u_audio*.70)
                +u_glow*emission*emission*(.35+u_pointer.z*.32+u_audio*1.45);
            // Front microfibres cover the buried emitter. Keep their shaded
            // material response instead of painting emission over their face.
            vec3 coat=u_shadow*(.32+v_depth*.20)+u_particle*tint*material.b*(.35+material.a*.90);
            color=mix(color,coat,frontCover*.88);
            // Broad erosion creates differently sized wisps; fine coverage
            // turns each wisp into porous, irregular microfibres, not a cable.
            float lengths=3.0+15.0*fract(v_seed*.56984);
            float fragments=smoothstep(.20,.58,materialNoise(v_age*lengths,v_seed+4.1));
            fragments=mix(fragments,.75,smoothstep(.35,.70,matter)*.55);
            float grain=.06+.94*smoothstep(.24,.78,materialNoise(v_age*167.0,v_seed*1.31));
            float packing=.45+matter*matter*5.50;
            float alpha=min(.90,edge*fade*(.20+v_depth*.10)*fragments*grain*packing
                *(1.0+frontCover*.75))*transmission;
            result=vec4(color*u_brightness,alpha);
        }
    `;
    const VOLUME=HEADER+FIELD+MEDIUM+TRANSPORT+`
        uniform vec2 u_resolution;
        uniform vec3 u_particle,u_energy,u_glow,u_shadow;
        uniform float u_size,u_brightness,u_density;
        in vec2 v_uv;
        out vec4 result;
        void main() {
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
                vec4 material=mediumAt(p);
                vec3 detail=flowUnwind(p,u_flow)-idleCenter(u_time)*.25;
                vec3 unused;
                float grains=potential(detail*83.0+vec3(u_time*.14,-u_time*.10,0),unused).x*.5+.5;
                float grain=.08+1.85*smoothstep(.35,.65,grains);
                float mass=max(0.0,material.r-.12);
                // Beer-Lambert extinction separates porous matter from the
                // emitting gas; front coats partially obscure deeper folds.
                float density=1.0-exp(-mass*mass*grain*18.0*(marchDepth/40.0)*u_density);
                float heat=material.g,incident=material.b;
                float face=material.a*material.a;
                vec3 tint=mix(vec3(1),u_energy,smoothstep(.12,.65,heat+incident*.45));
                vec3 scattered=u_shadow*(.34+face*.12)*(1.0-clamp(incident,0.0,1.0))
                    +u_particle*tint*incident*(.10+face*3.8)*(1.0-heat*.65)
                    +u_energy*incident*.10;
                // Voice changes the buried emitter, not a global screen flash.
                // A syllable lifts local radiance while pauses restore idle.
                vec3 emitted=u_energy*(2.4+u_pointer.z*heat*.28+u_audio*1.70)
                    +u_glow*heat*(.25+u_pointer.z*.28+u_audio*1.45);
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
        constructor() {
            this.canvas=document.createElement('canvas');
            this.available=false;this.error='';this.frames=0;this.steps=0;this.fieldBuilds=0;this.resources=[];
            this.pointerRevision=0;this.resetPointer();
            this.audioRevision=0;this.setAudioLevel(0,false);
            this.shapeState={from:0,to:0,start:0};this.shapeName='organic';
            this.guideFrom={name:'organic',id:0,weight:0,data:null};this.guideTo=this.guideFrom;
            this.guideTextures={};this.guideRevision=0;this.snapshotActive=false;this.shapeSnapshot=null;
            this.currentFlow=[1,0,0];this.historyFlow=[1,0,0];this.flowTime=-1;this.staticPresentation=false;
            this.canvas.addEventListener('webglcontextlost',event=>{
                event.preventDefault();this.available=false;this.error='Se perdió el contexto WebGL2.';
                this.announce();
            });
            this.canvas.addEventListener('webglcontextrestored',()=>{
                if(this.disposed)return;
                this.resources=[];this.targets=null;this.histories=null;this.field=null;this.fieldTime=null;this.fieldDensity=null;
                this.guideTextures={};this.shapeSnapshot=null;this.snapshotActive=false;
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
                    simulation:this.program(QUAD,SIM),field:this.program(QUAD,FIELD_CACHE),strands:this.program(STRAND_VERTEX,STRAND_FRAGMENT),
                    volume:this.program(QUAD,VOLUME),copy:this.program(QUAD,COPY),
                    extract:this.program(QUAD,EXTRACT),blur:this.program(QUAD,BLUR),composite:this.program(QUAD,COMPOSITE)
                };
                this.histories=[];this.histories.push(this.target(HISTORY,SIM_HEADS,true));
                this.histories.push(this.target(HISTORY,SIM_HEADS,true));
                this.field=this.target(384,288);this.fieldTime=null;this.fieldDensity=null;
                this.uploadGuide('from',this.guideFrom.data);this.uploadGuide('to',this.guideTo.data);
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
                }
            }
            this.shapeName=name;this.staticPresentation=still;
        }
        catalogGuide(name) {
            const data=name==='organic'?null:window.GunterCoreForms?.guide?.(name,128);
            if(name!=='organic'&&(!data||data.length!==128*128*4))throw new Error('Guía de forma no disponible: '+name);
            return {name,id:shapeId(name),weight:name==='organic'?0:1,data};
        }
        blendedGuide(progress) {
            const a=this.guideFrom,b=this.guideTo;
            if(progress>=1)return b;if(progress<=0)return a;
            const wa=a.weight*(1-progress),wb=b.weight*progress,weight=wa+wb;
            if(weight<.00001)return {name:'organic',id:0,weight:0,data:null};
            if(!wa)return {...b,weight};if(!wb)return {...a,weight};
            const data=new Float32Array(128*128*4),mix=wb/weight;
            for(let i=0;i<data.length;i++)data[i]=a.data[i]+(b.data[i]-a.data[i])*mix;
            return {name:'blended',id:-1,weight,data};
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
            this.vector(program,'u_flow',this.currentFlow);
            this.vector(program,'u_previousFlow',this.historyFlow);
            this.scalar(program,'u_static',this.staticPresentation?1:0);
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
            this.use(p);this.scalar(p,'u_time',time);this.scalar(p,'u_dt',STEP);
            this.interactionUniforms(p);
            this.materialUniforms(p,time);
            gl.uniform1i(this.uniform(p,'u_initialize'),initialize?1:0);
            this.texture(p,'u_history',this.histories[this.historyIndex].texture);
            gl.disable(gl.BLEND);this.quad(this.histories[next]);
            this.historyIndex=next;this.steps++;
            this.historyFlow=[...this.currentFlow];
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
            this.vector(volume,'u_energy',rgb(config.energyColor));this.vector(volume,'u_glow',rgb(config.glowColor));
            this.vector(volume,'u_shadow',rgb(config.shadowColor));
            this.quad(this.targets.energy);
            const copy=this.programs.copy;this.use(copy);this.texture(copy,'u_image',this.targets.energy.texture);
            this.quad(this.targets.scene);
            const strands=this.programs.strands;this.use(strands);
            this.interactionUniforms(strands);
            this.materialUniforms(strands,t);
            this.transportUniforms(strands,config.transport);
            this.texture(strands,'u_history',this.histories[this.historyIndex].texture);
            this.texture(strands,'u_volume',this.targets.energy.texture,1);
            this.texture(strands,'u_field',this.field.texture,2);
            gl.uniform2f(this.uniform(strands,'u_resolution'),this.width,this.height);
            this.scalar(strands,'u_time',t);this.scalar(strands,'u_size',size);this.scalar(strands,'u_brightness',config.brightness);
            this.vector(strands,'u_particle',rgb(config.particleColor));this.vector(strands,'u_energy',rgb(config.energyColor));
            this.vector(strands,'u_glow',rgb(config.glowColor));
            this.vector(strands,'u_shadow',rgb(config.shadowColor));
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
                shadowColor:color(config?.shadowColor,'#071423'),
                shape:knownShape(config?.shape)?config.shape:'organic',
                static:config?.static===true||config?.speed===0,
                brightness:number(config?.brightness,.2,2.5,1),density:number(config?.density,.25,2,1),
                speed:number(config?.speed,0,2,1),size:number(config?.size,.7,1.3,1),
                transport:transportConfig(config?.transport)
            };
            width=Math.round(number(width,1,720,512));height=Math.round(number(height,1,720,512));
            const phase=number(seconds,0,1e8,0)*config.speed;
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
                volumeGrid:48,volumeSamples:40,fieldBuilds:this.fieldBuilds,interaction:{...this.pointer},audio:{...this.audio},
                shape:this.shapeName,morph:this.shapeCoefficients(this.displayTime||0)[2],flow:[...this.currentFlow],
                transportFlow:'depth-delayed-smoke-packets'};
        }
        release() {
            if(!this.gl)return;
            this.deleteTargets(this.targets);this.targets=null;this.deleteTargets(this.histories);this.histories=null;
            this.deleteTargets(this.field?[this.field]:null);this.field=null;this.fieldTime=null;this.fieldDensity=null;
            this.deleteTargets(this.shapeSnapshot?[this.shapeSnapshot]:null);this.shapeSnapshot=null;this.snapshotActive=false;
            Object.values(this.guideTextures||{}).forEach(texture=>this.gl.deleteTexture(texture));this.guideTextures={};
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
