'use strict';
// GPU compositor contracts with a strict WebGL mock; no browser/media/network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/components/gunter-idle-core.js'), 'utf8');
const defaults = { color: '#ff452b', glowColor: '#ff6d35', brightness: 1, density: 1, speed: 1, size: 1 };
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`ok ${checks} - ${name}`); }

function webgl(options = {}) {
    const constants = ['ARRAY_BUFFER', 'STATIC_DRAW', 'VERTEX_SHADER', 'FRAGMENT_SHADER', 'COMPILE_STATUS',
        'LINK_STATUS', 'TEXTURE_2D', 'TEXTURE_MIN_FILTER', 'TEXTURE_MAG_FILTER', 'LINEAR', 'TEXTURE_WRAP_S',
        'TEXTURE_WRAP_T', 'CLAMP_TO_EDGE', 'RGBA', 'UNSIGNED_BYTE', 'FRAMEBUFFER', 'COLOR_ATTACHMENT0',
        'FRAMEBUFFER_COMPLETE', 'TRIANGLES', 'FLOAT', 'LINES', 'POINTS', 'COLOR_BUFFER_BIT', 'BLEND',
        'SRC_ALPHA', 'ONE', 'ONE_MINUS_SRC_ALPHA'];
    const gl = Object.fromEntries(constants.map((name, index) => [name, index + 1]));
    gl.TEXTURE0 = 100;
    const live = { Buffer: new Set(), Shader: new Set(), Program: new Set(), Texture: new Set(), Framebuffer: new Set() };
    const created = Object.fromEntries(Object.keys(live).map(kind => [kind, []]));
    const deleted = Object.fromEntries(Object.keys(live).map(kind => [kind, []]));
    const uploads = [], draws = [], uniforms = [], clears = [], blend = [], bindings = new Map();
    let boundBuffer, boundTexture, boundFramebuffer, activeProgram, activeUnit = 0, viewport, sequence = 0, losses = 0;
    for (const kind of Object.keys(live)) {
        gl['create' + kind] = () => {
            const resource = { kind, id: ++sequence };
            created[kind].push(resource); live[kind].add(resource);
            return resource;
        };
        gl['delete' + kind] = resource => {
            if (!resource) return;
            assert.ok(live[kind].delete(resource), `${kind} must be released exactly once`);
            deleted[kind].push(resource);
        };
    }
    gl.bindBuffer = (type, buffer) => { boundBuffer = buffer; };
    gl.bufferData = (type, data) => { boundBuffer.data = data.slice(); uploads.push(boundBuffer.data); };
    gl.shaderSource = (shader, text) => { shader.source = text; };
    gl.compileShader = () => {};
    gl.getShaderParameter = () => !options.failShader;
    gl.getShaderInfoLog = () => 'mock compile diagnostic';
    gl.attachShader = () => {};
    gl.linkProgram = () => {};
    gl.getProgramParameter = () => !options.failLink;
    gl.getProgramInfoLog = () => 'mock link diagnostic';
    gl.useProgram = program => { activeProgram = program; };
    gl.getUniformLocation = (program, name) => ({ program, name });
    for (const method of ['uniform1f', 'uniform2f', 'uniform1i', 'uniform3fv']) {
        gl[method] = (location, ...values) => {
            const value = values.length === 1 && Array.isArray(values[0]) ? values[0].slice() : values;
            location.program[location.name] = value;
            uniforms.push({ method, name: location.name, value });
        };
    }
    gl.activeTexture = unit => { activeUnit = unit - gl.TEXTURE0; };
    gl.bindTexture = (type, texture) => { boundTexture = texture; bindings.set(activeUnit, texture); };
    gl.texParameteri = () => {};
    gl.texImage2D = (target, level, format, width, height) => {
        assert.ok(Number.isInteger(width) && width >= 1 && width <= 720);
        assert.ok(Number.isInteger(height) && height >= 1 && height <= 720);
        boundTexture.width = width; boundTexture.height = height;
    };
    gl.bindFramebuffer = (type, framebuffer) => { boundFramebuffer = framebuffer; };
    gl.framebufferTexture2D = (target, attachment, type, texture) => { boundFramebuffer.texture = texture; };
    gl.checkFramebufferStatus = () => created.Framebuffer.length === options.failFramebufferAt ? -1 : gl.FRAMEBUFFER_COMPLETE;
    gl.viewport = (...values) => { viewport = values; };
    gl.clearColor = (...values) => clears.push(values);
    gl.clear = () => {};
    gl.enable = () => {};
    gl.disable = () => {};
    gl.blendFuncSeparate = (...values) => blend.push(values);
    gl.getAttribLocation = (program, name) => ({ a_seed: 0, a_path: 1, a_position: 2 })[name];
    gl.enableVertexAttribArray = () => {};
    gl.disableVertexAttribArray = () => {};
    gl.vertexAttribPointer = () => {};
    gl.drawArrays = (mode, first, count) => {
        assert.ok(Number.isInteger(count) && count >= 0, 'draw count is finite and nonnegative');
        assert.ok(count <= boundBuffer.data.length / (mode === gl.TRIANGLES ? 2 : 5), 'draw never exceeds uploaded vertices');
        if (mode === gl.TRIANGLES) {
            for (const name of ['u_image', 'u_bloom']) {
                if (activeProgram[name]) assert.notEqual(bindings.get(activeProgram[name][0]), boundFramebuffer?.texture,
                    'postprocessing must not sample its active render target');
            }
        }
        draws.push({ mode, first, count, program: activeProgram, framebuffer: boundFramebuffer, viewport: viewport.slice(),
            layer: activeProgram.u_layer?.[0], buffer: boundBuffer });
    };
    gl.getExtension = name => name === 'WEBGL_lose_context' ? { loseContext() { losses++; } } : null;
    return { gl, options, live, created, deleted, uploads, draws, uniforms, clears, blend,
        losses: () => losses,
        invalidate() { Object.values(live).forEach(resources => resources.clear()); } };
}

