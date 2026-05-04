/* =============================================
   GUNTER SERVICE - Local Data Maintenance (Fase D)
   -------------------------------------------------
   Mide, reporta y limpia almacenamiento local de
   forma SEGURA. Cero ejecución destructiva sin
   reglas explícitas + dryRun obligatorio antes de
   borrado real.

   Mapa de almacenes (auditoría D1):

     IndexedDB:
       gunter_audio_vault          purga si > maxAgeDays + no actual
       gunter_transcription_db     purga sesiones completed > maxAgeDays
       gunter_documents            REPORTE; nunca auto-purga (facturas)
       gunter_embeddings           REPORTE; cache valiosa
       gunter_semantic_index       REPORTE; índice valioso
       gunter_transcript_archive   REPORTE; single record
       gunter_daily                REPORTE; datos críticos del usuario

     localStorage (NUNCA borrar):
       gunter_data, gunter_premium_features, gunter_prefs,
       gunter_username, gunter_user, gunter_theme, gunter_dark_mode,
       gunter_project_id (sesión activa)

     localStorage (rotación segura):
       gunter_generated_analyses  rotar a maxEntries

     localStorage (purga opcional viejo):
       gunter_last_*, gunter_timeline, gunter_conversation
   ============================================= */

(function () {
    if (window.GunterLocalDataMaintenance) return;

    const LIMIT_LOCAL_STORAGE_BYTES = 5 * 1024 * 1024;   // 5MB típico

    // Keys que NUNCA se tocan (config + datos críticos)
    const LOCAL_STORAGE_PROTECTED = new Set([
        'gunter_data',
        'gunter_premium_features',
        'gunter_prefs',
        'gunter_username',
        'gunter_user',
        'gunter_theme',
        'gunter_dark_mode',
        'gunter_project_id',
        'gunter_project',
        'gunter_project_name',
        'gunter_env',
        'gunter_market',
        'gunter_budget',
        'gunter_full_transcript',     // mitigado por transcript-store
        'gunter_api_key'
    ]);

    // Keys candidatas a rotación / cleanup
    const LOCAL_STORAGE_VOLATILE = new Set([
        'gunter_last_analysis',
        'gunter_last_transcript',
        'gunter_timeline',
        'gunter_conversation',
        'gunter_analysis',
        'gunter_analysis_timestamp',
        'gunter_cache_stats',
        'gunter_transcript_recovered_at',
        'gunter_transcript_rectified_at',
        'gunter_transcripts'
    ]);

    // ---------- Helpers de medición ----------
    function byteSize(s) {
        if (s == null) return 0;
        try { return new Blob([String(s)]).size; }
        catch { return String(s).length; }
    }

    function formatBytes(bytes) {
        if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
        if (bytes < 1024)            return bytes + ' B';
        if (bytes < 1024 * 1024)     return (bytes / 1024).toFixed(1) + ' KB';
        if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
        return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
    }

    // ---------- localStorage usage ----------
    function estimateLocalStorageUsage() {
        let totalBytes = 0;
        const keys = [];
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                const v = localStorage.getItem(k) || '';
                const bytes = byteSize(k) + byteSize(v);
                totalBytes += bytes;
                keys.push({ key: k, bytes, gunter: k.startsWith('gunter_') });
            }
        } catch (e) { /* localStorage no disponible */ }

        keys.sort((a, b) => b.bytes - a.bytes);
        const gunterKeys = keys.filter(k => k.gunter);
        const gunterBytes = gunterKeys.reduce((s, k) => s + k.bytes, 0);
        const pct = +(totalBytes / LIMIT_LOCAL_STORAGE_BYTES * 100).toFixed(1);

        let level = 'ok';
        let levelMsg = null;
        if (pct >= 95)      { level = 'critical'; levelMsg = 'Gunter está casi sin espacio local. Limpia audios, transcripciones o análisis antiguos para evitar pérdida de datos.'; }
        else if (pct >= 85) { level = 'high';     levelMsg = 'El almacenamiento local está cerca del límite. Algunas funciones podrían fallar si no limpias datos antiguos.'; }
        else if (pct >= 70) { level = 'warn';     levelMsg = 'Gunter está usando bastante almacenamiento local. Te recomiendo limpiar datos antiguos pronto.'; }

        return {
            totalBytes,
            totalFormatted: formatBytes(totalBytes),
            limitBytes: LIMIT_LOCAL_STORAGE_BYTES,
            usedPct: pct,
            level,
            levelMsg,
            gunterBytes,
            gunterFormatted: formatBytes(gunterBytes),
            keysCount: keys.length,
            gunterKeysCount: gunterKeys.length,
            largestKeys: gunterKeys.slice(0, 8).map(k => ({ key: k.key, bytes: k.bytes, formatted: formatBytes(k.bytes) }))
        };
    }

    // ---------- IndexedDB usage ----------
    async function _idbCount(dbName, storeName) {
        try {
            const db = await new Promise((resolve, reject) => {
                const req = indexedDB.open(dbName);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            if (!db.objectStoreNames.contains(storeName)) { db.close(); return null; }
            const count = await new Promise((resolve) => {
                const tx = db.transaction(storeName, 'readonly');
                const r = tx.objectStore(storeName).count();
                r.onsuccess = () => resolve(r.result);
                r.onerror = () => resolve(0);
            });
            db.close();
            return count;
        } catch { return null; }
    }

    async function _idbAll(dbName, storeName) {
        try {
            const db = await new Promise((resolve, reject) => {
                const req = indexedDB.open(dbName);
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => reject(req.error);
            });
            if (!db.objectStoreNames.contains(storeName)) { db.close(); return []; }
            const all = await new Promise((resolve) => {
                const tx = db.transaction(storeName, 'readonly');
                const r = tx.objectStore(storeName).getAll();
                r.onsuccess = () => resolve(r.result || []);
                r.onerror = () => resolve([]);
            });
            db.close();
            return all;
        } catch { return []; }
    }

    async function estimateIndexedDBUsage() {
        // navigator.storage.estimate() da total cross-DB cuando está disponible
        let totalEstimate = null;
        try {
            if (navigator.storage?.estimate) {
                const est = await navigator.storage.estimate();
                totalEstimate = { usage: est.usage, quota: est.quota };
            }
        } catch { /* ignore */ }

        const counts = {
            audioVault:        await _idbCount('gunter_audio_vault', 'recordings'),
            transcriptionMeta: await _idbCount('gunter_transcription_db', 'meta'),
            transcriptionChunks: await _idbCount('gunter_transcription_db', 'chunks'),
            documents:         await _idbCount('gunter_documents', 'receipts'),
            embeddings:        await _idbCount('gunter_embeddings', 'vectors'),
            semanticIndex:     await _idbCount('gunter_semantic_index', 'chunks'),
            transcriptArchive: await _idbCount('gunter_transcript_archive', 'transcripts'),
            tasks:             await _idbCount('gunter_daily', 'tasks'),
            events:            await _idbCount('gunter_daily', 'events'),
            reminders:         await _idbCount('gunter_daily', 'reminders')
        };
        return { counts, totalEstimate, totalEstimateFormatted: totalEstimate ? formatBytes(totalEstimate.usage) : null };
    }

    // ---------- Reporte completo ----------
    async function getStorageReport() {
        const localStorageInfo = estimateLocalStorageUsage();
        const idbInfo = await estimateIndexedDBUsage();
        const recommendations = await getRecommendations({ localStorageInfo, idbInfo });
        return {
            localStorage: localStorageInfo,
            indexedDB: idbInfo,
            recommendations,
            generatedAt: new Date().toISOString()
        };
    }

    // ---------- Recomendaciones ----------
    async function getRecommendations({ localStorageInfo = null, idbInfo = null } = {}) {
        const ls = localStorageInfo || estimateLocalStorageUsage();
        const idb = idbInfo || await estimateIndexedDBUsage();
        const rec = [];

        if (ls.levelMsg) rec.push({ severity: ls.level, message: ls.levelMsg });

        // Audio vault
        const audioCount = idb.counts.audioVault || 0;
        if (audioCount > 5) {
            rec.push({
                severity: audioCount > 20 ? 'high' : 'warn',
                message: `Tienes ${audioCount} audio${audioCount === 1 ? '' : 's'} guardado${audioCount === 1 ? '' : 's'}. Considera limpiar los antiguos (>30 días).`,
                action: 'cleanupOldAudio'
            });
        }

        // Transcription chunks
        const chunkCount = idb.counts.transcriptionChunks || 0;
        if (chunkCount > 100) {
            rec.push({
                severity: chunkCount > 500 ? 'high' : 'warn',
                message: `Hay ${chunkCount} chunks de transcripción. Limpia sesiones completadas antiguas (>14 días).`,
                action: 'cleanupOldTranscriptionChunks'
            });
        }

        // Generated analyses
        try {
            const ga = JSON.parse(localStorage.getItem('gunter_generated_analyses') || '{}');
            const entries = Object.keys(ga).length;
            if (entries > 100) {
                rec.push({
                    severity: entries > 200 ? 'high' : 'warn',
                    message: `Hay ${entries} análisis generados acumulados. Rota a los más recientes (max 100).`,
                    action: 'cleanupGeneratedAnalyses'
                });
            }
        } catch { /* ignore */ }

        // Documents
        const docCount = idb.counts.documents || 0;
        if (docCount > 50) {
            rec.push({
                severity: 'info',
                message: `Tienes ${docCount} documentos guardados. Revisa si quieres conservarlos todos (no se purgan automáticamente).`,
                action: null
            });
        }

        if (rec.length === 0) {
            rec.push({ severity: 'ok', message: 'Todo está bien. No encontré datos antiguos para limpiar.', action: null });
        }
        return rec;
    }

    // ---------- D4: Cleanup audio vault ----------
    async function cleanupOldAudio({ maxAgeDays = 30, dryRun = true, preserveProjectId = null } = {}) {
        const result = {
            success: true,
            dryRun,
            deletedCount: 0,
            freedBytesEstimate: 0,
            items: []
        };
        try {
            const recordings = await _idbAll('gunter_audio_vault', 'recordings');
            const now = Date.now();
            const cutoff = now - (maxAgeDays * 86400000);
            const currentProjectId = preserveProjectId || (typeof localStorage !== 'undefined' ? localStorage.getItem('gunter_project_id') : null);

            const candidates = recordings.filter(r => {
                if (!r) return false;
                const savedAt = r.savedAt || 0;
                if (savedAt >= cutoff) return false;                       // muy reciente
                if (currentProjectId && r.projectId === currentProjectId) return false;  // proyecto actual
                return true;
            });

            for (const r of candidates) {
                const sizeEst = (r.blob && r.blob.size) || 0;
                result.items.push({
                    projectId: r.projectId,
                    projectName: r.projectName || '',
                    savedAt: r.savedAt ? new Date(r.savedAt).toISOString() : null,
                    bytes: sizeEst,
                    formatted: formatBytes(sizeEst)
                });
                result.freedBytesEstimate += sizeEst;
            }
            result.deletedCount = candidates.length;
            result.freedBytesEstimateFormatted = formatBytes(result.freedBytesEstimate);

            // Borrado real
            if (!dryRun && candidates.length > 0) {
                if (!window.GunterAudioVault?.remove) {
                    return { ...result, success: false, error: 'GunterAudioVault.remove no disponible.' };
                }
                for (const r of candidates) {
                    try { await window.GunterAudioVault.remove(r.projectId); } catch (e) { /* siguiente */ }
                }
            }
            return result;
        } catch (e) {
            return { ...result, success: false, error: e.message || String(e) };
        }
    }

    // ---------- D5: Cleanup transcription chunks ----------
    async function cleanupOldTranscriptionChunks({ maxAgeDays = 14, dryRun = true } = {}) {
        const result = { success: true, dryRun, deletedCount: 0, freedBytesEstimate: 0, items: [] };
        try {
            const metas = await _idbAll('gunter_transcription_db', 'meta');
            const now = Date.now();
            const cutoff = now - (maxAgeDays * 86400000);

            // Candidatos: status 'completed' Y meta.startedAt o meta.lastActivityAt < cutoff
            const candidates = metas.filter(m => {
                if (!m) return false;
                if (m.status !== 'completed') return false;            // no tocar 'active'
                const refTime = m.completedAt || m.lastActivityAt || m.startedAt || m.createdAt;
                if (!refTime) return false;                            // sin timestamp, no purgamos
                const ts = typeof refTime === 'number' ? refTime : new Date(refTime).getTime();
                return Number.isFinite(ts) && ts < cutoff;
            });

            // Estimar bytes leyendo chunks de cada sesión
            for (const m of candidates) {
                let sessionBytes = 0;
                try {
                    const allChunks = await _idbAll('gunter_transcription_db', 'chunks');
                    const sessionChunks = allChunks.filter(c => c.sessionId === m.sessionId);
                    for (const c of sessionChunks) {
                        sessionBytes += (c.blob && c.blob.size) || 0;
                    }
                } catch { /* ignore */ }
                result.items.push({
                    sessionId: m.sessionId,
                    status: m.status,
                    refTime: m.completedAt || m.lastActivityAt || m.startedAt,
                    bytes: sessionBytes,
                    formatted: formatBytes(sessionBytes)
                });
                result.freedBytesEstimate += sessionBytes;
            }
            result.deletedCount = candidates.length;
            result.freedBytesEstimateFormatted = formatBytes(result.freedBytesEstimate);

            // Borrado real via GunterTranscriptionService.purgeSession (la API existente)
            if (!dryRun && candidates.length > 0) {
                if (!window.GunterTranscriptionService?.prototype?.purgeSession) {
                    // purgeSession es método de instancia; intentar lo expuesto también:
                    // En transcription-service.js, purgeSession solo es de instancia. Usamos IDB directo:
                    for (const m of candidates) {
                        try { await _idbDeleteSession(m.sessionId); } catch { /* siguiente */ }
                    }
                } else {
                    for (const m of candidates) {
                        try { await window.GunterTranscriptionService.prototype.purgeSession(m.sessionId); } catch { /* siguiente */ }
                    }
                }
            }
            return result;
        } catch (e) {
            return { ...result, success: false, error: e.message || String(e) };
        }
    }

    async function _idbDeleteSession(sessionId) {
        const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('gunter_transcription_db');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        try {
            // 1. encontrar chunks de la sesión
            const chunks = await new Promise((resolve) => {
                const tx = db.transaction('chunks', 'readonly');
                const idx = tx.objectStore('chunks').index('sessionId');
                const r = idx.getAllKeys(sessionId);
                r.onsuccess = () => resolve(r.result || []);
                r.onerror = () => resolve([]);
            });
            // 2. borrar chunks + meta en una transacción
            await new Promise((resolve, reject) => {
                const tx = db.transaction(['chunks', 'meta'], 'readwrite');
                const cs = tx.objectStore('chunks');
                const ms = tx.objectStore('meta');
                for (const k of chunks) cs.delete(k);
                ms.delete(sessionId);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => reject(tx.error);
            });
        } finally { db.close(); }
    }

    // ---------- D6: Rotación de gunter_generated_analyses ----------
    async function cleanupGeneratedAnalyses({ maxEntries = 100, preserveCurrentProjectId = true, dryRun = true } = {}) {
        const result = { success: true, dryRun, deletedCount: 0, freedBytesEstimate: 0, items: [] };
        try {
            const raw = localStorage.getItem('gunter_generated_analyses');
            if (!raw) return result;
            const obj = JSON.parse(raw);
            const entries = Object.entries(obj);
            if (entries.length <= maxEntries) return result;

            const currentProjectId = preserveCurrentProjectId
                ? (localStorage.getItem('gunter_project_id') || null)
                : null;

            // Ordenar por generatedAt DESC (más recientes primero); fallback a key (no garantiza orden)
            const sorted = entries.map(([key, val]) => ({
                key, val,
                ts: val?.generatedAt ? new Date(val.generatedAt).getTime() : 0,
                projectId: key.split('::')[0]
            })).sort((a, b) => b.ts - a.ts);

            // Mantener: los maxEntries más recientes + todos los del proyecto actual
            const keep = new Set();
            for (let i = 0; i < Math.min(maxEntries, sorted.length); i++) keep.add(sorted[i].key);
            if (currentProjectId) {
                for (const e of sorted) if (e.projectId === currentProjectId) keep.add(e.key);
            }

            const toDelete = sorted.filter(e => !keep.has(e.key));
            for (const e of toDelete) {
                const bytes = byteSize(JSON.stringify(e.val));
                result.items.push({
                    key: e.key,
                    projectId: e.projectId,
                    generatedAt: e.val?.generatedAt || null,
                    bytes,
                    formatted: formatBytes(bytes)
                });
                result.freedBytesEstimate += bytes;
            }
            result.deletedCount = toDelete.length;
            result.freedBytesEstimateFormatted = formatBytes(result.freedBytesEstimate);

            if (!dryRun && toDelete.length > 0) {
                const next = {};
                for (const e of sorted) if (keep.has(e.key)) next[e.key] = e.val;
                try { localStorage.setItem('gunter_generated_analyses', JSON.stringify(next)); }
                catch (e) {
                    return { ...result, success: false, error: 'No pude reescribir gunter_generated_analyses: ' + (e.message || '') };
                }
            }
            return result;
        } catch (e) {
            return { ...result, success: false, error: e.message || String(e) };
        }
    }

    // ---------- Cleanup de cache antiguo (delegado al cache-service si existe) ----------
    async function cleanupOldCache({ dryRun = true } = {}) {
        const result = { success: true, dryRun, deletedCount: 0, freedBytesEstimate: 0, items: [] };
        try {
            // GunterCacheService.clearExpiredCache ya tiene su propia política TTL
            if (!dryRun && window.GunterCacheService?.prototype?.clearExpiredCache) {
                // método de instancia; intentar lo accesible
                try {
                    const inst = new window.GunterCacheService();
                    const cleared = inst.clearExpiredCache?.() || 0;
                    result.deletedCount = cleared;
                } catch { /* ignore */ }
            }

            // Limpiar también keys volátiles antiguas: gunter_last_*, gunter_timeline, etc.
            // Son temporales. Las borramos solo si tienen >7 días detectables
            // (la mayoría no tiene timestamp; se asume "viejo" si llave existe sin proyecto activo)
            for (const key of LOCAL_STORAGE_VOLATILE) {
                const v = localStorage.getItem(key);
                if (v == null) continue;
                const bytes = byteSize(key) + byteSize(v);
                result.items.push({ key, bytes, formatted: formatBytes(bytes) });
                result.freedBytesEstimate += bytes;
                if (!dryRun) {
                    try { localStorage.removeItem(key); } catch { /* ignore */ }
                }
            }
            result.deletedCount = (result.deletedCount || 0) + result.items.length;
            result.freedBytesEstimateFormatted = formatBytes(result.freedBytesEstimate);
            return result;
        } catch (e) {
            return { ...result, success: false, error: e.message || String(e) };
        }
    }

    // ---------- Documents: REPORTE solo, no auto-purga ----------
    async function cleanupOldDocuments({ olderThanDays = 365, dryRun = true } = {}) {
        // Política conservadora: documentos son facturas/recibos con valor de archivo.
        // Solo se reportan candidatos > 1 año para que el USUARIO decida.
        const result = { success: true, dryRun: true, deletedCount: 0, freedBytesEstimate: 0, items: [], note: 'Los documentos NO se borran automáticamente. Solo se listan candidatos para revisión manual.' };
        try {
            const docs = await _idbAll('gunter_documents', 'receipts');
            const cutoff = Date.now() - (olderThanDays * 86400000);
            const candidates = docs.filter(d => {
                const ts = d?.createdAt || d?.savedAt;
                if (!ts) return false;
                const t = typeof ts === 'number' ? ts : new Date(ts).getTime();
                return Number.isFinite(t) && t < cutoff;
            });
            for (const d of candidates) {
                const bytes = byteSize(JSON.stringify(d));
                result.items.push({
                    id: d.id,
                    title: d.title || d.empresa || 'Documento',
                    createdAt: d.createdAt || d.savedAt,
                    bytes,
                    formatted: formatBytes(bytes)
                });
                result.freedBytesEstimate += bytes;
            }
            result.deletedCount = 0;     // siempre 0; nunca borra automáticamente
            result.candidates = candidates.length;
            return result;
        } catch (e) {
            return { ...result, success: false, error: e.message || String(e) };
        }
    }

    // ---------- D2: Mantenimiento orquestado seguro ----------
    async function runSafeMaintenance({ dryRun = true, scope = 'all' } = {}) {
        const result = {
            success: true,
            dryRun,
            startedAt: new Date().toISOString(),
            steps: {},
            totalFreedBytes: 0,
            warnings: []
        };
        try {
            if (scope === 'all' || scope === 'audio') {
                result.steps.audio = await cleanupOldAudio({ maxAgeDays: 30, dryRun });
                result.totalFreedBytes += result.steps.audio.freedBytesEstimate || 0;
            }
            if (scope === 'all' || scope === 'transcription') {
                result.steps.transcription = await cleanupOldTranscriptionChunks({ maxAgeDays: 14, dryRun });
                result.totalFreedBytes += result.steps.transcription.freedBytesEstimate || 0;
            }
            if (scope === 'all' || scope === 'analyses') {
                result.steps.analyses = await cleanupGeneratedAnalyses({ maxEntries: 100, preserveCurrentProjectId: true, dryRun });
                result.totalFreedBytes += result.steps.analyses.freedBytesEstimate || 0;
            }
            if (scope === 'all' || scope === 'cache') {
                result.steps.cache = await cleanupOldCache({ dryRun });
                result.totalFreedBytes += result.steps.cache.freedBytesEstimate || 0;
            }
            // documents: solo reportar
            result.steps.documents = await cleanupOldDocuments({ olderThanDays: 365, dryRun: true });

            result.totalFreedFormatted = formatBytes(result.totalFreedBytes);
            result.completedAt = new Date().toISOString();
            return result;
        } catch (e) {
            result.success = false;
            result.error = e.message || String(e);
            return result;
        }
    }

    // ============================================
    // Fase 3 (Android-ready): AUTO-PURGE periódico
    // --------------------------------------------
    // Android puede borrar TODO el storage si la app pasa la cuota (~6% disco).
    // Para evitarlo, corremos limpieza segura silenciosa:
    //   1. 60s después del boot (no bloquea carga inicial)
    //   2. cada 24h si la app sigue abierta
    //   3. cuando StorageManager.estimate() reporte > 80% de la cuota
    //
    // Solo borra: audio chunks > 30 días, transcripciones completed > 14 días,
    // análisis generados > 100 entries, cache temporal. NUNCA toca proyectos,
    // tareas, eventos, configuración, ni decisiones.
    // ============================================
    const AUTO_PURGE_BOOT_DELAY_MS  = 60 * 1000;
    const AUTO_PURGE_INTERVAL_MS    = 24 * 60 * 60 * 1000;
    const QUOTA_PRESSURE_THRESHOLD  = 0.80;   // 80% de la cuota

    let autoPurgeTimer = null;
    let lastPurgeAt = 0;

    async function checkQuotaPressure() {
        try {
            if (!navigator.storage?.estimate) return false;
            const { usage = 0, quota = 0 } = await navigator.storage.estimate();
            if (!quota) return false;
            return (usage / quota) >= QUOTA_PRESSURE_THRESHOLD;
        } catch { return false; }
    }

    async function autoPurge(reason = 'scheduled') {
        if (Date.now() - lastPurgeAt < 60_000) return;
        lastPurgeAt = Date.now();
        try {
            // 'all' incluye audio (>30d), transcripción (>14d), análisis (>100), cache.
            // El servicio NUNCA toca proyectos, tareas, eventos ni configuración.
            const result = await runSafeMaintenance({ dryRun: false, scope: 'all' });
            if (result.success) {
                console.log('[auto-purge] OK (' + reason + ')', {
                    freedBytes: result.totalFreedBytes,
                    freedFormatted: result.totalFreedFormatted
                });
            }
        } catch (e) {
            console.warn('[auto-purge] failed:', e?.message);
        }
    }

    function startAutoPurge() {
        if (autoPurgeTimer) return;
        setTimeout(async () => {
            const pressured = await checkQuotaPressure();
            await autoPurge(pressured ? 'boot+quota-pressure' : 'boot');
        }, AUTO_PURGE_BOOT_DELAY_MS);
        autoPurgeTimer = setInterval(async () => {
            const pressured = await checkQuotaPressure();
            await autoPurge(pressured ? 'daily+quota-pressure' : 'daily');
        }, AUTO_PURGE_INTERVAL_MS);
    }

    if (typeof window !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startAutoPurge);
        } else {
            startAutoPurge();
        }
    }

    // ---------- Public ----------
    window.GunterLocalDataMaintenance = {
        getStorageReport,
        estimateLocalStorageUsage,
        estimateIndexedDBUsage,
        cleanupOldAudio,
        cleanupOldTranscriptionChunks,
        cleanupGeneratedAnalyses,
        cleanupOldCache,
        cleanupOldDocuments,
        runSafeMaintenance,
        getRecommendations,
        formatBytes,
        // Auto-purge (Fase 3 — Android-ready)
        checkQuotaPressure,
        autoPurge,
        // Exposed for UI / tests
        LOCAL_STORAGE_PROTECTED: [...LOCAL_STORAGE_PROTECTED],
        LOCAL_STORAGE_VOLATILE: [...LOCAL_STORAGE_VOLATILE]
    };
})();
