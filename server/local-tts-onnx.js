/* Supertonic 3 M1 ONNX runtime. Ported from the MIT-licensed Supertonic
 * UnicodeProcessor/Supertonic pipeline; model weights remain external. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ort = require('onnxruntime-node');

const MODELS = Object.freeze({
    duration: 'duration_predictor.onnx', encoder: 'text_encoder.onnx',
    estimator: 'vector_estimator.onnx', vocoder: 'vocoder.onnx'
});
const SYMBOLS = Object.freeze({ '–': '-', '‑': '-', '—': '-', '¯': ' ', '_': ' ',
    '“': '"', '”': '"', '‘': "'", '’': "'", '´': "'", '`': "'", '[': ' ', ']': ' ',
    '|': ' ', '/': ' ', '#': ' ', '→': ' ', '←': ' ' });
const EMOJI = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FAFF}\u2600-\u27BF\u{1F1E6}-\u{1F1FF}]+/gu;

function tensor(type, data, dims) { return new ort.Tensor(type, data, dims); }
function flatten(data) { return Float32Array.from(data.flat(3)); }
function preprocess(input) {
    let text = input.normalize('NFKD').replace(EMOJI, '');
    for (const [from, to] of Object.entries(SYMBOLS)) text = text.replaceAll(from, to);
    text = text.replace(/[♥☆♡©\\]/gu, '').replaceAll('@', ' at ')
        .replaceAll('e.g.,', 'for example, ').replaceAll('i.e.,', 'that is, ');
    for (const [from, to] of [[' ,', ','], [' .', '.'], [' !', '!'], [' ?', '?'],
        [' ;', ';'], [' :', ':'], [" '", "'"]]) text = text.replaceAll(from, to);
    text = text.replace(/(["'`])\1+/gu, '$1').replace(/\s+/gu, ' ').trim();
    if (!/[.!?;:,'"')\]}…】【。』】〉》›»]$/u.test(text)) text += '.';
    return `<es>${text}</es>`;
}
function normal(length) {
    const values = new Float32Array(length);
    let spare = null;
    for (let i = 0; i < length; i++) {
        if (spare !== null) { values[i] = spare; spare = null; continue; }
        const u = Math.max(Number.MIN_VALUE, Math.random());
        const v = Math.random();
        const scale = Math.sqrt(-2 * Math.log(u));
        values[i] = scale * Math.cos(2 * Math.PI * v);
        spare = scale * Math.sin(2 * Math.PI * v);
    }
    return values;
}
function wavPcm16(samples, sampleRate) {
    const count = samples.length;
    const buffer = Buffer.allocUnsafe(44 + count * 2);
    buffer.write('RIFF', 0); buffer.writeUInt32LE(36 + count * 2, 4); buffer.write('WAVE', 8);
    buffer.write('fmt ', 12); buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28); buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(count * 2, 40);
    for (let i = 0; i < count; i++) {
        const value = Math.max(-1, Math.min(1, samples[i]));
        buffer.writeInt16LE(value < 0 ? Math.round(value * 32768) : Math.round(value * 32767), 44 + i * 2);
    }
    return buffer;
}

class SupertonicOnnxRuntime {
    constructor(modelDir) {
        this.modelDir = modelDir;
        this.sessions = null;
        this.cancelled = false;
    }
    async start() {
        if (this.sessions) return;
        const root = path.join(this.modelDir, 'onnx');
        const config = JSON.parse(fs.readFileSync(path.join(root, 'tts.json'), 'utf8'));
        this.indexer = JSON.parse(fs.readFileSync(path.join(root, 'unicode_indexer.json'), 'utf8'));
        const style = JSON.parse(fs.readFileSync(path.join(this.modelDir, 'voice_styles', 'M1.json'), 'utf8'));
        this.styleTtl = tensor('float32', flatten(style.style_ttl.data), style.style_ttl.dims);
        this.styleDp = tensor('float32', flatten(style.style_dp.data), style.style_dp.dims);
        this.sampleRate = config.ae.sample_rate;
        this.chunkSize = config.ae.base_chunk_size * config.ttl.chunk_compress_factor;
        this.latentDim = config.ttl.latent_dim * config.ttl.chunk_compress_factor;
        const options = { executionProviders: ['cpu'], intraOpNumThreads: 4, interOpNumThreads: 1 };
        this.sessions = {};
        for (const [name, file] of Object.entries(MODELS))
            this.sessions[name] = await ort.InferenceSession.create(path.join(root, file), options);
    }
    health() { return { ready: !!this.sessions, model: 'supertonic-3', voice: 'M1', runtime: 'onnxruntime-node' }; }
    cancel() { this.cancelled = true; }
    stop() { this.cancel(); this.sessions = null; }
    async synthesize(input, speed = 1.05) {
        if (!this.sessions) throw new Error('RUNTIME_NOT_STARTED');
        if (typeof input !== 'string' || !input.trim() || input.length > 800) throw new Error('INVALID_TEXT');
        if (!Number.isFinite(speed) || speed < 0.75 || speed > 1.35) throw new Error('INVALID_SPEED');
        this.cancelled = false;
        const text = preprocess(input);
        const chars = Array.from(text);
        const ids = new BigInt64Array(chars.length);
        for (let i = 0; i < chars.length; i++) {
            const code = chars[i].codePointAt(0);
            const value = this.indexer[code];
            if (!Number.isInteger(value) || value < 0) throw new Error('UNSUPPORTED_TEXT_CHARACTER');
            ids[i] = BigInt(value);
        }
        const mask = new Float32Array(chars.length).fill(1);
        const textIds = tensor('int64', ids, [1, chars.length]);
        const textMask = tensor('float32', mask, [1, 1, chars.length]);
        const durationResult = await this.sessions.duration.run({ text_ids: textIds, style_dp: this.styleDp, text_mask: textMask });
        if (this.cancelled) throw new Error('CANCELLED');
        const duration = Number(durationResult.duration.data[0]) / speed;
        if (!Number.isFinite(duration) || duration <= 0 || duration > 60) throw new Error('INVALID_DURATION');
        const embResult = await this.sessions.encoder.run({ text_ids: textIds, style_ttl: this.styleTtl, text_mask: textMask });
        if (this.cancelled) throw new Error('CANCELLED');
        const wavLength = Math.trunc(duration * this.sampleRate);
        const latentLength = Math.floor((duration * this.sampleRate + this.chunkSize - 1) / this.chunkSize);
        const latentMaskLength = Math.ceil(wavLength / this.chunkSize);
        const latentMask = new Float32Array(latentLength);
        latentMask.fill(1, 0, Math.min(latentLength, latentMaskLength));
        const noise = normal(this.latentDim * latentLength);
        for (let n = latentMaskLength; n < latentLength; n++)
            for (let channel = 0; channel < this.latentDim; channel++) noise[channel * latentLength + n] = 0;
        let latent = tensor('float32', noise, [1, this.latentDim, latentLength]);
        const latentMaskTensor = tensor('float32', latentMask, [1, 1, latentLength]);
        const totalStep = tensor('float32', Float32Array.of(8), [1]);
        for (let step = 0; step < 8; step++) {
            if (this.cancelled) throw new Error('CANCELLED');
            const currentStep = tensor('float32', Float32Array.of(step), [1]);
            const result = await this.sessions.estimator.run({ noisy_latent: latent,
                text_emb: embResult.text_emb, style_ttl: this.styleTtl,
                latent_mask: latentMaskTensor, text_mask: textMask,
                current_step: currentStep, total_step: totalStep });
            latent = result.denoised_latent;
        }
        if (this.cancelled) throw new Error('CANCELLED');
        const result = await this.sessions.vocoder.run({ latent });
        const audio = result.wav_tts.data;
        return { buffer: wavPcm16(audio, this.sampleRate), duration: audio.length / this.sampleRate };
    }
}

module.exports = { SupertonicOnnxRuntime, preprocess, wavPcm16 };
