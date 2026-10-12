/* =============================================
   GUNTER — Durable Jobs Scheduler
   -------------------------------------------------
   Ejecuta recordatorios y seguimientos por usuario,
   con recuperación tras reinicio y reintentos.
   ============================================= */

const crypto = require('crypto');
const store = require('./store');
const proactiveStore = require('../proactive/store');
const userContext = require('../user-context');
const authStore = require('../auth/store');

const TYPES = new Set(['reminder', 'follow_up']);
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const DEFAULT_INTERVAL_MS = 5000;
let timer = null;
let ticking = false;

function validateCreate(params = {}) {
    const type = String(params.type || 'reminder');
    const title = String(params.title || '').trim();
    const date = new Date(params.runAt);
    if (!TYPES.has(type)) return { ok: false, error: 'type_invalid' };
    if (title.length < 2 || title.length > 180) return { ok: false, error: 'title_invalid' };
    if (!params.runAt || Number.isNaN(date.getTime())) return { ok: false, error: 'run_at_invalid' };
    const delta = date.getTime() - Date.now();
    if (delta < -60_000) return { ok: false, error: 'run_at_too_old' };
    if (delta > 366 * 24 * 3600 * 1000) return { ok: false, error: 'run_at_too_far' };
    const maxAttempts = Math.max(1, Math.min(Number(params.maxAttempts) || 3, 5));
    return {
        ok: true,
        value: {
            type,
            title,
            runAt: date.toISOString(),
            priority: ['low', 'normal', 'high', 'urgent'].includes(params.priority) ? params.priority : 'normal',
            payload: params.payload && typeof params.payload === 'object' && !Array.isArray(params.payload) ? params.payload : {},
            maxAttempts,
            dedupeKey: params.dedupeKey || defaultDedupe(type, title, date)
        }
    };
}

function defaultDedupe(type, title, date) {
    return crypto.createHash('sha256')
        .update(`${type}|${title.toLowerCase()}|${date.toISOString()}`)
        .digest('hex').slice(0, 24);
}

function create(params) {
    const validation = validateCreate(params);
    if (!validation.ok) return { ok: false, error: validation.error };
    const created = store.add(validation.value);
    return { ok: true, ...created };
}

function list(params = {}) {
    return store.list(params);
}

function get(id) {
    return store.get(String(id || ''));
}

function cancel(id) {
    return store.cancel(String(id || ''));
}

function explicitDate(value) {
    if (typeof value !== 'string') return null;
    const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
    if (!parts) return null;
    const [, year, month, day, hour, minute, second, offset] = parts;
    const calendar = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() !== Number(month) - 1
        || calendar.getUTCDate() !== Number(day) || Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59) return null;
    if (offset !== 'Z' && (Number(offset.slice(1, 3)) > 14 || Number(offset.slice(4)) > 59
        || (Number(offset.slice(1, 3)) === 14 && Number(offset.slice(4)) !== 0))) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function updateReminder(params = {}) {
    if (params.confirmed !== true) return { ok: false, error: 'job_confirmation_required' };
    if (userContext.contextKind() !== 'session' || typeof params.ownerId !== 'string'
        || !params.ownerId || params.ownerId !== userContext.currentUserId()) {
        return { ok: false, error: 'job_owner_mismatch' };
    }
    const patch = params.patch;
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length
        || Object.keys(patch).some(key => !['title', 'runAt'].includes(key))) return { ok: false, error: 'job_patch_invalid' };
    const normalized = {};
    if (Object.hasOwn(patch, 'title')) {
        if (typeof patch.title !== 'string' || patch.title.trim().length < 2 || patch.title.trim().length > 180) {
            return { ok: false, error: 'job_title_invalid' };
        }
        normalized.title = patch.title.trim();
    }
    if (!store.validSnapshot(params.expected)) return { ok: false, error: 'job_snapshot_required' };
    const date = explicitDate(Object.hasOwn(patch, 'runAt') ? patch.runAt : params.expected.runAt);
    if (!date) return { ok: false, error: 'job_run_at_invalid' };
    const delta = date.getTime() - Date.now();
    if (delta <= 0) return { ok: false, error: 'job_run_at_not_future' };
    if (delta > 366 * 24 * 3600 * 1000) return { ok: false, error: 'job_run_at_too_far' };
    if (Object.hasOwn(patch, 'runAt')) normalized.runAt = date.toISOString();
    try {
        return store.updateReminder(String(params.id || ''), params.expected, normalized, defaultDedupe);
    } catch (error) {
        return { ok: false, error: 'job_persist_failed' };
    }
}

