/* Optional, text-only LocalBrain. Gunter owns the loopback process; the model never dispatches actions. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const manifest = require('./models/ministral-3-3b-instruct-2512.json');
const PROPOSAL_SCHEMA = Object.freeze({ type: 'object', properties: {
    intent: { type: 'string', enum: ['answer', 'propose', 'clarify', 'refuse', 'confirm', 'recover'] },
    tool: { type: 'string', enum: ['none', 'add_task', 'navigate', 'set_setting', 'send_message'] },
    args: { type: 'object' }, answer: { type: 'string' }
}, required: ['intent', 'tool', 'args', 'answer'], additionalProperties: false });

const state = { child: null, token: null, port: null, ready: false, verified: false, error: null,
    starting: null, model: null, startedAt: null };
const CODE = Object.freeze({ MISSING: 'LOCAL_MODEL_NOT_INSTALLED', UNAVAILABLE: 'LOCAL_PROVIDER_UNAVAILABLE' });
function failure(code, cause) { return Object.assign(new Error(code), { code, cause }); }
function localConfig() {
    try {
        const file = path.join(process.env.GUNTER_DATA_DIR || path.join(__dirname, '..', 'data'), 'local-brain.json');
        const value = JSON.parse(fs.readFileSync(file, 'utf8'));
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch { return {}; }
}
function modelPath() { return process.env.GUNTER_LOCAL_MODEL_PATH || localConfig().modelPath || ''; }
function runtimePath() { return process.env.GUNTER_LLAMA_SERVER_PATH || localConfig().runtimePath || ''; }
function validFile(file, extension) {
    if (!file || !path.isAbsolute(file)) return false;
    try {
        const real = fs.realpathSync(file);
        const appRoot = path.resolve(__dirname, '..') + path.sep;
        return !real.toLowerCase().startsWith(appRoot.toLowerCase()) &&
            real.toLowerCase().endsWith(extension) && fs.statSync(real).isFile();
    } catch { return false; }
}
function installed() { return validFile(modelPath(), '.gguf'); }
function snapshot() {
    return { localBrainInstalled: installed(), localBrainRuntimeAvailable: validFile(runtimePath(), '.exe'),
        localBrainReady: state.ready && !!state.child && state.child.exitCode === null,
        localBrainModel: state.ready ? manifest.id : null, localBrainError: state.error,
        pid: state.child?.pid || null };
}
async function verifyModel() {
    if (!installed()) throw failure(CODE.MISSING);
    const file = fs.realpathSync(modelPath());
    const stat = fs.statSync(file);
    if (stat.size !== manifest.size) throw failure(CODE.UNAVAILABLE, 'MODEL_SIZE_MISMATCH');
    if (state.verified && state.model === file && state.modelMtime === stat.mtimeMs) return file;
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    if (hash.digest('hex') !== manifest.sha256) throw failure(CODE.UNAVAILABLE, 'MODEL_SHA256_MISMATCH');
    state.verified = true; state.model = file; state.modelMtime = stat.mtimeMs;
    return file;
}
function randomPort() { return 20000 + crypto.randomInt(30000); }
function portAvailable(port) {
    return new Promise(resolve => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
}
async function probe() {
    if (!state.child || state.child.exitCode !== null || !state.port) return false;
    try {
        const response = await fetch(`http://127.0.0.1:${state.port}/v1/models`, {
            headers: { Authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(1500) });
        if (!response.ok) return false;
        const data = await response.json();
        const found = data.data?.some(item => item.id === manifest.apiAlias);
        state.ready = !!found;
        if (!found) state.error = 'WRONG_LOCAL_MODEL';
        return !!found;
    } catch { state.ready = false; return false; }
}
async function start() {
    if (state.starting) return state.starting;
    state.starting = (async () => {
        if (state.ready && state.child?.exitCode === null) return snapshot();
        if (state.child?.exitCode === null) {
            const old = state.child; old.kill();
            await new Promise(resolve => { old.once('exit', resolve); setTimeout(resolve, 3000); });
        }
        const file = await verifyModel();
        if (!validFile(runtimePath(), '.exe')) throw failure(CODE.UNAVAILABLE, 'RUNTIME_NOT_FOUND');
        state.error = null; state.ready = false;
        state.port = Number(process.env.GUNTER_LOCAL_PORT) || randomPort();
        if (!Number.isInteger(state.port) || state.port < 1024 || state.port > 65535) throw failure(CODE.UNAVAILABLE, 'INVALID_PORT');
        if (!await portAvailable(state.port)) throw failure(CODE.UNAVAILABLE, 'RUNTIME_PORT_BUSY');
        state.token = crypto.randomBytes(32).toString('hex');
        const args = ['--model', file, '--alias', manifest.apiAlias, '--host', '127.0.0.1', '--port', String(state.port),
            '--ctx-size', '4096', '--threads', String(Number(process.env.GUNTER_LOCAL_THREADS) || 6),
            '--threads-batch', String(Number(process.env.GUNTER_LOCAL_THREADS) || 6), '--batch-size', '512',
            '--parallel', '1', '--no-webui', '--no-mmproj', '--offline'];
        const child = spawn(fs.realpathSync(runtimePath()), args, { windowsHide: true,
            env: { ...process.env, LLAMA_API_KEY: state.token }, stdio: ['ignore', 'ignore', 'pipe'] });
        state.child = child; state.startedAt = Date.now();
        let recentError = '';
        child.stderr.on('data', chunk => { recentError = (recentError + String(chunk)).slice(-2000); });
        child.on('error', error => { state.ready = false; state.error = `RUNTIME_START_FAILED:${error.code || 'unknown'}`; });
        child.on('exit', () => { if (state.child === child) { state.ready = false;
            state.error = state.error || `RUNTIME_EXITED:${recentError.slice(-120)}`; } });
        const deadline = Date.now() + 45000;
        while (Date.now() < deadline) {
            if (child.exitCode !== null) break;
            if (await probe()) return snapshot();
            await new Promise(resolve => setTimeout(resolve, 300));
        }
        child.kill(); state.ready = false;
        throw failure(CODE.UNAVAILABLE, state.error || 'RUNTIME_START_TIMEOUT_OR_PORT_BUSY');
    })().catch(error => { state.error = error.cause || error.code || 'RUNTIME_FAILED'; throw error; })
        .finally(() => { state.starting = null; });
    return state.starting;
}
async function health() {
    if (state.ready) await probe();
    return snapshot();
}
function stop() {
    const child = state.child;
    state.child = null; state.ready = false; state.token = null; state.port = null;
    if (child && child.exitCode === null) child.kill();
    return snapshot();
}
process.once('exit', () => { if (state.child?.exitCode === null) state.child.kill(); });
async function restart() {
    const old = state.child;
    stop();
    if (old?.exitCode === null) await new Promise(resolve => { old.once('exit', resolve); setTimeout(resolve, 3000); });
    return start();
}
async function request(payload, signal) {
    await start();
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) throw Object.assign(new Error('AbortError'), { name: 'AbortError' });
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 90000);
    try {
        const response = await fetch(`http://127.0.0.1:${state.port}/v1/chat/completions`, {
            method: 'POST', headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payload, model: manifest.apiAlias, max_tokens: Math.min(Number(payload.max_tokens) || 400, 2048) }),
            signal: controller.signal });
        if (!response.ok) throw failure(CODE.UNAVAILABLE, `RUNTIME_HTTP_${response.status}`);
        return { response, cleanup: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); } };
    } catch (error) {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (signal?.aborted) throw Object.assign(new Error('AbortError'), { name: 'AbortError' });
        state.ready = false; state.error = 'RUNTIME_REQUEST_FAILED';
        throw error.code ? error : failure(CODE.UNAVAILABLE, error.message);
    }
}
async function generate(payload, signal) {
    const { response, cleanup } = await request({ ...payload, stream: false }, signal);
    try { return await response.json(); }
    finally { cleanup(); }
}
async function stream(payload, signal) { return request({ ...payload, stream: true }, signal); }
function validateProposal(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        !PROPOSAL_SCHEMA.properties.intent.enum.includes(value.intent) ||
        !PROPOSAL_SCHEMA.properties.tool.enum.includes(value.tool) ||
        !value.args || typeof value.args !== 'object' || Array.isArray(value.args) ||
        typeof value.answer !== 'string') return { ok: false, code: 'INVALID_LOCAL_PROPOSAL' };
    if (value.tool === 'add_task' && (typeof value.args.title !== 'string' || !value.args.title.trim() || value.args.title.length > 120))
        return { ok: false, code: 'INVALID_LOCAL_PROPOSAL' };
    if (value.tool === 'navigate' && !['inicio', 'conversaciones', 'reuniones', 'tareas', 'agenda', 'recordatorios', 'actividad', 'resultados', 'conexiones', 'configuracion'].includes(value.args.target))
        return { ok: false, code: 'INVALID_LOCAL_PROPOSAL' };
    if (value.tool === 'set_setting' && (typeof value.args.key !== 'string' || typeof value.args.value !== 'boolean'))
        return { ok: false, code: 'INVALID_LOCAL_PROPOSAL' };
    if (value.tool === 'send_message' && (typeof value.args.recipient !== 'string' || typeof value.args.text !== 'string' || value.intent !== 'confirm'))
        return { ok: false, code: 'CONFIRMATION_REQUIRED' };
    return { ok: true, proposal: value, executed: false, requiresPermissionGate: value.tool !== 'none' };
}
async function propose(messages, signal) {
    const proposalSystem = `Eres Gunter, planificador aislado. Devuelve SOLO JSON con cuatro campos: intent, tool, args, answer. No ejecutas herramientas ni afirmas haber completado acciones. Herramientas permitidas: none, add_task, navigate, set_setting, send_message. Para crear tarea: intent propose, tool add_task, args.title exacto. Para enviar mensajes: intent confirm, tool send_message y pide confirmación. Ante ambigüedad: clarify/none. Ejemplo: 'Crea una tarea llamada Comprar cuaderno' -> {"intent":"propose","tool":"add_task","args":{"title":"Comprar cuaderno"},"answer":"Puedo crear esa tarea."}. Sin markdown.`;
    const response = await generate({ messages: [{ role: 'system', content: proposalSystem },
        ...messages.filter(message => message?.role !== 'system')], temperature: 0, max_tokens: 120,
        response_format: { type: 'json_schema', schema: PROPOSAL_SCHEMA } }, signal);
    let value;
    try { value = JSON.parse(response.choices?.[0]?.message?.content || ''); }
    catch { return { ok: false, code: 'INVALID_LOCAL_PROPOSAL' }; }
    return validateProposal(value);
}
module.exports = { manifest, CODE, PROPOSAL_SCHEMA, installed, snapshot, verifyModel, start, health,
    stop, restart, generate, stream, validateProposal, propose };
