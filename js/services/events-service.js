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
    const REMINDERS_STORE = 'reminders';

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

    const PLANNING_KEY = 'gunter_prefs';
    const PLANNING_DEFAULTS = {
        respectWorkingHours: false, workingDays: [1, 2, 3, 4, 5],
        workStart: '09:00', workEnd: '18:00', bufferMinutes: 0
    };

    function planningDefaults() {
        return { ...PLANNING_DEFAULTS, workingDays: [...PLANNING_DEFAULTS.workingDays] };
    }

    function planningObject(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value);
    }

    function validatePlanning(patch, base = planningDefaults(), error = 'EVENT_PLANNING_INVALID') {
        const keys = Object.keys(PLANNING_DEFAULTS);
        if (!planningObject(patch) || Object.keys(patch).some(key => !keys.includes(key))) throw new Error(error);
        const next = { ...base, ...patch };
        if (typeof next.respectWorkingHours !== 'boolean'
            || !Array.isArray(next.workingDays) || !next.workingDays.length
            || next.workingDays.some(day => !Number.isInteger(day) || day < 0 || day > 6)
            || new Set(next.workingDays).size !== next.workingDays.length
            || typeof next.workStart !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(next.workStart)
            || typeof next.workEnd !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(next.workEnd)
            || next.workStart >= next.workEnd
            || !Number.isInteger(next.bufferMinutes) || next.bufferMinutes < 0 || next.bufferMinutes > 120) {
            throw new Error(error);
        }
        return { ...next, workingDays: [...next.workingDays].sort((a, b) => a - b) };
    }

    function planningOwner(ownerId) {
        const authenticatedOwner = currentOwner();
        if (authenticatedOwner && ownerId != null && ownerId !== authenticatedOwner) {
            throw new Error('EVENT_OWNER_MISMATCH');
        }
        return authenticatedOwner;
    }

    function readPlanningStorage() {
        let storage, raw;
        try { storage = window.localStorage; raw = storage?.getItem(PLANNING_KEY); }
        catch { throw new Error('EVENT_PLANNING_STORAGE'); }
        if (raw == null) return { storage, preferences: {}, byAccount: {} };
        let preferences;
        try { preferences = JSON.parse(raw); }
        catch { throw new Error('EVENT_PLANNING_CORRUPT'); }
        if (!planningObject(preferences)) throw new Error('EVENT_PLANNING_CORRUPT');
        const byAccount = Object.prototype.hasOwnProperty.call(preferences, 'calendarPlanningByAccount')
            ? preferences.calendarPlanningByAccount : {};
        if (!planningObject(byAccount)) throw new Error('EVENT_PLANNING_CORRUPT');
        return { storage, preferences, byAccount };
    }

    function getPlanningPreferences(ownerId) {
        const owner = planningOwner(ownerId);
        // Standalone consumers have no authenticated profile to assign settings to.
        if (!owner) return planningDefaults();
        const { byAccount } = readPlanningStorage();
        if (currentOwner() !== owner) throw new Error('EVENT_OWNER_MISMATCH');
        if (!Object.prototype.hasOwnProperty.call(byAccount, owner)) return planningDefaults();
        return validatePlanning(byAccount[owner], planningDefaults(), 'EVENT_PLANNING_CORRUPT');
    }

    function validatePlanningPreferences(patch, ownerId) {
        const owner = planningOwner(ownerId);
        if (!owner) throw new Error('EVENT_AUTH_REQUIRED');
        return validatePlanning(patch, getPlanningPreferences(owner));
    }

    function updatePlanningPreferences(patch, ownerId, opts = {}) {
        const owner = planningOwner(ownerId);
        if (!owner) throw new Error('EVENT_AUTH_REQUIRED');
        const { storage, preferences, byAccount } = readPlanningStorage();
        const current = Object.prototype.hasOwnProperty.call(byAccount, owner)
            ? validatePlanning(byAccount[owner], planningDefaults(), 'EVENT_PLANNING_CORRUPT') : planningDefaults();
        if (Object.prototype.hasOwnProperty.call(opts, 'expected')) {
            const expected = validatePlanning(opts.expected);
            if (!sameValue(current, expected)) throw new Error('EVENT_PLANNING_CHANGED');
        }
        const next = validatePlanning(patch, current);
        if (currentOwner() !== owner) throw new Error('EVENT_OWNER_MISMATCH');
        if (!storage || typeof storage.setItem !== 'function') throw new Error('EVENT_PLANNING_STORAGE');
        try {
            storage.setItem(PLANNING_KEY, JSON.stringify({ ...preferences,
                calendarPlanningByAccount: { ...byAccount, [owner]: next } }));
        } catch { throw new Error('EVENT_PLANNING_STORAGE'); }
        emit('gunter-calendar-preferences-change', { ownerId: owner });
        return { ...next, workingDays: [...next.workingDays] };
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

    function reminderOwner(ownerId) {
        const owner = currentOwner();
        if (!owner) throw new Error('EVENT_AUTH_REQUIRED');
        if (ownerId != null && ownerId !== owner) throw new Error('EVENT_OWNER_MISMATCH');
        return owner;
    }

    function reminderLink(reminder) {
        const link = reminder?.meta?.eventLink;
        return link && link.version === 1 && typeof link.eventId === 'string' && link.eventId
            && Number.isSafeInteger(link.offsetMs) && link.offsetMs >= 0
            && typeof link.startAt === 'string' && Number.isFinite(Date.parse(link.startAt)) ? link : null;
    }

    function localReminderEvent(event) {
        return event && (!event.status || event.status === 'scheduled')
            && !event.rrule && event.kind !== 'recurring' && event.kind !== 'allDay'
            && !Object.values(event.externalIds || {}).some(Boolean)
            && (!event.syncStatus || event.syncStatus === 'local')
            && typeof event.title === 'string' && event.title.trim()
            && typeof event.startAt === 'string' && typeof event.endAt === 'string'
            && Number.isFinite(Date.parse(event.startAt)) && Number.isFinite(Date.parse(event.endAt))
            && Date.parse(event.endAt) > Date.parse(event.startAt);
    }

    function cancelledReminder(reminder, reason) {
        const now = new Date().toISOString();
        return { ...reminder, status: 'cancelled', updatedAt: now, cancelledAt: now,
            meta: { ...reminder.meta, cancellationReason: reason } };
    }

    function reminderWrite(store, method, value, owner, fail) {
        const request = store[method](value);
        request.onsuccess = () => {
            try { if (currentOwner() !== owner) throw new Error('EVENT_OWNER_MISMATCH'); }
            catch (error) { fail(error); }
        };
        return request;
    }

    // Event and linked notices live in the same database. Never leave an old
    // notice armed after a successful calendar change, even if a write fails.
    function adjustEventReminders(transaction, before, after, owner, complete, fail) {
        if (!owner || before?.ownerId !== owner) { complete(); return; }
        const store = transaction.objectStore(REMINDERS_STORE);
        const request = store.getAll();
        request.onsuccess = () => {
            try {
                if (currentOwner() !== owner) throw new Error('EVENT_OWNER_MISMATCH');
                let changed = false;
                for (const reminder of request.result || []) {
                    const link = reminderLink(reminder);
                    if (reminder.ownerId !== owner || reminder.status !== 'scheduled'
                        || !link || link.eventId !== before.id) continue;
                    let next;
                    if (!after || !localReminderEvent(after)
                        || link.startAt !== before.startAt
                        || Date.parse(reminder.fireAt) !== Date.parse(before.startAt) - link.offsetMs) {
                        next = cancelledReminder(reminder, after ? 'event_unavailable' : 'event_removed');
                    } else {
                        const fire = Date.parse(after.startAt) - link.offsetMs;
                        if (fire <= Date.now() && after.startAt !== before.startAt) {
                            next = cancelledReminder(reminder, 'event_rescheduled_past_notice');
                        }
                        else next = { ...reminder, title: after.title, fireAt: new Date(fire).toISOString(),
                            updatedAt: new Date().toISOString(),
                            meta: { ...reminder.meta, eventLink: { ...link, startAt: after.startAt } } };
                    }
                    if (!sameValue({ ...reminder, updatedAt: null }, { ...next, updatedAt: null })) {
                        reminderWrite(store, 'put', next, owner, fail); changed = true;
                    }
                }
                complete(changed);
            } catch (error) { fail(error); }
        };
    }

    async function scheduleReminder(eventId, { fireAt, ownerId, expected } = {}) {
        const owner = reminderOwner(ownerId);
        const fire = typeof fireAt === 'string' ? Date.parse(fireAt) : NaN;
        const snapshotKeys = ['title', 'startAt', 'endAt', 'status', 'updatedAt', 'rrule', 'externalIds'];
        if (typeof eventId !== 'string' || !eventId || !Number.isFinite(fire) || fire <= Date.now()
            || !expected || typeof expected !== 'object' || Array.isArray(expected)
            || snapshotKeys.some(key => !Object.prototype.hasOwnProperty.call(expected, key))) {
            throw new Error('EVENT_REMINDER_INVALID');
        }
        const db = await openDB();
        let saved, created = false;
        try {
            saved = await new Promise((resolve, reject) => {
                if (currentOwner() !== owner) throw new Error('EVENT_OWNER_MISMATCH');
                const transaction = db.transaction([STORE, REMINDERS_STORE], 'readwrite');
                const events = transaction.objectStore(STORE), reminders = transaction.objectStore(REMINDERS_STORE);
                let result, failure = null;
                const fail = error => { failure = error; transaction.abort(); };
                const request = events.get(eventId);
                request.onsuccess = () => {
                    try {
                        const event = request.result;
                        if (currentOwner() !== owner || (event && event.ownerId !== owner)) throw new Error('EVENT_OWNER_MISMATCH');
                        if (!event) throw new Error('EVENT_REMINDER_NOT_FOUND');
                        if (snapshotKeys.some(key => !sameValue(snapshotValue(event, key), snapshotValue(expected, key)))) {
                            throw new Error('EVENT_CHANGED');
                        }
                        if (!localReminderEvent(event)) throw new Error('EVENT_REMINDER_UNSUPPORTED');
                        const start = Date.parse(event.startAt), offsetMs = start - fire;
                        if (start <= Date.now() || fire <= Date.now() || !Number.isSafeInteger(offsetMs) || offsetMs < 0) {
                            throw new Error('EVENT_REMINDER_INVALID');
                        }
                        const allRequest = reminders.getAll();
                        allRequest.onsuccess = () => {
                            try {
                                if (currentOwner() !== owner) throw new Error('EVENT_OWNER_MISMATCH');
                                result = (allRequest.result || []).find(reminder => {
                                    const link = reminderLink(reminder);
                                    return reminder.ownerId === owner && reminder.status === 'scheduled'
                                        && link?.eventId === eventId && link.offsetMs === offsetMs;
                                });
                                if (result) return;
                                const now = new Date().toISOString();
                                result = { id: `rem_evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`,
                                    ownerId: owner, title: event.title, priority: 'normal', status: 'scheduled',
                                    createdAt: now, updatedAt: now, fireAt: new Date(fire).toISOString(), durable: false,
                                    meta: { eventLink: { version: 1, eventId, offsetMs, startAt: event.startAt } } };
                                reminderWrite(reminders, 'add', result, owner, fail); created = true;
                            } catch (error) { fail(error); }
                        };
                    } catch (error) { fail(error); }
                };
                transaction.oncomplete = () => resolve(result);
                transaction.onabort = () => reject(failure || transaction.error || new Error('EVENT_REMINDER_ABORTED'));
                transaction.onerror = () => { failure ||= transaction.error; };
            });
        } finally { db.close(); }
        if (currentOwner() !== owner) throw new Error('EVENT_OWNER_MISMATCH');
        if (created) emit('reminders-changed', { op: 'create', id: saved.id, eventId, linked: true });
        return saved;
    }

    async function getReminder(id) {
        const owner = reminderOwner();
        const db = await openDB();
        let reminder;
        try {
            reminder = await new Promise((resolve, reject) => {
                const request = db.transaction(REMINDERS_STORE).objectStore(REMINDERS_STORE).get(id);
                request.onsuccess = () => resolve(request.result || null);
                request.onerror = () => reject(request.error);
            });
        } finally { db.close(); }
        if (currentOwner() !== owner) throw new Error('EVENT_OWNER_MISMATCH');
        if (reminder && reminder.ownerId !== owner) throw new Error('EVENT_OWNER_MISMATCH');
        return reminder && reminderLink(reminder) ? reminder : null;
    }

    async function changeReminder(id, claim) {
        const owner = reminderOwner();
        const db = await openDB();
        let result, changed = false;
        try {
            result = await new Promise((resolve, reject) => {
                if (currentOwner() !== owner) throw new Error('EVENT_OWNER_MISMATCH');
                const transaction = db.transaction([STORE, REMINDERS_STORE], 'readwrite');
                const reminders = transaction.objectStore(REMINDERS_STORE), events = transaction.objectStore(STORE);
                let outcome = { reminder: null, fired: false }, failure = null;
                const fail = error => { failure = error; transaction.abort(); };
                const request = reminders.get(id);
                request.onsuccess = () => {
                    try {
                        const reminder = request.result;
                        if (currentOwner() !== owner || (reminder && reminder.ownerId !== owner)) throw new Error('EVENT_OWNER_MISMATCH');
                        if (!reminder || !reminderLink(reminder)) {
                            if (!claim) throw new Error('EVENT_REMINDER_NOT_FOUND');
                            return;
                        }
                        outcome.reminder = reminder;
                        if (reminder.status !== 'scheduled') return;
                        if (!claim) {
                            outcome.reminder = cancelledReminder(reminder, 'user_cancelled');
                            reminderWrite(reminders, 'put', outcome.reminder, owner, fail); changed = true;
                            return;
                        }
                        const link = reminderLink(reminder), eventRequest = events.get(link.eventId);
                        eventRequest.onsuccess = () => {
                            try {
                                if (currentOwner() !== owner) throw new Error('EVENT_OWNER_MISMATCH');
                                const event = eventRequest.result;
                                const valid = event?.ownerId === owner && localReminderEvent(event)
                                    && link.startAt === event.startAt
                                    && Date.parse(reminder.fireAt) === Date.parse(event.startAt) - link.offsetMs;
                                if (!valid || Date.parse(event.endAt) <= Date.now()) {
                                    outcome = { reminder: cancelledReminder(reminder, valid ? 'event_elapsed' : 'event_unavailable'), cancelled: true };
                                    reminderWrite(reminders, 'put', outcome.reminder, owner, fail); changed = true;
                                } else if (Date.parse(reminder.fireAt) > Date.now()) outcome = { reminder, waiting: true };
                                else {
                                    const now = new Date().toISOString();
                                    outcome = { reminder: { ...reminder, status: 'fired', firedAt: now, updatedAt: now }, fired: true };
                                    reminderWrite(reminders, 'put', outcome.reminder, owner, fail); changed = true;
                                }
                            } catch (error) { fail(error); }
                        };
                    } catch (error) { fail(error); }
                };
                transaction.oncomplete = () => resolve(outcome);
                transaction.onabort = () => reject(failure || transaction.error || new Error('EVENT_REMINDER_ABORTED'));
                transaction.onerror = () => { failure ||= transaction.error; };
            });
        } finally { db.close(); }
        if (currentOwner() !== owner) throw new Error('EVENT_OWNER_MISMATCH');
        if (changed) emit('reminders-changed', { op: claim ? 'claim' : 'cancel', id, linked: true });
        return claim ? result : result.reminder;
    }

    const cancelReminder = id => changeReminder(id, false);
    const claimReminder = id => changeReminder(id, true);

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

    // Build bounded real-time segments for the requested local day. Looking at
    // Intl parts, not host hours, handles skipped and repeated DST minutes.
    function workingWindows(start, formatter, policy) {
        if (!policy.respectWorkingHours) return null;
        const timezone = formatter.resolvedOptions().timeZone;
        const local = new Intl.DateTimeFormat('en-GB', { timeZone: timezone,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
        const parts = instant => Object.fromEntries(local.formatToParts(new Date(instant))
            .filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
        const target = parts(start);
        const weekday = new Date(`${target.year}-${target.month}-${target.day}T12:00:00Z`).getUTCDay();
        if (!policy.workingDays.includes(weekday)) return [];
        const minutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
        const fromMinute = minutes(policy.workStart), toMinute = minutes(policy.workEnd);
        const windows = [], anchor = Math.floor(start / 60000) * 60000;
        let open = null;
        for (let instant = anchor - 36 * 3600000; instant <= anchor + 36 * 3600000; instant += 60000) {
            const item = parts(instant), minute = Number(item.hour) * 60 + Number(item.minute);
            const allowed = item.year === target.year && item.month === target.month && item.day === target.day
                && minute >= fromMinute && minute < toMinute;
            if (allowed) {
                if (open == null) { open = instant; windows.push({ start: instant, end: instant + 60000 }); }
                else windows[windows.length - 1].end = instant + 60000;
            } else open = null;
        }
        return windows;
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
        const planningPreferences = getPlanningPreferences(ownerId);
        const buffer = planningPreferences.bufferMinutes * 60000;
        const workWindows = workingWindows(start, formatter, planningPreferences);
        const outsideWorkingHours = workWindows !== null
            && !workWindows.some(window => start >= window.start && end <= window.end);
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
        const bufferOnly = valid.filter(interval => interval.start - buffer < end && interval.end + buffer > start
            && !(interval.start < end && interval.end > start));
        const fingerprintRows = [...new Map([...overlaps.map(item => item.row), ...bufferOnly.map(item => item.row), ...unresolved]
            .map(row => [row.id, row])).values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
        const fingerprint = JSON.stringify({ planningPreferences: canonicalValue(planningPreferences), rows: fingerprintRows.map(row => ({
            id: row.id, title: row.title ?? null, startAt: row.startAt ?? null,
            endAt: row.endAt ?? null, status: row.status || 'scheduled',
            updatedAt: row.updatedAt ?? null, rrule: canonicalValue(row.rrule), kind: row.kind ?? null
        })) });
        const warnings = [];
        if (bufferOnly.length) warnings.push(`Este horario no respeta el margen de ${planningPreferences.bufferMinutes} minutos entre reuniones.`);
        if (outsideWorkingHours) warnings.push(`Este horario queda fuera de tus días y jornada configurados (${planningPreferences.workStart}–${planningPreferences.workEnd}).`);
        if (recurring) warnings.push('Hay eventos recurrentes sin ocurrencias expandidas; no puedo asegurar los horarios libres.');
        if (allDay) warnings.push('Hay eventos de día completo cuya cobertura no está resuelta; no puedo asegurar los horarios libres.');
        if (invalid) warnings.push('Hay eventos propios con fechas inválidas; corrígelos antes de confiar en los horarios libres.');
        const complete = unresolved.length === 0;
        const suggestions = [];
        if (complete && (overlaps.length || bufferOnly.length || outsideWorkingHours)) {
            const duration = end - start, day = formatter.format(new Date(start));
            let candidate = start;
            while (suggestions.length < 3) {
                if (workWindows !== null) {
                    const window = workWindows.find(window => Math.max(candidate, window.start) + duration <= window.end);
                    if (!window) break;
                    candidate = Math.max(candidate, window.start);
                }
                const candidateEnd = candidate + duration;
                // end - 1ms permits an exact midnight boundary, never the next day.
                if (formatter.format(new Date(candidate)) !== day
                    || formatter.format(new Date(candidateEnd - 1)) !== day) break;
                const blockers = valid.filter(interval => interval.start - buffer < candidateEnd && interval.end + buffer > candidate);
                if (blockers.length) {
                    candidate = Math.max(...blockers.map(interval => interval.end + buffer));
                    continue;
                }
                suggestions.push({ startAt: new Date(candidate).toISOString(), endAt: new Date(candidateEnd).toISOString() });
                candidate = candidateEnd;
            }
        }
        return {
            conflicts: overlaps.map(({ row }) => ({ id: row.id, title: row.title,
                startAt: row.startAt, endAt: row.endAt })),
            bufferConflicts: bufferOnly.map(({ row }) => ({ id: row.id, title: row.title,
                startAt: row.startAt, endAt: row.endAt })),
            outsideWorkingHours, planningPreferences, suggestions, complete, warnings, fingerprint
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
        let merged, remindersChanged = false;
        try {
            merged = await new Promise((res, rej) => {
                const t = db.transaction([STORE, REMINDERS_STORE], 'readwrite');
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
                        const save = () => adjustEventReminders(t, current, next, authenticatedOwner, changed => {
                            remindersChanged = changed || false;
                            if (authenticatedOwner) reminderWrite(store, 'put', next, authenticatedOwner,
                                error => { failure = error; t.abort(); });
                            else store.put(next);
                        }, error => { failure = error; t.abort(); });
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
                                    save();
                                } catch (error) { failure = error; t.abort(); }
                            };
                        } else save();
                    } catch (error) { failure = error; t.abort(); }
                };
                t.oncomplete = () => res(next);
                t.onabort = () => rej(failure || t.error || new Error('EVENT_UPDATE_ABORTED'));
                t.onerror = () => { failure ||= t.error; };
            });
        } finally { db.close(); }
        if (currentOwner() !== authenticatedOwner) throw new Error('EVENT_OWNER_MISMATCH');
        emit('events-changed', { op: 'update', id });
        if (remindersChanged) emit('reminders-changed', { op: 'event-update', eventId: id, linked: true });

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
        let existing, remindersChanged = false;
        try {
            existing = await new Promise((res, rej) => {
                const t = db.transaction([STORE, REMINDERS_STORE], 'readwrite');
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
                        adjustEventReminders(t, record, null, authenticatedOwner, changed => {
                            remindersChanged = changed || false;
                            if (authenticatedOwner) reminderWrite(store, 'delete', id, authenticatedOwner,
                                error => { failure = error; t.abort(); });
                            else store.delete(id);
                        }, error => { failure = error; t.abort(); });
                    } catch (error) { failure = error; t.abort(); }
                };
                t.oncomplete = () => res(record);
                t.onabort = () => rej(failure || t.error || new Error('EVENT_DELETE_ABORTED'));
                t.onerror = () => { failure ||= t.error; };
            });
        } finally { db.close(); }
        if (currentOwner() !== authenticatedOwner) throw new Error('EVENT_OWNER_MISMATCH');
        emit('events-changed', { op: 'delete', id });
        if (remindersChanged) emit('reminders-changed', { op: 'event-delete', eventId: id, linked: true });

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
        create, update, remove, list, listForToday, listUpcoming, checkSchedule,
        getPlanningPreferences, validatePlanningPreferences, updatePlanningPreferences,
        scheduleReminder, getReminder, cancelReminder, claimReminder
    };
})();
