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
        const auth = window.GunterAuth, user = auth?.getUser?.();
        const account = user?.status === 'approved' && auth?.canAccessLocalData?.() === true
            && window.localStorage?.getItem('gunter_device_user') === user.id ? user.id : null;
        if (account && data.ownerId && data.ownerId !== account && data.ownerId !== 'local-user') throw new Error('TASK_OWNER_MISMATCH');
        const task = {
            id: newId(),
            title: data.title,
            notes: data.notes || '',
            status: 'pending',
            priority: data.priority || 'normal',
            dueAt: data.dueAt || null,
            projectId: data.projectId || null,
            projectName: data.projectName || null,
            ownerId: account || data.ownerId || 'local-user',
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

    // A reviewed commitment becomes one task in the existing store. Read and
    // dedupe inside the write transaction so competing tabs cannot add twice.
    function commitmentOwner(expectedOwner) {
        const auth = window.GunterAuth;
        let trusted, ownerId, deviceOwner;
        try {
            trusted = typeof auth?.canAccessLocalData === 'function'
                ? auth.canAccessLocalData() : auth?.isVerified?.();
            ownerId = trusted === true && auth?.getUser?.()?.id;
            deviceOwner = window.localStorage?.getItem('gunter_device_user');
        } catch { throw new Error('TASK_AUTH_REQUIRED'); }
        if (typeof ownerId !== 'string' || !ownerId.trim() || ownerId === 'local-user') {
            throw new Error('TASK_AUTH_REQUIRED');
        }
        if (ownerId !== expectedOwner || (deviceOwner != null && deviceOwner !== ownerId)) {
            throw new Error('TASK_ACCOUNT_CHANGED');
        }
        return ownerId;
    }

    function commitmentText(value, limit, required = false, multiline = false) {
        if (value == null && !required) return '';
        if (typeof value !== 'string' || value.length > limit
            || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value)
            || (required && !value.trim())) throw new Error('TASK_INVALID_DATA');
        return value.trim();
    }

    function commitmentTask(data, ownerId) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('TASK_INVALID_DATA');
        if (data.ownerId != null && data.ownerId !== ownerId) throw new Error('TASK_ACCOUNT_CHANGED');
        if (typeof data.title !== 'string' || !data.title.trim() || data.title.length > 500
            || /[\u0000-\u001f\u007f]/.test(data.title)) throw new Error('TASK_INVALID_TITLE');
        let dueAt = null;
        if (data.dueAt != null) {
            if (typeof data.dueAt !== 'string' || data.dueAt.length > 64 || !Number.isFinite(Date.parse(data.dueAt))) {
                throw new Error('TASK_INVALID_DATE');
            }
            dueAt = new Date(data.dueAt).toISOString();
        }
        const sourceMeta = data.meta;
        if (!sourceMeta || typeof sourceMeta !== 'object' || Array.isArray(sourceMeta)
            || typeof sourceMeta.commitmentId !== 'string' || !/^cmt_[A-Za-z0-9_-]{1,150}$/.test(sourceMeta.commitmentId)) {
            throw new Error('TASK_INVALID_COMMITMENT');
        }
        const meta = { commitmentId: sourceMeta.commitmentId };
        if (sourceMeta.sourceType != null) {
            if (!['meeting', 'chat', 'whatsapp', 'manual', 'transcript', 'message'].includes(sourceMeta.sourceType)) {
                throw new Error('TASK_INVALID_DATA');
            }
            meta.sourceType = sourceMeta.sourceType;
        }
        if (sourceMeta.sourceRefId != null) meta.sourceRefId = commitmentText(sourceMeta.sourceRefId, 160);
        if (sourceMeta.excerpt != null) meta.excerpt = commitmentText(sourceMeta.excerpt, 600, false, true);
        if (sourceMeta.sourceTs != null) {
            const stamp = sourceMeta.sourceTs;
            if ((typeof stamp !== 'string' && typeof stamp !== 'number')
                || (typeof stamp === 'string' && stamp.length > 64)
                || !Number.isFinite(new Date(stamp).getTime())) throw new Error('TASK_INVALID_DATE');
            meta.sourceTs = new Date(stamp).toISOString();
        }
        if (data.priority != null && !['low', 'normal', 'high'].includes(data.priority)) throw new Error('TASK_INVALID_DATA');
        const list = value => {
            if (value == null) return [];
            if (!Array.isArray(value) || value.length > 20) throw new Error('TASK_INVALID_DATA');
            return value.map(item => commitmentText(item, 80, true));
        };
        const timestamp = new Date().toISOString();
        return {
            id: newId(), title: data.title.trim(), notes: commitmentText(data.notes, 5000, false, true),
            status: 'pending', priority: data.priority || 'normal', dueAt,
            projectId: data.projectId == null ? null : commitmentText(data.projectId, 160, true),
            projectName: data.projectName == null ? null : commitmentText(data.projectName, 200, true),
            ownerId, people: list(data.people), tags: list(data.tags), source: 'commitment', meta,
            createdAt: timestamp, updatedAt: timestamp
        };
    }

    async function createFromCommitment(data, guard = {}) {
        if (!guard || typeof guard !== 'object' || Array.isArray(guard) || guard.confirmed !== true) {
            throw new Error('TASK_CONFIRM_REQUIRED');
        }
        const ownerId = commitmentOwner(guard.ownerId);
        const task = commitmentTask(data, ownerId);
        const db = await openDB();
        try {
            commitmentOwner(ownerId);
            const result = await new Promise((resolve, reject) => {
                const transaction = db.transaction(STORE, 'readwrite');
                const store = transaction.objectStore(STORE);
                let outcome, failure;
                const fail = error => { failure = error; transaction.abort(); };
                const request = store.getAll();
                request.onsuccess = () => {
                    try {
                        commitmentOwner(ownerId);
                        const existing = (request.result || []).find(row => row.ownerId === ownerId
                            && row.source === 'commitment' && row.meta?.commitmentId === task.meta.commitmentId);
                        outcome = { task: existing || task, created: !existing };
                        if (!existing) {
                            const write = store.add(task);
                            write.onsuccess = () => {
                                try { commitmentOwner(ownerId); } catch (error) { fail(error); }
                            };
                        }
                    } catch (error) { fail(error); }
                };
                transaction.oncomplete = () => {
                    try { commitmentOwner(ownerId); resolve(outcome); } catch (error) { reject(error); }
                };
                transaction.onerror = () => { failure ||= transaction.error; };
                transaction.onabort = () => reject(failure || transaction.error || new Error('TASK_COMMITMENT_CREATE_ABORTED'));
            });
            commitmentOwner(ownerId);
            if (result.created) emit('tasks-changed', { op: 'create', id: result.task.id, ownerId });
            return result;
        } finally { db.close(); }
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

    async function complete(id, ownerId, expected) {
        const merged = await update(id, { status: 'done', completedAt: new Date().toISOString() },
            ownerId ? { ownerId, statuses: ['pending', 'doing'], expected } : { expected });
        return merged;
    }
    async function reopen(id, ownerId, expected) { return update(id, { status: 'pending', completedAt: null, cancelledAt: null },
        ownerId ? { ownerId, statuses: ['done', 'cancelled'], expected } : { expected }); }
    async function cancel(id, ownerId, expected) { return update(id, { status: 'cancelled', cancelledAt: new Date().toISOString() },
        ownerId ? { ownerId, statuses: ['pending', 'doing'], expected } : { expected }); }

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
        create, createFromCommitment, update, complete, reopen, cancel, remove, list, listForToday, listOverdue, listBySource
    };
})();
