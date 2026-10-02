/* Gunter Control Plane — atomic persistence isolated from the web root. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_ROOT = path.join(process.env.GUNTER_DATA_DIR || path.join(__dirname, '..', '..', 'data'), 'control-plane');

function rootDir() {
    return path.resolve(process.env.GUNTER_CONTROL_DATA_DIR || DEFAULT_ROOT);
}

function ensureRoot() {
    const root = rootDir();
    if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    return root;
}

function target(name) {
    const safe = String(name || '').replace(/[^a-zA-Z0-9_.-]/g, '_');
    if (!safe) throw new Error('control_store_name_required');
    return path.join(ensureRoot(), safe);
}

function loadJson(name, fallback) {
    try {
        const file = target(name);
        if (!fs.existsSync(file)) return structuredCloneSafe(fallback);
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        console.warn(`[control/persistence] read ${name}:`, error.message);
        return structuredCloneSafe(fallback);
    }
}

function saveJson(name, value) {
    const file = target(name);
    const temp = path.join(path.dirname(file), `.${path.basename(file)}-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    try {
        fs.renameSync(temp, file);
    } catch {
        fs.copyFileSync(temp, file);
        fs.unlinkSync(temp);
    }
    return value;
}

function appendJsonl(name, value) {
    fs.appendFileSync(target(name), `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function readJsonl(name, { limit = 200, filter = null } = {}) {
    try {
        const file = target(name);
        if (!fs.existsSync(file)) return [];
        let rows = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
        if (filter) rows = rows.filter(line => line.includes(filter));
        return rows.slice(-Math.max(1, Math.min(Number(limit) || 200, 1000)))
            .map(line => { try { return JSON.parse(line); } catch { return null; } })
            .filter(Boolean);
    } catch (error) {
        console.warn(`[control/persistence] jsonl ${name}:`, error.message);
        return [];
    }
}

function getOrCreateSecret(name, bytes = 32) {
    const file = target(name);
    try {
        if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
        const secret = crypto.randomBytes(bytes).toString('base64url');
        fs.writeFileSync(file, secret, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        return secret;
    } catch (error) {
        if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
        throw error;
    }
}

function hash(value) {
    return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function structuredCloneSafe(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

module.exports = { rootDir, ensureRoot, target, loadJson, saveJson, appendJsonl, readJsonl, getOrCreateSecret, hash };
