/* =============================================
   GUNTER — Durable Jobs Store
   -------------------------------------------------
   Persistencia por usuario para recordatorios y
   seguimientos que sobreviven al cierre del navegador.
   ============================================= */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const userStore = require('../user-store');

function filePath() { return userStore.userFile('jobs.json'); }

function loadAll() {
    try {
        const target = filePath();
        if (!fs.existsSync(target)) return [];
        const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
        return Array.isArray(parsed) ? parsed : (Array.isArray(parsed.jobs) ? parsed.jobs : []);
    } catch (error) {
        console.warn('[jobs/store] load:', error.message);
        return [];
    }
}

function saveAll(jobs) {
    const target = filePath();
    const temp = path.join(path.dirname(target), `.jobs-${process.pid}-${Date.now()}.tmp`);
    try {
        fs.writeFileSync(temp, JSON.stringify({ jobs, savedAt: new Date().toISOString() }, null, 2), {
            encoding: 'utf8', mode: 0o600
        });
        try {
            fs.renameSync(temp, target);
        } catch (renameError) {
            // Windows no siempre permite reemplazar un archivo existente con renameSync.
            fs.copyFileSync(temp, target);
            fs.unlinkSync(temp);
        }
        return true;
    } catch (error) {
        try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch { /* noop */ }
        console.warn('[jobs/store] save:', error.message);
        return false;
    }
}

function newId() {
    return `job_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function add(input) {
    const jobs = loadAll();
    if (input.dedupeKey) {
        const duplicate = jobs.find(job =>
            job.dedupeKey === input.dedupeKey &&
            ['scheduled', 'retry_wait', 'running'].includes(job.status)
        );
        if (duplicate) return { job: duplicate, duplicate: true };
    }
    const timestamp = new Date().toISOString();
    const job = {
        id: input.id || newId(),
        type: input.type,
        title: input.title,
        runAt: input.runAt,
        payload: input.payload || {},
        priority: input.priority || 'normal',
        status: 'scheduled',
        attempts: 0,
        maxAttempts: input.maxAttempts || 3,
        nextAttemptAt: null,
        lastError: null,
        result: null,
        dedupeKey: input.dedupeKey || null,
        createdAt: timestamp,
        updatedAt: timestamp,
        startedAt: null,
        completedAt: null,
        cancelledAt: null
    };
    jobs.push(job);
    if (!saveAll(jobs)) throw new Error('No se pudo persistir el proceso.');
    return { job, duplicate: false };
}

function get(id) {
    return loadAll().find(job => job.id === id) || null;
}

function update(id, patch = {}) {
    const jobs = loadAll();
    const index = jobs.findIndex(job => job.id === id);
    if (index === -1) return null;
    jobs[index] = { ...jobs[index], ...patch, id: jobs[index].id, updatedAt: new Date().toISOString() };
    if (!saveAll(jobs)) throw new Error('No se pudo actualizar el proceso.');
    return jobs[index];
}

function list({ status = null, type = null, limit = 100 } = {}) {
    let jobs = loadAll();
    if (status) jobs = jobs.filter(job => job.status === status);
    if (type) jobs = jobs.filter(job => job.type === type);
    jobs.sort((a, b) => new Date(a.runAt) - new Date(b.runAt));
    return jobs.slice(0, Math.max(1, Math.min(Number(limit) || 100, 200)));
}

function cancel(id) {
    const current = get(id);
    if (!current) return { ok: false, reason: 'not_found' };
    if (['completed', 'failed', 'cancelled'].includes(current.status)) {
        return { ok: false, reason: 'terminal', job: current };
    }
    const job = update(id, { status: 'cancelled', cancelledAt: new Date().toISOString() });
    return { ok: true, job };
}

function clear() {
    if (!saveAll([])) throw new Error('No se pudo limpiar la cola.');
    return true;
}

module.exports = { add, get, update, list, cancel, clear, _loadAll: loadAll, _saveAll: saveAll };
