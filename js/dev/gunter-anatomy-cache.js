/* Opt-in laboratory geometry cache. Numeric analytic descriptors only: no
 * simulation, rendering, visual assets, persistence or device access.
 * buildAsync(kind, {volume, front}, options) yields between bounded chunks;
 * synchronous build() is retained for offline numeric audits and tests.
 */
(function () {
    'use strict';
    if (window.GunterAnatomyCache) return;

    const GRID_XY = 64, GRID_Z = 32, EXTENT = Object.freeze([.96, .96, .36]);
    const SLICE_COLUMNS = 8, SLICE_ROWS = 4, CHANNELS = 4, FORM_COUNT = 3;
    const VOLUME_WIDTH = GRID_XY * SLICE_COLUMNS;
    const VOLUME_PLANE_HEIGHT = GRID_XY * SLICE_ROWS;
    const VOLUME_HEIGHT = VOLUME_PLANE_HEIGHT * 2;
    const FRONT_WIDTH = 256, FRONT_HEIGHT = 256;
    const VOLUME_ATLAS_HEIGHT = VOLUME_HEIGHT * FORM_COUNT;
    const FRONT_ATLAS_HEIGHT = FRONT_HEIGHT * FORM_COUNT;
    const VOLUME_SAMPLE_COUNT = GRID_XY * GRID_XY * GRID_Z;
    const FRONT_SAMPLE_COUNT = FRONT_WIDTH * FRONT_HEIGHT;
    const VOLUME_LENGTH = VOLUME_WIDTH * VOLUME_HEIGHT * CHANNELS;
    const FRONT_LENGTH = FRONT_WIDTH * FRONT_HEIGHT * CHANNELS;
    const DEFAULT_BATCH_SIZE = 128, MAX_BATCH_SIZE = 4096;
    const KINDS = Object.freeze({hand: 1, eye: 2, phoenix: 3});

    function validKind(kind) {
        if (!Number.isInteger(kind) || kind < 1 || kind > FORM_COUNT) {
            throw new RangeError('Anatomical kind must be 1 (hand), 2 (eye) or 3 (phoenix).');
        }
        return kind;
    }
    function finite(value) {
        return Number.isFinite(value) && Number.isFinite(Math.fround(value));
    }
    function vector(value, size) {
        if (!value || value.length < size) return false;
        for (let i = 0; i < size; i++) if (!finite(value[i])) return false;
        return true;
    }
    function integer(value, limit, name) {
        if (!Number.isInteger(value) || value < 0 || value >= limit) {
            throw new RangeError(name + ' is outside the geometry grid.');
        }
    }
    function rawVolumeIndex(x, y, z, plane, offsetY) {
        return (((offsetY + plane * VOLUME_PLANE_HEIGHT + Math.floor(z / SLICE_COLUMNS) * GRID_XY + y)
            * VOLUME_WIDTH) + (z % SLICE_COLUMNS) * GRID_XY + x) * CHANNELS;
    }
    // Indices address Float32 elements, not pixels. Omit kind for a per-form
    // resource; pass kind for the vertically stacked three-form GPU atlas.
    function volumeIndex(x, y, z, plane = 0, kind) {
        integer(x, GRID_XY, 'x'); integer(y, GRID_XY, 'y'); integer(z, GRID_Z, 'z');
        integer(plane, 2, 'plane');
        return rawVolumeIndex(x, y, z, plane, kind === undefined ? 0 : (validKind(kind) - 1) * VOLUME_HEIGHT);
    }
    function frontIndex(x, y, kind) {
        integer(x, FRONT_WIDTH, 'x'); integer(y, FRONT_HEIGHT, 'y');
        return (((kind === undefined ? 0 : (validKind(kind) - 1) * FRONT_HEIGHT) + y) * FRONT_WIDTH + x) * CHANNELS;
    }

    function createBuild(kind, callbacks) {
        validKind(kind);
        if (!callbacks || typeof callbacks.volume !== 'function' || typeof callbacks.front !== 'function') {
            throw new TypeError('build requires analytic volume(kind, q) and front(kind, xy) callbacks.');
        }
        return {kind, callbacks, volume: new Float32Array(VOLUME_LENGTH), front: new Float32Array(FRONT_LENGTH),
            q: [0, 0, 0], xy: [0, 0], volumeSamples: 0, frontSamples: 0};
    }
    function fillVolume(state, stop) {
        const {kind, callbacks, volume, q} = state;
        for (; state.volumeSamples < stop; state.volumeSamples++) {
            const node = state.volumeSamples, x = node % GRID_XY,
                y = Math.floor(node / GRID_XY) % GRID_XY, z = Math.floor(node / (GRID_XY * GRID_XY));
            q[0] = (x / (GRID_XY - 1) * 2 - 1) * EXTENT[0];
            q[1] = (y / (GRID_XY - 1) * 2 - 1) * EXTENT[1];
            q[2] = (z / (GRID_Z - 1) * 2 - 1) * EXTENT[2];
            // Both planes come from this single geometry evaluation.
            const sample = callbacks.volume(kind, q);
            if (!sample || !finite(sample.distance) || !vector(sample.normal, 3)
                || !vector(sample.local, 3) || !finite(sample.radius) || sample.radius <= 0) {
                throw new TypeError('Non-finite or invalid volume sample at [' + x + ',' + y + ',' + z + '].');
            }
            let index = rawVolumeIndex(x, y, z, 0, 0);
            volume[index] = sample.distance;
            volume[index + 1] = sample.normal[0];
            volume[index + 2] = sample.normal[1];
            volume[index + 3] = sample.normal[2];
            index = rawVolumeIndex(x, y, z, 1, 0);
            volume[index] = sample.local[0];
            volume[index + 1] = sample.local[1];
            volume[index + 2] = sample.local[2];
            volume[index + 3] = sample.radius;
        }
    }
    function fillFront(state, stop) {
        const {kind, callbacks, front, xy} = state;
        for (; state.frontSamples < stop; state.frontSamples++) {
            const node = state.frontSamples, x = node % FRONT_WIDTH, y = Math.floor(node / FRONT_WIDTH);
            xy[0] = (x / (FRONT_WIDTH - 1) * 2 - 1) * EXTENT[0];
            xy[1] = (y / (FRONT_HEIGHT - 1) * 2 - 1) * EXTENT[1];
            const sample = callbacks.front(kind, xy);
            if (!sample || !finite(sample.z) || !finite(sample.coverage) || !finite(sample.pupil)
                || sample.coverage < 0 || sample.coverage > 1 || sample.pupil < 0 || sample.pupil > 1) {
                throw new TypeError('Non-finite or invalid front sample at [' + x + ',' + y + '].');
            }
            const index = node * CHANNELS;
            front[index] = sample.z * sample.coverage;
            front[index + 1] = sample.coverage;
            front[index + 2] = sample.pupil * sample.coverage;
            // Channel four stays zero. Pupil attenuation is deliberately
            // reapplied analytically by the renderer after interpolation.
        }
    }
    function progress(state, channel) {
        const completed = state.volumeSamples + state.frontSamples, total = VOLUME_SAMPLE_COUNT + FRONT_SAMPLE_COUNT;
        return Object.freeze({fraction: completed / total, channel, completed, total,
            volumeSamples: state.volumeSamples, frontSamples: state.frontSamples});
    }
    function* buildChunks(state, batchSize) {
        while (state.volumeSamples < VOLUME_SAMPLE_COUNT) {
            fillVolume(state, Math.min(VOLUME_SAMPLE_COUNT, state.volumeSamples + batchSize));
            yield progress(state, 'volume');
        }
        while (state.frontSamples < FRONT_SAMPLE_COUNT) {
            fillFront(state, Math.min(FRONT_SAMPLE_COUNT, state.frontSamples + batchSize));
            yield progress(state, 'front');
        }
        return Object.freeze({kind: state.kind, volume: state.volume, front: state.front,
            volumeWidth: VOLUME_WIDTH, volumeHeight: VOLUME_HEIGHT,
            frontWidth: FRONT_WIDTH, frontHeight: FRONT_HEIGHT,
            metrics: Object.freeze({volumeSamples: state.volumeSamples, frontSamples: state.frontSamples})});
    }
    function build(kind, callbacks) {
        const iterator = buildChunks(createBuild(kind, callbacks), MAX_BATCH_SIZE);
        let step;
        do { step = iterator.next(); } while (!step.done);
        return step.value;
    }
    function checkAbort(signal) {
        if (signal && signal.aborted) {
            const error = new Error('Anatomical cache preparation was cancelled.');
            error.name = 'AbortError';
            throw error;
        }
    }
    const defaultSchedule = () => new Promise(resolve => setTimeout(resolve, 0));
    // The scheduler must yield control to the host (default: one zero-delay
    // timer). Tests may inject a deterministic scheduler; this cache creates
    // no animation loop and publishes no partially prepared resource.
    async function buildAsync(kind, callbacks, options = {}) {
        if (!options || typeof options !== 'object') throw new TypeError('Async cache options must be an object.');
        const {signal, onProgress, schedule = defaultSchedule, batchSize = DEFAULT_BATCH_SIZE} = options;
        if (typeof schedule !== 'function' || (onProgress !== undefined && typeof onProgress !== 'function')) {
            throw new TypeError('Async schedule and onProgress options must be functions.');
        }
        if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
            throw new RangeError('Async cache batchSize must be between 1 and ' + MAX_BATCH_SIZE + '.');
        }
        checkAbort(signal);
        const iterator = buildChunks(createBuild(kind, callbacks), batchSize);
        try {
            while (true) {
                checkAbort(signal);
                await schedule();
                checkAbort(signal);
                const step = iterator.next();
                if (step.done) return step.value;
                if (onProgress) onProgress(step.value);
            }
        } finally {
            iterator.return();
        }
    }

    function resource(input, field, localLength, kind) {
        const raw = input && input[field] ? input[field] : input;
        if (Object.prototype.toString.call(raw) !== '[object Float32Array]') {
            throw new TypeError(field + ' must be a Float32Array or a built cache record.');
        }
        if (input && input[field] && input.kind !== undefined) {
            validKind(input.kind);
            if (kind !== undefined && kind !== input.kind) throw new RangeError('Cache kind does not match the requested kind.');
            kind = input.kind;
        }
        if (kind !== undefined) validKind(kind);
        if (raw.length === localLength) return {raw, offsetY: 0};
        if (raw.length !== localLength * FORM_COUNT) throw new RangeError(field + ' has an unexpected resource size.');
        if (kind === undefined) throw new RangeError('Sampling a global atlas requires an explicit anatomical kind.');
        return {raw, offsetY: (kind - 1) * (field === 'volume' ? VOLUME_HEIGHT : FRONT_HEIGHT)};
    }
    function coordinate(value, axis, count) {
        const scaled = (Math.max(-EXTENT[axis], Math.min(EXTENT[axis], value)) / EXTENT[axis] * .5 + .5) * (count - 1);
        const low = Math.floor(scaled);
        return [low, Math.min(count - 1, low + 1), scaled - low];
    }
    // CPU mirrors explicitly interpolate grid nodes, never adjacent raster
    // pixels across z-slice tiles, packed planes or anatomical form boundaries.
    // surface=[distance,nx,ny,nz]; frame=[localX,localY,localZ,radius].
    function sampleVolume(input, q, kind) {
        if (!vector(q, 3)) throw new TypeError('Volume coordinates must contain three finite values.');
        const {raw, offsetY} = resource(input, 'volume', VOLUME_LENGTH, kind);
        const x = coordinate(q[0], 0, GRID_XY), y = coordinate(q[1], 1, GRID_XY), z = coordinate(q[2], 2, GRID_Z);
        const planes = [];
        for (let plane = 0; plane < 2; plane++) {
            const out = [0, 0, 0, 0];
            for (let zi = 0; zi < 2; zi++) for (let yi = 0; yi < 2; yi++) for (let xi = 0; xi < 2; xi++) {
                const weight = (xi ? x[2] : 1 - x[2]) * (yi ? y[2] : 1 - y[2]) * (zi ? z[2] : 1 - z[2]);
                const index = rawVolumeIndex(x[xi], y[yi], z[zi], plane, offsetY);
                for (let c = 0; c < CHANNELS; c++) out[c] += raw[index + c] * weight;
            }
            planes.push(out);
        }
        return {surface: planes[0], frame: planes[1]};
    }
    // Returns the still-premultiplied [z*coverage,coverage,pupil*coverage,0].
    // It does not reconstruct z or turn the interpolated pupil into a gas mask.
    function sampleFront(input, xy, kind) {
        if (!vector(xy, 2)) throw new TypeError('Front coordinates must contain two finite values.');
        const {raw, offsetY} = resource(input, 'front', FRONT_LENGTH, kind);
        const x = coordinate(xy[0], 0, FRONT_WIDTH), y = coordinate(xy[1], 1, FRONT_HEIGHT), out = [0, 0, 0, 0];
        for (let yi = 0; yi < 2; yi++) for (let xi = 0; xi < 2; xi++) {
            const weight = (xi ? x[2] : 1 - x[2]) * (yi ? y[2] : 1 - y[2]);
            const index = ((offsetY + y[yi]) * FRONT_WIDTH + x[xi]) * CHANNELS;
            for (let c = 0; c < CHANNELS; c++) out[c] += raw[index + c] * weight;
        }
        return out;
    }

    window.GunterAnatomyCache = Object.freeze({
        GRID_XY, GRID_Z, EXTENT, SLICE_COLUMNS, SLICE_ROWS, CHANNELS, FORM_COUNT, KINDS,
        VOLUME_WIDTH, VOLUME_PLANE_HEIGHT, VOLUME_HEIGHT, VOLUME_ATLAS_HEIGHT,
        FRONT_WIDTH, FRONT_HEIGHT, FRONT_ATLAS_HEIGHT, VOLUME_SAMPLE_COUNT, FRONT_SAMPLE_COUNT,
        DEFAULT_BATCH_SIZE, MAX_BATCH_SIZE, build, buildAsync, volumeIndex, frontIndex, sampleVolume, sampleFront
    });
})();
