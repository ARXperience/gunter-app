/* Local-only Supertonic 3 M1 adapter. ONNX weights stay outside the repo. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { manifest, verifyModelAssets } = require('./local-tts-assets');

const CODE = Object.freeze({ MISSING: 'LOCAL_TTS_NOT_INSTALLED', UNAVAILABLE: 'LOCAL_TTS_UNAVAILABLE', BUSY: 'LOCAL_TTS_BUSY' });
const REQUIRED = Object.keys(manifest.files);
const MAX_TEXT = 800;
const MAX_WAV_BYTES = 8 * 1024 * 1024;
const MAX_LINE_BYTES = 12 * 1024 * 1024;
let worker = null, warmPromise = null, warmResolve = null, warmReject = null, warmTimer = null;
let pending = null, active = false, ready = false, lastError = null, lineBuffer = '', nextId = 0;
let verifiedDir = null, verificationPromise = null;

function failure(code, detail) { return Object.assign(new Error(code), { code, detail }); }
function abortError() { return Object.assign(new Error('AbortError'), { name: 'AbortError' }); }
function config() {
    let fileConfig = {};
    const dataDir = process.env.GUNTER_DATA_DIR || path.join(__dirname, '..', 'data');
    try {
        const file = path.join(dataDir, 'local-tts.json');
        fileConfig = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { /* Optional per-machine configuration. */ }
    return { modelDir: process.env.GUNTER_LOCAL_TTS_MODEL_DIR || fileConfig.modelDir || path.join(dataDir, 'models', 'supertonic3') };
}
function isFile(file) { try { const info = fs.statSync(file); return info.isFile() && info.size > 0; } catch { return false; } }
function installed() {
    const { modelDir } = config();
    return path.isAbsolute(modelDir)
        && REQUIRED.every(relative => isFile(path.join(modelDir, relative)));
}
function snapshot() {
    const configured = installed();
    return { localTTSInstalled: configured, localTTSRuntimeAvailable: configured && !lastError,
        localTTSReady: configured && ready && !!worker && !lastError,
        localTTSModel: configured ? 'Supertone/supertonic-3 · M1 · es' : null, localTTSError: lastError };
}
function validWav(buffer) {
    return buffer.length >= 44 && buffer.toString('ascii', 0, 4) === 'RIFF'
        && buffer.toString('ascii', 8, 12) === 'WAVE';
}
function settlePending(error, value) {
    const job = pending;
    if (!job) return;
    pending = null;
    clearTimeout(job.timer);
    job.signal?.removeEventListener('abort', job.abort);
    if (error) job.reject(error); else job.resolve(value);
}
function failWorker(child, error) {
    if (worker !== child) return;
    worker = null; ready = false; lineBuffer = '';
    if (warmTimer) { clearTimeout(warmTimer); warmTimer = null; }
    const rejectWarm = warmReject;
    warmPromise = warmResolve = warmReject = null;
    if (error.name !== 'AbortError') lastError = error.detail || error.code || 'RUNTIME_FAILED';
    rejectWarm?.(error);
    settlePending(error);
    try { child.kill(); } catch { /* already exited */ }
}
function handleMessage(child, message) {
    if (worker !== child || !message || typeof message !== 'object') return;
    if (message.type === 'ready') {
        ready = true; lastError = null;
        if (warmTimer) { clearTimeout(warmTimer); warmTimer = null; }
        const resolveWarm = warmResolve;
        warmPromise = warmResolve = warmReject = null;
        resolveWarm?.();
        return;
    }
    if (!pending || message.id !== pending.id) return;
    if (message.type === 'error') {
        const error = failure(CODE.UNAVAILABLE, String(message.error || 'RUNTIME_ERROR').slice(0, 300));
        lastError = error.detail; settlePending(error);
        return;
    }
    if (message.type !== 'audio' || typeof message.wav !== 'string') return;
    const buffer = Buffer.from(message.wav, 'base64');
    if (buffer.length > MAX_WAV_BYTES || !validWav(buffer))
        return failWorker(child, failure(CODE.UNAVAILABLE, 'INVALID_WAV'));
    lastError = null;
    settlePending(null, { buffer, mime: 'audio/wav', provider: 'supertonic3.local' });
}
async function warm() {
    if (!installed()) return Promise.reject(failure(CODE.MISSING));
    if (ready && worker) return Promise.resolve();
    if (warmPromise) return warmPromise;
    const { modelDir } = config();
    if (verifiedDir !== modelDir) {
        if (!verificationPromise) verificationPromise = verifyModelAssets(modelDir)
            .then(() => { verifiedDir = modelDir; lastError = null; })
            .catch(error => { lastError = error.message; throw failure(CODE.UNAVAILABLE, error.message); })
            .finally(() => { verificationPromise = null; });
        await verificationPromise;
    }
    if (ready && worker) return;
    if (warmPromise) return warmPromise;
    const child = spawn(process.execPath, [path.join(__dirname, 'local-tts-worker.js')], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, GUNTER_LOCAL_TTS_MODEL_DIR: modelDir }
    });
    worker = child; lineBuffer = '';
    let stderr = '';
    warmPromise = new Promise((resolve, reject) => { warmResolve = resolve; warmReject = reject; });
    warmTimer = setTimeout(() => failWorker(child, failure(CODE.UNAVAILABLE, 'WARM_TIMEOUT')), 6000);
    child.stdout.on('data', data => {
        lineBuffer += data.toString('utf8');
        if (lineBuffer.length > MAX_LINE_BYTES) return failWorker(child, failure(CODE.UNAVAILABLE, 'OUTPUT_TOO_LARGE'));
        let newline;
        while ((newline = lineBuffer.indexOf('\n')) !== -1) {
            const line = lineBuffer.slice(0, newline);
            lineBuffer = lineBuffer.slice(newline + 1);
            try { handleMessage(child, JSON.parse(line)); }
            catch { failWorker(child, failure(CODE.UNAVAILABLE, 'INVALID_WORKER_MESSAGE')); }
        }
    });
    child.stderr.on('data', data => { stderr = (stderr + data.toString('utf8')).slice(-1000); });
    child.stdin.on('error', () => {});
    child.once('error', error => failWorker(child, failure(CODE.UNAVAILABLE, error.code || error.message)));
    child.once('close', code => failWorker(child, failure(CODE.UNAVAILABLE, stderr || `EXIT_${code}`)));
    return warmPromise;
}
function stop() { if (worker) failWorker(worker, abortError()); }
async function synthesizeSpeech({ text, speed = 1.05, signal } = {}) {
    if (!installed()) throw failure(CODE.MISSING);
    if (active) throw failure(CODE.BUSY);
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT)
        throw failure('LOCAL_TTS_INVALID_TEXT');
    if (!Number.isFinite(speed) || speed < 0.75 || speed > 1.35)
        throw failure('LOCAL_TTS_INVALID_SPEED');
    if (signal?.aborted) throw abortError();
    active = true;
    const abortWarm = () => { if (!ready && worker) failWorker(worker, abortError()); };
    signal?.addEventListener('abort', abortWarm, { once: true });
    try {
        await warm();
        signal?.removeEventListener('abort', abortWarm);
        if (signal?.aborted) throw abortError();
        return await new Promise((resolve, reject) => {
            const child = worker, id = ++nextId;
            const abort = () => failWorker(child, abortError());
            const timer = setTimeout(() => failWorker(child, failure(CODE.UNAVAILABLE, 'SYNTH_TIMEOUT')), 12000);
            pending = { id, resolve, reject, signal, abort, timer };
            signal?.addEventListener('abort', abort, { once: true });
            child.stdin.write(JSON.stringify({ id, text, speed }) + '\n', error => {
                if (error) failWorker(child, failure(CODE.UNAVAILABLE, error.code || error.message));
            });
        });
    } finally {
        signal?.removeEventListener('abort', abortWarm);
        active = false;
    }
}

process.once('exit', () => { if (worker) worker.kill(); });
module.exports = { CODE, installed, snapshot, warm, stop, synthesizeSpeech };
