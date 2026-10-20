'use strict';
// Numeric cache contracts only. No browser, GPU, images or application backend.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/dev/gunter-anatomy-cache.js'), 'utf8');
const context = {window: {}};
vm.runInNewContext(source, context);
const C = context.window.GunterAnatomyCache;
let checks = 0;
const check = (name, fn) => { fn(); console.log('ok ' + (++checks) + ' - ' + name); };
const near = (actual, expected, tolerance = 3e-6) => assert.ok(Math.abs(actual - expected) <= tolerance,
    actual + ' should be within ' + tolerance + ' of ' + expected);
const nearVector = (actual, expected, tolerance) => {
    assert.equal(actual.length, expected.length);
    Array.from(expected).forEach((value, i) => near(actual[i], value, tolerance));
};
const point = (x, y, z) => [(x / 63 * 2 - 1) * .96, (y / 63 * 2 - 1) * .96, (z / 31 * 2 - 1) * .36];
const frontPoint = (x, y) => [(x / 255 * 2 - 1) * .96, (y / 255 * 2 - 1) * .96];
const analyticVolume = (kind, q) => ({distance: kind * 10 + q[0] + q[1] * 2 + q[2] * 3,
    normal: [q[0], q[1], q[2]], local: [q[0] * 2 + kind, q[1] * 3 - kind, q[2] * 4],
    radius: .2 + (q[0] + .96) * .05});
const analyticFront = (kind, q) => ({z: kind + q[0] * .13 + q[1] * .21,
    coverage: .4 + (q[0] + .96) * .2, pupil: .15 + (q[1] + .96) * .1});
const packedVolume = sample => ({surface: [sample.distance, ...sample.normal], frame: [...sample.local, sample.radius]});
const packedFront = sample => [sample.z * sample.coverage, sample.coverage, sample.pupil * sample.coverage, 0];
let volumeCalls = 0, frontCalls = 0;
const hand = C.build(1, {volume: (kind, q) => { volumeCalls++; return analyticVolume(kind, q); },
    front: (kind, q) => { frontCalls++; return analyticFront(kind, q); }});

check('explicit bounded dimensions match the packed per-form and global atlas layouts', () => {
    assert.equal(C.GRID_XY, 64); assert.equal(C.GRID_Z, 32);
    assert.deepEqual(Array.from(C.EXTENT), [.96, .96, .36]);
    assert.equal(C.VOLUME_WIDTH, 512); assert.equal(C.VOLUME_PLANE_HEIGHT, 256);
    assert.equal(C.VOLUME_HEIGHT, 512); assert.equal(C.VOLUME_ATLAS_HEIGHT, 1536);
    assert.equal(C.FRONT_WIDTH, 256); assert.equal(C.FRONT_HEIGHT, 256); assert.equal(C.FRONT_ATLAS_HEIGHT, 768);
    assert.deepEqual({...C.KINDS}, {hand: 1, eye: 2, phoenix: 3});
    assert.equal(hand.volume.length, 512 * 512 * 4); assert.equal(hand.front.length, 256 * 256 * 4);
    assert.equal(hand.volume.byteLength + hand.front.byteLength, 5 * 1024 * 1024);
    assert.equal(hand.volumeWidth, 512); assert.equal(hand.volumeHeight, 512);
    assert.equal(hand.frontWidth, 256); assert.equal(hand.frontHeight, 256);
    assert.ok(Object.isFrozen(C)); assert.ok(Object.isFrozen(C.EXTENT)); assert.ok(Object.isFrozen(C.KINDS));
    assert.ok(Object.isFrozen(hand)); assert.ok(Object.isFrozen(hand.metrics));
});

check('one volume callback supplies both planes and each front node is evaluated once', () => {
    assert.equal(volumeCalls, 131072); assert.equal(frontCalls, 65536);
    assert.equal(hand.metrics.volumeSamples, volumeCalls); assert.equal(hand.metrics.frontSamples, frontCalls);
    assert.equal(C.VOLUME_SAMPLE_COUNT, volumeCalls); assert.equal(C.FRONT_SAMPLE_COUNT, frontCalls);
});

