/* =============================================
   GUNTER APP - Audio Vault
   -------------------------------------------------
   Persiste el audio completo de cada reunión en
   IndexedDB (no localStorage — soporta blobs grandes).
   Ofrece re-transcripción completa con Whisper,
   con chunking automático para archivos >25 MB.
   ============================================= */

(function () {
    const DB_NAME = 'gunter_audio_vault';
    const DB_VERSION = 1;
    const STORE = 'recordings';

    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE, { keyPath: 'projectId' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function put(record) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(record);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); reject(tx.error); };
        });
    }

    async function get(projectId) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(projectId);
            req.onsuccess = () => { db.close(); resolve(req.result || null); };
            req.onerror = () => { db.close(); reject(req.error); };
        });
    }

    async function remove(projectId) {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(projectId);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); reject(tx.error); };
        });
    }

    async function list() {
        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).getAll();
            req.onsuccess = () => {
                db.close();
                // Return metadata only (without blob) for listings
                resolve((req.result || []).map(r => ({
                    projectId: r.projectId,
                    projectName: r.projectName,
                    environment: r.environment,
                    savedAt: r.savedAt,
                    durationSec: r.durationSec,
                    size: r.blob ? r.blob.size : 0,
                    mimeType: r.mimeType
                })));
            };
            req.onerror = () => { db.close(); reject(req.error); };
        });
    }

    /**
     * Persist a full recording blob.
     * Optionally records the transcription-service sessionId so that
     * rectify can reuse the 15s chunks already in IndexedDB instead of
     * re-decoding the full blob (critical for 2h+ recordings).
     */
    async function saveRecording({ projectId, projectName, environment, blob, durationSec, mimeType, sessionId }) {
        if (!projectId) throw new Error('audio-vault: projectId required');
        if (!blob) throw new Error('audio-vault: blob required');
        await put({
            projectId,
            projectName: projectName || '',
            environment: environment || '',
            blob,
            mimeType: mimeType || blob.type || 'audio/webm',
            durationSec: durationSec || 0,
            sessionId: sessionId || null,
            savedAt: Date.now()
        });
    }

    async function getRecording(projectId) {
        return get(projectId);
    }

    /**
     * Try to load the chunks that the transcription-service persisted during
     * the live session. Each is a standalone WebM blob (~500KB) with its own
     * header — ready to send to Whisper with NO decoding.
     * Returns [] if no chunks found.
     */
    async function loadSessionChunks(sessionId) {
        if (!sessionId) return [];
        return new Promise((resolve) => {
            const req = indexedDB.open('gunter_transcription_db', 1);
            req.onsuccess = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains('chunks')) { db.close(); resolve([]); return; }
                try {
                    const tx = db.transaction('chunks', 'readonly');
                    const idx = tx.objectStore('chunks').index('sessionId');
                    const r = idx.getAll(sessionId);
                    r.onsuccess = () => {
                        db.close();
                        const chunks = (r.result || []).sort((a, b) => a.index - b.index);
                        resolve(chunks);
                    };
                    r.onerror = () => { db.close(); resolve([]); };
                } catch { try { db.close(); } catch {}; resolve([]); }
            };
            req.onerror = () => resolve([]);
        });
    }

    async function sendToWhisper(blob, filename, { language, model, whisperUrl }) {
        const form = new FormData();
        form.append('file', blob, filename);
        form.append('model', model);
        form.append('language', language);
        form.append('response_format', 'json');

        const resp = await fetch(whisperUrl, { method: 'POST', body: form });
        if (!resp.ok) {
            const txt = await resp.text().catch(() => '');
            throw new Error(`Whisper HTTP ${resp.status}: ${txt.slice(0, 200)}`);
        }
        const raw = await resp.text();
        try { return (JSON.parse(raw).text || '').trim(); } catch { return raw.trim(); }
    }

    /**
     * Re-transcribe the full audio using Whisper.
     * Strategy:
     *   A) If the session's 15s chunks are available in IndexedDB, use them.
     *      Each chunk is a ~500KB independently-decodable WebM → no memory
     *      issues even for 2h+ recordings (N×15s = hundreds of small requests).
     *   B) Fallback: decode the full blob and re-chunk client-side (legacy).
     *
     * Concurrent uploads (3 at a time) keep total time manageable.
     * Reports progress via onProgress({ step, total, percent, message, strategy }).
     */
    async function rectifyTranscription(projectId, {
        onProgress = () => { },
        language = 'es',
        whisperUrl = (window.GUNTER_CONFIG && window.GUNTER_CONFIG.PROXY_TRANSCRIBE_URL) || '/api/transcribe',
        model = (window.GUNTER_CONFIG && window.GUNTER_CONFIG.WHISPER_MODEL) || 'whisper-1',
        concurrency = 3
    } = {}) {
        const record = await get(projectId);
        if (!record) throw new Error('No hay audio guardado para este proyecto.');

        // ---------- STRATEGY A: reuse persisted session chunks ----------
        const sessionChunks = await loadSessionChunks(record.sessionId);
        if (sessionChunks.length > 0) {
            const total = sessionChunks.length;
            const durationMin = Math.round((record.durationSec || 0) / 60);
            onProgress({
                step: 0, total, percent: 2, strategy: 'chunks',
                message: `Reutilizando ${total} segmentos grabados (${durationMin} min) — sin decodificar el archivo completo.`
            });

            const results = new Array(total);
            let completed = 0;

            // Small concurrent worker pool to speed up long recordings
            async function worker(startIdx) {
                for (let i = startIdx; i < total; i += concurrency) {
                    const c = sessionChunks[i];
                    try {
                        const text = await sendToWhisper(c.blob, `session_${i}.webm`, { language, model, whisperUrl });
                        results[i] = text;
                    } catch (e) {
                        console.warn(`[rectify] chunk ${i} failed:`, e.message);
                        // Fall back to any previously-transcribed text we had
                        results[i] = c.text || '';
                    }
                    completed++;
                    const percent = 5 + Math.floor((completed / total) * 92);
                    onProgress({
                        step: completed, total, percent, strategy: 'chunks',
                        message: `Transcribiendo segmento ${completed} de ${total}…`
                    });
                }
            }
            await Promise.all(Array.from({ length: Math.min(concurrency, total) }, (_, i) => worker(i)));

            const full = results.join(' ').replace(/\s+/g, ' ').trim();
            onProgress({ step: total, total, percent: 100, strategy: 'chunks', message: 'Transcripción rectificada ✓' });
            return {
                text: full,
                segments: results,
                duration: record.durationSec || 0,
                rectifiedAt: Date.now(),
                strategy: 'session-chunks'
            };
        }

        // ---------- STRATEGY B: legacy full-blob path ----------
        if (!record.blob) throw new Error('Sin chunks de sesión ni blob completo para rectificar.');
        const blob = record.blob;
        const sizeMB = blob.size / (1024 * 1024);
        onProgress({ step: 0, total: 1, percent: 0, strategy: 'blob', message: `Decodificando audio completo (${sizeMB.toFixed(1)} MB)…` });

        const MAX_MB = 20;
        let chunks = [{ blob, index: 0 }];
        let totalDuration = record.durationSec || 0;

        if (sizeMB > MAX_MB) {
            if (!window.GunterAudioChunker) {
                throw new Error('GunterAudioChunker no disponible para archivos grandes.');
            }
            // Memory warning for huge files
            if (sizeMB > 80) {
                console.warn('[rectify] Legacy path with large blob — may use significant RAM. Consider re-recording with the new session-chunk system.');
            }
            const chunker = new window.GunterAudioChunker();
            onProgress({ step: 0, total: 1, percent: 5, strategy: 'blob', message: 'Dividiendo archivo grande en segmentos…' });
            const meta = await chunker.getAudioMetadata(blob);
            totalDuration = meta.duration;
            chunks = await chunker.splitAudioByDuration(blob, 6); // 6-min chunks → smaller WAVs
        }

        const transcripts = [];
        for (let i = 0; i < chunks.length; i++) {
            const c = chunks[i];
            const percent = 10 + Math.floor((i / chunks.length) * 85);
            onProgress({ step: i + 1, total: chunks.length, percent, strategy: 'blob', message: `Transcribiendo segmento ${i + 1} de ${chunks.length}…` });
            const filename = `rectify_${i}.${c.blob.type.includes('wav') ? 'wav' : 'webm'}`;
            const text = await sendToWhisper(c.blob, filename, { language, model, whisperUrl });
            transcripts.push(text);
        }
        const full = transcripts.join(' ').replace(/\s+/g, ' ').trim();
        onProgress({ step: chunks.length, total: chunks.length, percent: 100, strategy: 'blob', message: 'Transcripción rectificada ✓' });
        return { text: full, segments: transcripts, duration: totalDuration, rectifiedAt: Date.now(), strategy: 'full-blob' };
    }

    window.GunterAudioVault = {
        save: saveRecording,
        get: getRecording,
        remove,
        list,
        rectify: rectifyTranscription
    };
})();
