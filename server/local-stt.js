/* Experimental, transcription-only Moonshine sidecar. No model is bundled or fetched here. */
'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const manifest = require('./models/moonshine-small-streaming-es.json');

const MAX_INPUT_BYTES = 30 * 1024 * 1024;
const MAX_DURATION_SECONDS = 120;
const MAX_OUTPUT_BYTES = MAX_DURATION_SECONDS * 16000 * 2 + 4096;
const MIME = Object.freeze({
    'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/wav': '.wav',
    'audio/x-wav': '.wav', 'audio/mpeg': '.mp3', 'audio/mp3': '.mp3',
    'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a'
});
const CODE = Object.freeze({ MISSING: 'LOCAL_STT_NOT_INSTALLED', UNAVAILABLE: 'LOCAL_STT_UNAVAILABLE',
    INVALID: 'LOCAL_STT_INVALID_AUDIO', TOO_LARGE: 'LOCAL_STT_AUDIO_TOO_LARGE', BUSY: 'LOCAL_STT_BUSY' });
const state = { ready: false, error: null, verifiedModel: null, verifiedRuntime: null,
    lastHealth: 0, active: null, checking: null, busy: false, generation: 0 };
function failure(code, cause) { return Object.assign(new Error(code), { code, cause }); }
function config() {
    try {
        const file = path.join(process.env.GUNTER_DATA_DIR || path.join(__dirname, '..', 'data'), 'local-stt.json');
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
}
function modelDir() { return process.env.GUNTER_LOCAL_STT_MODEL_DIR || config().modelDir || ''; }
function runtimeDir() {
    const configured = process.env.GUNTER_LOCAL_STT_RUNTIME_DIR || config().runtimeDir;
    return configured ? (path.isAbsolute(configured) ? configured : '') : path.join(__dirname, '..', 'native', 'moonshine');
}
function runtimePath() { return path.join(runtimeDir(), 'transcriber.exe'); }
function ffmpegPath() { try { return require('ffmpeg-static'); } catch { return null; } }
function modelFiles() {
    const dir = modelDir();
    if (!dir || !path.isAbsolute(dir)) return null;
    try {
        const real = fs.realpathSync(dir);
        if (!fs.statSync(real).isDirectory()) return null;
        for (const [name, entry] of Object.entries(manifest.files)) {
            const file = path.join(real, name);
            if (!fs.statSync(file).isFile() || fs.statSync(file).size !== entry.size) return null;
        }
        return real;
    } catch { return null; }
}
function installed() { return !!modelFiles(); }
function runtimeAvailable() {
    if (process.platform !== 'win32' || !ffmpegPath() || !runtimeDir()) return false;
    try { if (!fs.statSync(ffmpegPath()).isFile()) return false; } catch { return false; }
    return Object.keys(manifest.runtimeFiles).every(name => {
        try { return fs.statSync(path.join(runtimeDir(), name)).isFile(); } catch { return false; }
    });
}
function snapshot() {
    return { localSTTInstalled: installed(), localSTTRuntimeAvailable: runtimeAvailable(),
        localSTTReady: state.ready && installed() && runtimeAvailable(),
        localSTTModel: state.ready ? manifest.id : null, localSTTError: state.error };
}
async function hashFile(file) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
}
async function verify() {
    const dir = modelFiles();
    if (!dir) throw failure(CODE.MISSING, 'MODEL_FILES_MISSING');
    if (!runtimeAvailable()) throw failure(CODE.UNAVAILABLE, 'NATIVE_RUNTIME_OR_FFMPEG_MISSING');
    const identity = Object.keys(manifest.files).map(name => {
        const s = fs.statSync(path.join(dir, name));
        return `${name}:${s.size}:${s.mtimeMs}`;
    }).join('|');
    if (state.verifiedModel !== `${dir}|${identity}`) {
        for (const [name, entry] of Object.entries(manifest.files)) {
            if (await hashFile(path.join(dir, name)) !== entry.sha256)
                throw failure(CODE.UNAVAILABLE, `MODEL_SHA256_MISMATCH:${name}`);
        }
        state.verifiedModel = `${dir}|${identity}`;
    }
    const runtimeIdentity = Object.keys(manifest.runtimeFiles).map(name => {
        const s = fs.statSync(path.join(runtimeDir(), name));
        return `${name}:${s.size}:${s.mtimeMs}`;
    }).join('|');
    if (state.verifiedRuntime !== `${runtimeDir()}|${runtimeIdentity}`) {
        for (const [name, expected] of Object.entries(manifest.runtimeFiles)) {
            if (await hashFile(path.join(runtimeDir(), name)) !== expected)
                throw failure(CODE.UNAVAILABLE, `RUNTIME_SHA256_MISMATCH:${name}`);
        }
        state.verifiedRuntime = `${runtimeDir()}|${runtimeIdentity}`;
    }
    return dir;
}
function abortError() { return Object.assign(new Error('AbortError'), { name: 'AbortError' }); }
function run(executable, args, { signal, timeoutMs, maxStdout = 65536 } = {}) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(abortError());
        const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], cwd: runtimeDir() });
        state.active = child;
        let stdout = '', stderr = '', settled = false, cancelled = null;
        const abort = () => { cancelled = abortError(); child.kill(); };
        const timer = setTimeout(() => { cancelled = failure(CODE.UNAVAILABLE, 'RUNTIME_TIMEOUT'); child.kill(); }, timeoutMs);
        function finish(error, value) {
            if (settled) return;
            settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
            if (state.active === child) state.active = null;
            if (error) reject(error); else resolve(value);
        }
        signal?.addEventListener('abort', abort, { once: true });
        child.stdout.on('data', data => {
            stdout += data.toString('utf8');
            if (stdout.length > maxStdout) { cancelled = failure(CODE.UNAVAILABLE, 'RUNTIME_OUTPUT_LIMIT'); child.kill(); }
        });
        child.stderr.on('data', data => { stderr = (stderr + data.toString('utf8')).slice(-4096); });
        child.once('error', error => finish(failure(CODE.UNAVAILABLE, error.code || error.message)));
        child.once('close', code => finish(cancelled || (code === 0 ? null : failure(CODE.UNAVAILABLE, `RUNTIME_EXIT_${code}:${stderr.slice(-200)}`)), stdout));
    });
}
function wavSilence() {
    const samples = 16000;
    const data = Buffer.alloc(44 + samples * 2);
    data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
    data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
    data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28);
    data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
    data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
    return data;
}
async function probe() {
    if (state.busy) return snapshot();
    state.busy = true;
    const generation = state.generation;
    let tmp;
    try {
        const dir = await verify();
        if (generation !== state.generation) throw failure(CODE.UNAVAILABLE, 'RUNTIME_STOPPED');
        await run(ffmpegPath(), ['-version'], { timeoutMs: 5000, maxStdout: 4096 });
        tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'gunter-stt-health-'));
        const wav = path.join(tmp, 'silence.wav');
        await fsp.writeFile(wav, wavSilence());
        const out = await run(runtimePath(), ['--model-path', dir, '--model-arch', '4', '--wav-path', wav, '--transcription-interval', '0.1'], { timeoutMs: 15000 });
        if (generation !== state.generation) throw failure(CODE.UNAVAILABLE, 'RUNTIME_STOPPED');
        if (/^TRANSCRIPT_LINE\t/m.test(out)) throw failure(CODE.UNAVAILABLE, 'VAD_SILENCE_FALSE_POSITIVE');
        state.ready = true; state.error = null; state.lastHealth = Date.now();
        return snapshot();
    } finally {
        try { if (tmp) await fsp.rm(tmp, { recursive: true, force: true }); }
        finally { state.busy = false; }
    }
}
async function health() {
    if (state.active) return snapshot();
    if (state.ready && Date.now() - state.lastHealth < 30000) return snapshot();
    if (!state.checking) state.checking = probe().catch(error => {
        state.ready = false; state.error = error.cause || error.code || 'RUNTIME_FAILED'; return snapshot();
    }).finally(() => { state.checking = null; });
    return state.checking;
}
function stop() { state.generation++; if (state.active) state.active.kill(); state.ready = false; state.lastHealth = 0; return snapshot(); }
async function restart() {
    stop();
    const deadline = Date.now() + 5000;
    while (state.busy && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
    if (state.busy) throw failure(CODE.UNAVAILABLE, 'RUNTIME_STOP_TIMEOUT');
    return health();
}
async function transcribeAudio(data, mime, { signal } = {}) {
    if (state.busy) throw failure(CODE.BUSY);
    if (!Buffer.isBuffer(data) || !data.length) throw failure(CODE.INVALID, 'AUDIO_EMPTY');
    if (data.length > MAX_INPUT_BYTES) throw failure(CODE.TOO_LARGE);
    const extension = MIME[String(mime || '').toLowerCase().split(';')[0].trim()];
    if (!extension) throw failure(CODE.INVALID, 'AUDIO_FORMAT_UNSUPPORTED');
    state.busy = true;
    const generation = state.generation;
    let temp;
    try {
        const dir = await verify();
        if (generation !== state.generation) throw failure(CODE.UNAVAILABLE, 'RUNTIME_STOPPED');
        temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'gunter-stt-audio-'));
        const input = path.join(temp, `input${extension}`);
        const output = path.join(temp, 'normalized.wav');
        await fsp.writeFile(input, data);
        try {
            await run(ffmpegPath(), ['-hide_banner', '-loglevel', 'error', '-nostdin', '-protocol_whitelist', 'file,pipe',
                '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-t', String(MAX_DURATION_SECONDS + 1),
                '-f', 'wav', output], { signal, timeoutMs: 30000, maxStdout: 1024 });
        } catch (error) {
            if (generation !== state.generation) throw failure(CODE.UNAVAILABLE, 'RUNTIME_STOPPED');
            if (error.name === 'AbortError' || error.cause === 'RUNTIME_TIMEOUT') throw error;
            throw failure(CODE.INVALID, 'AUDIO_DECODE_FAILED');
        }
        if (generation !== state.generation) throw failure(CODE.UNAVAILABLE, 'RUNTIME_STOPPED');
        const converted = await fsp.stat(output);
        if (converted.size < 100) throw failure(CODE.INVALID, 'AUDIO_EMPTY');
        if (converted.size > MAX_OUTPUT_BYTES) throw failure(CODE.TOO_LARGE, 'DURATION_LIMIT');
        const stdout = await run(runtimePath(), ['--model-path', dir, '--model-arch', '4', '--wav-path', output,
            '--transcription-interval', '0.1'], { signal, timeoutMs: 90000 });
        if (generation !== state.generation) throw failure(CODE.UNAVAILABLE, 'RUNTIME_STOPPED');
        const text = stdout.split(/\r?\n/).filter(line => line.startsWith('TRANSCRIPT_LINE\t'))
            .map(line => line.slice('TRANSCRIPT_LINE\t'.length)).join(' ').trim();
        state.ready = true; state.error = null; state.lastHealth = Date.now();
        return text;
    } catch (error) {
        if (error.name !== 'AbortError') { state.ready = false; state.error = error.cause || error.code || 'RUNTIME_FAILED'; }
        throw error;
    } finally {
        try { if (temp) await fsp.rm(temp, { recursive: true, force: true }); }
        finally { state.busy = false; }
    }
}
process.once('exit', () => { if (state.active) state.active.kill(); });
module.exports = { manifest, CODE, installed, snapshot, verify, health, stop, restart, transcribeAudio };
