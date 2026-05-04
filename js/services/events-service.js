/* =============================================
   GUNTER SERVICE - Events (local calendar)
   -------------------------------------------------
   CRUD de eventos. Comparte BD `gunter_daily`
   (store 'events') con tasks-service.
   `pushToGoogle` queda como hook para fase futura.
   ============================================= */

(function () {
    const DB_NAME = 'gunter_daily';
    const STORE = 'events';

    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    function newId() {
        return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    }

    async function create(data) {
        const event = {
            id: newId(),
            title: data.title,
            startAt: data.startAt,
            endAt: data.endAt || addMinutes(data.startAt, 60),
            kind: data.kind || 'instant',
            rrule: data.rrule || null,
            location: data.location || null,
            attendees: data.attendees || [],
            priority: data.priority || 'normal',
            projectId: data.projectId || null,
            tags: data.tags || [],
            ownerId: data.ownerId || 'local-user',
            externalIds: {},
            source: data.source || 'manual',
            syncStatus: 'local',   // 'local' | 'synced' | 'pending' | 'error'
            syncError: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        const db = await openDB();
        await new Promise((res, rej) => {
            const t = db.transaction(STORE, 'readwrite');
            t.objectStore(STORE).add(event);
            t.oncomplete = res; t.onerror = () => rej(t.error);
        });
        db.close();
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
        return event;
    }

    async function update(id, patch, opts = {}) {
        const db = await openDB();
        const current = await new Promise((res, rej) => {
            const r = db.transaction(STORE).objectStore(STORE).get(id);
            r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
        });
        if (!current) { db.close(); throw new Error('Event no encontrado'); }
        const merged = { ...current, ...patch, updatedAt: new Date().toISOString() };
        await new Promise((res, rej) => {
            const t = db.transaction(STORE, 'readwrite');
            t.objectStore(STORE).put(merged);
            t.oncomplete = res; t.onerror = () => rej(t.error);
        });
        db.close();
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
        return merged;
    }

    async function remove(id) {
        // Read first so we can also remove from Google
        const db = await openDB();
        const existing = await new Promise((res, rej) => {
            const r = db.transaction(STORE).objectStore(STORE).get(id);
            r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
        });
        await new Promise((res, rej) => {
            const t = db.transaction(STORE, 'readwrite');
            t.objectStore(STORE).delete(id);
            t.oncomplete = res; t.onerror = () => rej(t.error);
        });
        db.close();
        emit('events-changed', { op: 'delete', id });

        if (existing?.externalIds?.google && window.GunterCalendarService?.deleteEvent) {
            try { await window.GunterCalendarService.deleteEvent(existing.externalIds.google); } catch {}
        }
        return { id };
    }

    async function list({ from, to, projectId } = {}) {
        const db = await openDB();
        const all = await new Promise((res, rej) => {
            const r = db.transaction(STORE).objectStore(STORE).getAll();
            r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
        });
        db.close();
        return all.filter(e => {
            if (projectId && e.projectId !== projectId) return false;
            if (from && e.startAt && e.startAt < from) return false;
            if (to && e.startAt && e.startAt > to) return false;
            return true;
        }).sort((a, b) => (a.startAt || '') < (b.startAt || '') ? -1 : 1);
    }

    async function listForToday() {
        const d = new Date();
        const start = new Date(d); start.setHours(0, 0, 0, 0);
        const end = new Date(d); end.setHours(23, 59, 59, 999);
        return list({ from: start.toISOString(), to: end.toISOString() });
    }

    async function listUpcoming(limit = 10) {
        const now = new Date().toISOString();
        const all = await list();
        return all.filter(e => e.startAt >= now).slice(0, limit);
    }

    function addMinutes(iso, mins) {
        const d = new Date(iso); d.setMinutes(d.getMinutes() + mins); return d.toISOString();
    }

    function emit(name, detail) {
        window.dispatchEvent(new CustomEvent(name, { detail }));
    }

    window.GunterEventsService = {
        create, update, remove, list, listForToday, listUpcoming
    };
})();
