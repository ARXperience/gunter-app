/* =============================================
   GUNTER SERVICE - Notifications / Reminders
   -------------------------------------------------
   Recordatorios con 3 canales:
     1) in-app toast (siempre)
     2) Notification API (si el usuario concedió permiso)
     3) push server-side — stub (fase futura)

   Los recordatorios viven en IndexedDB. Un scheduler
   en memoria dispara cuando llega la hora, aún en la
   misma pestaña; al cargar la app se rehidratan.
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
        if (Notification.permission === 'default') {
            return await Notification.requestPermission();
        }
        return Notification.permission;
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
        const t = timers.get(id);
        if (t) { clearTimeout(t); timers.delete(id); }
        return update(id, { status: 'cancelled' });
    }

    async function list({ status } = {}) {
        const db = await openDB();
        const all = await new Promise((res, rej) => {
            const r = db.transaction(STORE).objectStore(STORE).getAll();
            r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
        });
        db.close();
        return all.filter(r => !status || r.status === status)
            .sort((a, b) => (a.fireAt || '') < (b.fireAt || '') ? -1 : 1);
    }

    async function rehydrate() {
        const scheduled = await list({ status: 'scheduled' });
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
        schedule, cancel, update, list, rehydrate, requestPermission, showToast, withOperation
    };
})();
