/* =============================================
   GUNTER SERVICE - Notifications / Reminders
   -------------------------------------------------
   Recordatorios con 3 canales:
     1) in-app toast (siempre)
     2) Notification API (si el usuario concedió permiso)
     3) Web Push del servidor, incluso con la app cerrada

   Los recordatorios nuevos viven en la cola durable del servidor.
   IndexedDB se conserva como respaldo y para registros heredados.
   ============================================= */

(function () {
    const DB_NAME = 'gunter_daily';
    const STORE = 'reminders';
    const timers = new Map(); // id → setTimeout

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
        if (!fireAt) throw new Error('Reminder requiere fireAt');
        if (window.GunterJobs?.scheduleReminder) {
            const job = await window.GunterJobs.scheduleReminder({ title, runAt: fireAt, priority, message: meta.message || '', dedupeKey: meta.dedupeKey || null });
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
            status: 'scheduled',
            createdAt: new Date().toISOString()
        };
        const db = await openDB();
        await new Promise((res, rej) => {
            const t = db.transaction(STORE, 'readwrite');
            t.objectStore(STORE).add(rem);
            t.oncomplete = res; t.onerror = () => rej(t.error);
        });
        db.close();
        arm(rem);
        emit('reminders-changed', { op: 'create', id: rem.id });
        return rem;
    }

    function arm(rem) {
        const delay = new Date(rem.fireAt).getTime() - Date.now();
        if (delay < 0) { fire(rem); return; }
        // Clamp: setTimeout max is ~24.8 days
        const clamped = Math.min(delay, 2 ** 31 - 1);
        const id = setTimeout(() => fire(rem), clamped);
        timers.set(rem.id, id);
    }

    async function fire(rem) {
        timers.delete(rem.id);
        try { await update(rem.id, { status: 'fired', firedAt: new Date().toISOString() }); } catch {}
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

    async function update(id, patch) {
        const db = await openDB();
        const current = await new Promise((res, rej) => {
            const r = db.transaction(STORE).objectStore(STORE).get(id);
            r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
        });
        if (!current) { db.close(); throw new Error('Reminder no encontrado'); }
        const merged = { ...current, ...patch };
        await new Promise((res, rej) => {
            const t = db.transaction(STORE, 'readwrite');
            t.objectStore(STORE).put(merged);
            t.oncomplete = res; t.onerror = () => rej(t.error);
        });
        db.close();
        emit('reminders-changed', { op: 'update', id });
        return merged;
    }

    async function cancel(id) {
        if (String(id || '').startsWith('job_') && window.GunterJobs?.cancel) {
            const job = await window.GunterJobs.cancel(id);
            emit('reminders-changed', { op: 'update', id, durable: true });
            return durableToReminder(job);
        }
        const t = timers.get(id);
        if (t) { clearTimeout(t); timers.delete(id); }
        return update(id, { status: 'cancelled' });
    }

    async function listLocal({ status } = {}) {
        const db = await openDB();
        const all = await new Promise((res, rej) => {
            const r = db.transaction(STORE).objectStore(STORE).getAll();
            r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
        });
        db.close();
        return all.filter(r => !status || r.status === status)
            .sort((a, b) => (a.fireAt || '') < (b.fireAt || '') ? -1 : 1);
    }

    async function list({ status } = {}) {
        const local = await listLocal({ status }).catch(() => []);
        if (!window.GunterJobs?.list) return local;
        try {
            const durable = await window.GunterJobs.list({ status, type: 'reminder', limit: 200 });
            const byId = new Map([...durable.map(durableToReminder), ...local].map(item => [item.id, item]));
            return [...byId.values()].sort((a, b) => String(a.fireAt || '').localeCompare(String(b.fireAt || '')));
        } catch { return local; }
    }

    function durableToReminder(job) {
        return { ...job, fireAt: job?.runAt || job?.fireAt, meta: job?.payload || {}, durable: true };
    }

    async function rehydrate() {
        const scheduled = await listLocal({ status: 'scheduled' });
        for (const r of scheduled) {
            if (!timers.has(r.id)) arm(r);
        }
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

    // Auto-rehydrate on load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => rehydrate().catch(() => {}));
    } else {
        rehydrate().catch(() => {});
    }

    window.GunterNotificationsService = {
        schedule, cancel, update, list, rehydrate, requestPermission, enablePush, disablePush, pushStatus, testPush, showToast, withOperation
    };
})();
