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
check('loading twice preserves the same catalog; no DOM, network or new storage', () => {
    vm.runInNewContext(source, { window }); assert.equal(window.GunterCoreForms, forms);
    assert.ok(!/fetch\(|localStorage|indexedDB|document\.|setInterval|requestAnimationFrame/.test(source));
});
console.log(`${checks} core-form catalog checks passed (${forms.list().length} silhouettes).`);
