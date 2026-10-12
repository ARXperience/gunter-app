/* =============================================
   GUNTER SERVICE - Notifications / Reminders
   -------------------------------------------------
   Recordatorios con 3 canales:
     1) in-app toast (siempre)
     2) Notification API (si el usuario concedió permiso)
     3) Web Push del servidor, incluso con la app cerrada

   Los recordatorios independientes utilizan la cola durable del servidor.
   Los vinculados a reuniones locales comparten su transacción IndexedDB
   y requieren Gunter abierto. Los registros heredados sin dueño se aíslan.
   ============================================= */

(function () {
    const DB_NAME = 'gunter_daily';
    const STORE = 'reminders';
    const timers = new Map();
    let reconciliation = 0;
    let invalidationChannel = null;

    function currentOwner() {
        const auth = window.GunterAuth;
        const trusted = typeof auth?.canAccessLocalData === 'function'
            ? auth.canAccessLocalData() : auth?.isVerified?.();
        const ownerId = trusted && auth.getUser?.()?.id;
        if (typeof ownerId !== 'string' || !ownerId || ownerId === 'local-user') throw new Error('REMINDER_AUTH_REQUIRED');
        // A different account signed in in another tab must stop this tab's timers.
        const deviceOwner = window.localStorage?.getItem('gunter_device_user');
        if (deviceOwner && deviceOwner !== ownerId) throw new Error('REMINDER_ACCOUNT_CHANGED');
        return ownerId;
    }

    function owns(reminder, ownerId) { return reminder?.ownerId === ownerId; }
    function linked(reminder) { return Boolean(reminder?.meta?.eventLink); }
    function stopTimer(id) {
        const entry = timers.get(id);
        if (entry) clearTimeout(entry.timer);
        timers.delete(id);
    }
    function stopTimers() { for (const id of timers.keys()) stopTimer(id); }
    function clearLocalError() { window.GunterStatusBus?.clear?.('reminders:local'); }
    function reportLocalError(error) {
        try { currentOwner(); } catch { stopTimers(); clearLocalError(); return; }
        if (/AUTH_REQUIRED|ACCOUNT_CHANGED|OWNER_MISMATCH/.test(error?.code || error?.message || '')) {
            stopTimers(); clearLocalError(); return;
        }
        // Never forward reminder contents, account IDs or raw storage errors.
        window.GunterStatusBus?.set?.('reminders:local', 'error', {
            label: 'No pude verificar los recordatorios locales.',
            hint: 'Mantén Gunter abierto y vuelve a abrir Recordatorios para reintentar.'
        });
    }

    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    function newId() { return `rem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`; }

    async function schedule({ title, fireAt, priority = 'normal', meta = {} }) {
        if (!title) throw new Error('Reminder requiere title');
        if (!Number.isFinite(new Date(fireAt).getTime())) throw new Error('Reminder requiere fireAt válido');
        const ownerId = currentOwner();
        if (meta.eventLink) {
            const service = window.GunterEventsService;
            if (!service?.scheduleReminder) throw new Error('LINKED_REMINDER_SERVICE_UNAVAILABLE');
            const link = meta.eventLink;
            if (link.ownerId != null && link.ownerId !== ownerId) throw new Error('REMINDER_OWNER_MISMATCH');
            const reminder = await service.scheduleReminder(link.eventId, {
                fireAt, ownerId, expected: link.expected, priority
            });
            if (currentOwner() !== ownerId || !owns(reminder, ownerId)) throw new Error('REMINDER_ACCOUNT_CHANGED');
            arm(reminder);
            emit('reminders-changed', { op: 'create', id: reminder.id, ownerId, durable: false });
            return reminder;
        }
        if (window.GunterJobs?.scheduleReminder) {
            const job = await window.GunterJobs.scheduleReminder({ title, runAt: fireAt, priority, message: meta.message || '', dedupeKey: meta.dedupeKey || null });
            if (currentOwner() !== ownerId) throw new Error('REMINDER_ACCOUNT_CHANGED');
            const reminder = durableToReminder(job);
            emit('reminders-changed', { op: 'create', id: reminder.id, durable: true });
            return reminder;
        }
        const rem = {
            id: newId(),
            title,
            fireAt,
            priority,
            meta,
            ownerId,
            durable: false,
            status: 'scheduled',
            createdAt: new Date().toISOString()
        };
        const db = await openDB();
        try {
            await new Promise((res, rej) => {
                const t = db.transaction(STORE, 'readwrite');
                if (currentOwner() !== ownerId) { t.abort(); rej(new Error('REMINDER_ACCOUNT_CHANGED')); return; }
                t.objectStore(STORE).add(rem);
                t.oncomplete = res; t.onerror = t.onabort = () => rej(t.error || new Error('REMINDER_WRITE_FAILED'));
            });
        } finally { db.close(); }
        if (currentOwner() !== ownerId) throw new Error('REMINDER_ACCOUNT_CHANGED');
        arm(rem);
        emit('reminders-changed', { op: 'create', id: rem.id });
        return rem;
    }

    function arm(rem) {
        stopTimer(rem.id);
        if (rem.status !== 'scheduled' || rem.durable || (linked(rem) && !window.GunterEventsService?.claimReminder)) return;
        let ownerId;
        try { ownerId = currentOwner(); } catch { return; }
        if (!owns(rem, ownerId)) return;
        const delay = new Date(rem.fireAt).getTime() - Date.now();
        if (!Number.isFinite(delay)) return;
        // Clamp: setTimeout max is ~24.8 days
        const clamped = Math.max(0, Math.min(delay, 2 ** 31 - 1));
        const entry = { ownerId, timer: null };
        entry.timer = setTimeout(() => {
            if (timers.get(rem.id) !== entry) return;
            timers.delete(rem.id);
            fire(rem).catch(reportLocalError);
        }, clamped);
        timers.set(rem.id, entry);
    }

    async function fire(rem) {
        const ownerId = currentOwner();
        if (!owns(rem, ownerId)) return;
        const claim = linked(rem)
            ? await window.GunterEventsService?.claimReminder?.(rem.id)
            : await claimIndependent(rem.id, ownerId);
        if (!claim) return;
        if (currentOwner() !== ownerId || !owns(claim.reminder, ownerId)) return;
        if (claim.waiting) { arm(claim.reminder); return; }
        if (!claim.fired) return;
        rem = claim.reminder;
        emit('reminders-changed', { op: 'fire', id: rem.id, ownerId, durable: false });
        // In-app toast
        showToast(`⏰ ${rem.title}`, { priority: rem.priority });
        // Notification API
        try {
            if ('Notification' in window && Notification.permission === 'granted') {
                new Notification('Gunter — Recordatorio', {
                    body: rem.title,
                    tag: rem.id,
                    silent: rem.priority === 'low'
                });
            }
        } catch {}
        // Animate Gunter if visible
        try {
            const av = window.__GUNTER_PRIMARY_AVATAR__;
            if (av && av.playAnimation) av.playAnimation(rem.priority === 'urgent' ? 'alert' : 'nod');
        } catch {}
    }

    async function claimIndependent(id, ownerId) {
        return mutateLocal(id, ownerId, row => {
            if (linked(row) || row.status !== 'scheduled') return { result: null };
            const dueAt = new Date(row.fireAt).getTime();
            if (!Number.isFinite(dueAt)) return { result: null };
            if (dueAt > Date.now()) return { result: { reminder: row, waiting: true } };
            const next = { ...row, status: 'fired', firedAt: new Date().toISOString() };
            return { row: next, result: { reminder: next, fired: true } };
        });
    }

    async function requestPermission() {
        if (!('Notification' in window)) return 'unsupported';
        let permission = Notification.permission;
        if (Notification.permission === 'default') {
            permission = await Notification.requestPermission();
        }
        if (permission === 'granted') await enablePush().catch(error => console.warn('[push] subscribe:', error.message));
        return permission;
    }

    async function enablePush() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) throw new Error('push_unsupported');
        if (Notification.permission !== 'granted') throw new Error('notification_permission_required');
        const keyResponse = await fetch('/api/push/public-key');
        const keyJson = await keyResponse.json().catch(() => ({}));
        if (!keyResponse.ok || !keyJson.success || !keyJson.data?.publicKey) throw new Error(keyJson.error || 'push_key_unavailable');
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(keyJson.data.publicKey) });
        const response = await fetch('/api/push/subscribe', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ subscription: subscription.toJSON(), deviceLabel: deviceLabel() })
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json.success) throw new Error(json.error || 'push_subscription_failed');
        return json.data;
    }

    async function disablePush() {
        if (!('serviceWorker' in navigator)) return { removed: false };
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager?.getSubscription?.();
        if (!subscription) return { removed: false };
        await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: subscription.endpoint }) });
        const removed = await subscription.unsubscribe();
        return { removed };
    }

    async function pushStatus() {
        const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
        if (!supported) return { supported: false, permission: 'unsupported', subscribed: false, devices: [] };
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        const response = await fetch('/api/push/status');
        const json = await response.json().catch(() => ({}));
        return { supported: true, permission: Notification.permission, subscribed: Boolean(subscription), devices: json.data?.devices || [] };
    }

    async function testPush() {
        const response = await fetch('/api/push/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ confirmed: true }) });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || !json.success) throw new Error(json.error || 'push_test_failed');
        return json.data;
    }

    function base64UrlToBytes(value) {
        const padding = '='.repeat((4 - value.length % 4) % 4);
        const binary = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
        return Uint8Array.from(binary, char => char.charCodeAt(0));
    }
    function deviceLabel() {
        const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
        return `${mobile ? 'Móvil' : 'PC'} · ${navigator.platform || 'Navegador'}`.slice(0, 100);
    }

    // Claims and cancellations must read and write in one transaction so that
    // another tab cannot deliver an already cancelled or already fired reminder.
    async function mutateLocal(id, ownerId, transform) {
        const db = await openDB();
        try {
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, 'readwrite');
                const store = tx.objectStore(STORE);
                let result = null, error;
                const req = store.get(id);
                req.onsuccess = () => {
                    try {
                        if (currentOwner() !== ownerId) throw new Error('REMINDER_ACCOUNT_CHANGED');
                        const row = req.result;
                        if (!owns(row, ownerId)) return;
                        const mutation = transform(row);
                        result = mutation.result;
                        if (mutation.row) store.put(mutation.row);
                    } catch (failure) { error = failure; tx.abort(); }
                };
                tx.oncomplete = () => resolve(result);
                tx.onerror = tx.onabort = () => reject(error || tx.error || new Error('REMINDER_WRITE_FAILED'));
            });
        } finally { db.close(); }
    }

    async function get(id) {
        const ownerId = currentOwner();
        if (String(id || '').startsWith('job_') && window.GunterJobs?.get) {
            const job = await window.GunterJobs.get(id);
            if (currentOwner() !== ownerId) throw new Error('REMINDER_ACCOUNT_CHANGED');
            if (!job || job.type !== 'reminder' || (job.ownerId !== undefined && job.ownerId !== ownerId)) return null;
            const reminder = { ...durableToReminder(job), ownerId };
            if (currentOwner() !== ownerId) throw new Error('REMINDER_ACCOUNT_CHANGED');
            return reminder;
        }
        const db = await openDB();
        let row;
        try {
            row = await new Promise((resolve, reject) => {
                const req = db.transaction(STORE).objectStore(STORE).get(id);
                req.onsuccess = () => resolve(req.result || null);
                req.onerror = () => reject(req.error);
            });
        } finally { db.close(); }
        if (currentOwner() !== ownerId || !owns(row, ownerId)) return null;
        if (!linked(row)) return row;
        if (!window.GunterEventsService?.getReminder) return row;
        const reminder = await window.GunterEventsService.getReminder(id);
        return currentOwner() === ownerId && owns(reminder, ownerId) ? reminder : null;
    }

    async function update(id, patch) {
        const ownerId = currentOwner();
        const merged = await mutateLocal(id, ownerId, row => {
            if (linked(row) || patch.meta?.eventLink) throw new Error('LINKED_REMINDER_EDIT_REQUIRES_EVENT');
            if ((patch.ownerId != null && patch.ownerId !== ownerId) || (patch.id != null && patch.id !== id)) throw new Error('REMINDER_OWNER_MISMATCH');
            const next = { ...row, ...patch, id: row.id, ownerId: row.ownerId, createdAt: row.createdAt };
            if (!next.title || !Number.isFinite(new Date(next.fireAt).getTime())) throw new Error('REMINDER_INVALID');
            return { row: next, result: next };
        });
        if (!merged) throw new Error('Reminder no encontrado');
        if (currentOwner() !== ownerId) throw new Error('REMINDER_ACCOUNT_CHANGED');
        if (merged.status === 'scheduled') arm(merged); else stopTimer(id);
        emit('reminders-changed', { op: 'update', id });
        return merged;
    }

    async function cancel(id, { ownerId: requestedOwner, expected } = {}) {
        const ownerId = currentOwner();
        const guarded = requestedOwner !== undefined || expected !== undefined;
        if (guarded && requestedOwner !== ownerId) throw new Error('REMINDER_ACCOUNT_CHANGED');
        function checkSnapshot(reminder) {
            if (currentOwner() !== ownerId || !owns(reminder, ownerId)) throw new Error('REMINDER_ACCOUNT_CHANGED');
            if (reminder.status !== 'scheduled') throw new Error('REMINDER_NOT_CANCELLABLE');
            if (!expected || expected.id !== id || typeof expected.title !== 'string' ||
                typeof expected.fireAt !== 'string' || expected.status !== 'scheduled' ||
                ['id', 'title', 'fireAt', 'status'].some(key => reminder[key] !== expected[key]) ||
                (reminder.updatedAt ?? null) !== (expected.updatedAt ?? null)) {
                throw new Error('REMINDER_CHANGED');
            }
        }
        if (String(id || '').startsWith('job_') && window.GunterJobs?.cancel) {
            // The durable caller has its own server CAS/confirmation contract;
            // do not silently downgrade a local guarded request to legacy cancel.
            if (guarded) throw new Error('REMINDER_DURABLE_CANCEL_REQUIRES_JOB');
            const job = await window.GunterJobs.cancel(id);
            if (currentOwner() !== ownerId) throw new Error('REMINDER_ACCOUNT_CHANGED');
            emit('reminders-changed', { op: 'update', id, durable: true });
            return durableToReminder(job);
        }
        const reminder = await get(id);
        if (guarded && currentOwner() !== ownerId) throw new Error('REMINDER_ACCOUNT_CHANGED');
        if (!reminder) throw new Error(guarded ? 'REMINDER_CHANGED' : 'Reminder no encontrado');
        if (guarded) checkSnapshot(reminder);
        if (linked(reminder)) {
            if (!window.GunterEventsService?.cancelReminder) throw new Error('LINKED_REMINDER_SERVICE_UNAVAILABLE');
            const cancelled = await window.GunterEventsService.cancelReminder(id);
            if (currentOwner() !== ownerId || !owns(cancelled, ownerId)) throw new Error('REMINDER_ACCOUNT_CHANGED');
            if (guarded && (cancelled.status !== 'cancelled' ||
                ['id', 'title', 'fireAt'].some(key => cancelled[key] !== expected[key]))) {
                throw new Error('REMINDER_CHANGED');
            }
            stopTimer(id);
            emit('reminders-changed', { op: 'update', id, ownerId, durable: false });
            return cancelled;
        }
        if (guarded) {
            const cancelled = await mutateLocal(id, ownerId, row => {
                checkSnapshot(row);
                if (linked(row)) throw new Error('REMINDER_CHANGED');
                const now = new Date().toISOString();
                const next = { ...row, status: 'cancelled', cancelledAt: now, updatedAt: now };
                return { row: next, result: next };
            });
            if (!cancelled) throw new Error('REMINDER_CHANGED');
            if (currentOwner() !== ownerId || !owns(cancelled, ownerId)) throw new Error('REMINDER_ACCOUNT_CHANGED');
            stopTimer(id);
            emit('reminders-changed', { op: 'update', id, ownerId, durable: false });
            return cancelled;
        }
        return update(id, { status: 'cancelled' });
    }

    async function listLocal({ status } = {}) {
        const ownerId = currentOwner();
        const db = await openDB();
        let all;
        try {
            if (currentOwner() !== ownerId) throw new Error('REMINDER_ACCOUNT_CHANGED');
            all = await new Promise((res, rej) => {
                const r = db.transaction(STORE).objectStore(STORE).getAll();
                r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
            });
        } finally { db.close(); }
        if (currentOwner() !== ownerId) throw new Error('REMINDER_ACCOUNT_CHANGED');
        return all.filter(r => owns(r, ownerId) && (!status || r.status === status))
            .sort((a, b) => (a.fireAt || '') < (b.fireAt || '') ? -1 : 1);
    }

    // A view snapshot distinguishes an empty collection from an unavailable
    // source. It never persists an owner onto legacy or server records.
    async function listSnapshot({ status, statuses } = {}) {
        let ownerId, local = [], durable = [], limited = false;
        const sources = {
            local: { available: false, error: 'REMINDER_LOCAL_UNAVAILABLE' },
            durable: { available: false, error: 'REMINDER_DURABLE_UNAVAILABLE' }
        };
        function assertOwner() {
            if (currentOwner() !== ownerId) throw new Error('REMINDER_ACCOUNT_CHANGED');
        }
        function unavailable(error) {
            const code = /REMINDER_AUTH_REQUIRED/.test(error?.message || '')
                ? 'REMINDER_AUTH_REQUIRED' : 'REMINDER_ACCOUNT_CHANGED';
            return { items: [], ownerId: null, sources: {
                local: { available: false, error: code }, durable: { available: false, error: code }
            }, limited: false };
        }
        try { ownerId = currentOwner(); } catch (error) { return unavailable(error); }
        try {
            assertOwner();
            // job_ identities belong to the server source, never to a stale
            // local mirror whose delivery state could differ from the server.
            local = (await listLocal()).filter(row => !String(row.id || '').startsWith('job_'));
            assertOwner();
            sources.local = { available: true };
        } catch {
            try { assertOwner(); } catch (error) { return unavailable(error); }
        }
        if (typeof window.GunterJobs?.list === 'function') {
            try {
                assertOwner();
                const requested = Array.isArray(statuses) ? [...new Set(statuses)].filter(value =>
                    ['scheduled', 'running', 'retry_wait', 'failed', 'completed', 'cancelled'].includes(value)) : status ? [status] : [null];
                const collections = await Promise.all((requested.length ? requested : [null]).map(value =>
                    window.GunterJobs.list({ ...(value ? { status: value } : {}), type: 'reminder', limit: 200 })));
                assertOwner();
                if (collections.some(rows => !Array.isArray(rows))) throw new Error('REMINDER_DURABLE_UNAVAILABLE');
                const jobs = collections.flat();
                limited = collections.some(rows => rows.length >= 200);
                durable = jobs.filter(job => job?.type === 'reminder' &&
                    (job.ownerId === undefined || job.ownerId === ownerId))
                    .map(job => ({ ...durableToReminder(job), ownerId }));
                sources.durable = { available: true };
            } catch {
                try { assertOwner(); } catch (error) { return unavailable(error); }
            }
        }
        try { assertOwner(); } catch (error) { return unavailable(error); }
        const byId = new Map();
        // Durable status wins if an old local row mirrors the same server ID.
        for (const item of [...local, ...durable]) {
            if (typeof item?.id === 'string' && item.id && owns(item, ownerId)) byId.set(item.id, item);
        }
        const items = [...byId.values()].filter(item => (!status || item.status === status)
            && (!Array.isArray(statuses) || statuses.includes(item.status)))
            .sort((a, b) => String(a.fireAt || '').localeCompare(String(b.fireAt || '')));
        try { assertOwner(); } catch (error) { return unavailable(error); }
        return { items, ownerId, sources, limited };
    }

    async function list(options = {}) {
        return (await listSnapshot(options)).items;
    }

    function durableToReminder(job) {
        return { ...job, fireAt: job?.runAt || job?.fireAt, meta: job?.payload || {}, durable: true };
    }

    async function rehydrate() {
        const generation = ++reconciliation;
        stopTimers();
        const scheduled = await listLocal({ status: 'scheduled' });
        if (generation !== reconciliation) return;
        for (const r of scheduled) {
            arm(r);
        }
        clearLocalError();
    }

    // In-app toast — soporta variants info/success/warn/error/loading,
    // loading no se auto-cierra; devuelve handle con update/dismiss.
    const COLOR_BY_VARIANT = {
        info:    { border: 'var(--accent-primary, #00d4ff)', icon: 'ℹ' },
        success: { border: '#4ade80', icon: '✓' },
        warn:    { border: '#fbbf24', icon: '⚠' },
        error:   { border: '#f87171', icon: '⚠' },
        loading: { border: 'var(--accent-primary, #00d4ff)', icon: '⏳' }
    };

    function showToast(message, opts = {}) {
        const root = ensureToastRoot();
        const variant = opts.variant
            || (opts.priority === 'high' || opts.priority === 'urgent' ? 'warn' : 'info');
        const colors = COLOR_BY_VARIANT[variant] || COLOR_BY_VARIANT.info;

        const el = document.createElement('div');
        el.className = `gunter-toast gunter-toast--${variant} gunter-toast--${opts.priority || 'normal'}`;
        el.style.cssText = `
            background: var(--bg-card, #111827);
            color: var(--text-primary, #fff);
            border: 1px solid ${colors.border};
            padding: 12px 16px;
            border-radius: 10px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.4);
            margin: 8px;
            font-size: 14px;
            min-width: 240px;
            max-width: 360px;
            backdrop-filter: blur(16px);
            transform: translateX(120%);
            transition: transform 300ms cubic-bezier(.22,.61,.36,1), opacity 200ms ease;
            display: flex;
            align-items: center;
            gap: 10px;
            pointer-events: auto;
        `;
        el.innerHTML = `
            <span class="gunter-toast__icon" aria-hidden="true">${escapeHtml(colors.icon)}</span>
            <span class="gunter-toast__msg" style="flex:1; line-height:1.4;">${escapeHtml(message)}</span>
        `;
        if (variant === 'loading') startSpinner(el.querySelector('.gunter-toast__icon'));

        root.appendChild(el);
        requestAnimationFrame(() => { el.style.transform = 'translateX(0)'; });

        const sticky = variant === 'loading' || opts.sticky === true;
        let timer = null;
        const ttl = opts.duration || 6000;
        if (!sticky) {
            timer = setTimeout(dismiss, ttl);
        }

        // Speak the toast if voice is enabled with notifications mode (skip loading/info auto)
        if (window.GunterVoice && !opts.silent && variant !== 'loading') {
            try { window.GunterVoice.speak(message, { context: 'notification' }); } catch {}
        }

        function dismiss() {
            if (timer) { clearTimeout(timer); timer = null; }
            el.style.transform = 'translateX(120%)';
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 320);
        }

        function update(newMessage, newVariant) {
            const v = newVariant || variant;
            const cc = COLOR_BY_VARIANT[v] || colors;
            el.querySelector('.gunter-toast__msg').textContent = newMessage;
            const iconEl = el.querySelector('.gunter-toast__icon');
            iconEl.textContent = cc.icon;
            iconEl.style.animation = '';
            if (v === 'loading') startSpinner(iconEl);
            el.style.borderColor = cc.border;
            // Reprogramar auto-dismiss si cambia a no-loading
            if (timer) { clearTimeout(timer); timer = null; }
            if (v !== 'loading' && opts.sticky !== true) {
                timer = setTimeout(dismiss, opts.duration || 4000);
            }
        }

        return { update, dismiss, el };
    }

    // Helper: ejecuta una operación async con toast loading → success/error.
    // Uso: await GunterNotificationsService.withOperation('Guardando…', async () => { ... }, { successText, errorText })
    async function withOperation(label, asyncFn, opts = {}) {
        const toast = showToast(label, { variant: 'loading', sticky: true, silent: true });
        try {
            const result = await asyncFn();
            toast.update(opts.successText || '✓ Listo', 'success');
            return result;
        } catch (err) {
            const human = window.GunterErrors?.format1?.(err) || (err.message || String(err));
            toast.update(opts.errorText || `⚠ ${human}`, 'error');
            throw err;
        }
    }

    function startSpinner(iconEl) {
        ensureSpinnerKeyframes();
        iconEl.style.display = 'inline-block';
        iconEl.style.animation = 'gunterToastSpin 1.2s linear infinite';
        iconEl.textContent = '◐';
    }

    function ensureSpinnerKeyframes() {
        if (document.getElementById('gunter-toast-keyframes')) return;
        const s = document.createElement('style');
        s.id = 'gunter-toast-keyframes';
        s.textContent = `@keyframes gunterToastSpin { to { transform: rotate(360deg); } }`;
        document.head.appendChild(s);
    }

    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
        );
    }

    function ensureToastRoot() {
        let root = document.getElementById('gunter-toast-root');
        if (!root) {
            root = document.createElement('div');
            root.id = 'gunter-toast-root';
            Object.assign(root.style, {
                position: 'fixed',
                bottom: '20px',
                right: '20px',
                zIndex: '99999',
                pointerEvents: 'none',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end'
            });
            document.body.appendChild(root);
        }
        return root;
    }

    function emit(name, detail) {
        window.dispatchEvent(new CustomEvent(name, { detail }));
    }

    function reconcile() { rehydrate().catch(reportLocalError); }

    function invalidate(event) {
        reconcile();
        if (event?.detail?.remote) return;
        try {
            invalidationChannel?.postMessage({ ownerId: currentOwner() });
        } catch { }
    }

    // Messages invalidate timers, never carry or attribute reminder contents.
    // The IndexedDB claim remains the arbiter when several tabs are open.
    try {
        if (typeof window.BroadcastChannel === 'function') {
            invalidationChannel = new window.BroadcastChannel('gunter-reminders-invalidation');
            invalidationChannel.addEventListener('message', event => {
                try {
                    if (event.data?.ownerId !== currentOwner()) return;
                    emit('reminders-changed', { remote: true });
                } catch { stopTimers(); clearLocalError(); }
            });
        }
    } catch { }
    ['events-changed', 'reminders-changed'].forEach(name => window.addEventListener(name, invalidate));
    document.addEventListener('gunter-auth-ready', reconcile);
    document.addEventListener('gunter-auth-profile-changed', reconcile);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reconcile(); });
    window.addEventListener('focus', reconcile);
    window.addEventListener('storage', event => {
        if (event.key === 'gunter_device_user' || event.key === 'gunter_auth_user') {
            stopTimers();
            reconcile();
        }
    });

    // Auto-rehydrate on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', reconcile);
    } else {
        reconcile();
    }

    window.GunterNotificationsService = {
        schedule, get, cancel, update, list, listSnapshot, rehydrate, requestPermission, enablePush, disablePush, pushStatus, testPush, showToast, withOperation
    };
})();
