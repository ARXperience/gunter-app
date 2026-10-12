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
        // Si el reemplazo atómico falla (p. ej. archivo bloqueado en Windows),
        // conservar el original: copiar sobre él podría dejar JSON parcial.
        fs.renameSync(temp, target);
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
        cancelledAt: null,
        revision: 1
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
    jobs[index] = { ...jobs[index], ...patch, id: jobs[index].id, updatedAt: new Date().toISOString(), revision: revision(jobs[index]) + 1 };
    if (!saveAll(jobs)) throw new Error('No se pudo actualizar el proceso.');
    return jobs[index];
}

function revision(job) {
    return Number.isSafeInteger(job?.revision) && job.revision >= 0 ? job.revision : 0;
}

function snapshot(job) {
    if (!job) return null;
    return {
        id: job.id, type: job.type, title: job.title, runAt: job.runAt,
        priority: job.priority, status: job.status, updatedAt: job.updatedAt,
        revision: revision(job)
    };
}

function validSnapshot(expected) {
    const keys = ['id', 'type', 'title', 'runAt', 'priority', 'status', 'updatedAt', 'revision'];
    return Boolean(expected && typeof expected === 'object' && !Array.isArray(expected)
        && Object.keys(expected).length === keys.length && keys.every(key => Object.hasOwn(expected, key))
        && keys.slice(0, -1).every(key => typeof expected[key] === 'string')
        && Number.isSafeInteger(expected.revision) && expected.revision >= 0);
}

function editableReminder(job) {
    return job?.type === 'reminder' && job.status === 'scheduled' && Number(job.attempts || 0) === 0
        && !job.payload?.eventLink && !job.payload?.meta?.eventLink;
}

// Una única lectura/check/escritura síncrona evita sobreescribir otra pestaña
// o una transición del scheduler entre la validación y la persistencia.
function updateReminder(id, expected, patch, deriveDedupe) {
    if (!validSnapshot(expected)) return { ok: false, error: 'job_snapshot_required' };
    const jobs = loadAll();
    const index = jobs.findIndex(job => job.id === id);
    if (index === -1) return { ok: false, error: 'job_not_found' };
    const current = jobs[index];
    if (!editableReminder(current)) return { ok: false, error: 'job_not_editable' };
    if (JSON.stringify(snapshot(current)) !== JSON.stringify(snapshot(expected))) {
        return { ok: false, error: 'job_changed' };
    }
    const next = { ...current, ...patch };
    if (current.dedupeKey === deriveDedupe(current.type, current.title, new Date(current.runAt))) {
        next.dedupeKey = deriveDedupe(next.type, next.title, new Date(next.runAt));
    }
    const duplicate = jobs.some(job => job.id !== current.id
        && ['scheduled', 'retry_wait', 'running'].includes(job.status)
        && ((next.dedupeKey && job.dedupeKey === next.dedupeKey)
            || (job.type === next.type && job.title.toLowerCase() === next.title.toLowerCase()
                && new Date(job.runAt).getTime() === new Date(next.runAt).getTime())));
    if (duplicate) return { ok: false, error: 'job_duplicate' };
    next.id = current.id;
    next.updatedAt = new Date().toISOString();
    next.revision = revision(current) + 1;
    jobs[index] = next;
    if (!saveAll(jobs)) return { ok: false, error: 'job_persist_failed' };
    return { ok: true, job: next };
}

// El reintento confirmado es una transición del mismo registro, no un job nuevo.
// Releer/CAS/persistir sin awaits conserva la atomicidad frente al scheduler.
function retryReminder(id, expected, deriveDedupe) {
    if (!validSnapshot(expected) || expected.id !== id || expected.type !== 'reminder'
        || expected.status !== 'failed') return { ok: false, error: 'job_snapshot_required' };
    const jobs = loadAll();
    const index = jobs.findIndex(job => job.id === id);
    if (index === -1) return { ok: false, error: 'job_not_found' };
    const current = jobs[index];
    if (current.type !== 'reminder' || current.status !== 'failed'
        || current.payload?.eventLink || current.payload?.meta?.eventLink) {
        return { ok: false, error: 'job_not_retryable' };
    }
    if (JSON.stringify(snapshot(current)) !== JSON.stringify(snapshot(expected))) {
        return { ok: false, error: 'job_changed' };
    }
    const previousDate = new Date(current.runAt);
    if (typeof current.title !== 'string' || current.title.trim().length < 2
        || current.title.length > 180 || !Number.isFinite(previousDate.getTime())) {
        return { ok: false, error: 'job_not_retryable' };
    }
    const timestamp = new Date().toISOString();
    const next = {
        ...current, status: 'scheduled', attempts: 0, runAt: timestamp,
        nextAttemptAt: null, lastError: null, result: null,
        startedAt: null, completedAt: null, cancelledAt: null,
        lastFailure: {
            attempts: Number(current.attempts || 0), lastError: current.lastError || null,
            runAt: current.runAt, failedAt: current.updatedAt, retriedAt: timestamp
        },
        updatedAt: timestamp, revision: revision(current) + 1
    };
    if (current.dedupeKey === deriveDedupe(current.type, current.title, previousDate)) {
        next.dedupeKey = deriveDedupe(next.type, next.title, new Date(next.runAt));
    }
    const duplicate = jobs.some(job => job.id !== current.id
        && ['scheduled', 'retry_wait', 'running'].includes(job.status)
        && ((current.dedupeKey && job.dedupeKey === current.dedupeKey)
            || (next.dedupeKey && job.dedupeKey === next.dedupeKey)
            || (job.type === current.type && typeof job.title === 'string'
                && job.title.toLowerCase() === current.title.toLowerCase()
                && [previousDate.getTime(), new Date(next.runAt).getTime()].includes(new Date(job.runAt).getTime()))));
    if (duplicate) return { ok: false, error: 'job_duplicate' };
    jobs[index] = next;
    if (!saveAll(jobs)) return { ok: false, error: 'job_persist_failed' };
    return { ok: true, job: next };
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

module.exports = { add, get, update, updateReminder, retryReminder, snapshot, validSnapshot, list, cancel, clear, _loadAll: loadAll, _saveAll: saveAll };
