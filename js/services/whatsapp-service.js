/* =============================================
   GUNTER SERVICE - WhatsApp Bridge (client)
   -------------------------------------------------
   Wrapper de los endpoints /api/whatsapp/* y
   proceso de sync que adopta tareas/eventos
   creados desde WhatsApp en el storage local.
   ============================================= */

(function () {
    const BASE = '/api/whatsapp';
    const subs = new Set();
    let pollTimer = null;
    let syncTimer = null;
    let lastState = null;

    async function status() {
        try {
            const r = await fetch(`${BASE}/status`);
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return await r.json();
        } catch (e) {
            return { state: 'error', error: e.message };
        }
    }

    async function qr() {
        const r = await fetch(`${BASE}/qr`);
        return r.ok ? r.json() : { qr: null };
    }

    async function connect() {
        const r = await fetch(`${BASE}/connect`, { method: 'POST' });
        return r.ok ? r.json() : { error: 'connect failed' };
    }

    async function disconnect() {
        const r = await fetch(`${BASE}/disconnect`, { method: 'POST' });
        return r.ok ? r.json() : { error: 'disconnect failed' };
    }

    async function messages(limit = 50) {
        const r = await fetch(`${BASE}/messages?limit=${limit}`);
        return r.ok ? (await r.json()).messages : [];
    }

    async function send(to, text) {
        const r = await fetch(`${BASE}/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to, text })
        });
        return r.ok ? r.json() : { error: (await r.text()) };
    }

    // ---------- State mirror (browser → server) ----------
    async function pushState() {
        try {
            const tasks = window.GunterTasksService?.list ? await window.GunterTasksService.list() : [];
            const events = window.GunterEventsService?.list ? await window.GunterEventsService.list() : [];
            const reminders = window.GunterNotificationsService?.list ? await window.GunterNotificationsService.list({ status: 'scheduled' }) : [];
            await fetch(`${BASE}/state`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tasks, events, reminders })
            });
        } catch (e) { /* silent */ }
    }

    // ---------- Personality sync (browser preferences → server) ----------
    async function syncPersonality() {
        try {
            const pfs = window.PremiumFeaturesService;
            if (!pfs) return;
            const patch = {
                voiceStyle: pfs.get('voiceStyle'),
                personalityMode: pfs.get('personalityMode'),
                personalityIntensity: pfs.get('personalityIntensity'),
                userName: localStorage.getItem('gunter_username') || null,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
            };
            await fetch(`${BASE}/personality`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch)
            });
        } catch (e) { /* silent */ }
    }

    // Sync on premium flag changes (personality changes specifically)
    const PERSONALITY_KEYS = new Set(['voiceStyle', 'personalityMode', 'personalityIntensity', 'whatsappAssistant']);
    window.addEventListener('gunterPremiumFeaturesChange', (e) => {
        if (PERSONALITY_KEYS.has(e.detail?.key) || e.detail?.key === null) {
            syncPersonality();
        }
    });

    // ---------- Memory viewer ----------
    async function listMemory() {
        try {
            const r = await fetch(`${BASE}/memory`);
            if (!r.ok) return { contacts: [] };
            return await r.json();
        } catch { return { contacts: [] }; }
    }
    async function getMemory(phone) {
        try {
            const r = await fetch(`${BASE}/memory/${encodeURIComponent(phone)}`);
            if (!r.ok) return null;
            return await r.json();
        } catch { return null; }
    }
    async function forgetContact(phone) {
        return fetch(`${BASE}/memory/${encodeURIComponent(phone)}`, { method: 'DELETE' });
    }

    // ---------- Sync bridge ----------
    async function fetchPending() {
        try {
            const r = await fetch(`${BASE}/sync-pending`);
            if (!r.ok) return { pending: [] };
            return await r.json();
        } catch { return { pending: [] }; }
    }

    async function claim(ids) {
        return fetch(`${BASE}/sync-claim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });
    }

    async function runSyncOnce() {
        // Siempre empujamos nuestro state primero para que el handler del server pueda responder con datos reales
        await pushState().catch(() => {});

        const { pending } = await fetchPending();
        if (!pending || pending.length === 0) return 0;
        const adoptedIds = [];

        for (const item of pending) {
            try {
                if (item.kind === 'task' && window.GunterTasksService) {
                    await window.GunterTasksService.create({
                        ...item.payload,
                        source: item.payload.source || 'whatsapp',
                        meta: { ...(item.payload.meta || {}), whatsappFrom: item.from, syncId: item.id }
                    });
                    adoptedIds.push(item.id);
                } else if (item.kind === 'event' && window.GunterEventsService) {
                    await window.GunterEventsService.create({
                        ...item.payload,
                        source: 'whatsapp'
                    });
                    adoptedIds.push(item.id);
                } else if (item.kind === 'task_op' && window.GunterTasksService) {
                    const op = item.payload;
                    if (op.op === 'complete' && op.taskId) {
                        await window.GunterTasksService.complete(op.taskId).catch(() => {});
                    } else if (op.op === 'modify' && op.taskId && op.patch) {
                        await window.GunterTasksService.update(op.taskId, op.patch).catch(() => {});
                    } else if (op.op === 'delete' && op.taskId) {
                        await window.GunterTasksService.remove(op.taskId).catch(() => {});
                    }
                    adoptedIds.push(item.id);
                } else if (item.kind === 'event_op' && window.GunterEventsService) {
                    const op = item.payload;
                    if (op.op === 'cancel' && op.eventId) {
                        await window.GunterEventsService.remove(op.eventId).catch(() => {});
                    } else if (op.op === 'modify' && op.eventId && op.patch) {
                        await window.GunterEventsService.update(op.eventId, op.patch).catch(() => {});
                    }
                    adoptedIds.push(item.id);
                } else if (item.kind === 'project_note' && window.gunterData) {
                    // Persistir nota en el proyecto (usa data-service que vive en localStorage).
                    const { projectId, note, at } = item.payload;
                    try {
                        const data = window.gunterData.data || {};
                        const proj = (data.projects || []).find(p => p.id === projectId);
                        if (proj) {
                            proj.notes = Array.isArray(proj.notes) ? proj.notes : [];
                            proj.notes.push({ source: 'whatsapp', text: note, at: at || new Date().toISOString() });
                            proj.updatedAt = new Date().toISOString();
                            window.gunterData.save();
                            // Avisar al sync de knowledge para repushear
                            window.dispatchEvent(new CustomEvent('gunter-data-changed', { detail: { projectId } }));
                            adoptedIds.push(item.id);
                        }
                    } catch (e) { console.warn('[wa-sync] project_note adoption failed:', e.message); }
                }
            } catch (e) {
                console.warn('[wa-sync] adoption failed:', e.message);
            }
        }
        if (adoptedIds.length > 0) {
            await claim(adoptedIds);
            notify('sync', { adopted: adoptedIds.length });
            // Toast feedback si hay notifications-service
            if (window.GunterNotificationsService?.showToast) {
                window.GunterNotificationsService.showToast(
                    `📱 ${adoptedIds.length} ${adoptedIds.length === 1 ? 'item recibido' : 'items recibidos'} por WhatsApp`,
                    { priority: 'normal', duration: 4500 }
                );
            }
        }
        return adoptedIds.length;
    }

    // ---------- Status polling ----------
    function startPolling(intervalMs = 3000) {
        if (pollTimer) return;
        const tick = async () => {
            const s = await status();
            if (!lastState || lastState.state !== s.state || lastState.qrAvailable !== s.qrAvailable) {
                lastState = s;
                notify('status', s);
            } else {
                lastState = s;
            }
        };
        tick();
        pollTimer = setInterval(tick, intervalMs);
    }

    function stopPolling() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    function startSync(intervalMs = 8000) {
        if (syncTimer) return;
        runSyncOnce().catch(() => {});
        syncTimer = setInterval(() => runSyncOnce().catch(() => {}), intervalMs);
    }
    function stopSync() {
        if (syncTimer) { clearInterval(syncTimer); syncTimer = null; }
    }

    // ---------- Subscribe ----------
    function subscribe(cb) { subs.add(cb); return () => subs.delete(cb); }
    function notify(type, payload) {
        subs.forEach(cb => { try { cb(type, payload); } catch {} });
        window.dispatchEvent(new CustomEvent('whatsapp-' + type, { detail: payload }));
    }

    // Autostart sync polling when premium flag is ON
    function autoStart() {
        try {
            const enabled = window.PremiumFeaturesService?.isEnabled?.('whatsappAssistant');
            if (enabled) startSync();
        } catch {}
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoStart);
    } else {
        autoStart();
    }
    // React to toggle changes
    window.addEventListener('gunterPremiumFeaturesChange', (e) => {
        if (e.detail?.key === 'whatsappAssistant') {
            if (e.detail.value) startSync();
            else stopSync();
        }
    });

    // Auto-sync personality on first load (if WhatsApp is enabled)
    function autoSyncPersonality() {
        try {
            if (window.PremiumFeaturesService?.isEnabled?.('whatsappAssistant')) {
                syncPersonality();
            }
        } catch {}
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoSyncPersonality);
    } else {
        autoSyncPersonality();
    }

    window.GunterWhatsApp = {
        status, qr, connect, disconnect, messages, send,
        runSyncOnce, startPolling, stopPolling, startSync, stopSync,
        pushState, syncPersonality,
        listMemory, getMemory, forgetContact,
        subscribe
    };
})();
