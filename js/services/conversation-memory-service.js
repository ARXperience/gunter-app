/* =============================================
   GUNTER SERVICE - Conversation Memory (v2 — F1)
   -------------------------------------------------
   Memoria de largo plazo de conversaciones.
   Cada turno (web/voz/wake) se vectoriza y guarda.
   Al responder, se recuperan los top-K turnos más
   relevantes y se inyectan como contexto al LLM.

   Storage: IDB `gunter_conversation_memory` / store `turns`
     { id, role, text, vector, ts, channel, sessionId, projectId }

   API:
     await GunterConversationMemory.remember({role, text, channel, projectId})
     await GunterConversationMemory.recall(query, {topK, minScore, sinceMs})
       → array de turnos relevantes
     await GunterConversationMemory.forget(textOrPattern)
     await GunterConversationMemory.list({limit})
     await GunterConversationMemory.clear()
     await GunterConversationMemory.stats()
     GunterConversationMemory.contextSnippet(turns)
       → string formateado para inyectar al system prompt
   ============================================= */

(function () {
    if (window.GunterConversationMemory) return;

    const DB_NAME = 'gunter_conversation_memory';
    const DB_VERSION = 1;
    const STORE = 'turns';
    const MIN_TEXT_CHARS = 8;          // ignorar acks tipo "ok"
    const MAX_TEXT_CHARS = 2000;
    const DEFAULT_TOPK = 5;
    const DEFAULT_MIN_SCORE = 0.32;    // umbral cosine
    const RETENTION_DAYS = 180;        // purga automática silenciosa

    let dbPromise = null;

    function flagOn() { return !!(window.PremiumFeaturesService?.isEnabled?.('conversationMemory')); }

    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            try {
                const req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(STORE)) {
                        const s = db.createObjectStore(STORE, { keyPath: 'id' });
                        s.createIndex('ts', 'ts', { unique: false });
                        s.createIndex('channel', 'channel', { unique: false });
                        s.createIndex('projectId', 'projectId', { unique: false });
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            } catch (err) { reject(err); }
        });
        return dbPromise;
    }

    function newId() {
        return 'turn_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    }

    function normalize(text) {
        return String(text || '').replace(/\s+/g, ' ').trim();
    }

    async function idbPut(turn) {
        const db = await openDb();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(turn);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    }

    async function idbAll() {
        const db = await openDb();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => resolve([]);
        });
    }

    async function idbDeleteIds(ids) {
        if (!ids?.length) return 0;
        const db = await openDb();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            for (const id of ids) store.delete(id);
            tx.oncomplete = () => resolve(ids.length);
            tx.onerror = () => resolve(0);
        });
    }

    async function idbClear() {
        const db = await openDb();
        return new Promise((resolve) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).clear();
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        });
    }

    /**
     * Guarda un turno en memoria. Silencioso: si flag OFF o texto trivial, no hace nada.
     */
    async function remember({ role, text, channel = 'chat', projectId = null, sessionId = null } = {}) {
        if (!flagOn()) return null;
        const t = normalize(text);
        if (t.length < MIN_TEXT_CHARS) return null;
        if (!window.GunterEmbeddings?.embed) return null;

        try {
            const truncated = t.slice(0, MAX_TEXT_CHARS);
            const vec = await window.GunterEmbeddings.embed(truncated);
            const turn = {
                id: newId(),
                role: role || 'user',
                text: truncated,
                vector: Array.from(vec),
                ts: Date.now(),
                channel,
                projectId,
                sessionId
            };
            await idbPut(turn);
            return turn;
        } catch (e) {
            console.warn('[conv-memory] remember failed:', e?.message);
            return null;
        }
    }

    /**
     * Recupera turnos relevantes a una query semánticamente.
     */
    async function recall(query, { topK = DEFAULT_TOPK, minScore = DEFAULT_MIN_SCORE, sinceMs = null, channel = null, projectId = null } = {}) {
        if (!flagOn()) return [];
        const q = normalize(query);
        if (q.length < 3) return [];
        if (!window.GunterEmbeddings?.embed || !window.GunterEmbeddings?.cosine) return [];

        try {
            const qVec = await window.GunterEmbeddings.embed(q);
            const all = await idbAll();
            const cutoff = sinceMs ? (Date.now() - sinceMs) : null;

            const scored = [];
            for (const t of all) {
                if (cutoff && t.ts < cutoff) continue;
                if (channel && t.channel !== channel) continue;
                if (projectId && t.projectId !== projectId) continue;
                if (!t.vector || !Array.isArray(t.vector)) continue;
                const v = new Float32Array(t.vector);
                const score = window.GunterEmbeddings.cosine(qVec, v);
                if (score < minScore) continue;
                scored.push({ ...t, score });
            }
            scored.sort((a, b) => b.score - a.score);
            return scored.slice(0, topK);
        } catch (e) {
            console.warn('[conv-memory] recall failed:', e?.message);
            return [];
        }
    }

    /**
     * Borra turnos cuyo texto contenga el patrón (para honrar "olvida X").
     */
    async function forget(textOrPattern) {
        if (!textOrPattern) return 0;
        const needle = String(textOrPattern).toLowerCase();
        const all = await idbAll();
        const ids = all
            .filter(t => (t.text || '').toLowerCase().includes(needle))
            .map(t => t.id);
        return idbDeleteIds(ids);
    }

    async function list({ limit = 50, sinceMs = null, channel = null } = {}) {
        const all = await idbAll();
        let filtered = all;
        const cutoff = sinceMs ? (Date.now() - sinceMs) : null;
        if (cutoff) filtered = filtered.filter(t => t.ts >= cutoff);
        if (channel) filtered = filtered.filter(t => t.channel === channel);
        return filtered.sort((a, b) => b.ts - a.ts).slice(0, limit);
    }

    async function clear() { return idbClear(); }

    async function stats() {
        const all = await idbAll();
        const byChannel = {};
        const byProject = {};
        let oldestTs = Date.now();
        let totalBytes = 0;
        for (const t of all) {
            byChannel[t.channel || 'unknown'] = (byChannel[t.channel || 'unknown'] || 0) + 1;
            const pid = t.projectId || 'sin-proyecto';
            byProject[pid] = (byProject[pid] || 0) + 1;
            if (t.ts && t.ts < oldestTs) oldestTs = t.ts;
            totalBytes += (t.text?.length || 0) + (t.vector?.length || 0) * 4;
        }
        return {
            total: all.length,
            byChannel,
            byProject,
            oldestAt: all.length ? new Date(oldestTs).toISOString() : null,
            estimateBytes: totalBytes
        };
    }

    /**
     * Formatea turnos recuperados como contexto inyectable al system prompt.
     */
    function contextSnippet(turns) {
        if (!turns?.length) return '';
        const lines = ['MEMORIA RELEVANTE de conversaciones pasadas (no inventes — solo usa lo que aquí está):'];
        for (const t of turns) {
            const when = new Date(t.ts).toLocaleString('es-MX', {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
            });
            lines.push(`- [${when} · ${t.channel}${t.role === 'assistant' ? ' · tú' : ''}] ${t.text.slice(0, 240)}`);
        }
        return lines.join('\n');
    }

    /**
     * Purga silenciosa: borra turnos > RETENTION_DAYS al cargar.
     */
    async function autoPurge() {
        try {
            const all = await idbAll();
            const cutoff = Date.now() - RETENTION_DAYS * 86400000;
            const old = all.filter(t => t.ts < cutoff).map(t => t.id);
            if (old.length) await idbDeleteIds(old);
        } catch { /* noop */ }
    }
    if (typeof window !== 'undefined') setTimeout(autoPurge, 5000);

    window.GunterConversationMemory = {
        remember, recall, forget, list, clear, stats, contextSnippet,
        DEFAULT_TOPK, DEFAULT_MIN_SCORE, RETENTION_DAYS
    };
})();
