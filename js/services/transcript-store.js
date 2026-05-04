/* =============================================
   GUNTER SERVICE - Transcript Store (Fase A.A2)
   -------------------------------------------------
   Maneja transcripciones largas que pueden superar
   el límite de localStorage (~5MB del navegador).

   Estrategia:
     - Si la transcripción es ≤ 200KB → localStorage tal cual.
     - Si es > 200KB → guarda VERSIÓN RESUMIDA en localStorage
       (primeros 50KB + marcador + últimos 50KB) + completa
       en IndexedDB (`gunter_transcript_archive`).

     Esto permite que código legacy que solo lea localStorage
     siga funcionando con la versión resumida, y el código
     consciente del helper obtenga la versión completa.

   API:
     await GunterTranscriptStore.save(text)
     await GunterTranscriptStore.load()         → Promise<string>
     GunterTranscriptStore.loadSummarySync()    → string (solo localStorage)
     await GunterTranscriptStore.clear()
     GunterTranscriptStore.LOCAL_KEY            // 'gunter_full_transcript'
     GunterTranscriptStore.MAX_LOCAL_BYTES      // 200000
   ============================================= */

(function () {
    if (window.GunterTranscriptStore) return;

    const LOCAL_KEY = 'gunter_full_transcript';
    const MAX_LOCAL_BYTES = 200 * 1024;     // 200 KB
    const HALF_KEEP = 50 * 1024;             // 50 KB head + 50 KB tail

    const DB_NAME = 'gunter_transcript_archive';
    const DB_VERSION = 1;
    const STORE = 'transcripts';
    let dbPromise = null;

    function openDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            try {
                const req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(STORE)) {
                        db.createObjectStore(STORE, { keyPath: 'id' });
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            } catch (err) { reject(err); }
        });
        return dbPromise;
    }

    async function idbPut(text) {
        try {
            const db = await openDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put({
                    id: 'current',
                    text,
                    bytes: text.length,
                    savedAt: new Date().toISOString()
                });
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {
            console.warn('[transcript-store] idbPut failed:', e?.message || e);
            return false;
        }
    }

    async function idbGet() {
        try {
            const db = await openDb();
            return new Promise((resolve) => {
                const tx = db.transaction(STORE, 'readonly');
                const req = tx.objectStore(STORE).get('current');
                req.onsuccess = () => {
                    const row = req.result;
                    resolve(row ? String(row.text || '') : '');
                };
                req.onerror = () => resolve('');
            });
        } catch (e) {
            console.warn('[transcript-store] idbGet failed:', e?.message || e);
            return '';
        }
    }

    async function idbClear() {
        try {
            const db = await openDb();
            return new Promise((resolve) => {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).delete('current');
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            });
        } catch { return false; }
    }

    function buildSummary(text) {
        const head = text.slice(0, HALF_KEEP);
        const tail = text.slice(-HALF_KEEP);
        const totalKB = Math.round(text.length / 1024);
        return head +
            `\n\n— [Vista resumida; ${totalKB} KB conservados en almacenamiento local seguro. Abre Resultados para ver la transcripción completa] —\n\n` +
            tail;
    }

    function notify(message, variant = 'info') {
        try {
            if (window.GunterNotificationsService?.showToast) {
                window.GunterNotificationsService.showToast(message, {
                    variant,
                    duration: 4500,
                    silent: true
                });
            }
        } catch { /* no-op */ }
    }

    function safeLocalSet(key, value) {
        try {
            localStorage.setItem(key, value);
            return true;
        } catch (e) {
            console.warn('[transcript-store] localStorage.setItem failed:', e?.message);
            return false;
        }
    }

    /**
     * Guarda el texto. Devuelve { mode: 'local'|'idb+summary'|'failed', bytes }.
     */
    async function save(text) {
        const t = String(text || '');
        if (!t) {
            try { localStorage.removeItem(LOCAL_KEY); } catch {}
            await idbClear();
            return { mode: 'cleared', bytes: 0 };
        }

        if (t.length <= MAX_LOCAL_BYTES) {
            const ok = safeLocalSet(LOCAL_KEY, t);
            // Si por alguna razón el navegador rechazó ese tamaño (quota), caemos a IDB
            if (!ok) {
                await idbPut(t);
                safeLocalSet(LOCAL_KEY, buildSummary(t));
                notify('La transcripción es muy grande para localStorage. La guardé completa en almacenamiento local seguro.', 'warn');
                return { mode: 'idb+summary', bytes: t.length };
            }
            // También limpiamos cualquier copia previa en IDB para no duplicar
            await idbClear();
            return { mode: 'local', bytes: t.length };
        }

        // Texto grande: guardamos full en IDB, resumen en localStorage
        const idbOk = await idbPut(t);
        const summary = buildSummary(t);
        safeLocalSet(LOCAL_KEY, summary);
        if (idbOk) {
            notify(
                'La transcripción completa es muy grande. Guardé una vista resumida en localStorage y conservé la versión completa en almacenamiento local seguro.',
                'info'
            );
            return { mode: 'idb+summary', bytes: t.length };
        }
        // Si IDB también falló, intentamos guardar al menos el resumen
        notify('No pude guardar la transcripción completa. Conservé un resumen.', 'warn');
        return { mode: 'summary-only', bytes: t.length };
    }

    /**
     * Carga el texto completo. Prefiere IDB; si no hay, usa localStorage.
     */
    async function load() {
        const fromIdb = await idbGet();
        if (fromIdb) return fromIdb;
        try { return localStorage.getItem(LOCAL_KEY) || ''; }
        catch { return ''; }
    }

    /**
     * Versión sincrónica para callers legacy. Solo lee localStorage.
     * Puede devolver el RESUMEN si el original era >200KB.
     */
    function loadSummarySync() {
        try { return localStorage.getItem(LOCAL_KEY) || ''; }
        catch { return ''; }
    }

    async function clear() {
        try { localStorage.removeItem(LOCAL_KEY); } catch {}
        await idbClear();
    }

    async function stats() {
        let local = 0, idb = 0;
        try { local = (localStorage.getItem(LOCAL_KEY) || '').length; } catch {}
        try { const t = await idbGet(); idb = t.length; } catch {}
        return { localBytes: local, idbBytes: idb, hasFullInIdb: idb > 0 };
    }

    window.GunterTranscriptStore = {
        save, load, loadSummarySync, clear, stats,
        LOCAL_KEY, MAX_LOCAL_BYTES
    };
})();
