/* =============================================
   GUNTER SERVICE - Events (local calendar)
   -------------------------------------------------
   CRUD de eventos. Comparte BD `gunter_daily`
   (store 'events') con tasks-service.
   `pushToGoogle` queda como hook para fase futura.
   ============================================= */

(function () {
    const DB_NAME = 'gunter_daily';
    const DB_VERSION = 2;
    const STORE = 'events';

    function openDB() {
        return new Promise((resolve, reject) => {
            // Abrir siempre con el mismo esquema que tasks-service. Antes,
            // si EventsService era el primer módulo en tocar una BD nueva,
            // IndexedDB creaba una base v1 sin stores y la primera consulta
            // de agenda fallaba con NotFoundError.
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('tasks')) {
                    const tasks = db.createObjectStore('tasks', { keyPath: 'id' });
                    tasks.createIndex('status', 'status');
                    tasks.createIndex('dueAt', 'dueAt');
                    tasks.createIndex('projectId', 'projectId');
                    tasks.createIndex('ownerId', 'ownerId');
                    tasks.createIndex('source', 'source');
                }
                if (!db.objectStoreNames.contains(STORE)) {
                    const events = db.createObjectStore(STORE, { keyPath: 'id' });
                    events.createIndex('startAt', 'startAt');
                    events.createIndex('projectId', 'projectId');
                    events.createIndex('ownerId', 'ownerId');
                }
                if (!db.objectStoreNames.contains('reminders')) {
                    const reminders = db.createObjectStore('reminders', { keyPath: 'id' });
                    reminders.createIndex('fireAt', 'fireAt');
                    reminders.createIndex('status', 'status');
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    function newId() {
        return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    }

    function currentOwner() {
        const auth = window.GunterAuth;
        if (!auth) return null; // Compatibility for standalone/local consumers.
        const trusted = typeof auth.canAccessLocalData === 'function'
            ? auth.canAccessLocalData() : auth.isVerified?.();
        const ownerId = trusted && auth.getUser?.()?.id;
        if (typeof ownerId !== 'string' || !ownerId || ownerId === 'local-user') {
            throw new Error('EVENT_AUTH_REQUIRED');
        }
        return ownerId;
    }

    function validateEvent(event) {
        if (typeof event.title !== 'string' || !event.title.trim()) {
            throw new Error('EVENT_INVALID_TITLE');
        }
        const start = typeof event.startAt === 'string' ? Date.parse(event.startAt) : NaN;
        const end = typeof event.endAt === 'string' ? Date.parse(event.endAt) : NaN;
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
            throw new Error('EVENT_INVALID_DATES');
        }
    }

    function snapshotValue(event, key) {
        if (key === 'status') return event.status || 'scheduled';
        if (key === 'externalIds') return event.externalIds || {};
        return event[key] ?? null;
    }

    function sameValue(left, right) {
        if (left === right) return true;
        if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
        if (Array.isArray(left) !== Array.isArray(right)) return false;
        const keys = Object.keys(left);
        return keys.length === Object.keys(right).length && keys.every(key =>
            Object.prototype.hasOwnProperty.call(right, key) && sameValue(left[key], right[key]));
    }

    function scheduleDayFormatter(timezone) {
        return new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone || window.GunterPresence?.timezone?.()
                || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
            year: 'numeric', month: '2-digit', day: '2-digit'
        });
    }

    function canonicalValue(value) {
        if (!value || typeof value !== 'object') return value ?? null;
        if (Array.isArray(value)) return value.map(canonicalValue);
        return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalValue(value[key])]));
    }

    // Inspect only cached calendar records. Recurrences and legacy all-day rows
    // have no expanded coverage here, so they cannot prove that a slot is free.
    function inspectSchedule(rows, { ownerId, startAt, endAt, excludeId, timezone }) {
        const start = typeof startAt === 'string' ? Date.parse(startAt) : NaN;
        const end = typeof endAt === 'string' ? Date.parse(endAt) : NaN;
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
            throw new Error('EVENT_INVALID_DATES');
        }
        const formatter = scheduleDayFormatter(timezone);
        const active = rows.filter(row => row.ownerId === ownerId && row.id !== excludeId
            && (!row.status || row.status === 'scheduled'));
        const valid = [], unresolved = [];
        let recurring = false, invalid = false, allDay = false;
        for (const row of active) {
            const rowStart = typeof row.startAt === 'string' ? Date.parse(row.startAt) : NaN;
            const rowEnd = typeof row.endAt === 'string' ? Date.parse(row.endAt) : NaN;
            const badDates = !Number.isFinite(rowStart) || !Number.isFinite(rowEnd) || rowEnd <= rowStart;
            const recurrence = Boolean(row.rrule) || row.kind === 'recurring';
            const partialDay = row.kind === 'allDay';
            if (badDates || recurrence || partialDay) unresolved.push(row);
            recurring ||= recurrence; invalid ||= badDates; allDay ||= partialDay;
            if (!badDates) valid.push({ row, start: rowStart, end: rowEnd });
        }
        valid.sort((a, b) => a.start - b.start || a.end - b.end || String(a.row.id).localeCompare(String(b.row.id)));
        const overlaps = valid.filter(interval => interval.start < end && interval.end > start);
        const fingerprintRows = [...new Map([...overlaps.map(item => item.row), ...unresolved]
            .map(row => [row.id, row])).values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
        const fingerprint = JSON.stringify(fingerprintRows.map(row => ({
            id: row.id, title: row.title ?? null, startAt: row.startAt ?? null,
            endAt: row.endAt ?? null, status: row.status || 'scheduled',
            updatedAt: row.updatedAt ?? null, rrule: canonicalValue(row.rrule), kind: row.kind ?? null
        })));
        const warnings = [];
        if (recurring) warnings.push('Hay eventos recurrentes sin ocurrencias expandidas; no puedo asegurar los horarios libres.');
        if (allDay) warnings.push('Hay eventos de día completo cuya cobertura no está resuelta; no puedo asegurar los horarios libres.');
        if (invalid) warnings.push('Hay eventos propios con fechas inválidas; corrígelos antes de confiar en los horarios libres.');
        const complete = unresolved.length === 0;
        const suggestions = [];
        if (complete && overlaps.length) {
            const duration = end - start, day = formatter.format(new Date(start));
            let candidate = start;
            while (suggestions.length < 3) {
                const candidateEnd = candidate + duration;
                // end - 1ms permits an exact midnight boundary, never the next day.
                if (formatter.format(new Date(candidate)) !== day
                    || formatter.format(new Date(candidateEnd - 1)) !== day) break;
                const blockers = valid.filter(interval => interval.start < candidateEnd && interval.end > candidate);
                if (blockers.length) {
                    candidate = Math.max(...blockers.map(interval => interval.end));
                    continue;
                }
                suggestions.push({ startAt: new Date(candidate).toISOString(), endAt: new Date(candidateEnd).toISOString() });
                candidate = candidateEnd;
            }
        }
        return {
            conflicts: overlaps.map(({ row }) => ({ id: row.id, title: row.title,
                startAt: row.startAt, endAt: row.endAt })),
            suggestions, complete, warnings, fingerprint
        };
    }

    function scheduleGuard(opts) {
        if (!Object.prototype.hasOwnProperty.call(opts, 'scheduleExpected')) return null;
        const expected = opts.scheduleExpected;
        if (!expected || typeof expected.fingerprint !== 'string') {
            throw new Error('EVENT_INVALID_SCHEDULE_GUARD');
        }
        scheduleDayFormatter(expected.timezone);
        return expected;
    }

    async function checkSchedule({ ownerId, startAt, endAt, excludeId, timezone } = {}) {
        const authenticatedOwner = currentOwner();
        if (!ownerId || (authenticatedOwner && ownerId !== authenticatedOwner)) {
            throw new Error('EVENT_OWNER_MISMATCH');
        }
        // Do not filter by start date: an interval may begin on a previous day.
        const rows = await list({ ownerId, includeCancelled: true });
        if (currentOwner() !== authenticatedOwner) throw new Error('EVENT_OWNER_MISMATCH');
        return inspectSchedule(rows, { ownerId, startAt, endAt, excludeId, timezone });
    }

    async function create(data, opts = {}) {
        const ownerId = currentOwner();
        if (ownerId && data.ownerId != null && data.ownerId !== ownerId) {
            throw new Error('EVENT_OWNER_MISMATCH');
        }
        if (typeof data.startAt !== 'string' || !Number.isFinite(Date.parse(data.startAt))) {
            throw new Error('EVENT_INVALID_DATES');
        }
        const event = {
            id: newId(),
            title: typeof data.title === 'string' ? data.title.trim() : data.title,
            startAt: data.startAt,
            endAt: data.endAt ?? addMinutes(data.startAt, 60),
            status: 'scheduled',
            kind: data.kind || 'instant',
            rrule: data.rrule || null,
            location: data.location || null,
            attendees: data.attendees || [],
            priority: data.priority || 'normal',
            projectId: data.projectId || null,
            tags: data.tags || [],
            ownerId: ownerId || data.ownerId || 'local-user',
            externalIds: {},
            source: data.source || 'manual',
            syncStatus: 'local',   // 'local' | 'synced' | 'pending' | 'error'
            syncError: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        validateEvent(event);
        const expectedSchedule = scheduleGuard(opts);
        const db = await openDB();
        try {
            await new Promise((res, rej) => {
                if (currentOwner() !== ownerId) throw new Error('EVENT_OWNER_MISMATCH');
                const t = db.transaction(STORE, 'readwrite');
                const store = t.objectStore(STORE);
                let failure = null;
                if (expectedSchedule) {
                    const request = store.getAll();
                    request.onsuccess = () => {
                        try {
                            if (currentOwner() !== ownerId) throw new Error('EVENT_OWNER_MISMATCH');
                            const schedule = inspectSchedule(request.result || [], {
                                ownerId: event.ownerId, startAt: event.startAt, endAt: event.endAt,
                                timezone: expectedSchedule.timezone
                            });
                            if (schedule.fingerprint !== expectedSchedule.fingerprint) {
                                throw new Error('EVENT_SCHEDULE_CHANGED');
                            }
                            store.add(event);
                        } catch (error) { failure = error; t.abort(); }
                    };
                } else store.add(event);
                t.oncomplete = res;
                t.onabort = t.onerror = () => rej(failure || t.error || new Error('EVENT_CREATE_ABORTED'));
            });
        } finally { db.close(); }
        emit('events-changed', { op: 'create', id: event.id });

        // Push to Google Calendar if requested + available
        if (data.pushToGoogle && window.GunterCalendarService?.pushEvent) {
            try {
                const ext = await window.GunterCalendarService.pushEvent(event);
                if (ext?.id) {
                    await update(event.id, {
                        externalIds: { google: ext.id, googleHtmlLink: ext.htmlLink || null },
                        syncStatus: 'synced'
                    });
                } else if (ext?.queued) {
                    await update(event.id, { syncStatus: 'pending' });
                }
            } catch (err) {
                await update(event.id, { syncStatus: 'error', syncError: String(err.message || err) });
            }
        }
        if (currentOwner() !== ownerId) throw new Error('EVENT_OWNER_MISMATCH');
        return event;
    }

    async function update(id, patch, opts = {}) {
        const guarded = Object.prototype.hasOwnProperty.call(opts, 'ownerId');
        const authenticatedOwner = currentOwner();
        if (guarded) {
            if (!opts.ownerId || (authenticatedOwner && opts.ownerId !== authenticatedOwner)) {
                throw new Error('EVENT_OWNER_MISMATCH');
            }
            const allowed = ['title', 'startAt', 'endAt', 'status', 'cancelledAt'];
            if (!patch || typeof patch !== 'object' || Array.isArray(patch)
                || Object.keys(patch).some(key => !allowed.includes(key))) {
                throw new Error('EVENT_PATCH_FORBIDDEN');
            }
        }
        const expectedSchedule = scheduleGuard(opts);
        const db = await openDB();
        let merged;
        try {
            merged = await new Promise((res, rej) => {
                const t = db.transaction(STORE, 'readwrite');
                const store = t.objectStore(STORE);
                let next = null, failure = null;
                const request = store.get(id);
                request.onsuccess = () => {
                    try {
                        const current = request.result;
                        if (!current) throw new Error('Event no encontrado');
                        if (currentOwner() !== authenticatedOwner) throw new Error('EVENT_OWNER_MISMATCH');
                        if (authenticatedOwner && current.ownerId !== authenticatedOwner) throw new Error('EVENT_OWNER_MISMATCH');
                        if (guarded && current.ownerId !== opts.ownerId) throw new Error('EVENT_OWNER_MISMATCH');
                        if (opts.statuses && !opts.statuses.includes(current.status || 'scheduled')) {
                            throw new Error('EVENT_STATUS_CHANGED');
                        }
                        if (opts.expected && Object.keys(opts.expected).some(key =>
                            !sameValue(snapshotValue(current, key), snapshotValue(opts.expected, key)))) {
                            throw new Error('EVENT_CHANGED');
                        }
                        next = { ...current, ...patch, updatedAt: new Date().toISOString() };
                        if (authenticatedOwner && (next.id !== current.id || next.ownerId !== current.ownerId)) {
                            throw new Error('EVENT_PATCH_FORBIDDEN');
                        }
                        if (Object.prototype.hasOwnProperty.call(patch, 'title') && typeof next.title === 'string') {
                            next.title = next.title.trim();
                        }
                        validateEvent(next);
                        if (expectedSchedule) {
                            const scheduleRequest = store.getAll();
                            scheduleRequest.onsuccess = () => {
                                try {
                                    if (currentOwner() !== authenticatedOwner) throw new Error('EVENT_OWNER_MISMATCH');
                                    const schedule = inspectSchedule(scheduleRequest.result || [], {
                                        ownerId: next.ownerId, startAt: next.startAt, endAt: next.endAt,
                                        excludeId: id, timezone: expectedSchedule.timezone
                                    });
                                    if (schedule.fingerprint !== expectedSchedule.fingerprint) {
                                        throw new Error('EVENT_SCHEDULE_CHANGED');
                                    }
                                    store.put(next);
                                } catch (error) { failure = error; t.abort(); }
                            };
                        } else store.put(next);
                    } catch (error) { failure = error; t.abort(); }
                };
                t.oncomplete = () => res(next);
                t.onabort = () => rej(failure || t.error || new Error('EVENT_UPDATE_ABORTED'));
                t.onerror = () => { failure ||= t.error; };
            });
        } finally { db.close(); }
        if (currentOwner() !== authenticatedOwner) throw new Error('EVENT_OWNER_MISMATCH');
        emit('events-changed', { op: 'update', id });

        // Push patch to Google if the event has an external id and caller wants sync
        if (!opts.skipSync
            && merged.externalIds?.google
            && window.GunterCalendarService?.updateEvent) {
            try {
                const res = await window.GunterCalendarService.updateEvent(merged.externalIds.google, merged);
                if (res?.gone) {
                    await update(id, { externalIds: {}, syncStatus: 'local' }, { skipSync: true });
                }
            } catch (err) {
                // Don't overwrite the user's change; just mark sync state
                await update(id, { syncStatus: 'error', syncError: String(err.message || err) }, { skipSync: true });
            }
        }
        if (currentOwner() !== authenticatedOwner) throw new Error('EVENT_OWNER_MISMATCH');
        return merged;
    }

    async function remove(id) {
        const authenticatedOwner = currentOwner();
        const db = await openDB();
        let existing;
        try {
            existing = await new Promise((res, rej) => {
                const t = db.transaction(STORE, 'readwrite');
                const store = t.objectStore(STORE);
                let record, failure = null;
                const request = store.get(id);
                request.onsuccess = () => {
                    try {
                        record = request.result;
                        if (currentOwner() !== authenticatedOwner) throw new Error('EVENT_OWNER_MISMATCH');
                        if (authenticatedOwner && record?.ownerId !== authenticatedOwner) {
                            throw new Error(record ? 'EVENT_OWNER_MISMATCH' : 'Event no encontrado');
                        }
                        store.delete(id);
                    } catch (error) { failure = error; t.abort(); }
                };
                t.oncomplete = () => res(record);
                t.onabort = () => rej(failure || t.error || new Error('EVENT_DELETE_ABORTED'));
                t.onerror = () => { failure ||= t.error; };
            });
        } finally { db.close(); }
        if (currentOwner() !== authenticatedOwner) throw new Error('EVENT_OWNER_MISMATCH');
        emit('events-changed', { op: 'delete', id });

        if (existing?.externalIds?.google && window.GunterCalendarService?.deleteEvent) {
            try { await window.GunterCalendarService.deleteEvent(existing.externalIds.google); } catch {}
        }
        if (currentOwner() !== authenticatedOwner) throw new Error('EVENT_OWNER_MISMATCH');
        return { id };
    }

    async function list({ from, to, projectId, ownerId, includeCancelled = false } = {}) {
        let authenticatedOwner;
        try { authenticatedOwner = currentOwner(); } catch { return []; }
        if (authenticatedOwner && ownerId != null && ownerId !== authenticatedOwner) return [];
        const filterOwner = authenticatedOwner || ownerId;
        const db = await openDB();
        let all;
        try {
            all = await new Promise((res, rej) => {
                const r = db.transaction(STORE).objectStore(STORE).getAll();
                r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
            });
        } finally { db.close(); }
        try { if (currentOwner() !== authenticatedOwner) return []; } catch { return []; }
        const fromTime = from ? Date.parse(from) : null;
        const toTime = to ? Date.parse(to) : null;
        return all.filter(e => {
            if (filterOwner && e.ownerId !== filterOwner) return false;
            if (!includeCancelled && e.status === 'cancelled') return false;
            if (projectId && e.projectId !== projectId) return false;
            const startTime = Date.parse(e.startAt);
            if (from && e.startAt && startTime < fromTime) return false;
            if (to && e.startAt && startTime > toTime) return false;
            return true;
        }).sort((a, b) => {
            const aTime = Date.parse(a.startAt), bTime = Date.parse(b.startAt);
            return (Number.isFinite(aTime) ? aTime : Infinity) - (Number.isFinite(bTime) ? bTime : Infinity);
        });
    }

    async function listForToday() {
        const timezone = window.GunterPresence?.timezone?.()
            || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        const formatter = new Intl.DateTimeFormat('en-CA', {
            timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
        });
        const today = formatter.format(new Date());
        const all = await list();
        return all.filter(e => {
            const startTime = Date.parse(e.startAt);
            return Number.isFinite(startTime) && formatter.format(new Date(startTime)) === today;
        });
    }

    async function listUpcoming(limit = 10) {
        const now = Date.now();
        const all = await list();
        return all.filter(e => Date.parse(e.startAt) >= now).slice(0, limit);
    }

    function addMinutes(iso, mins) {
        const d = new Date(iso); d.setMinutes(d.getMinutes() + mins); return d.toISOString();
    }

    function emit(name, detail) {
        window.dispatchEvent(new CustomEvent(name, { detail }));
    }

    window.GunterEventsService = {
        create, update, remove, list, listForToday, listUpcoming, checkSchedule
    };
})();