check('slice, row and plane addressing never overlaps or skips a voxel', () => {
    const used = new Uint8Array(hand.volume.length / 4);
    for (let z = 0; z < 32; z++) for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        for (let plane = 0; plane < 2; plane++) {
            const index = C.volumeIndex(x, y, z, plane);
            assert.equal(index % 4, 0); assert.equal(used[index / 4], 0);
            used[index / 4] = 1;
        }
    }
    assert.equal(used.every(value => value === 1), true);
    assert.equal(C.volumeIndex(0, 0, 0, 0), 0);
    assert.equal(C.volumeIndex(0, 0, 7, 0), 448 * 4);
    assert.equal(C.volumeIndex(0, 0, 8, 0), 64 * 512 * 4);
    assert.equal(C.volumeIndex(0, 0, 0, 1), 256 * 512 * 4);
    assert.equal(C.volumeIndex(63, 63, 31, 1), hand.volume.length - 4);
});

check('all selected extreme and z-slice boundary nodes reproduce both analytic planes', () => {
    for (const z of [0, 7, 8, 15, 16, 23, 24, 31]) for (const y of [0, 31, 63]) for (const x of [0, 32, 63]) {
        const q = point(x, y, z), expected = packedVolume(analyticVolume(1, q));
        const sampled = C.sampleVolume(hand, q);
        nearVector(sampled.surface, expected.surface); nearVector(sampled.frame, expected.frame);
        for (const [plane, values] of [[0, expected.surface], [1, expected.frame]]) {
            const index = C.volumeIndex(x, y, z, plane);
            nearVector(hand.volume.subarray(index, index + 4), values);
        }
    }
});

check('trilinear interpolation uses geometric grid neighbours across slice tile seams', () => {
    for (const position of [[.123, -.251, .083], [0, 0, 0], point(62.75, .25, 7.7),
        point(.1, 62.9, 15.4), point(31.3, 47.7, 23.8)]) {
        const expected = packedVolume(analyticVolume(1, position)), actual = C.sampleVolume(hand.volume, position);
        nearVector(actual.surface, expected.surface); nearVector(actual.frame, expected.frame);
    }
});

check('front geometry stores depth and pupil premultiplied by coverage, with a zero fourth channel', () => {
    for (const x of [0, 127, 255]) for (const y of [0, 128, 255]) {
        const q = frontPoint(x, y), index = C.frontIndex(x, y), expected = packedFront(analyticFront(1, q));
        nearVector(hand.front.subarray(index, index + 4), expected);
        nearVector(C.sampleFront(hand, q), expected);
    }
    const x = 87, y = 192, fx = .23, fy = .78, result = [0, 0, 0, 0];
    for (let yi = 0; yi < 2; yi++) for (let xi = 0; xi < 2; xi++) {
        const values = packedFront(analyticFront(1, frontPoint(x + xi, y + yi)));
        const weight = (xi ? fx : 1 - fx) * (yi ? fy : 1 - fy);
        values.forEach((value, i) => { result[i] += value * weight; });
    }
    nearVector(C.sampleFront(hand.front, frontPoint(x + fx, y + fy)), result);
});

check('coordinates clamp at the resource extent rather than wrapping to another slice or form', () => {
    nearVector(C.sampleVolume(hand, [-9, 9, 9]).surface, C.sampleVolume(hand, [-.96, .96, .36]).surface);
    nearVector(C.sampleVolume(hand, [9, -9, -9]).frame, C.sampleVolume(hand, [.96, -.96, -.36]).frame);
    nearVector(C.sampleFront(hand, [-9, 9]), C.sampleFront(hand, [-.96, .96]));
});

