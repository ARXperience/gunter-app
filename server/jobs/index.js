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
        const attempt = Number(queued.attempts || 0) + 1;
        const running = store.update(queued.id, {
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
    create, list, get, cancel, retry, runDue, tickAllUsers, start, stop, stats, clear,
    TYPES, TERMINAL, _store: store, _validateCreate: validateCreate
};