function retry(id) {
    const current = get(id);
    if (!current) return { ok: false, reason: 'not_found' };
    if (current.status !== 'failed') return { ok: false, reason: 'not_failed', job: current };
    const job = store.update(id, {
        status: 'scheduled', attempts: 0, runAt: new Date().toISOString(),
        nextAttemptAt: null, lastError: null, completedAt: null
    });
    return { ok: true, job };
}

function retryReminder(params = {}) {
    if (!params || typeof params !== 'object' || Array.isArray(params)
        || Object.keys(params).some(key => !['id', 'ownerId', 'expected', 'confirmed'].includes(key))) {
        return { ok: false, error: 'job_params_invalid' };
    }
    if (params.confirmed !== true) return { ok: false, error: 'job_confirmation_required' };
    if (userContext.contextKind() !== 'session' || typeof params.ownerId !== 'string'
        || !params.ownerId || params.ownerId !== userContext.currentUserId()) {
        return { ok: false, error: 'job_owner_mismatch' };
    }
    if (typeof params.id !== 'string' || !params.id || params.id.length > 200
        || params.id !== params.id.trim() || /[\u0000-\u001f\u007f]/.test(params.id)) {
        return { ok: false, error: 'job_id_invalid' };
    }
    if (!store.validSnapshot(params.expected) || params.expected.id !== params.id
        || params.expected.type !== 'reminder' || params.expected.status !== 'failed') {
        return { ok: false, error: 'job_snapshot_required' };
    }
    try {
        return store.retryReminder(params.id, params.expected, defaultDedupe);
    } catch (error) {
        return { ok: false, error: 'job_persist_failed' };
    }
}

async function defaultExecutor(job) {
    const isReminder = job.type === 'reminder';
    const intervention = proactiveStore.add({
        type: isReminder ? 'scheduled_reminder' : 'scheduled_follow_up',
        severity: job.priority === 'urgent' || job.priority === 'high' ? 'high' : 'mid',
        title: isReminder ? `⏰ ${job.title}` : `🔁 Seguimiento: ${job.title}`,
        message: job.payload?.message || (isReminder
            ? `Recordatorio programado: ${job.title}`
            : `Es momento de continuar el seguimiento de ${job.title}.`),
        suggestedActions: isReminder
            ? [{ label: 'Marcar atendido', action: 'dismiss', payload: { jobId: job.id } }]
            : [{ label: 'Ver seguimiento', action: 'open_follow_up', payload: { jobId: job.id } }],
        payload: { ...job.payload, jobId: job.id },
        projectId: job.payload?.projectId || null,
        dedupeKey: `durable-job:${job.id}`
    });
    if (!intervention) throw new Error('No se pudo crear la intervención persistente.');
    let push = { attempted: 0, delivered: 0, outcomes: [] };
    try {
        push = await require('../push').deliver({
            title: isReminder ? 'Gunter · Recordatorio' : 'Gunter · Seguimiento',
            body: job.payload?.message || job.title,
            tag: `job:${job.id}`, priority: job.priority,
            url: '/day.html#reminders', data: { jobId: job.id, type: job.type }
        });
    } catch (error) {
        push = { attempted: 0, delivered: 0, outcomes: [], error: error.code || error.message };
    }
    return { interventionId: intervention.id, deliveredTo: push.delivered ? 'proactive-queue+web-push' : 'proactive-queue', push };
}

