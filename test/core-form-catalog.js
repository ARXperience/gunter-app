'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/components/gunter-core-forms.js'), 'utf8');
const window = {};
vm.runInNewContext(source, { window, Float32Array, Map, Set, Math, Number, String, Object, Array, RangeError });
const forms = window.GunterCoreForms;
let checks = 0;
function check(description, fn) { fn(); console.log(`ok ${++checks} - ${description}`); }
check('all reference families are represented without duplicate IDs', () => {
    const list = forms.list();
    assert.ok(list.length >= 80, `${list.length} forms`);
    assert.equal(new Set(list.map(x => x.id)).size, list.length);
    const required = 'organic pentagram eye hand sword octagram crystal orbits portal diamond_ring drone energy_column hourglass feather capsule beacon shield armillary butterfly wolf owl serpent deer lion raven fox jellyfish whale dragon hummingbird ankh scarab lotus flail_and_crook horus_falcon cobra pyramids egyptian_sun djed was_sceptre papyrus maat_feather sun_dial winged_orb ziggurat cuneiform rosette winged_sun palm_tree solar_cross trident temple mesopotamian_sun knot horus_eye ra_eye wedjat_eye nautilus cosmic_flower flame_drop flame swirl tree phoenix dragon_head wolf_head deer_head crystal_cluster planet galaxy triskelion triquetra torus star_eye hexagram triangle diamond crescent yin_yang triple_moon'.split(' ');
    required.forEach(id => assert.ok(forms.get(id), id));
});
check('every procedural silhouette is finite, bounded, nonempty and distinct', () => {
    const signatures = new Set();
    forms.list().forEach(({ id, label, description, aliases }) => {
        assert.ok(label && description && aliases.length, id);
        const item = forms.get(id);
        if (id === 'organic') return assert.equal(item.strokes.length, 0);
        assert.ok(item.strokes.length > 0, id);
        item.strokes.forEach(s => {
            assert.ok(Number.isFinite(s.width) && s.width > .005 && s.width < .2, id);
            assert.ok(s.points.length >= 2, id);
            s.points.forEach(p => { assert.equal(p.length, 2); p.forEach(n => assert.ok(Number.isFinite(n) && Math.abs(n) <= .821, `${id}: ${n}`)); });
        });
        const signature = JSON.stringify(item.strokes);
        assert.ok(!signatures.has(signature), `${id} duplicates another silhouette`); signatures.add(signature);
    });
});
check('Spanish accents and exact aliases resolve without taking over command grammar', () => {
    assert.equal(forms.resolve('BÚHO'), 'owl');
    assert.equal(forms.resolve('ojo de Horus'), 'horus_eye');
    assert.equal(forms.resolve('ojo de Ra'), 'ra_eye');
    assert.equal(forms.resolve('cabeza de lobo'), 'wolf_head');
    assert.equal(forms.resolve('estrella de ocho puntas'), 'octagram');
    assert.equal(forms.resolve('estrella invertida'), 'pentagram');
    assert.equal(forms.resolve('forma original'), 'organic');
    assert.equal(forms.resolve('muestra un ojo y borra mis tareas'), null);
    assert.equal(forms.resolve('ojo de Horus durante cinco segundos'), null);
    assert.equal(forms.resolve('configura el modo desconocido'), null);
    assert.equal(forms.resolve('despejado'), null);
});
check('all labels and aliases resolve to their own stable ID', () => {
    forms.list().forEach(item => [item.label, ...item.aliases].forEach(alias => assert.equal(forms.resolve(alias), item.id, `${item.id}: ${alias}`)));
});
check('catalog metadata cannot mutate the renderer source of truth', () => {
    const list = forms.list(); list[0].label = 'changed'; list[0].aliases.push('extra');
    assert.notEqual(forms.get('organic').label, 'changed');
    assert.ok(!forms.get('organic').aliases.includes('extra'));
    assert.ok(Object.isFrozen(forms.get('sword')));
    assert.ok(Object.isFrozen(forms.get('sword').strokes[0].points[0]));
    assert.equal(forms.get('__proto__'), null);
    assert.equal(forms.get('missing'), null);
});
check('guide is a finite nearest-material field with positive widths', () => {
    const data = forms.guide('sword', 32);
    assert.ok(data instanceof Float32Array); assert.equal(data.length, 32 * 32 * 4);
    for (let i = 0; i < data.length; i += 4) {
        assert.ok(Math.abs(data[i]) <= .821 && Math.abs(data[i + 1]) <= .821);
        assert.ok(Number.isFinite(data[i + 2]) && data[i + 2] >= 0 && data[i + 2] < 3);
        assert.ok(data[i + 3] > 0 && data[i + 3] < .2);
    }
});
check('texture rows run from negative to positive Y, without flipping silhouettes', () => {
    const data = forms.guide('sword', 32), center = 16;
    assert.ok(data[(0 * 32 + center) * 4 + 1] < 0);
    assert.ok(data[(31 * 32 + center) * 4 + 1] > 0);
});
check('cached fields are isolated from caller writes and deterministic after eviction', () => {
    const original = forms.guide('eye', 16), sample = original.slice();
    original.fill(99);
    assert.deepEqual(forms.guide('eye', 16), sample);
    ['sword', 'lotus', 'whale', 'cobra', 'butterfly'].forEach(id => forms.guide(id, 16));
    assert.deepEqual(forms.guide('eye', 16), sample);
});
check('organic and unknown forms have no imposed guide; resolution is bounded', () => {
    assert.equal(forms.guide('organic'), null); assert.equal(forms.guide('missing'), null);
    [0, 15, 257, 32.5, NaN, Infinity].forEach(size => assert.throws(() => forms.guide('eye', size), RangeError));
});
check('trajectory rows preserve stroke identity and a bounded length CDF for every form', () => {
    forms.list().filter(f=>f.id!=='organic').forEach(({id})=>{
        const entry=forms.get(id),field=forms.trajectories(id,32);
        assert.equal(field.width,32,id);assert.equal(field.height,entry.strokes.length,id);
        assert.equal(field.data.length,32*field.height*4,id);
        assert.equal(field.strokes.at(-1).cdf,1,id);
        let previous=0;
        field.strokes.forEach((metadata,row)=>{
            assert.ok(metadata.length>0 && metadata.cdf>previous && metadata.cdf<=1,id);
            previous=metadata.cdf;assert.equal(metadata.width,entry.strokes[row].width,id);
            for(let col=0;col<32;col++){
                const at=(row*32+col)*4;
                assert.ok(Math.abs(field.data[at])<=.821 && Math.abs(field.data[at+1])<=.821,id);
                assert.ok(field.data[at+2]>0 && field.data[at+2]<=metadata.width+1e-7,id);
                assert.equal(field.data[at+3],metadata.closed?1:0,id);
                if(col){
                    const step=Math.hypot(field.data[at]-field.data[at-4],field.data[at+1]-field.data[at-3]);
                    assert.ok(step<=metadata.length/31+1e-6,`${id} row ${row}: no jumps between authored strokes`);
                }
            }
        });
    });
});
check('open trajectories include both endpoints and do not connect fingers or tentacles', () => {
    ['hand','jellyfish','dragon','wolf','eye'].forEach(id=>{
        const entry=forms.get(id),field=forms.trajectories(id,128);
        field.strokes.forEach((metadata,row)=>{
            const stroke=entry.strokes[row],first=stroke.points[0],last=stroke.points.at(-1);
            const a=row*128*4,b=(row*128+127)*4;
            assert.ok(Math.abs(field.data[a]-first[0])<1e-7 && Math.abs(field.data[a+1]-first[1])<1e-7,id);
            assert.ok(Math.abs(field.data[b]-last[0])<1e-7 && Math.abs(field.data[b+1]-last[1])<1e-7,id);
            assert.equal(metadata.closed,Math.hypot(first[0]-last[0],first[1]-last[1])<1e-6,id);
        });
    });
    const tentacles=forms.trajectories('jellyfish');
    assert.ok(tentacles.strokes.slice(2,9).every(s=>!s.closed),'seven separate tentacles stay open');
});
check('closed rows have matching seams while open rows taper without wrapping', () => {
    const star=forms.trajectories('pentagram',64);
    star.strokes.forEach((s,row)=>{
        assert.equal(s.closed,true);
        const a=row*64*4,b=(row*64+63)*4;
        [0,1,2,3].forEach(channel=>assert.ok(Math.abs(star.data[a+channel]-star.data[b+channel])<1e-6));
        assert.ok(star.data[a+2]>star.data[(row*64+32)*4+2],'closed width varies continuously');
    });
    const sword=forms.trajectories('sword',65),row=1;
    assert.equal(sword.strokes[row].closed,false);
    assert.ok(sword.data[(row*65)*4+2]<sword.data[(row*65+32)*4+2],'open width tapers at endpoint');
});
check('trajectories sample by arc length, not by the uneven number of contour vertices', () => {
    const samples=65,field=forms.trajectories('sword',samples),stroke=forms.get('sword').strokes[1];
    const [first,last]=stroke.points;
    for(let col=0;col<samples;col++){
        const at=(samples+col)*4,t=col/(samples-1);
        assert.ok(Math.abs(field.data[at]-(first[0]+(last[0]-first[0])*t))<1e-7);
        assert.ok(Math.abs(field.data[at+1]-(first[1]+(last[1]-first[1])*t))<1e-7);
    }
    // The hand has closely spaced fingertip vertices and long wrist segments;
    // all samples still lie on one original segment in order of walked length.
    const hand=forms.get('hand').strokes[0],trail=forms.trajectories('hand',128);
    const lengths=hand.points.slice(1).map((p,i)=>Math.hypot(p[0]-hand.points[i][0],p[1]-hand.points[i][1]));
    let segment=0,start=0;
    for(let col=0;col<128;col++){
        const distance=trail.strokes[0].length*col/127;
        while(segment<lengths.length-1 && distance>start+lengths[segment])start+=lengths[segment++];
        const t=(distance-start)/lengths[segment],a=hand.points[segment],b=hand.points[segment+1];
        assert.ok(Math.hypot(trail.data[col*4]-(a[0]+(b[0]-a[0])*t),trail.data[col*4+1]-(a[1]+(b[1]-a[1])*t))<1e-6);
    }
});
check('trajectory snapshots and cache eviction cannot corrupt guides or authored strokes', () => {
    const original=forms.trajectories('hand',32),sample=original.data.slice(),length=original.strokes[0].length;
    original.data.fill(99);original.strokes[0].length=99;original.strokes.push({length:99});
    assert.deepEqual(forms.trajectories('hand',32).data,sample);
    assert.equal(forms.trajectories('hand',32).strokes[0].length,length);
    ['eye','dragon','wolf','lotus','sword'].forEach(id=>{forms.trajectories(id,32);forms.guide(id,16);});
    assert.deepEqual(forms.trajectories('hand',32).data,sample);
    assert.equal(forms.trajectories('organic'),null);assert.equal(forms.trajectories('missing'),null);
    [0,15,257,32.5,NaN,Infinity].forEach(samples=>assert.throws(()=>forms.trajectories('eye',samples),RangeError));
});
check('loading twice preserves the same catalog; no DOM, network or new storage', () => {
    vm.runInNewContext(source, { window }); assert.equal(window.GunterCoreForms, forms);
    assert.ok(!/fetch\(|localStorage|indexedDB|document\.|setInterval|requestAnimationFrame/.test(source));
});
console.log(`${checks} core-form catalog checks passed (${forms.list().length} silhouettes).`);