check('global atlas sampling selects only the requested form even on boundary texels', () => {
    const eye = C.build(2, {volume: analyticVolume, front: analyticFront});
    const phoenix = C.build(3, {volume: analyticVolume, front: analyticFront});
    const volumeAtlas = new Float32Array(hand.volume.length * 3), frontAtlas = new Float32Array(hand.front.length * 3);
    [hand, eye, phoenix].forEach((cache, index) => {
        volumeAtlas.set(cache.volume, index * hand.volume.length); frontAtlas.set(cache.front, index * hand.front.length);
    });
    assert.equal(volumeAtlas.byteLength + frontAtlas.byteLength, 15 * 1024 * 1024);
    for (const cache of [hand, eye, phoenix]) {
        for (const q of [[-.96, -.96, -.36], [.96, .96, .36], [.96, -.96, .36], [-.96, .96, -.36], [0, 0, 0]]) {
            const sample = C.sampleVolume(volumeAtlas, q, cache.kind), expected = C.sampleVolume(cache, q);
            nearVector(sample.surface, expected.surface); nearVector(sample.frame, expected.frame);
            nearVector(C.sampleFront(frontAtlas, q, cache.kind), C.sampleFront(cache, q));
        }
        assert.equal(C.volumeIndex(63, 63, 31, 1, cache.kind), cache.kind * hand.volume.length - 4);
        assert.equal(C.frontIndex(255, 255, cache.kind), cache.kind * hand.front.length - 4);
    }
    assert.throws(() => C.sampleVolume(volumeAtlas, [0, 0, 0]), /explicit anatomical kind/);
    assert.throws(() => C.sampleFront(frontAtlas, [0, 0]), /explicit anatomical kind/);
    assert.throws(() => C.sampleVolume(hand, [0, 0, 0], 2), /does not match/);
});

check('the builder never memoizes stale callbacks or mutates analytic sample results', () => {
    const shared = {distance: -.2, normal: Object.freeze([0, 0, 1]), local: Object.freeze([0, 0, 0]), radius: .1};
    Object.freeze(shared);
    const other = C.build(1, {volume: () => shared, front: () => ({z: .2, coverage: 1, pupil: 0})});
    assert.notEqual(other.volume, hand.volume); assert.notEqual(other.front, hand.front);
    near(C.sampleVolume(other, [0, 0, 0]).surface[0], -.2);
    assert.equal(shared.distance, -.2);
});

check('unknown kinds, malformed callbacks and unsafe grid indices fail before sampling', () => {
    for (const kind of [0, 4, -1, 1.1, NaN, Infinity, '1', null]) {
        assert.throws(() => C.build(kind, {volume: analyticVolume, front: analyticFront}), /kind must/);
    }
    for (const callbacks of [null, {}, {volume: analyticVolume}, {front: analyticFront}, {volume: 1, front: 1}]) {
        assert.throws(() => C.build(1, callbacks), /requires analytic/);
    }
    for (const args of [[-1, 0, 0], [64, 0, 0], [0, 64, 0], [0, 0, 32], [0, 0, 0, 2], [.5, 0, 0]]) {
        assert.throws(() => C.volumeIndex(...args), /outside the geometry grid/);
    }
    assert.throws(() => C.frontIndex(256, 0), /outside the geometry grid/);
    assert.throws(() => C.frontIndex(0, -1), /outside the geometry grid/);
});

check('non-finite, overflowing or missing callback channels cannot reach a GPU upload', () => {
    const good = analyticVolume(1, [0, 0, 0]);
    for (const invalid of [null, {...good, distance: NaN}, {...good, distance: 1e300},
        {...good, normal: [0, Infinity, 1]}, {...good, local: [0, 0]}, {...good, radius: 0}, {...good, radius: -1}]) {
        assert.throws(() => C.build(1, {volume: () => invalid, front: analyticFront}), /invalid volume sample/);
    }
    const goodFront = analyticFront(1, [0, 0]);
    for (const invalid of [null, {...goodFront, z: NaN}, {...goodFront, coverage: Infinity},
        {...goodFront, pupil: 1.1}, {...goodFront, coverage: -.1}]) {
        assert.throws(() => C.build(1, {volume: () => good, front: () => invalid}), /invalid front sample/);
    }
});

