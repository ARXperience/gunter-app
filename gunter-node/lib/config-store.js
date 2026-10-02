const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function rootDir() {
    if (process.env.GUNTER_NODE_HOME) return path.resolve(process.env.GUNTER_NODE_HOME);
    const base = process.env.APPDATA || path.join(os.homedir(), '.config');
    return path.join(base, 'Gunter', 'Node');
}

function ensureRoot() {
    const root = rootDir();
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    return root;
}

function keyFile() { return path.join(ensureRoot(), 'device.key'); }
function configFile() { return path.join(ensureRoot(), 'config.enc'); }

function deviceKey() {
    const file = keyFile();
    if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32), { mode: 0o600, flag: 'wx' });
    const key = fs.readFileSync(file);
    if (key.length !== 32) throw new Error('gunter_node_device_key_invalid');
    return key;
}

function load() {
    const file = configFile();
    if (!fs.existsSync(file)) return {};
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    const decipher = crypto.createDecipheriv('aes-256-gcm', deviceKey(), Buffer.from(payload.iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(payload.tag, 'base64url'));
    const clear = Buffer.concat([decipher.update(Buffer.from(payload.value, 'base64url')), decipher.final()]);
    return JSON.parse(clear.toString('utf8'));
}

function save(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', deviceKey(), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    const payload = { version: 1, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), value: encrypted.toString('base64url') };
    const file = configFile();
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, file);
    return value;
}

function patch(values) { return save({ ...load(), ...values, updatedAt: new Date().toISOString() }); }
function clear() { const file = configFile(); if (fs.existsSync(file)) fs.unlinkSync(file); }
function publicConfig(value = load()) {
    return {
        paired: Boolean(value.nodeToken && value.nodeId), serverUrl: value.serverUrl || null,
        nodeId: value.nodeId || null, deviceName: value.deviceName || null,
        beeperConfigured: Boolean(value.beeperToken), allowedFolders: value.allowedFolders || [],
        filesystemScope: value.fullFilesystemAccess ? 'all' : 'standard',
        programScope: value.fullProgramAccess ? 'all' : 'standard',
        updatedAt: value.updatedAt || null
    };
}

module.exports = { rootDir, load, save, patch, clear, publicConfig };
