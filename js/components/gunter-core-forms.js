/* Procedural, local silhouette guides for Gunter's existing GPU material.
 * Coordinates are x/right, y/up in [-.84,.84]; guide texture row zero is y=-1.
 * These are deliberately basic silhouettes, not reproductions of the supplied art.
 * Only a requested guide is rasterised. Four CPU fields are retained, never all forms.
 */
(function () {
    'use strict';
    if (window.GunterCoreForms) return;
    const TAU = Math.PI * 2, entries = new Map(), cache = new Map();
    const normal = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase().replace(/[_-]/g, ' ').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const line = (points, width = .045) => ({ points: typeof points === 'string'
        ? points.trim().split(/\s+/).map(pair => pair.split(',').map(Number)) : points, width });
    const oval = (x, y, rx, ry = rx, width = .035, start = 0, end = TAU, steps = 40) => line(
        Array.from({ length: steps + 1 }, (_, i) => {
            const a = start + (end - start) * i / steps; return [x + Math.cos(a) * rx, y + Math.sin(a) * ry];
        }), width);
    const mirror = (stroke, axis = 'x') => line(stroke.points.map(([x, y]) => [axis === 'x' ? -x : x, axis === 'y' ? -y : y]), stroke.width);
    const pair = stroke => [stroke, mirror(stroke)];
    const path = (points, width = .045) => line(points, width);
    const spiral = (turns = 2.3, radius = .77, width = .045, phase = 0) => line(
        Array.from({ length: 100 }, (_, i) => {
            const t = i / 99, a = phase + t * TAU * turns, r = .025 + t * radius; return [r * Math.cos(a), r * Math.sin(a)];
        }), width);
    const star = (n, step, down = false, radius = .8, width = .045) => {
        const start = down ? -Math.PI / 2 : Math.PI / 2;
        return line(Array.from({ length: n + 1 }, (_, i) => {
            const a = start + (i * step % n) / n * TAU; return [Math.cos(a) * radius, Math.sin(a) * radius];
        }), width);
    };
    const rays = (n, inner, outer, width = .045, phase = 0) => Array.from({ length: n }, (_, i) => {
        const a = phase + i * TAU / n; return line([[Math.cos(a) * inner, Math.sin(a) * inner], [Math.cos(a) * outer, Math.sin(a) * outer]], width);
    });
    const petal = (angle, radius = .79, width = .045, slender = .18) => {
        const rotate = ([x, y]) => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
        return line([[.04, 0], [radius * .5, slender], [radius, 0], [radius * .5, -slender], [.04, 0]].map(rotate), width);
    };
    const flowers = (n, radius = .79, width = .045, phase = Math.PI / 2) => Array.from({ length: n }, (_, i) => petal(phase + i * TAU / n, radius, width));
    function add(id, label, aliases, description, strokes) {
        const extent = Math.max(.84, ...strokes.flatMap(s => s.points.flatMap(p => p.map(Math.abs))));
        const scale = .82 / extent;
        const frozen = strokes.map(s => Object.freeze({ width: s.width * scale,
            points: Object.freeze(s.points.map(p => Object.freeze([p[0] * scale, p[1] * scale]))) }));
        entries.set(id, Object.freeze({ id, label, aliases: Object.freeze([...aliases]), description, strokes: Object.freeze(frozen) }));
    }
    add('organic', 'Núcleo orgánico', ['organica', 'organico', 'nucleo', 'forma original', 'forma normal'], 'Materia y energía sin silueta impuesta.', []);
    add('pentagram', 'Estrella invertida', ['pentagrama', 'pentagrama invertido', 'estrella invertida', 'estrella de cinco puntas', 'cinco puntas'], 'Estrella de cinco puntas con una punta hacia abajo.', [star(5, 2, true), oval(0, 0, .8, .8, .025)]);
    const eye = [path('-.8,0 -.5,.28 0,.36 .5,.28 .8,0 .5,-.26 0,-.34 -.5,-.26 -.8,0'), oval(0, 0, .25, .29, .048), oval(0, 0, .08, .15, .04)];
    add('eye', 'Ojo', ['ojo', 'ojo abierto'], 'Párpados almendrados, iris y pupila.', eye);
    add('hand', 'Mano', ['mano', 'palma', 'mano abierta'], 'Palma abierta y cinco dedos diferenciados.', [path('-.32,-.78 -.4,-.36 -.7,-.02 -.74,.22 -.63,.3 -.41,.02 -.36,.04 -.4,.55 -.32,.63 -.24,.57 -.2,.17 -.17,.72 -.08,.8 .01,.72 .02,.17 .09,.62 .18,.69 .25,.61 .23,.08 .32,.46 .42,.49 .48,.4 .4,-.14 .3,-.45 .25,-.78', .065), path('-.31,-.18 -.1,-.3 .2,-.14', .035)]);
    add('sword', 'Espada', ['espada', 'espada de energia'], 'Hoja larga, punta, guarda y empuñadura.', [path('0,.85 -.13,.58 -.08,-.24 -.4,-.26 -.42,-.36 -.09,-.34 -.07,-.68 0,-.81 .07,-.68 .09,-.34 .42,-.36 .4,-.26 .08,-.24 .13,.58 0,.85', .045), path('0,.65 0,-.22', .026)]);
    add('octagram', 'Estrella de ocho puntas', ['octagrama', 'ocho puntas', 'estrella de ocho puntas'], 'Dos cuadrados entrelazados dentro de un círculo.', [star(8, 3, false), oval(0, 0, .8, .8, .025)]);
    // Technological / cosmic objects, one distinct contour per reference tile.
    add('crystal', 'Cristal', ['cristal', 'cristal de energia'], 'Cristal central facetado con dos agujas laterales.', [path('0,.87 -.27,.27 -.22,-.34 0,-.85 .22,-.34 .27,.27 0,.87'), path('0,.87 0,-.85'), path('-.27,.27 .22,-.34 -.22,-.34 .27,.27 -.27,.27', .025), path('-.24,-.32 -.44,.19 -.52,-.3 -.24,-.61 .24,-.61 .52,-.3 .44,.19 .24,-.32', .035)]);
    add('orbits', 'Átomo orbital', ['atomo', 'atomo orbital', 'orbitas', 'orbita atomica'], 'Esfera con tres órbitas y pequeños satélites.', [oval(0, 0, .34), oval(0, 0, .79, .25), oval(0, 0, .25, .79), oval(.66, .14, .06), oval(-.16, .73, .07), oval(-.59, -.24, .05)]);
    add('portal', 'Portal', ['portal', 'portal circular'], 'Anillo abierto con cuatro marcas cardinales.', [oval(0, 0, .6, .6, .07), oval(0, 0, .72, .72, .027), ...rays(4, .48, .86, .052)]);
    add('diamond_ring', 'Diamante orbital', ['diamante orbital', 'rombo orbital', 'diamante con anillo'], 'Doble punta vertical atravesada por un anillo.', [path('0,.84 -.29,.04 0,-.84 .29,.04 0,.84', .06), oval(0, .02, .79, .17, .04), path('0,.84 0,-.84', .025)]);
    add('drone', 'Dron', ['dron', 'drone', 'nave dron'], 'Cuerpo circular con dos alas cortas angulares.', [oval(0, 0, .36, .4, .065), oval(0, 0, .17), ...pair(path('-.4,.16 -.6,.51 -.79,.13 -.75,-.32 -.58,-.53 -.43,-.16', .065)), path('0,.8 0,.42 0,-.42 0,-.8', .04)]);
    add('energy_column', 'Columna de energía', ['columna de energia', 'reactor vertical'], 'Esfera sostenida entre dos discos y un eje vertical.', [oval(0, 0, .34, .34, .07), oval(0, .48, .43, .1, .045), oval(0, -.48, .43, .1, .045), path('0,-.84 0,.84', .035), ...pair(path('-.21,-.77 -.21,-.43 -.21,.42 -.21,.76', .035))]);
    add('hourglass', 'Reloj de arena', ['reloj de arena', 'reloj arena'], 'Dos cámaras cónicas unidas por un cuello estrecho.', [path('-.44,.68 -.33,.39 -.09,.07 -.06,0 -.09,-.1 -.34,-.43 -.44,-.69 .44,-.69 .34,-.43 .09,-.1 .06,0 .09,.07 .33,.39 .44,.68 -.44,.68', .045), oval(0, .72, .52, .1), oval(0, -.72, .52, .1), path('0,.42 0,-.35', .035)]);
    add('feather', 'Pluma', ['pluma', 'pluma diagonal'], 'Pluma inclinada con nervadura y barbas.', [path('-.6,-.8 -.35,-.31 -.18,.2 .25,.6 .76,.82 .59,.3 .2,-.15 -.35,-.31', .055), path('-.6,-.8 .61,.63', .032), ...Array.from({ length: 7 }, (_, i) => { const t = i / 7; return line([[-.31 + t * .8, -.24 + t * .84], [-.22 + t * .82, .03 + t * .75]], .022); })]);
    add('capsule', 'Cápsula', ['capsula', 'capsula de energia'], 'Cápsula vertical redondeada rodeada de una órbita.', [oval(0, .56, .32, .2, .05, 0, Math.PI), path('-.32,.56 -.32,-.56', .055), path('.32,.56 .32,-.56', .055), oval(0, -.56, .32, .2, .05, Math.PI, TAU), oval(0, 0, .57, .2, .03), path('0,-.53 0,.53', .04)]);
    add('beacon', 'Baliza', ['baliza', 'faro de energia', 'plataforma de energia'], 'Disco horizontal con haz vertical.', [oval(0, -.08, .79, .2, .06), oval(0, -.08, .52, .11), path('0,-.7 0,.83', .045), path('-.09,-.6 -.09,.57 .09,.57 .09,-.6', .027)]);
    add('shield', 'Escudo', ['escudo', 'escudo cosmico'], 'Escudo puntiagudo con centro circular.', [path('0,.85 -.47,.34 -.41,-.28 0,-.84 .41,-.28 .47,.34 0,.85', .07), oval(0, -.02, .24, .3, .05), path('0,.73 0,-.7', .03)]);
    add('armillary', 'Esfera armilar', ['esfera armilar', 'armilar', 'giroscopio'], 'Esfera central y órbitas inclinadas entre soportes.', [oval(0, 0, .37, .4, .07), oval(0, 0, .76, .2, .04), line(oval(0, 0, .72, .26).points.map(([x,y]) => [x * .72 - y * .7, x * .7 + y * .72]), .035), path('0,.85 0,.47 0,-.47 0,-.85', .045)]);
    // Creatures. Contours and anatomical landmarks remain distinct at thumbnail scale.
    const butterflyWing = path('-.04,.08 -.26,.55 -.62,.79 -.8,.49 -.69,.13 -.31,-.05 -.56,-.2 -.64,-.57 -.39,-.72 -.14,-.39 -.04,.08', .055);
    add('butterfly', 'Mariposa', ['mariposa'], 'Cuatro alas simétricas y antenas.', [...pair(butterflyWing), path('0,-.57 0,.36 -.13,.55 0,.36 .13,.55', .035), ...pair(path('-.08,.06 -.51,.39 -.72,.48', .025))]);
    const wolfBody = path('-.8,-.25 -.61,-.13 -.37,.07 -.2,.36 .07,.49 .21,.79 .34,.58 .48,.57 .6,.41 .42,.3 .26,.12 .25,-.3 .17,-.7 .05,-.73 .03,-.28 -.23,-.3 -.4,-.67 -.53,-.7 -.48,-.21 -.7,-.39 -.8,-.25', .065);
    add('wolf', 'Lobo', ['lobo', 'lobo aullando'], 'Lobo de perfil con hocico elevado y cola.', [wolfBody, path('-.39,.01 -.23,-.3 .04,-.31 .26,.12', .035)]);
    add('owl', 'Búho', ['buho', 'lechuza'], 'Ave frontal de ojos grandes y alas extendidas.', [oval(0, .1, .3, .47, .055), oval(-.14, .32, .13, .16, .04), oval(.14, .32, .13, .16, .04), path('-.1,.18 0,.03 .1,.18', .035), ...pair(path('-.25,.14 -.58,.47 -.82,.72 -.71,.11 -.48,-.18 -.26,-.23', .055)), path('-.11,-.38 -.16,-.65 0,-.51 .16,-.65 .11,-.38', .04)]);
    add('serpent', 'Serpiente', ['serpiente', 'culebra'], 'Cuerpo sinuoso en S y cabeza de perfil.', [path('-.37,-.79 .04,-.64 .4,-.37 .46,-.08 .3,.09 -.28,.25 -.39,.48 -.17,.71 .18,.76 .41,.56 .22,.43 .02,.56 -.15,.46 -.07,.33 .36,.16 .6,-.12 .47,-.48 .1,-.74 -.37,-.79', .055), path('.31,.52 .48,.49 .55,.56', .018)]);
    add('deer', 'Ciervo', ['ciervo', 'venado'], 'Ciervo de pie con cornamenta ramificada.', [path('-.67,-.04 -.42,.2 .03,.15 .25,.42 .25,.6 .44,.68 .57,.5 .39,.32 .32,-.15 .21,-.7 .13,-.7 .09,-.23 -.28,-.18 -.38,-.7 -.47,-.7 -.42,-.17 -.7,-.2', .055), path('.28,.59 .12,.79 .03,.72', .028), path('.4,.66 .55,.84 .63,.76', .028)]);
    add('lion', 'León', ['leon'], 'León sentado con melena redonda, hocico y patas.', [oval(-.09, .36, .37, .43, .075), path('-.22,.55 .02,.59 .16,.42 .06,.24 -.16,.22 -.26,.39 -.22,.55', .045), path('-.31,.02 -.41,-.36 -.62,-.65 -.02,-.66 .16,-.64 .14,-.12 .03,.03', .065), path('-.46,-.48 -.71,-.41 -.8,-.08 -.66,.05', .04), path('-.09,-.1 -.09,-.61', .035)]);
    const flyingWing = path('-.12,.02 -.4,.22 -.82,.73 -.78,.35 -.59,.06 -.36,-.16 -.15,-.13', .06);
    add('raven', 'Cuervo', ['cuervo', 'corvido'], 'Cuervo en vuelo con pico largo, alas y cola.', [...pair(flyingWing), path('-.13,.08 -.13,.28 .02,.38 .19,.29 .34,.16 .12,.16 .12,-.19 .26,-.57 0,-.42 -.28,-.58 -.12,-.15 -.13,.08', .05)]);
    add('fox', 'Zorro', ['zorro'], 'Zorro sentado de orejas agudas y cola grande.', [path('-.15,.38 -.21,.8 .03,.61 .31,.78 .31,.31 .15,.1 .28,-.32 .11,-.68 -.27,-.69 -.41,-.46 -.33,-.02 -.15,.38', .055), path('-.32,-.15 -.62,-.23 -.8,-.51 -.6,-.68 -.27,-.69', .08), path('-.12,.35 .06,.19 .24,.34', .035)]);
    add('jellyfish', 'Medusa', ['medusa'], 'Campana amplia y tentáculos sinuosos descendentes.', [oval(0, .27, .63, .42, .065, 0, Math.PI), path('-.63,.27 -.42,.14 -.2,.25 0,.13 .2,.25 .42,.14 .63,.27', .045), ...[-.42,-.2,0,.2,.42].map((x,i) => path([[x,.17],[x-.09,-.1],[x+.04,-.35],[x-.07,-.59],[x+.02,-.82+i*.03]], .026))]);
    add('whale', 'Ballena', ['ballena'], 'Ballena curva con aletas y cola elevada.', [path('-.64,.01 -.36,.31 .03,.4 .49,.35 .75,.12 .57,-.12 .17,-.17 -.03,-.35 -.14,-.16 -.42,-.12 -.58,-.31 -.78,-.19 -.64,.01', .065), path('-.64,.01 -.69,.3 -.86,.48 -.54,.43 -.4,.65 -.4,.31 -.64,.01', .045), path('.34,.3 .43,.28', .022)]);
    add('dragon', 'Dragón', ['dragon'], 'Dragón alado con cuello curvo y cola enrollada.', [path('0,-.28 -.33,-.56 -.27,-.76 .08,-.75 .3,-.55 .24,-.34 .03,-.14 .22,.15 .33,.39 .17,.65 .32,.79 .09,.71 -.1,.47 -.14,.19 -.02,-.04 0,-.28', .065), ...pair(path('-.08,.16 -.45,.63 -.83,.79 -.68,.29 -.43,-.03 -.08,.16', .055)), path('.17,.65 .43,.58 .28,.48', .035)]);
    add('hummingbird', 'Colibrí', ['colibri'], 'Pájaro pequeño con pico fino y alas ascendentes.', [path('-.28,-.18 -.03,.04 .15,.23 .36,.25 .73,.4 .38,.16 .3,-.04 .08,-.13 -.25,-.46 -.28,-.18', .045), path('0,.04 -.3,.64 -.65,.8 -.5,.32 -.19,-.04', .06), path('.07,.1 -.03,.57 .13,.72 .26,.4 .21,.21', .045)]);
    // Egyptian silhouettes.
    add('ankh', 'Ankh', ['ankh', 'cruz egipcia', 'cruz ansada'], 'Lazo superior, travesaño y eje vertical.', [oval(0, .45, .27, .34, .065), path('0,.11 0,-.81', .08), path('-.51,.05 .51,.05', .075)]);
    add('scarab', 'Escarabajo alado', ['escarabajo', 'escarabajo alado'], 'Escarabajo oval con patas, cuernos y alas.', [oval(0, -.05, .24, .4, .07), oval(0, .42, .18, .13), path('0,.34 0,-.45', .03), ...pair(path('-.22,.14 -.46,.34 -.79,.57 -.68,.05 -.42,-.17 -.22,-.15', .06)), ...pair(path('-.19,-.28 -.39,-.48 -.32,-.63', .03)), path('-.1,.5 -.2,.66 -.09,.73', .025), path('.1,.5 .2,.66 .09,.73', .025), oval(0, .8, .1)]);
    const lotusPetals = [path('0,-.53 -.17,-.05 0,.7 .17,-.05 0,-.53', .06), ...pair(path('0,-.53 -.38,-.19 -.58,.35 -.25,.22 0,-.53', .055)), ...pair(path('0,-.53 -.58,-.42 -.8,-.01 -.42,-.08 0,-.53', .05))];
    add('lotus', 'Loto', ['loto', 'flor de loto'], 'Flor de loto de siete pétalos escalonados.', lotusPetals);
    add('flail_and_crook', 'Cayado y flagelo', ['cayado y flagelo', 'flagelo y cayado', 'heka y nekhakha'], 'Dos bastones cruzados: gancho y flecos.', [path('-.6,-.8 .49,.57 .49,.73 .34,.8 .2,.74 .19,.59', .055), path('.65,-.78 -.41,.68 -.54,.79 -.65,.7 -.6,.53', .055), ...[-.68,-.55,-.42].map(x => path([[x,.54],[x-.04,.02],[x-.12,-.13]], .03))]);
    add('horus_falcon', 'Halcón de Horus', ['halcon de horus', 'halcon egipcio', 'horus alado'], 'Halcón frontal alado con disco solar.', [oval(0, .64, .15, .15, .045), ...pair(path('-.07,.27 -.36,.3 -.8,.6 -.71,.1 -.39,-.13 -.15,-.24', .06)), path('-.1,.26 -.1,-.22 -.24,-.64 .24,-.64 .1,-.22 .1,.3 .28,.29 .12,.46 -.04,.42 -.1,.26', .05)]);
    add('cobra', 'Cobra', ['cobra', 'cobra egipcia', 'uraeus'], 'Capucha extendida y cuerpo enrollado.', [path('-.1,-.42 -.16,.07 -.34,.36 -.28,.61 -.12,.79 .12,.79 .28,.61 .34,.36 .16,.07 .1,-.42', .06), oval(0, -.51, .62, .2, .06), oval(0, -.54, .34, .09, .035), path('-.11,.57 .11,.57', .022)]);
    add('pyramids', 'Pirámides', ['piramides', 'piramide egipcia', 'piramide'], 'Pirámide central y dos pirámides laterales.', [path('-.8,-.48 -.35,.17 .12,-.48 -.8,-.48', .055), path('-.5,-.48 0,.68 .54,-.48 -.5,-.48', .06), path('.31,-.48 .55,.14 .84,-.48 .31,-.48', .05), path('0,.68 .08,-.48', .03)]);
    add('egyptian_sun', 'Sol egipcio', ['sol egipcio', 'disco solar egipcio', 'aton'], 'Disco solar rodeado de rayos alargados.', [oval(0, 0, .29, .29, .07), ...rays(14, .35, .8, .035, Math.PI/2), ...Array.from({length:14},(_,i) => oval(Math.cos(i*TAU/14)*.8, Math.sin(i*TAU/14)*.8,.025,.025,.016))]);
    add('djed', 'Pilar Djed', ['djed', 'pilar djed'], 'Pilar de cuatro travesaños.', [path('-.17,-.8 -.17,.54 .17,.54 .17,-.8 -.17,-.8', .065), ...[.2,.37,.54,.71].map(y=>path([[-.4,y],[.4,y]],.065)), path('-.3,-.8 .3,-.8',.05)]);
    add('was_sceptre', 'Cetro Was', ['cetro was', 'was', 'cetro egipcio'], 'Bastón con cabeza animal y pie bifurcado.', [path('-.08,-.71 -.08,.55 -.3,.65 -.07,.8 .23,.73 .17,.6 -.08,.55', .06), path('-.08,-.71 -.23,-.83 -.08,-.71 .07,-.83', .045)]);
    add('papyrus', 'Papiro', ['papiro', 'ramo de papiro'], 'Tres tallos con flores en forma de abanico.', [path('0,-.8 0,.15 -.29,.54 0,.7 .29,.54 0,.15', .05), ...pair(path('-.08,-.78 -.25,-.01 -.58,.18 -.45,.39 -.18,.26 -.25,-.01', .05))]);
    add('maat_feather', 'Plumas de Maat', ['maat', 'plumas de maat', 'pluma de maat'], 'Dos plumas verticales sobre una base circular.', [...pair(path('-.13,-.35 -.43,.11 -.4,.71 -.23,.82 -.13,.49 -.13,-.35', .06)), ...pair(path('-.19,-.32 -.29,.63', .025)), oval(0,-.52,.21,.22,.05), path('-.35,-.76 .35,-.76',.035)]);
    // Mesopotamian / celestial emblems.
    add('sun_dial', 'Rueda solar', ['rueda solar', 'reloj solar', 'sol con orbitas'], 'Rueda de doce rayos y puntos orbitales.', [oval(0,0,.24,.24,.065), ...rays(12,.31,.68,.048), oval(0,0,.79,.79,.022), ...Array.from({length:6},(_,i)=>oval(Math.cos(i*TAU/6)*.79,Math.sin(i*TAU/6)*.79,.04,.04,.023))]);
    add('winged_orb', 'Orbe alado', ['orbe alado', 'esfera alada'], 'Orbe central, alas curvas y eje con remates.', [oval(0,0,.23,.23,.065), ...pair(path('-.23,.09 -.5,.24 -.79,.22 -.64,-.04 -.41,-.11 -.23,-.04',.065)), path('0,-.72 0,.72',.035), oval(0,.75,.07),oval(0,-.75,.07)]);
    add('ziggurat', 'Zigurat', ['zigurat', 'ziggurat', 'piramide escalonada'], 'Templo piramidal de cuatro niveles.', [path('-.8,-.65 -.8,-.45 -.6,-.45 -.6,-.14 -.4,-.14 -.4,.16 -.2,.16 -.2,.49 .2,.49 .2,.16 .4,.16 .4,-.14 .6,-.14 .6,-.45 .8,-.45 .8,-.65 -.8,-.65',.055), path('0,-.65 0,.73',.04)]);
    add('cuneiform', 'Glifo cuneiforme', ['cuneiforme', 'glifo cuneiforme', 'escritura cuneiforme'], 'Cuñas enlazadas por tres trazos verticales.', [path('-.65,.54 -.43,.24 -.2,.54 -.65,.54',.055),path('-.1,.54 .12,.24 .35,.54 -.1,.54',.055),path('.41,.54 .62,.24 .8,.54 .41,.54',.055),path('-.43,.24 -.43,-.7',.05),path('.12,.24 .12,-.7',.05),path('.62,.24 .62,-.7',.05),path('-.7,.07 .62,.07',.05)]);
    add('rosette', 'Roseta', ['roseta', 'roseta de ocho petalos'], 'Ocho pétalos en diamante alrededor de un centro.', [oval(0,0,.16,.16,.055),...flowers(8,.78,.045)]);
    add('winged_sun', 'Sol alado', ['sol alado', 'disco alado'], 'Disco solar sobre un creciente de alas ascendentes.', [oval(0,-.1,.24,.24,.07),...pair(path('-.24,-.04 -.53,.22 -.72,.65 -.77,.31 -.66,-.08 -.45,-.27 -.2,-.29',.07)),oval(0,.46,.07),oval(0,.64,.055),oval(0,.8,.04)]);
    add('palm_tree', 'Palmera', ['palmera', 'palma tropical'], 'Tronco central y hojas arqueadas.', [path('0,-.8 -.03,-.18 0,.4',.065),...pair(path('0,.4 -.24,.67 -.58,.61 -.81,.43 -.42,.48 0,.4',.045)),...pair(path('0,.36 -.36,.33 -.7,.02 -.78,-.22 -.4,.08 0,.36',.05)),...pair(path('0,.39 -.14,.77 -.29,.82 -.27,.57 0,.39',.045))]);
    add('solar_cross', 'Cruz solar', ['cruz solar', 'rueda de cuatro puntas'], 'Cuatro puntas largas rodeadas por una órbita.', [oval(0,0,.21,.21,.065),oval(0,0,.69,.69,.027),...flowers(4,.82,.055,0)]);
    add('trident', 'Tridente', ['tridente', 'tridente de energia'], 'Tres puntas y asta central sobre una base.', [path('0,-.8 0,.82',.065),path('-.57,.59 -.57,-.05 -.35,-.27 .35,-.27 .57,-.05 .57,.59',.055),path('-.7,.49 -.57,.72 -.44,.49',.045),path('-.13,.65 0,.84 .13,.65',.04)]);
    add('temple', 'Templo', ['templo', 'templo de tres pilares'], 'Plataforma escalonada y tres pilares rematados.', [path('-.75,-.67 -.75,-.48 -.56,-.48 -.56,-.27 .56,-.27 .56,-.48 .75,-.48 .75,-.67 -.75,-.67',.06),...[-.43,0,.43].map((x,i)=>path([[x,-.27],[x,.4+(i===1?.2:0)]],.065)),...[-.43,0,.43].map((x,i)=>oval(x,.48+(i===1?.2:0),.085,.11,.04))]);
    add('mesopotamian_sun', 'Estrella solar', ['estrella solar', 'sol mesopotamico', 'estrella mesopotamica'], 'Ocho rayos alternos, largos y cortos.', [oval(0,0,.18,.18,.065),...Array.from({length:8},(_,i)=>petal(i*TAU/8,i%2?.56:.82,.05,.085))]);
    add('knot', 'Nudo entrelazado', ['nudo', 'nudo entrelazado', 'nudo geometrico'], 'Cuatro rombos enlazados diagonalmente.', [path('0,.8 .8,0 0,-.8 -.8,0 0,.8',.05),path('-.47,.47 .47,.47 .47,-.47 -.47,-.47 -.47,.47',.05),path('0,.56 .56,0 0,-.56 -.56,0 0,.56',.035)]);
    // Three distinct reference-eye variants; the plain eye remains available.
    const horusTail=path('-.19,-.3 -.2,-.7 -.4,-.76 -.58,-.66 -.57,-.5 -.43,-.43 -.31,-.5 -.4,-.58',.04);
    add('horus_eye', 'Ojo de Horus', ['ojo de horus', 'horus', 'ojo egipcio'], 'Ojo con ceja extendida, lágrima y espiral lateral.', [...eye,path('-.81,.4 -.34,.53 .2,.47 .76,.27',.04),horusTail,path('.19,-.3 .34,-.71 .42,-.51',.045)]);
    add('ra_eye', 'Ojo de Ra', ['ojo de ra', 'ra'], 'Variante solar con ceja y lágrima vertical larga.', [...eye,path('-.75,.43 -.28,.53 .3,.48 .78,.35',.04),path('-.08,-.33 -.05,-.79 .1,-.59 .12,-.31',.045),path('-.7,-.1 -.49,-.38 -.27,-.41',.03)]);
    add('wedjat_eye', 'Ojo Udjat', ['ojo udjat', 'udjat', 'wedjat', 'ojo wedjat'], 'Ojo con espiral a la derecha y trazo descendente izquierdo.', [...eye,path('-.76,.41 -.24,.56 .33,.47 .72,.25',.04),mirror(horusTail),path('-.15,-.31 -.29,-.75 -.37,-.52',.045)]);
    add('nautilus', 'Nautilo', ['nautilo', 'nautilus', 'concha espiral'], 'Concha espiral con cámaras radiales.', [spiral(1.7,.74,.065,.8),...Array.from({length:12},(_,i)=>{const t=.35+i*.05,a=.8+t*TAU*1.7,r=.025+t*.74;return line([[r*Math.cos(a),r*Math.sin(a)],[(r+.17)*Math.cos(a+.22),(r+.17)*Math.sin(a+.22)]],.026);})]);
    add('cosmic_flower', 'Flor cósmica', ['flor cosmica', 'flor eterea', 'flor colgante'], 'Flor elevada con pétalos y raíces colgantes.', [...flowers(6,.62,.055),...[-.3,-.15,0,.15,.3].map((x,i)=>path([[x,-.12],[x*.6,-.36],[x-.08,-.58],[x*.65,-.82]],.024)),oval(0,0,.12,.15,.05)]);
    add('flame_drop', 'Gota de fuego', ['gota de fuego', 'gota luminosa', 'llama gota'], 'Gota puntiaguda con una esfera interior.', [path('0,.83 -.2,.36 -.42,-.05 -.44,-.4 -.23,-.68 .13,-.71 .4,-.46 .41,-.12 .16,.32 0,.83',.065),oval(0,-.35,.18,.19,.05)]);
    add('flame', 'Llama', ['llama', 'fuego'], 'Tres lenguas de fuego de alturas diferentes.', [path('-.23,-.74 -.58,-.48 -.55,-.13 -.36,.13 -.32,-.17 -.17,.11 -.07,.6 .11,.84 .1,.37 .31,.58 .42,.22 .3,-.13 .51,.1 .6,-.27 .49,-.59 .16,-.77 -.23,-.74',.06),path('-.13,-.55 -.23,-.32 0,.1 .17,-.27 .1,-.57',.04)]);
    add('swirl', 'Remolino', ['remolino', 'vortice', 'torbellino'], 'Corriente ascendente en S de tres vueltas.', [path('-.44,-.76 .1,-.71 .34,-.48 .11,-.26 -.3,-.18 -.46,.05 -.25,.31 .23,.32 .46,.52 .29,.77 -.12,.78',.085),path('-.32,-.69 .18,-.55 -.34,-.02 .3,.53',.025)]);
    add('tree', 'Árbol de la vida', ['arbol', 'arbol de la vida', 'arbol cosmico'], 'Tronco ramificado, copa abierta y raíces.', [path('0,-.71 -.06,-.2 .04,.22 0,.54',.075),...pair(path('0,-.69 -.33,-.81 -.51,-.8',.035)),...pair(path('-.03,-.15 -.35,.1 -.57,.5 -.72,.57',.045)),...pair(path('.02,.14 -.22,.47 -.23,.76 -.35,.8',.035)),...pair(path('-.31,.14 -.63,.24 -.78,.17',.03)),...pair(path('-.39,.29 -.4,.63 -.56,.72',.03)),...pair(path('0,.44 -.1,.72 0,.83',.035))]);
    add('phoenix', 'Fénix', ['fenix', 'ave fenix'], 'Ave renaciente con alas elevadas y cola llameante.', [...pair(path('-.09,.01 -.33,.33 -.53,.8 -.61,.48 -.79,.65 -.68,.22 -.48,-.1 -.14,-.16',.065)),path('-.12,.09 -.14,.36 .03,.49 .19,.38 .35,.34 .13,.24 .12,-.16 .3,-.5 .08,-.8 0,-.56 -.16,-.8 -.28,-.51 -.12,-.17 -.12,.09',.055)]);
    add('dragon_head', 'Cabeza de dragón', ['cabeza de dragon', 'rostro de dragon'], 'Cabeza de perfil con cuernos, mandíbula y hocico.', [path('-.52,-.72 -.7,-.21 -.67,.22 -.45,.58 -.49,.84 -.14,.61 .17,.67 .39,.46 .78,.26 .64,.09 .36,.04 .62,-.15 .33,-.24 .04,-.15 -.21,-.35 -.28,-.77',.07),path('-.4,.48 -.12,.3 .29,.32',.035),path('-.57,.33 -.81,.5 -.66,.11',.04)]);
    add('wolf_head', 'Cabeza de lobo', ['cabeza de lobo', 'rostro de lobo'], 'Orejas triangulares, hocico largo y cuello.', [path('-.48,-.79 -.6,-.23 -.64,.28 -.48,.82 -.2,.59 .17,.69 .31,.46 .68,.22 .8,.06 .59,-.07 .29,-.1 .08,-.33 -.1,-.75',.065),path('-.44,.29 -.12,.25 .24,.33',.03),path('.27,-.09 .1,-.3',.035)]);
    add('deer_head', 'Cabeza de ciervo', ['cabeza de ciervo', 'cabeza de venado', 'cornamenta'], 'Cabeza frontal con dos grandes astas ramificadas.', [path('-.18,.13 -.23,-.22 0,-.67 .23,-.22 .18,.13 0,.24 -.18,.13',.065),...pair(path('-.16,.11 -.41,.39 -.43,.77 -.56,.83',.04)),...pair(path('-.4,.39 -.66,.48 -.78,.7',.035)),...pair(path('-.43,.57 -.27,.7 -.2,.84',.03)),...pair(path('-.17,.06 -.49,.2 -.36,-.04 -.17,.06',.04))]);
    add('crystal_cluster', 'Grupo de cristales', ['grupo de cristales', 'cristales', 'racimo de cristales'], 'Cinco prismas de alturas diferentes.', [path('0,.85 -.17,.43 -.12,-.65 .12,-.65 .17,.43 0,.85',.05),...pair(path('-.13,-.65 -.41,.01 -.35,.45 -.16,.15 -.13,-.65',.05)),...pair(path('-.31,-.65 -.68,-.24 -.72,.06 -.46,-.06 -.31,-.65',.045)),path('0,.8 0,-.65',.023)]);
    add('planet', 'Planeta', ['planeta', 'saturno', 'planeta con anillo'], 'Planeta esférico con anillo diagonal.', [oval(0,0,.47,.47,.075),line(oval(0,0,.84,.17).points.map(([x,y])=>[x*.86-y*.5,x*.5+y*.86]),.045)]);
    add('galaxy', 'Galaxia', ['galaxia', 'galaxia espiral'], 'Tres brazos de una galaxia espiral.', [spiral(1.05,.77,.06),spiral(1.05,.77,.06,TAU/3),spiral(1.05,.77,.06,TAU*2/3),oval(0,0,.09,.09,.05)]);
    add('triskelion', 'Trisquel', ['trisquel', 'triskelion', 'triskel'], 'Tres espirales enlazadas desde un mismo centro.', Array.from({length:3},(_,i)=>line(spiral(1.2,.36,.055,i*TAU/3).points.map(([x,y])=>[x+Math.cos(i*TAU/3)*.32,y+Math.sin(i*TAU/3)*.32]),.055)));
    add('triquetra', 'Triqueta', ['triqueta', 'triquetra', 'nudo trinitario'], 'Tres lazos entrelazados en simetría triangular.', Array.from({length:3},(_,i)=>{const a=i*TAU/3;return line(oval(0,.2,.35,.58,.05).points.map(([x,y])=>[x*Math.cos(a)-y*Math.sin(a),x*Math.sin(a)+y*Math.cos(a)]),.05);}));
    add('torus', 'Toroide', ['toroide', 'toro', 'anillo de humo', 'aro de humo'], 'Anillo volumétrico con cavidad central.', [oval(0,0,.7,.61,.11),oval(0,0,.44,.35,.055),oval(0,.03,.58,.45,.045)]);
    add('star_eye', 'Ojo estelar', ['ojo estelar', 'ojo con estrella', 'estrella con ojo'], 'Ojo contenido en una estrella invertida.', [star(5,2,true,.82,.035),...eye.map(s=>line(s.points.map(([x,y])=>[x*.8,y*.8]),s.width*.9)),oval(0,0,.81,.81,.022)]);
    // Additional unique tiles of the earlier supplied glyph sheet.
    add('hexagram', 'Estrella de seis puntas', ['hexagrama', 'seis puntas', 'estrella de seis puntas'], 'Dos triángulos entrelazados.', [star(3,1,false),star(3,1,true)]);
    add('triangle', 'Triángulo', ['triangulo', 'triangulo de energia'], 'Triángulo hueco de lados luminosos.', [star(3,1,false,.82,.07)]);
    add('diamond', 'Rombo', ['rombo', 'diamante'], 'Rombo de cuatro puntas y centro abierto.', [path('0,.82 .65,0 0,-.82 -.65,0 0,.82',.075),path('0,.55 .41,0 0,-.55 -.41,0 0,.55',.035)]);
    add('crescent', 'Luna creciente', ['luna', 'luna creciente', 'creciente lunar'], 'Dos arcos curvos unidos en las puntas.', [oval(.08,0,.57,.78,.07,Math.PI*.3,Math.PI*1.7),oval(.4,0,.57,.65,.045,Math.PI*.41,Math.PI*1.59)]);
    add('yin_yang', 'Yin y yang', ['yin yang', 'yin y yang', 'taijitu'], 'Círculo dividido por un trazo en S y dos semillas.', [oval(0,0,.78,.78,.055),oval(0,.39,.39,.39,.05,-Math.PI/2,Math.PI/2),oval(0,-.39,.39,.39,.05,Math.PI/2,Math.PI*1.5),oval(0,.39,.085,.085,.035),oval(0,-.39,.085,.085,.035)]);
    add('triple_moon', 'Triple luna', ['triple luna', 'tres lunas'], 'Luna central y dos crecientes laterales.', [oval(0,0,.33,.4,.055),...pair(path('-.37,.42 -.66,.3 -.79,0 -.66,-.3 -.37,-.42 -.55,-.18 -.6,0 -.55,.18 -.37,.42',.045))]);
    const aliases = new Map();
    for (const entry of entries.values()) for (const alias of new Set([entry.id,entry.label,...entry.aliases].map(normal))) {
        aliases.set(alias, aliases.has(alias) && aliases.get(alias) !== entry.id ? null : entry.id);
    }
    function resolve(text) {
        const value=normal(text); if(!value || value.length>2000)return null;
        // Command grammar belongs to the existing intent router. Exact aliases
        // cannot accidentally turn a compound instruction into a visual action.
        return aliases.get(value)||null;
    }
    function guide(id,resolution=128) {
        const entry=entries.get(id);if(!entry || !entry.strokes.length)return null;
        const size=Number(resolution);if(!Number.isInteger(size)||size<16||size>256)throw new RangeError('Guide resolution must be an integer from 16 to 256.');
        const key=`${id}:${size}`;
        if(cache.has(key)){const found=cache.get(key);cache.delete(key);cache.set(key,found);return found.slice();}
        const segments=entry.strokes.flatMap(s=>s.points.slice(1).map((b,i)=>{
            const a=s.points[i],dx=b[0]-a[0],dy=b[1]-a[1];return {a,b,dx,dy,length:dx*dx+dy*dy,width:s.width};
        }));
        const data=new Float32Array(size*size*4);
        for(let row=0;row<size;row++)for(let col=0;col<size;col++){
            const x=(col+.5)/size*2-1,y=(row+.5)/size*2-1;
            let distance=Infinity,nx=0,ny=0,width=.035;
            for(const s of segments){
                const t=s.length?Math.max(0,Math.min(1,((x-s.a[0])*s.dx+(y-s.a[1])*s.dy)/s.length)):0;
                const px=s.a[0]+s.dx*t,py=s.a[1]+s.dy*t,d=(x-px)**2+(y-py)**2;
                if(d<distance){distance=d;nx=px;ny=py;width=s.width;}
            }
            const offset=(row*size+col)*4;data[offset]=nx;data[offset+1]=ny;data[offset+2]=Math.sqrt(distance);data[offset+3]=width;
        }
        cache.set(key,data);if(cache.size>4)cache.delete(cache.keys().next().value);return data.slice();
    }
    window.GunterCoreForms=Object.freeze({
        list:()=>[...entries.values()].map(({id,label,aliases,description})=>({id,label,aliases:[...aliases],description})),
        get:id=>entries.get(id)||null,resolve,guide
    });
})();
