/* =============================================
   GUNTER SERVICE - Google Calendar
   -------------------------------------------------
   Wrapper de la Calendar API v3 con:
   - Mapper LocalEvent ↔ GoogleEvent
   - Cola de reintentos offline (localStorage)
   - Manejo de 401/403/404/409/412/429/5xx
   - Recordatorios [1440, 30] por defecto
   ============================================= */

(function () {
    const API = 'https://www.googleapis.com/calendar/v3';
    const QUEUE_KEY = 'gunter_calendar_queue';

    function cfg() { return window.GUNTER_CONFIG || {}; }
    function calId() { return cfg().CALENDAR_DEFAULT_CALENDAR_ID || 'primary'; }
    function defaultReminders(priority) {
        const urgent = priority === 'urgent';
        return urgent
            ? (cfg().CALENDAR_URGENT_REMINDERS || [2880, 60, 10])
            : (cfg().CALENDAR_DEFAULT_REMINDERS || [1440, 30]);
    }

    // ---------- Queue (offline retry) ----------
    function readQueue() {
        try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return []; }
    }
    function writeQueue(q) { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); }
    function enqueue(op) { const q = readQueue(); q.push({ ...op, queuedAt: Date.now() }); writeQueue(q); }
    async function flushQueue() {
        if (!window.GunterGoogleAuth?.isConnected()) return 0;
        const q = readQueue();
        if (!q.length) return 0;
        const remaining = [];
        let done = 0;
        for (const op of q) {
            try {
                if (op.type === 'create') await pushEvent(op.localEvent, { skipQueue: true });
                else if (op.type === 'update') await updateEvent(op.googleId, op.patch, { skipQueue: true });
                else if (op.type === 'delete') await deleteEvent(op.googleId, { skipQueue: true });
                done++;
            } catch (e) {
                remaining.push(op);
            }
        }
        writeQueue(remaining);
        return done;
    }

    // ---------- Mapper ----------
    function mapLocalToGoogle(local) {
        const tz = detectTimezone();
        const isAllDay = local.kind === 'allDay' || (local.startAt && !/[T]/.test(local.startAt));
        const start = isAllDay
            ? { date: (local.startAt || '').slice(0, 10), timeZone: tz }
            : { dateTime: local.startAt, timeZone: tz };
        const end = isAllDay
            ? { date: (local.endAt || local.startAt || '').slice(0, 10), timeZone: tz }
            : { dateTime: local.endAt, timeZone: tz };

        // Premium flag: googleCalendarAutoReminders decides if we override
        // the user's Google Calendar default reminders.
        const autoRemEnabled = !window.PremiumFeaturesService
            || window.PremiumFeaturesService.isEnabled('googleCalendarAutoReminders');
        const reminders = autoRemEnabled
            ? { useDefault: false,
                overrides: defaultReminders(local.priority).map(min => ({ method: 'popup', minutes: min })) }
            : { useDefault: true };

        const description = [
            'Creado desde Gunter Día',
            local.notes || '',
            (local.tags && local.tags.length) ? 'Tags: ' + local.tags.map(t => '#' + t).join(' ') : ''
        ].filter(Boolean).join('\n');

        const body = {
            summary: local.title,
            description,
            start, end,
            reminders,
            location: local.location || undefined,
            extendedProperties: {
                private: {
                    'gunter.localId': local.id || '',
                    'gunter.source': 'gunter-dia',
                    'gunter.projectId': local.projectId || ''
                }
            }
        };
        if (Array.isArray(local.attendees) && local.attendees.length) {
            body.attendees = local.attendees.map(a => {
                if (typeof a === 'string') {
                    return a.includes('@') ? { email: a } : { displayName: a };
                }
                return a;
            });
        }
        if (local.rrule) body.recurrence = [`RRULE:${local.rrule.replace(/^RRULE:/, '')}`];
        return body;
    }

    function detectTimezone() {
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
        catch { return 'UTC'; }
    }

    // ---------- Core HTTP ----------
    async function apiFetch(path, opts = {}, attempt = 0) {
        const token = await window.GunterGoogleAuth.getAccessToken();
        const resp = await fetch(API + path, {
            ...opts,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                ...(opts.headers || {})
            }
        });

        if (resp.status === 401 && attempt === 0) {
            // Silent refresh and retry once
            try {
                await window.GunterGoogleAuth.connect({ silent: true });
                return apiFetch(path, opts, attempt + 1);
            } catch {
                throw new Error('Sesión de Google expirada. Reconecta.');
            }
        }
        if (resp.status === 403) {
            // Possibly scope missing or rate limit
            const body = await resp.text().catch(() => '');
            if (/insufficient.*scope|PERMISSION_DENIED/i.test(body)) {
                throw new Error('Falta el permiso de Calendar. Reconecta y acepta el permiso.');
            }
            if (attempt < 4) {
                await sleep(backoff(attempt));
                return apiFetch(path, opts, attempt + 1);
            }
        }
        if (resp.status === 429) {
            const wait = parseInt(resp.headers.get('Retry-After') || '0', 10) * 1000 || backoff(attempt);
            if (attempt < 5) { await sleep(wait); return apiFetch(path, opts, attempt + 1); }
        }
        if (resp.status >= 500 && attempt < 3) {
            await sleep(backoff(attempt));
            return apiFetch(path, opts, attempt + 1);
        }
        if (resp.status === 404) {
            throw Object.assign(new Error('Google: not found'), { code: 404 });
        }
        if (resp.status === 409) {
            throw Object.assign(new Error('Google: conflict'), { code: 409 });
        }
        if (resp.status === 412) {
            throw Object.assign(new Error('Google: precondition failed (etag mismatch)'), { code: 412 });
        }
        if (!resp.ok) {
            const txt = await resp.text().catch(() => '');
            throw new Error(`Google Calendar HTTP ${resp.status}: ${txt.slice(0, 200)}`);
        }
        return resp.status === 204 ? null : resp.json();
    }

    function backoff(attempt) { return Math.min(30000, 1000 * Math.pow(2, attempt)); }
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    // ---------- Public: push / update / delete ----------
    async function pushEvent(localEvent, { skipQueue = false } = {}) {
        if (!navigator.onLine) {
            if (!skipQueue) enqueue({ type: 'create', localEvent });
            return { queued: true };
        }
        try {
            if (!window.GunterGoogleAuth?.isConnected()) {
                if (!skipQueue) enqueue({ type: 'create', localEvent });
                return { queued: true, reason: 'not_connected' };
            }
            const body = mapLocalToGoogle(localEvent);
            const created = await apiFetch(`/calendars/${encodeURIComponent(calId())}/events`, {
                method: 'POST',
                body: JSON.stringify(body)
            });
            return { id: created.id, htmlLink: created.htmlLink, googleEvent: created };
        } catch (err) {
            if (!skipQueue && shouldRetryLater(err)) enqueue({ type: 'create', localEvent });
            throw err;
        }
    }

    async function updateEvent(googleId, patch, { skipQueue = false } = {}) {
        if (!googleId) throw new Error('updateEvent requiere googleId');
        if (!navigator.onLine) {
            if (!skipQueue) enqueue({ type: 'update', googleId, patch });
            return { queued: true };
        }
        try {
            const body = mapLocalToGoogle(patch);
            return await apiFetch(
                `/calendars/${encodeURIComponent(calId())}/events/${encodeURIComponent(googleId)}`,
                { method: 'PATCH', body: JSON.stringify(body) }
            );
        } catch (err) {
            if (err.code === 404) {
                // Google borró el evento; ignorar silencioso
                return { gone: true };
            }
            if (!skipQueue && shouldRetryLater(err)) enqueue({ type: 'update', googleId, patch });
            throw err;
        }
    }

    async function deleteEvent(googleId, { skipQueue = false } = {}) {
        if (!googleId) return;
        if (!navigator.onLine) {
            if (!skipQueue) enqueue({ type: 'delete', googleId });
            return { queued: true };
        }
        try {
            await apiFetch(
                `/calendars/${encodeURIComponent(calId())}/events/${encodeURIComponent(googleId)}`,
                { method: 'DELETE' }
            );
            return { deleted: true };
        } catch (err) {
            if (err.code === 404) return { deleted: true }; // already gone
            if (!skipQueue && shouldRetryLater(err)) enqueue({ type: 'delete', googleId });
            throw err;
        }
    }

    function shouldRetryLater(err) {
        const msg = String(err?.message || '');
        return /HTTP 5\d\d|Network|Failed to fetch|conexión|TypeError/i.test(msg);
    }

    async function listUpcoming({ maxResults = 10 } = {}) {
        if (!window.GunterGoogleAuth?.isConnected()) return [];
        const now = new Date().toISOString();
        const data = await apiFetch(
            `/calendars/${encodeURIComponent(calId())}/events?` +
            `timeMin=${encodeURIComponent(now)}&maxResults=${maxResults}&singleEvents=true&orderBy=startTime`
        );
        return data.items || [];
    }

    // Auto-flush on online
    window.addEventListener('online', () => { flushQueue().catch(() => {}); });

    window.GunterCalendarService = {
        pushEvent, updateEvent, deleteEvent, listUpcoming, flushQueue,
        mapLocalToGoogle   // exposed for tests / debugging
    };
})();
