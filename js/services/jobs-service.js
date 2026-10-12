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
        scheduleReminder, scheduleFollowUp, list, get, cancel, updateReminder, retry, runDue, stats,
        startPolling, stopPolling, pollCompleted
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => startPolling());
    else startPolling();
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopPolling();
        else startPolling();
    });
})();
