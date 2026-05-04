/* =============================================
   GUNTER SERVICE - Embeddings (Fase 4)
   -------------------------------------------------
   Wrapper sobre /api/embeddings (text-embedding-3-small,
   1536 dims). Persiste vectores en IndexedDB para no
   pagar tokens dos veces por el mismo texto.

   API:
     await GunterEmbeddings.embed(text)        → Float32Array(1536)
     await GunterEmbeddings.embedBatch(texts)  → Float32Array[]
     GunterEmbeddings.cosine(a, b)             → number en [-1,1]
     await GunterEmbeddings.clearCache()
   ============================================= */

(function () {
    const DB_NAME = 'gunter_embeddings';
    const DB_VERSION = 1;
    const STORE = 'vectors';
    const MEMORY_CACHE_MAX = 200;

    let dbPromise = null;
    const memCache = new Map();   // hash → Float32Array
    let inflightBatch = null;     // dedupe simultáneos

    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE, { keyPath: 'hash' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        return dbPromise;
    }

    // SHA-256 hex (texto + modelo) — clave estable y corta para el caché.
    async function hashKey(text, model = 'text-embedding-3-small') {
        const enc = new TextEncoder().encode(model + '::' + text);
        const buf = await crypto.subtle.digest('SHA-256', enc);
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async function getFromIdb(hash) {
        try {
            const db = await openDb();
            return new Promise((resolve) => {
                const tx = db.transaction(STORE, 'readonly');
                const req = tx.objectStore(STORE).get(hash);
                req.onsuccess = () => {
                    const row = req.result;
                    if (!row || !row.vector) return resolve(null);
                    resolve(new Float32Array(row.vector));
                };
                req.onerror = () => resolve(null);
            });
        } catch { return null; }
    }

    async function saveToIdb(hash, vector, meta = {}) {
        try {
            const db = await openDb();
            return new Promise((resolve) => {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put({
                    hash,
                    vector: Array.from(vector),    // serializable
                    dims: vector.length,
                    createdAt: Date.now(),
                    ...meta
                });
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            });
        } catch { return false; }
    }

    function cacheMem(hash, vec) {
        if (memCache.size >= MEMORY_CACHE_MAX) {
            const k = memCache.keys().next().value;
            memCache.delete(k);
        }
        memCache.set(hash, vec);
    }

    async function fetchEmbeddings(texts) {
        const url = (window.GUNTER_CONFIG?.PROXY_EMBEDDINGS_URL) || '/api/embeddings';
        const resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: texts, model: 'text-embedding-3-small' })
        });
        if (!resp.ok) {
            const t = await resp.text().catch(() => '');
            throw new Error(`Embeddings HTTP ${resp.status}: ${t.slice(0, 200)}`);
        }
        const data = await resp.json();
        if (!data?.data?.length) throw new Error('Respuesta sin embeddings');
        return data.data.map(d => new Float32Array(d.embedding));
    }

    // Truncar input para no romper el límite del modelo (~8k tokens).
    // Conservador: 28k chars ≈ 7k tokens en español.
    function truncate(text) {
        const s = String(text || '').replace(/\s+/g, ' ').trim();
        return s.length > 28000 ? s.slice(0, 28000) : s;
    }

    async function embed(text) {
        const t = truncate(text);
        if (!t) return new Float32Array(1536);
        const hash = await hashKey(t);
        if (memCache.has(hash)) return memCache.get(hash);

        const idb = await getFromIdb(hash);
        if (idb) { cacheMem(hash, idb); return idb; }

        const [vec] = await fetchEmbeddings([t]);
        cacheMem(hash, vec);
        await saveToIdb(hash, vec);
        return vec;
    }

    async function embedBatch(texts) {
        const inputs = texts.map(truncate);
        const hashes = await Promise.all(inputs.map(t => t ? hashKey(t) : Promise.resolve(null)));
        const result = new Array(inputs.length);
        const missingIdx = [];
        const missingTexts = [];

        for (let i = 0; i < inputs.length; i++) {
            const h = hashes[i];
            if (!h) { result[i] = new Float32Array(1536); continue; }
            if (memCache.has(h)) { result[i] = memCache.get(h); continue; }
            const idb = await getFromIdb(h);
            if (idb) { cacheMem(h, idb); result[i] = idb; continue; }
            missingIdx.push(i);
            missingTexts.push(inputs[i]);
        }

        if (missingTexts.length) {
            // Lotes de 64 para respetar el límite de la API.
            const BATCH = 64;
            for (let off = 0; off < missingTexts.length; off += BATCH) {
                const slice = missingTexts.slice(off, off + BATCH);
                const vecs = await fetchEmbeddings(slice);
                for (let j = 0; j < vecs.length; j++) {
                    const globalIdx = missingIdx[off + j];
                    const h = hashes[globalIdx];
                    result[globalIdx] = vecs[j];
                    cacheMem(h, vecs[j]);
                    await saveToIdb(h, vecs[j]);
                }
            }
        }
        return result;
    }

    function cosine(a, b) {
        if (!a || !b || a.length !== b.length) return 0;
        let dot = 0, na = 0, nb = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            na  += a[i] * a[i];
            nb  += b[i] * b[i];
        }
        const denom = Math.sqrt(na) * Math.sqrt(nb);
        return denom === 0 ? 0 : dot / denom;
    }

    async function clearCache() {
        memCache.clear();
        try {
            const db = await openDb();
            return new Promise((resolve) => {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).clear();
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            });
        } catch { return false; }
    }

    async function stats() {
        try {
            const db = await openDb();
            return new Promise((resolve) => {
                const tx = db.transaction(STORE, 'readonly');
                const req = tx.objectStore(STORE).count();
                req.onsuccess = () => resolve({ vectors: req.result, memCache: memCache.size });
                req.onerror = () => resolve({ vectors: 0, memCache: memCache.size });
            });
        } catch { return { vectors: 0, memCache: memCache.size }; }
    }

    window.GunterEmbeddings = { embed, embedBatch, cosine, clearCache, stats, hashKey };
})();
