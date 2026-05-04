/* =============================================
   GUNTER SERVICE - Semantic Index (Fase 4)
   -------------------------------------------------
   Construye un índice de chunks (transcripciones +
   análisis) sobre los proyectos guardados en
   gunterData. Persiste el catálogo de chunks en
   IndexedDB; los vectores reales viven en
   gunter_embeddings (los maneja embedding-service).

   API:
     await GunterSemanticIndex.ensureBuilt({force?: bool, onProgress?: fn})
     await GunterSemanticIndex.search(query, {topK, projectId?, sinceTs?, minScore?})
     await GunterSemanticIndex.stats()
     await GunterSemanticIndex.reset()
   ============================================= */

(function () {
    const DB_NAME = 'gunter_semantic_index';
    const DB_VERSION = 1;
    const STORE = 'chunks';
    let dbPromise = null;

    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    const s = db.createObjectStore(STORE, { keyPath: 'id' });
                    s.createIndex('projectId', 'projectId', { unique: false });
                    s.createIndex('sourceKey', 'sourceKey', { unique: false });
                    s.createIndex('createdAt', 'createdAt', { unique: false });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return dbPromise;
    }

    function tx(mode) {
        return openDb().then(db => db.transaction(STORE, mode).objectStore(STORE));
    }

    // ---------- Chunking ----------
    // Particiona texto largo en chunks de ~600 palabras con overlap de 60.
    function chunkText(text, { size = 600, overlap = 60 } = {}) {
        const words = String(text || '').split(/\s+/).filter(Boolean);
        if (words.length <= size) return [words.join(' ')];
        const out = [];
        for (let i = 0; i < words.length; i += (size - overlap)) {
            out.push(words.slice(i, i + size).join(' '));
            if (i + size >= words.length) break;
        }
        return out;
    }

    // ---------- Source enumeration ----------
    // Devuelve la lista de "sources" (transcripciones, análisis cacheados).
    // Cada source produce 1+ chunks; la clave del source determina si ya
    // está indexado (idempotencia).
    function collectSources() {
        const sources = [];
        try {
            const projects = window.gunterData?.getAllProjects?.() || [];
            for (const p of projects) {
                if (p.deletedAt) continue;
                for (const a of p.analyses || []) {
                    if (a.transcription && a.transcription.length > 30) {
                        sources.push({
                            sourceKey: `transcription::${p.id}::${a.id || a.timestamp}`,
                            projectId: p.id,
                            projectName: p.name,
                            kind: 'transcription',
                            title: 'Transcripción',
                            createdAt: new Date(a.timestamp).getTime() || Date.now(),
                            text: a.transcription
                        });
                    }
                }
            }
            // Análisis cacheados (gunter_generated_analyses)
            const cached = JSON.parse(localStorage.getItem('gunter_generated_analyses') || '{}');
            for (const [key, val] of Object.entries(cached)) {
                const [pid] = key.split('::');
                const proj = projects.find(pp => pp.id === pid);
                if (!proj || proj.deletedAt) continue;
                const text = `Análisis: ${val.definition?.title || key}\n\n${typeof val.payload === 'string' ? val.payload : JSON.stringify(val.payload)}`;
                sources.push({
                    sourceKey: `analysis::${key}`,
                    projectId: pid,
                    projectName: proj.name,
                    kind: 'analysis',
                    title: val.definition?.title || 'Análisis',
                    createdAt: new Date(val.generatedAt).getTime() || Date.now(),
                    text
                });
            }
        } catch (e) {
            console.warn('[semantic-index] collectSources failed:', e);
        }
        return sources;
    }

    async function getIndexedSourceKeys() {
        const store = await tx('readonly');
        return new Promise((resolve) => {
            const set = new Set();
            const req = store.openCursor();
            req.onsuccess = (e) => {
                const cur = e.target.result;
                if (cur) {
                    set.add(cur.value.sourceKey);
                    cur.continue();
                } else resolve(set);
            };
            req.onerror = () => resolve(set);
        });
    }

    async function putChunks(rows) {
        const store = await tx('readwrite');
        return new Promise((resolve) => {
            for (const r of rows) store.put(r);
            store.transaction.oncomplete = () => resolve(true);
            store.transaction.onerror = () => resolve(false);
        });
    }

    async function clearAll() {
        const store = await tx('readwrite');
        return new Promise((resolve) => {
            store.clear();
            store.transaction.oncomplete = () => resolve(true);
            store.transaction.onerror = () => resolve(false);
        });
    }

    async function getAllChunks(filter = {}) {
        const store = await tx('readonly');
        return new Promise((resolve) => {
            const out = [];
            const req = store.openCursor();
            req.onsuccess = (e) => {
                const cur = e.target.result;
                if (!cur) return resolve(out);
                const v = cur.value;
                let ok = true;
                if (filter.projectId && v.projectId !== filter.projectId) ok = false;
                if (filter.sinceTs && v.createdAt < filter.sinceTs) ok = false;
                if (ok) out.push(v);
                cur.continue();
            };
            req.onerror = () => resolve(out);
        });
    }

    // ---------- Build / Update ----------
    let buildLock = null;

    async function ensureBuilt({ force = false, onProgress = () => {} } = {}) {
        if (buildLock) return buildLock;
        buildLock = (async () => {
            if (!window.GunterEmbeddings) throw new Error('Embeddings no disponible');
            if (force) await clearAll();

            const sources = collectSources();
            const indexed = force ? new Set() : await getIndexedSourceKeys();
            const pending = sources.filter(s => !indexed.has(s.sourceKey));

            if (!pending.length) { onProgress({ done: 0, total: 0 }); return { added: 0 }; }

            // Construir lista de chunks con metadata
            const chunkRows = [];
            for (const src of pending) {
                const pieces = chunkText(src.text);
                pieces.forEach((piece, idx) => {
                    chunkRows.push({
                        id: `${src.sourceKey}::${idx}`,
                        sourceKey: src.sourceKey,
                        projectId: src.projectId,
                        projectName: src.projectName,
                        kind: src.kind,
                        title: src.title,
                        chunkIdx: idx,
                        chunkOf: pieces.length,
                        createdAt: src.createdAt,
                        text: piece,
                        vector: null
                    });
                });
            }

            // Embeber por lotes (embedding-service ya batchea internamente)
            const total = chunkRows.length;
            let done = 0;
            const PER_CALL = 32;
            for (let off = 0; off < chunkRows.length; off += PER_CALL) {
                const slice = chunkRows.slice(off, off + PER_CALL);
                const vectors = await window.GunterEmbeddings.embedBatch(slice.map(r => r.text));
                slice.forEach((r, i) => { r.vector = Array.from(vectors[i]); });
                await putChunks(slice);
                done += slice.length;
                onProgress({ done, total });
            }

            return { added: chunkRows.length, sources: pending.length };
        })().finally(() => { buildLock = null; });
        return buildLock;
    }

    // ---------- Search ----------
    async function search(query, opts = {}) {
        const {
            topK = 8,
            projectId = null,
            sinceTs = null,
            minScore = 0.18    // umbral suave; por debajo se considera ruido
        } = opts;

        if (!query || !window.GunterEmbeddings) return [];
        const qVec = await window.GunterEmbeddings.embed(query);

        const chunks = await getAllChunks({ projectId, sinceTs });
        if (!chunks.length) return [];

        const scored = [];
        for (const c of chunks) {
            if (!c.vector) continue;
            const v = c.vector instanceof Float32Array ? c.vector : new Float32Array(c.vector);
            const score = window.GunterEmbeddings.cosine(qVec, v);
            if (score < minScore) continue;
            scored.push({ ...c, score });
        }
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, topK);
    }

    async function stats() {
        const store = await tx('readonly');
        return new Promise((resolve) => {
            const req = store.count();
            req.onsuccess = () => resolve({ chunks: req.result });
            req.onerror = () => resolve({ chunks: 0 });
        });
    }

    async function reset() {
        await clearAll();
        return true;
    }

    window.GunterSemanticIndex = {
        ensureBuilt, search, stats, reset, chunkText
    };
})();
