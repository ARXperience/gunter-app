/* =============================================
   GUNTER SERVICE - Tasks
   -------------------------------------------------
   CRUD de tareas en IndexedDB. Estado:
     status: pending | doing | done | cancelled
   Filtros por día, prioridad, proyecto.
   ============================================= */

(function () {
    const DB_NAME = 'gunter_daily';
    const DB_VERSION = 2;
    const STORE = 'tasks';

    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = req.result;
                const oldVersion = e.oldVersion;
                if (!db.objectStoreNames.contains(STORE)) {
                    const s = db.createObjectStore(STORE, { keyPath: 'id' });
                    s.createIndex('status', 'status');
                    s.createIndex('dueAt', 'dueAt');
                    s.createIndex('projectId', 'projectId');
                    s.createIndex('ownerId', 'ownerId');
                    s.createIndex('source', 'source');
                } else if (oldVersion < 2) {
                    // Migrate: add source index to existing store
                    const tx = e.target.transaction;
                    const s = tx.objectStore(STORE);
                    if (!s.indexNames.contains('source')) s.createIndex('source', 'source');
                }
                if (!db.objectStoreNames.contains('events')) {
                    const s2 = db.createObjectStore('events', { keyPath: 'id' });
                    s2.createIndex('startAt', 'startAt');
                    s2.createIndex('projectId', 'projectId');
                    s2.createIndex('ownerId', 'ownerId');
                }
                if (!db.objectStoreNames.contains('reminders')) {
                    const s3 = db.createObjectStore('reminders', { keyPath: 'id' });
                    s3.createIndex('fireAt', 'fireAt');
                    s3.createIndex('status', 'status');
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    function tx(mode = 'readonly', store = STORE) {
        return openDB().then(db => ({ db, tx: db.transaction(store, mode), store: db.transaction(store, mode).objectStore(store) }));
    }

    function newId() {
        return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    }

    async function create(data) {
        const task = {
            id: newId(),
            title: data.title,
            notes: data.notes || '',
            status: 'pending',
            priority: data.priority || 'normal',
            dueAt: data.dueAt || null,
            projectId: data.projectId || null,
            projectName: data.projectName || null,
            ownerId: data.ownerId || 'local-user',
            people: data.people || [],
            tags: data.tags || [],
            source: data.source || 'manual',
            meta: data.meta || null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        const db = await openDB();
        await new Promise((res, rej) => {
            const t = db.transaction(STORE, 'readwrite');
            t.objectStore(STORE).add(task);
            t.oncomplete = res; t.onerror = () => rej(t.error);
        });
        db.close();
        emit('tasks-changed', { op: 'create', id: task.id });
        return task;
    }

    async function update(id, patch, guard = {}) {
        const db = await openDB();
        try {
            const merged = await new Promise((res, rej) => {
                const t = db.transaction(STORE, 'readwrite');
                const store = t.objectStore(STORE);
                let next = null, failure = null;
                const request = store.get(id);
                request.onsuccess = () => {
                    const current = request.result;
                    if (!current) failure = new Error('Task no encontrada');
                    else if (guard.ownerId && current.ownerId !== guard.ownerId) failure = new Error('TASK_OWNER_MISMATCH');
                    else if (guard.statuses && !guard.statuses.includes(current.status)) failure = new Error('TASK_STATUS_CHANGED');
                    else if (guard.expected && Object.entries(guard.expected).some(([key, value]) => (current[key] || null) !== (value || null)))
                        failure = new Error('TASK_CHANGED');
                    if (failure) { t.abort(); return; }
                    next = { ...current, ...patch, updatedAt: new Date().toISOString() };
                    store.put(next);
                };
                t.oncomplete = () => res(next);
                t.onabort = () => rej(failure || t.error || new Error('TASK_UPDATE_ABORTED'));
                t.onerror = () => { failure ||= t.error; };
            });
            emit('tasks-changed', { op: 'update', id });
            return merged;
        } finally { db.close(); }
    }

    async function complete(id, ownerId) {
        const merged = await update(id, { status: 'done', completedAt: new Date().toISOString() },
            ownerId ? { ownerId, statuses: ['pending', 'doing'] } : {});
        // v2 (F2) — auto-reconcile: ¿esta tarea cumple algún compromiso pendiente?
        try {
            if (window.GunterCommitmentsService?.reconcile) {
                window.GunterCommitmentsService.reconcile({
                    id: merged.id,
                    title: merged.title,
                    description: merged.notes || '',
                    type: 'task'
                }).then(r => {
                    if (r?.updated > 0) {
                        (window.GunterNotificationsService?.showToast || (() => {}))(
                            `🤝 ${r.updated} compromiso${r.updated > 1 ? 's' : ''} cumplido${r.updated > 1 ? 's' : ''} con esta tarea.`,
                            { variant: 'success', duration: 4000 }
                        );
                        window.dispatchEvent(new CustomEvent('gunter-commitments-changed'));
                    }
                }).catch(() => {});
            }
        } catch { /* noop */ }
        return merged;
    }
    async function reopen(id, ownerId) { return update(id, { status: 'pending', completedAt: null },
        ownerId ? { ownerId, statuses: ['done'] } : {}); }

    async function remove(id) {
        const db = await openDB();
        await new Promise((res, rej) => {
            const t = db.transaction(STORE, 'readwrite');
            t.objectStore(STORE).delete(id);
            t.oncomplete = res; t.onerror = () => rej(t.error);
        });
        db.close();
        emit('tasks-changed', { op: 'delete', id });
        return { id };
    }

    async function list({ status, projectId, from, to } = {}) {
        const db = await openDB();
        const all = await new Promise((res, rej) => {
            const r = db.transaction(STORE).objectStore(STORE).getAll();
            r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
        });
        db.close();
        return all.filter(t => {
            if (status && t.status !== status) return false;
            if (projectId && t.projectId !== projectId) return false;
            if (from && t.dueAt && t.dueAt < from) return false;
            if (to && t.dueAt && t.dueAt > to) return false;
            return true;
        }).sort((a, b) => {
            if (a.status !== b.status) {
                const order = { pending: 0, doing: 1, done: 2, cancelled: 3 };
                return order[a.status] - order[b.status];
            }
            return (a.dueAt || '9999') < (b.dueAt || '9999') ? -1 : 1;
        });
    }

    async function listForToday(ctx) {
        const tz = ctx?.timezone || 'UTC';
        const dayStart = startOfDayIso(new Date(), tz);
        const dayEnd = endOfDayIso(new Date(), tz);
        const all = await list();
        return all.filter(t => {
            if (t.status === 'done' || t.status === 'cancelled') return false;
            if (!t.dueAt) return t.status === 'pending';  // include undated pending
            return t.dueAt >= dayStart && t.dueAt <= dayEnd;
        });
    }

    async function listOverdue() {
        const now = new Date().toISOString();
        const all = await list();
        return all.filter(t => t.status === 'pending' && t.dueAt && t.dueAt < now);
    }

    function startOfDayIso(date, tz) {
        const d = new Date(date); d.setHours(0, 0, 0, 0);
        return d.toISOString();
    }
    function endOfDayIso(date, tz) {
        const d = new Date(date); d.setHours(23, 59, 59, 999);
        return d.toISOString();
    }

    function emit(name, detail) {
        window.dispatchEvent(new CustomEvent(name, { detail }));
    }

    async function listBySource(source) {
        const all = await list();
        return all.filter(t => t.source === source);
    }

    window.GunterTasksService = {
        create, update, complete, reopen, remove, list, listForToday, listOverdue, listBySource
    };
})();
