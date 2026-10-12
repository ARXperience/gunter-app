/* =============================================
   GUNTER SERVICE - Durable Jobs
   -------------------------------------------------
   Cliente de /api/jobs. El servidor conserva y ejecuta
   procesos aunque esta pestaña esté cerrada.
   ============================================= */

(function () {
    if (window.GunterJobs) return;
    const SEEN_KEY = 'gunter_seen_completed_jobs_v1';
    let pollTimer = null;
    const pollingOwners = new Set();

    function jobsError(code, message) {
        const error = new Error(message || code);
        error.code = code;
        return error;
    }

    function currentOwner() {
        try {
            const auth = window.GunterAuth;
            const trusted = auth && (typeof auth.canAccessLocalData === 'function'
                ? auth.canAccessLocalData() : auth.isVerified?.());
            const id = auth?.getUser?.()?.id;
            if (!trusted || typeof id !== 'string' || !id.trim() || id === 'local-user') return null;
            const deviceOwner = window.localStorage?.getItem('gunter_device_user');
            return deviceOwner && deviceOwner !== id ? null : id;
        } catch { return null; }
    }

    function requireOwner(expected) {
        const owner = currentOwner();
        if (!owner) throw jobsError('JOBS_AUTH_REQUIRED', 'Verifica tu sesión antes de consultar o modificar recordatorios.');
        if (expected !== undefined && expected !== owner) {
            throw jobsError('JOBS_OWNER_MISMATCH', 'El recordatorio no pertenece a la cuenta activa.');
        }
        return owner;
    }

    function assertCurrentOwner(owner) {
        if (currentOwner() !== owner) {
            throw jobsError('JOBS_ACCOUNT_CHANGED', 'La cuenta cambió durante la operación. Vuelve a consultar tus recordatorios.');
        }
    }

    function endpoint() {
        return (window.GUNTER_CONFIG?.PROXY_BASE_URL || '') + '/api/jobs';
    }

    async function call(op, params = {}) {
        const ownerId = requireOwner(params.ownerId);
        const response = await fetch(endpoint(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ op, params: { ...params, ownerId } })
        });
        assertCurrentOwner(ownerId);
        const json = await response.json().catch(() => ({}));
        assertCurrentOwner(ownerId);
        if (!response.ok || !json.success) {
            throw jobsError(json.code || json.data?.code || json.data?.error || json.error || 'JOBS_REQUEST_FAILED', json.error || `Jobs HTTP ${response.status}`);
        }
        return json.data;
    }

    async function scheduleReminder({ title, runAt, priority = 'normal', message = '', dedupeKey = null }) {
        const result = await call('create', {
            type: 'reminder', title, runAt, priority,
            payload: message ? { message } : {}, dedupeKey
        });
        return result.job;
    }

    async function scheduleFollowUp({ title, runAt, priority = 'normal', projectId = null, message = '' }) {
        const result = await call('create', {
            type: 'follow_up', title, runAt, priority,
            payload: { projectId, ...(message ? { message } : {}) }
        });
        return result.job;
    }

    async function list(filters = {}) {
        const result = await call('list', filters);
        return result.items || [];
    }

    async function get(id) {
        const result = await call('get', { id });
        return result.job || null;
    }

    async function cancel(id) {
        const result = await call('cancel', { id });
        return result.job || null;
    }

    async function cancelReminder(id, { ownerId, expected, confirmed } = {}) {
        if (confirmed !== true) {
            throw jobsError('REMINDER_CONFIRMATION_REQUIRED', 'Confirma la cancelación del recordatorio antes de guardarla.');
        }
        if (typeof ownerId !== 'string' || !ownerId) {
            throw jobsError('JOBS_OWNER_MISMATCH', 'La cancelación necesita la cuenta que la autorizó.');
        }
        requireOwner(ownerId);
        const keys = ['id', 'type', 'title', 'runAt', 'priority', 'status', 'updatedAt', 'revision'];
        if (!expected || typeof expected !== 'object' || Array.isArray(expected) || expected.id !== id
            || Object.keys(expected).length !== keys.length || !keys.every(key => Object.hasOwn(expected, key))
            || !keys.slice(0, -1).every(key => typeof expected[key] === 'string')
            || !Number.isSafeInteger(expected.revision) || expected.revision < 0) {
            throw jobsError('job_snapshot_required', 'Consulta el estado actual del recordatorio antes de confirmar la cancelación.');
        }
        const result = await call('cancel_reminder', { id, ownerId, expected, confirmed: true });
        assertCurrentOwner(ownerId);
        const job = result?.job;
        if (!job || job.id !== id || job.type !== 'reminder' || job.status !== 'cancelled'
            || !Number.isSafeInteger(job.revision) || job.revision !== expected.revision + 1
            || ['title', 'runAt', 'priority'].some(key => job[key] !== expected[key])
            || typeof job.cancelledAt !== 'string' || !Number.isFinite(new Date(job.cancelledAt).getTime())) {
            throw jobsError('REMINDER_CANCEL_NOT_VERIFIED', 'El servidor no confirmó el recordatorio cancelado.');
        }
        window.dispatchEvent(new CustomEvent('reminders-changed', { detail: { type: 'cancelled', id: job.id, ownerId, durable: true } }));
        assertCurrentOwner(ownerId);
        window.dispatchEvent(new CustomEvent('gunter-jobs-changed', { detail: { type: 'cancelled', id: job.id, ownerId } }));
        return job;
    }

    async function updateReminder(id, patch, { ownerId, expected, confirmed } = {}) {
        if (confirmed !== true) {
            throw jobsError('REMINDER_CONFIRMATION_REQUIRED', 'Confirma los cambios del recordatorio antes de guardarlos.');
        }
        if (typeof ownerId !== 'string' || !ownerId) {
            throw jobsError('JOBS_OWNER_MISMATCH', 'La modificación necesita la cuenta que autorizó el cambio.');
        }
        requireOwner(ownerId);
        const result = await call('update_reminder', { id, ownerId, expected, patch, confirmed: true });
        assertCurrentOwner(ownerId);
        const job = result.job;
        if (!job) throw jobsError('REMINDER_UPDATE_NOT_VERIFIED', 'El servidor no confirmó el recordatorio actualizado.');
        window.dispatchEvent(new CustomEvent('reminders-changed', { detail: { type: 'updated', id: job.id, ownerId, durable: true } }));
        assertCurrentOwner(ownerId);
        window.dispatchEvent(new CustomEvent('gunter-jobs-changed', { detail: { type: 'updated', id: job.id, ownerId } }));
        return job;
    }

    async function retry(id) {
        const result = await call('retry', { id });
        return result.job || null;
    }

    async function retryReminder(id, { ownerId, expected, confirmed } = {}) {
        if (confirmed !== true) {
            throw jobsError('REMINDER_CONFIRMATION_REQUIRED', 'Confirma el reintento del recordatorio antes de programarlo.');
        }
        if (typeof ownerId !== 'string' || !ownerId) {
            throw jobsError('JOBS_OWNER_MISMATCH', 'El reintento necesita la cuenta que lo autorizó.');
        }
        requireOwner(ownerId);
        if (!expected || typeof expected !== 'object' || Array.isArray(expected) || expected.id !== id) {
            throw jobsError('job_snapshot_required', 'Consulta el estado actual del recordatorio antes de confirmar el reintento.');
        }
        const result = await call('retry_reminder', { id, ownerId, expected, confirmed: true });
        assertCurrentOwner(ownerId);
        const job = result?.job;
        if (!job || job.id !== id || job.type !== 'reminder' || job.status !== 'scheduled') {
            throw jobsError('REMINDER_RETRY_NOT_VERIFIED', 'El servidor no confirmó el recordatorio reprogramado para reintento.');
        }
        window.dispatchEvent(new CustomEvent('reminders-changed', { detail: { type: 'retried', id: job.id, ownerId, durable: true } }));
        assertCurrentOwner(ownerId);
        window.dispatchEvent(new CustomEvent('gunter-jobs-changed', { detail: { type: 'retried', id: job.id, ownerId } }));
        return job;
    }

    async function runDue() {
        return call('run_due');
    }

    async function stats() {
        return call('stats');
    }

    function seenKey(ownerId) { return `${SEEN_KEY}:${encodeURIComponent(ownerId)}`; }

    function readSeen(ownerId) {
        try {
            const saved = JSON.parse(localStorage.getItem(seenKey(ownerId)) || '[]');
            return new Set(Array.isArray(saved) ? saved : []);
        }
        catch { return new Set(); }
    }

    function saveSeen(ownerId, seen) {
        if (currentOwner() !== ownerId) return;
        try { localStorage.setItem(seenKey(ownerId), JSON.stringify([...seen].slice(-200))); } catch { /* noop */ }
    }

    async function pollCompleted() {
        const ownerId = currentOwner();
        if (document.hidden || !ownerId || pollingOwners.has(ownerId)) return;
        pollingOwners.add(ownerId);
        try {
            const completed = await list({ status: 'completed', limit: 30 });
            if (document.hidden || currentOwner() !== ownerId) return;
            const seen = readSeen(ownerId);
            let changed = false;
            for (const job of completed) {
                if (document.hidden || currentOwner() !== ownerId) return;
                if (seen.has(job.id)) continue;
                seen.add(job.id);
                changed = true;
                const prefix = job.type === 'follow_up' ? '🔁 Seguimiento' : '⏰ Recordatorio';
                window.GunterNotificationsService?.showToast?.(`${prefix}: ${job.title}`, {
                    variant: job.priority === 'urgent' || job.priority === 'high' ? 'warn' : 'info',
                    duration: 7000
                });
                if (currentOwner() !== ownerId) return;
                window.dispatchEvent(new CustomEvent('gunter-job-completed', { detail: { job, ownerId } }));
            }
            if (changed) saveSeen(ownerId, seen);
        } catch (error) {
            console.warn('[jobs] poll:', error.message);
        } finally {
            pollingOwners.delete(ownerId);
        }
    }

    function startPolling(intervalMs = 15000) {
        if (pollTimer) return;
        pollCompleted();
        pollTimer = setInterval(pollCompleted, Math.max(5000, intervalMs));
    }

    function stopPolling() {
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
    }

    window.GunterJobs = {
        scheduleReminder, scheduleFollowUp, list, get, cancel, cancelReminder, updateReminder, retry, retryReminder, runDue, stats,
        startPolling, stopPolling, pollCompleted
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => startPolling());
    else startPolling();
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopPolling();
        else startPolling();
    });
})();