check('CPU mirrors reject invalid coordinates, resource types and ambiguous dimensions', () => {
    for (const q of [[NaN, 0, 0], [0, Infinity, 0], [0, 0], null]) {
        assert.throws(() => C.sampleVolume(hand, q), /coordinates/);
    }
    assert.throws(() => C.sampleFront(hand, [NaN, 0]), /coordinates/);
    assert.throws(() => C.sampleFront(hand, [0]), /coordinates/);
    assert.throws(() => C.sampleVolume([], [0, 0, 0]), /Float32Array/);
    assert.throws(() => C.sampleFront(new Float64Array(hand.front.length), [0, 0]), /Float32Array/);
    assert.throws(() => C.sampleVolume(new Float32Array(4), [0, 0, 0]), /resource size/);
    assert.throws(() => C.sampleFront(new Float32Array(4), [0, 0]), /resource size/);
});

check('cache loading is idempotent and has no network, media, storage or rendering lifecycle', () => {
    vm.runInNewContext(source, context);
    assert.equal(context.window.GunterAnatomyCache, C);
    assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|getUserMedia|MediaRecorder|requestAnimationFrame)\s*(?:\(|\.)/);
    assert.doesNotMatch(source, /\b(?:document|navigator)\s*\./);
    assert.doesNotMatch(source, /\b(?:setInterval|createTexture|getContext|createElement)\s*\(/);
    assert.equal((source.match(/\bsetTimeout\s*\(/g) || []).length, 1, 'the only timer is the async host-yield scheduler');
});

async function checkAsync(name, fn) {
    await fn();
    console.log('ok ' + (++checks) + ' - ' + name);
}
async function asyncChecks() {
    await checkAsync('async preparation shares the same generator and produces bit-identical complete buffers', async () => {
        let calls = 0, yields = 0;
        const updates = [];
        const result = await C.buildAsync(1, {volume: (kind, q) => { calls++; return analyticVolume(kind, q); }, front: analyticFront},
            {schedule: () => { yields++; return Promise.resolve(); }, onProgress: item => updates.push(item)});
        assert.equal(C.DEFAULT_BATCH_SIZE, 128); assert.equal(C.MAX_BATCH_SIZE, 4096);
        assert.equal(calls, 131072); assert.ok(yields >= 3);
        assert.equal(yields, Math.ceil(131072 / 128) + Math.ceil(65536 / 128) + 1);
        assert.equal(Buffer.compare(Buffer.from(result.volume.buffer), Buffer.from(hand.volume.buffer)), 0);
        assert.equal(Buffer.compare(Buffer.from(result.front.buffer), Buffer.from(hand.front.buffer)), 0);
        assert.deepEqual({...result.metrics}, {...hand.metrics});
        assert.equal(updates[0].completed, 128); assert.equal(updates[0].channel, 'volume');
        assert.equal(updates.at(-1).completed, 196608); assert.equal(updates.at(-1).fraction, 1);
        assert.equal(updates.at(-1).volumeSamples, 131072); assert.equal(updates.at(-1).frontSamples, 65536);
        assert.equal(updates.at(-1).channel, 'front');
        for (let i = 0; i < updates.length; i++) {
            const update = updates[i];
            assert.ok(Object.isFrozen(update)); assert.equal(update.total, 196608);
            assert.equal(update.completed, update.volumeSamples + update.frontSamples);
            assert.equal(update.fraction, update.completed / update.total);
            if (i) assert.ok(update.completed > updates[i - 1].completed);
        }
    });

    await checkAsync('async cancellation between chunks stops callbacks and never publishes partial resources', async () => {
        const controller = new AbortController();
        let yields = 0, volumeSamples = 0, frontSamples = 0, returned;
        const updates = [];
        await assert.rejects(async () => {
            returned = await C.buildAsync(2, {volume: (kind, q) => { volumeSamples++; return analyticVolume(kind, q); },
                front: (kind, q) => { frontSamples++; return analyticFront(kind, q); }},
            {signal: controller.signal, onProgress: value => updates.push(value), schedule: () => {
                yields++;
                if (yields === 3) controller.abort();
                return Promise.resolve();
            }});
        }, error => error.name === 'AbortError');
        assert.equal(yields, 3); assert.equal(volumeSamples, 256); assert.equal(frontSamples, 0);
        assert.equal(updates.length, 2); assert.equal(updates.at(-1).completed, 256); assert.equal(returned, undefined);
        await Promise.resolve();
        assert.equal(volumeSamples, 256, 'cancelled jobs must not schedule background continuation');
    });

    await checkAsync('pre-aborted jobs allocate no work and pending host yields observe cancellation before sampling', async () => {
        const before = new AbortController(); before.abort();
        let calls = 0, schedules = 0;
        const callbacks = {volume: () => { calls++; return analyticVolume(1, [0, 0, 0]); }, front: analyticFront};
        await assert.rejects(C.buildAsync(1, callbacks, {signal: before.signal, schedule: () => { schedules++; }}),
            error => error.name === 'AbortError');
        assert.equal(calls, 0); assert.equal(schedules, 0);
        const during = new AbortController();
        let release;
        const pending = C.buildAsync(1, callbacks, {signal: during.signal, schedule: () => new Promise(resolve => { release = resolve; })});
        assert.equal(calls, 0, 'the first geometry chunk must wait for a host yield');
        during.abort(); release();
        await assert.rejects(pending, error => error.name === 'AbortError');
        assert.equal(calls, 0);
    });

    await checkAsync('progress-triggered abort and scheduler failures cannot continue the iterator', async () => {
        const controller = new AbortController();
        let calls = 0, schedules = 0;
        await assert.rejects(C.buildAsync(1, {volume: (kind, q) => { calls++; return analyticVolume(kind, q); }, front: analyticFront},
            {signal: controller.signal, batchSize: 7, schedule: () => { schedules++; return Promise.resolve(); },
                onProgress: () => controller.abort()}), error => error.name === 'AbortError');
        assert.equal(calls, 7); assert.equal(schedules, 1);
        await assert.rejects(C.buildAsync(1, {volume: analyticVolume, front: analyticFront},
            {schedule: () => Promise.reject(new Error('host-yield failed'))}), /host-yield failed/);
    });

    await checkAsync('async options enforce a bounded batch size and valid scheduling hooks', async () => {
        const callbacks = {volume: analyticVolume, front: analyticFront};
        for (const options of [null, {schedule: 1}, {onProgress: true}]) {
            await assert.rejects(C.buildAsync(1, callbacks, options), /options/);
        }
        for (const batchSize of [0, -1, .5, 4097, Infinity, NaN, '128']) {
            await assert.rejects(C.buildAsync(1, callbacks, {batchSize}), /batchSize/);
        }
        await assert.rejects(C.buildAsync(4, callbacks), /kind must/);
        await assert.rejects(C.buildAsync(1, {}), /requires analytic/);
    });

    await checkAsync('default scheduling uses only zero-delay host yields and supports cancellation', async () => {
        const delays = [], controller = new AbortController();
        const timerContext = {window: {}, setTimeout: (callback, delay) => {
            delays.push(delay);
            if (delays.length === 3) controller.abort();
            Promise.resolve().then(callback);
        }};
        vm.runInNewContext(source, timerContext);
        let calls = 0;
        await assert.rejects(timerContext.window.GunterAnatomyCache.buildAsync(1,
            {volume: (kind, q) => { calls++; return analyticVolume(kind, q); }, front: analyticFront},
            {signal: controller.signal}), error => error.name === 'AbortError');
        assert.deepEqual(delays, [0, 0, 0]); assert.equal(calls, 256);
    });
    console.log(checks + ' anatomical geometry cache checks passed.');
}
asyncChecks().catch(error => { console.error(error); process.exitCode = 1; });
