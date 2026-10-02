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

    function endpoint() {
        return (window.GUNTER_CONFIG?.PROXY_BASE_URL || '') + '/api/jobs';
    }

    async function call(op, params = {}) {
        const response = await fetch(endpoint(), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ op, params })
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json.success) {
            throw new Error(json.error || `Jobs HTTP ${response.status}`);
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

    function readSeen() {
        try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); }
        catch { return new Set(); }
    }

    function saveSeen(seen) {
        try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-200))); } catch { /* noop */ }
    }

    async function pollCompleted() {
        if (document.hidden) return;
        try {
            const completed = await list({ status: 'completed', limit: 30 });
            const seen = readSeen();
            let changed = false;
            for (const job of completed) {
                if (seen.has(job.id)) continue;
                seen.add(job.id);
                changed = true;
                const prefix = job.type === 'follow_up' ? '🔁 Seguimiento' : '⏰ Recordatorio';
                window.GunterNotificationsService?.showToast?.(`${prefix}: ${job.title}`, {
                    variant: job.priority === 'urgent' || job.priority === 'high' ? 'warn' : 'info',
                    duration: 7000
                });
                window.dispatchEvent(new CustomEvent('gunter-job-completed', { detail: { job } }));
            }
            if (changed) saveSeen(seen);
        } catch (error) {
            console.warn('[jobs] poll:', error.message);
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
        scheduleReminder, scheduleFollowUp, list, get, cancel, retry, runDue, stats,
        startPolling, stopPolling, pollCompleted
    };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => startPolling());
    else startPolling();
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopPolling();
        else startPolling();
    });
})();