function environment(options = {}) {
    const gpu = webgl(options), contexts = [], listeners = new Map(), createdTags = [];
    const canvas = { width: 300, height: 150,
        getContext(type, attributes) { contexts.push({ type, attributes }); return options.noWebgl ? null : gpu.gl; },
        addEventListener(type, callback) { listeners.set(type, callback); } };
    const document = { createElement(tag) { createdTags.push(tag); assert.equal(tag, 'canvas'); return canvas; } };
    const events = [];
    const window = { dispatchEvent(event) { events.push(event); return true; } };
    const context = vm.createContext({ document, window,
        CustomEvent: class { constructor(type, attributes = {}) { this.type = type; this.detail = attributes.detail; } } });
    vm.runInContext(source, context, { filename: 'gunter-idle-core.js' });
    const core = new window.GunterIdleCore();
    return { ...gpu, core, canvas, contexts, createdTags, window, context, events,
        fire(type, event = {}) { listeners.get(type)(event); }, listeners };
}
function outputCanvas() {
    const operations = [], contexts = [];
    const output = { width: 0, height: 0, getContext(type) {
        contexts.push(type);
        assert.equal(type, '2d', 'each avatar uses the shared compositor rather than another GPU context');
        return { clearRect: (...args) => operations.push(['clear', ...args]), drawImage: (...args) => operations.push(['image', ...args]) };
    } };
    return { output, operations, contexts };
}
function render(env, width = 240, height = 240, seconds = 10, config = defaults) {
    const output = outputCanvas();
    env.core.renderTo(output.output, width, height, seconds, config);
    return output;
}
function assertReleased(env) {
    for (const [kind, resources] of Object.entries(env.live)) assert.equal(resources.size, 0, `${kind} has no leaked GPU resources`);
}

check('public API shares one transparent GPU compositor across output canvases', () => {
    const env = environment();
    for (const name of ['renderTo', 'stats', 'dispose']) assert.equal(typeof env.core[name], 'function');
    assert.equal(env.core.available, true);
    assert.deepEqual(env.createdTags, ['canvas']);
    assert.equal(env.contexts.length, 1);
    assert.equal(env.contexts[0].type, 'webgl');
    assert.equal(env.contexts[0].attributes.alpha, true);
    assert.equal(env.contexts[0].attributes.premultipliedAlpha, true);
    const first = render(env), second = render(env);
    assert.deepEqual(first.contexts, ['2d']); assert.deepEqual(second.contexts, ['2d']);
    assert.equal(first.operations[1][1], env.canvas);
    assert.deepEqual(first.operations[0], ['clear', 0, 0, 240, 240]);
    assert.equal(env.core.stats().renderer, 'webgl-filaments'); assert.equal(env.core.stats().frames, 2);
    const original = env.window.GunterIdleCore;
    vm.runInContext(source, env.context);
    assert.equal(env.window.GunterIdleCore, original);
    assert.deepEqual([...env.listeners.keys()], ['webglcontextlost', 'webglcontextrestored']);
    env.core.dispose(); assertReleased(env);
});