async function runDue(internal = {}) {
    const clock = internal._now ? new Date(internal._now) : new Date();
    const executor = internal._executor || defaultExecutor;
    const retryBaseMs = Math.max(10, Number(internal._retryBaseMs) || 30_000);
    const limit = Math.max(1, Math.min(Number(internal.limit) || 20, 50));
    const nowMs = clock.getTime();

    // Un proceso puede morir después de marcar running. Tras 60 s se recupera.
    for (const job of store.list({ status: 'running', limit: 200 })) {
        if (nowMs - new Date(job.updatedAt || job.startedAt || 0).getTime() >= 60_000) {
            store.update(job.id, { status: 'retry_wait', nextAttemptAt: clock.toISOString(), lastError: 'recovered_after_restart' });
        }
    }

    const due = store.list({ limit: 200 }).filter(job => {
        if (job.status === 'scheduled') return new Date(job.runAt).getTime() <= nowMs;
        if (job.status === 'retry_wait') return new Date(job.nextAttemptAt || job.runAt).getTime() <= nowMs;
        return false;
    }).slice(0, limit);

    const outcomes = [];
    for (const queued of due) {
        // Otra petición puede cancelar/reprogramar el siguiente job mientras
        // esperamos al anterior: nunca ejecutar el snapshot antiguo de due.
        const current = store.get(queued.id);
        const effectiveAt = current?.status === 'retry_wait' ? current.nextAttemptAt || current.runAt : current?.runAt;
        if (!current || !['scheduled', 'retry_wait'].includes(current.status)
            || !Number.isFinite(new Date(effectiveAt).getTime()) || new Date(effectiveAt).getTime() > nowMs) continue;
        const attempt = Number(current.attempts || 0) + 1;
        const running = store.update(current.id, {
            status: 'running', attempts: attempt, startedAt: clock.toISOString(), nextAttemptAt: null
        });
        try {
            const result = await executor(running);
            const completed = store.update(running.id, {
                status: 'completed', result: result || {}, completedAt: new Date().toISOString(), lastError: null
            });
            outcomes.push({ id: completed.id, status: completed.status, result: completed.result });
        } catch (error) {
            const exhausted = attempt >= Number(running.maxAttempts || 3);
            const delay = retryBaseMs * Math.pow(2, Math.max(0, attempt - 1));
            const failed = store.update(running.id, {
                status: exhausted ? 'failed' : 'retry_wait',
                lastError: String(error?.message || error),
                nextAttemptAt: exhausted ? null : new Date(clock.getTime() + delay).toISOString()
            });
            outcomes.push({ id: failed.id, status: failed.status, error: failed.lastError, nextAttemptAt: failed.nextAttemptAt });
        }
    }
    return { processed: outcomes.length, outcomes };
}

async function tickAllUsers() {
    if (ticking) return { skipped: true };
    ticking = true;
    const summary = [];
    try {
        const users = authStore.listUsers().filter(user => user.status === 'approved');
        for (const user of users) {
            const result = await userContext.runAs(user.id, () => runDue());
            if (result.processed) summary.push({ userId: user.id, processed: result.processed });
        }
        return { users: users.length, processed: summary };
    } finally {
        ticking = false;
    }
}

function start({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
    if (timer) return;
    const delay = Math.max(1000, Number(intervalMs) || DEFAULT_INTERVAL_MS);
    timer = setInterval(() => tickAllUsers().catch(error => console.warn('[jobs] tick:', error.message)), delay);
    timer.unref?.();
    setTimeout(() => tickAllUsers().catch(error => console.warn('[jobs] initial tick:', error.message)), 500).unref?.();
}

function stop() {
    if (timer) clearInterval(timer);
    timer = null;
}

function stats() {
    const jobs = store.list({ limit: 200 });
    const byStatus = {};
    jobs.forEach(job => { byStatus[job.status] = (byStatus[job.status] || 0) + 1; });
    return { total: jobs.length, byStatus };
}

function clear() { return store.clear(); }

module.exports = {
    create, list, get, cancel, updateReminder, snapshot: store.snapshot, retry, retryReminder, runDue, tickAllUsers, start, stop, stats, clear,
    TYPES, TERMINAL, _store: store, _validateCreate: validateCreate
};