check('filament and internal emission geometry is deterministic, finite and normalized', () => {
    const first = environment(), second = environment();
    assert.equal(first.uploads.length, 3);
    for (let index = 0; index < 2; index++) {
        const data = first.uploads[index];
        assert.ok(data.length > 1000 && data.length % 5 === 0);
        assert.ok(data.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
        assert.deepEqual(Buffer.from(data.buffer), Buffer.from(second.uploads[index].buffer));
    }
    const filaments = first.uploads[0];
    for (let offset = 0; offset < filaments.length; offset += 10) {
        for (let seed = 0; seed < 4; seed++) assert.equal(filaments[offset + seed], filaments[offset + seed + 5]);
        assert.ok(filaments[offset + 4] < filaments[offset + 9], 'each segment advances along its path');
    }
    first.core.dispose(); second.core.dispose(); assertReleased(first); assertReleased(second);
});

check('one frame draws three geometry layers and four bloom/composite passes without texture feedback', () => {
    const env = environment(); render(env, 301, 199, 5, { ...defaults, density: 1.8 });
    assert.deepEqual(env.draws.map(draw => draw.mode), [env.gl.LINES, env.gl.POINTS, env.gl.POINTS,
        env.gl.TRIANGLES, env.gl.TRIANGLES, env.gl.TRIANGLES, env.gl.TRIANGLES]);
    assert.deepEqual(env.draws.slice(0, 3).map(draw => draw.layer), [0, 1, 2]);
    assert.equal(env.draws[2].count, 1800);
    const targets = env.core.targets;
    assert.deepEqual(env.draws.map(draw => draw.framebuffer), [targets.scene.framebuffer, targets.scene.framebuffer,
        targets.scene.framebuffer, targets.a.framebuffer, targets.b.framebuffer, targets.a.framebuffer, null]);
    assert.deepEqual(env.draws[3].viewport, [0, 0, 151, 100]);
    assert.deepEqual(env.draws.at(-1).viewport, [0, 0, 301, 199]);
    assert.deepEqual(env.clears, [[0, 0, 0, 0]]);
    assert.deepEqual(env.blend, [[env.gl.SRC_ALPHA, env.gl.ONE, env.gl.ONE, env.gl.ONE_MINUS_SRC_ALPHA]]);
    env.core.dispose(); assertReleased(env);
});

check('time, density, color, brightness and size reach the shaders without input or media dependencies', () => {
    const env = environment();
    render(env, 100, 200, 12, { color: '#00ff80', glowColor: '#123456', brightness: 2.5, density: .35, speed: .5, size: 1.3 });
    const program = env.core.programs.filament.program;
    assert.deepEqual(Array.from(program.u_time), [6]);
    assert.deepEqual(Array.from(program.u_size), [1.3]);
    assert.deepEqual(Array.from(program.u_brightness), [2.5]);
    assert.deepEqual(Array.from(program.u_color), [0, 1, 128 / 255]);
    assert.deepEqual(Array.from(program.u_glow), [18 / 255, 52 / 255, 86 / 255]);
    assert.deepEqual(Array.from(program.u_aspect), [1, .5]);
    render(env, 100, 200, Infinity);
    assert.deepEqual(Array.from(program.u_time), [0]);
    assert.doesNotMatch(source, /\b(?:fetch|AudioContext|getUserMedia|requestAnimationFrame|pointermove|mousemove|video)\b/);
    env.core.dispose(); assertReleased(env);
});

check('requested resolution is bounded and identical sizes reuse all framebuffer allocations', () => {
    const env = environment(), output = render(env, 10000, -5);
    assert.equal(output.output.width, 720); assert.equal(output.output.height, 1);
    assert.equal(env.core.stats().width, 720); assert.equal(env.core.stats().height, 1);
    const allocated = env.created.Framebuffer.length;
    render(env, 10000, -5);
    assert.equal(env.created.Framebuffer.length, allocated);
    const oldTargets = Object.values(env.core.targets);
    render(env, 128.4, 65.7);
    assert.equal(env.core.stats().width, 128); assert.equal(env.core.stats().height, 66);
    assert.equal(env.live.Framebuffer.size, 3); assert.equal(env.live.Texture.size, 3);
    for (const target of oldTargets) {
        assert.ok(env.deleted.Framebuffer.includes(target.framebuffer));
        assert.ok(env.deleted.Texture.includes(target.texture));
    }
    env.core.dispose(); assertReleased(env);
});

check('direct calls default omitted config and sanitize nonfinite dimensions and out-of-range values', () => {
    const env = environment(), { output } = outputCanvas();
    assert.doesNotThrow(() => env.core.renderTo(output, NaN, NaN));
    assert.equal(output.width, 512); assert.equal(output.height, 512);
    const program = env.core.programs.filament.program;
    assert.deepEqual(Array.from(program.u_time), [0]);
    assert.deepEqual(Array.from(program.u_size), [1]);
    assert.deepEqual(Array.from(program.u_brightness), [1]);
    assert.doesNotThrow(() => env.core.renderTo(output, Infinity, -Infinity, Infinity,
        { density: 999, brightness: Infinity, speed: -99, size: -99 }));
    assert.equal(output.width, 512); assert.equal(output.height, 512);
    assert.equal(env.draws.at(-5).count, 1800);
    assert.deepEqual(Array.from(program.u_time), [0]);
    assert.deepEqual(Array.from(program.u_size), [.7]);
    assert.deepEqual(Array.from(program.u_brightness), [1]);
    assert.doesNotThrow(() => env.core.renderTo(output, -100, 10000, 7,
        { density: -100, brightness: -100, speed: Infinity, size: Infinity }));
    assert.equal(output.width, 1); assert.equal(output.height, 720);
    assert.equal(env.draws.at(-5).count, 350);
    assert.deepEqual(Array.from(program.u_time), [7]);
    assert.deepEqual(Array.from(program.u_size), [1]);
    assert.deepEqual(Array.from(program.u_brightness), [.2]);
    assert.ok(env.uniforms.every(uniform => Array.from(uniform.value).every(Number.isFinite)));
    env.core.dispose(); assertReleased(env);
});

check('unavailable WebGL preserves its diagnostic and does not pretend to render', () => {
    const env = environment({ noWebgl: true });
    assert.equal(env.core.available, false); assert.match(env.core.error, /WebGL no/);
    assert.throws(() => render(env), /WebGL no/); assert.equal(env.core.frames, 0);
    env.core.dispose(); assertReleased(env);
});

check('shader compile and program link failures keep GPU diagnostics and release partial resources', () => {
    for (const [options, diagnostic] of [[{ failShader: true }, /Shader: mock compile diagnostic/],
        [{ failLink: true }, /WebGL: mock link diagnostic/]]) {
        const env = environment(options);
        assert.equal(env.core.available, false); assert.match(env.core.error, diagnostic);
        assert.throws(() => render(env), diagnostic); assert.equal(env.core.frames, 0);
        assertReleased(env); env.core.dispose(); assertReleased(env);
    }
});

check('failed framebuffer resize releases partial allocations and preserves a truthful failure', () => {
    const env = environment({ failFramebufferAt: 2 });
    assert.throws(() => render(env), /buffer de emisión/);
    assert.equal(env.live.Framebuffer.size, 0); assert.equal(env.live.Texture.size, 0);
    assert.equal(env.core.frames, 0);
    env.options.failFramebufferAt = 0;
    if (env.core.available) {
        assert.doesNotThrow(() => render(env)); assert.equal(env.core.frames, 1);
    } else {
        assert.match(env.core.stats().error, /buffer de emisión/);
        assert.throws(() => render(env), /buffer de emisión/);
    }
    env.core.dispose(); assertReleased(env);
});

check('context loss blocks rendering and restoration rebuilds the compositor and targets', () => {
    const env = environment(); render(env);
    let prevented = false;
    env.fire('webglcontextlost', { preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(env.core.available, false);
    assert.match(env.core.stats().error, /contexto WebGL/);
    assert.equal(env.events.at(-1).type, 'gunter-idle-core-availability');
    assert.equal(env.events.at(-1).detail.available, false);
    assert.match(env.events.at(-1).detail.error, /contexto WebGL/);
    assert.throws(() => render(env), /contexto WebGL/);
    env.invalidate(); env.fire('webglcontextrestored');
    assert.equal(env.core.available, true); assert.equal(env.core.error, '');
    assert.equal(env.events.at(-1).detail.available, true); assert.equal(env.events.at(-1).detail.error, '');
    assert.equal(env.live.Program.size, 4); assert.equal(env.live.Buffer.size, 3);
    assert.equal(env.core.stats().width, 0); render(env);
    assert.equal(env.live.Framebuffer.size, 3); assert.equal(env.core.frames, 2);
    env.core.dispose(); assertReleased(env);
});

check('dispose releases everything once and blocks restoration and future rendering', () => {
    const env = environment(); render(env);
    env.core.dispose(); assertReleased(env);
    assert.equal(env.losses(), 1); assert.equal(env.canvas.width, 1); assert.equal(env.canvas.height, 1);
    env.core.dispose(); assertReleased(env); assert.equal(env.losses(), 1);
    const programs = env.created.Program.length;
    env.fire('webglcontextrestored'); assert.equal(env.created.Program.length, programs);
    assert.equal(env.core.available, false); assert.throws(() => render(env), /no está disponible/);
});

console.log(`${checks} idle GPU compositor checks passed.`);
