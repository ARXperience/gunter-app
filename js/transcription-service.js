/* =============================================
   GUNTER APP - Transcription Service (Dual Backup)
   -------------------------------------------------
   Combina Web Speech API (baja latencia) con envíos
   periódicos a Whisper (fuente de verdad) y persiste
   los chunks en IndexedDB para sobrevivir a crashes.
   ============================================= */

(function () {
    // ---------- IndexedDB helpers ----------
    const DB_NAME = 'gunter_transcription_db';
    const DB_VERSION = 1;
    const STORE_CHUNKS = 'chunks';
    const STORE_META = 'meta';

    function openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
                    const store = db.createObjectStore(STORE_CHUNKS, { keyPath: 'id', autoIncrement: true });
                    store.createIndex('sessionId', 'sessionId', { unique: false });
                }
                if (!db.objectStoreNames.contains(STORE_META)) {
                    db.createObjectStore(STORE_META, { keyPath: 'sessionId' });
                }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function idbPutChunk(db, chunk) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_CHUNKS, 'readwrite');
            tx.objectStore(STORE_CHUNKS).add(chunk);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function idbGetSessionChunks(db, sessionId) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_CHUNKS, 'readonly');
            const idx = tx.objectStore(STORE_CHUNKS).index('sessionId');
            const req = idx.getAll(sessionId);
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    async function idbUpdateChunk(db, chunk) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_CHUNKS, 'readwrite');
            tx.objectStore(STORE_CHUNKS).put(chunk);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function idbDeleteSession(db, sessionId) {
        const chunks = await idbGetSessionChunks(db, sessionId);
        return new Promise((resolve, reject) => {
            const tx = db.transaction([STORE_CHUNKS, STORE_META], 'readwrite');
            const store = tx.objectStore(STORE_CHUNKS);
            chunks.forEach(c => store.delete(c.id));
            tx.objectStore(STORE_META).delete(sessionId);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function idbPutMeta(db, meta) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_META, 'readwrite');
            tx.objectStore(STORE_META).put(meta);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function idbListSessions(db) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_META, 'readonly');
            const req = tx.objectStore(STORE_META).getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = () => reject(req.error);
        });
    }

    // ---------- Main service ----------
    class GunterTranscriptionService {
        constructor(options = {}) {
            this.options = {
                language: 'es-MX',
                chunkDurationMs: 15000,        // Send audio to Whisper every 15s
                chunkOverlapMs: 400,           // Small overlap to avoid word cuts
                whisperUrl: (window.GUNTER_CONFIG && window.GUNTER_CONFIG.PROXY_TRANSCRIBE_URL) || '/api/transcribe',
                onInterim: () => { },          // fast Web Speech interim text
                onLiveTranscript: () => { },   // Web Speech final utterance (fast, may be wrong)
                onAuthoritative: () => { },    // Whisper final chunk (slower, reliable)
                onChunkStatus: () => { },      // { index, status: 'pending|uploading|done|error' }
                onBackupStatus: () => { },     // { webSpeech: 'ok|failing', whisper: 'ok|failing' }
                onError: console.error,
                ...options
            };

            this.sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            this.db = null;
            this.stream = null;
            this.audioContext = null;
            this.analyser = null;

            this.mainRecorder = null;          // full session recorder (for download)
            this.mainChunks = [];

            this.rollingRecorder = null;       // rotating 15s recorder for Whisper
            this.rollingChunkIndex = 0;
            this.rollingTimer = null;

            this.recognition = null;           // Web Speech API
            this.webSpeechAlive = false;
            this.webSpeechRetries = 0;
            this.lastWebSpeechResultAt = 0;

            this.isRunning = false;
            this.isPaused = false;
            this.startedAt = null;

            this.liveEntries = [];             // Web Speech finals
            this.authoritativeEntries = [];    // Whisper finals
            this.pendingUploads = 0;
        }

        static isSupported() {
            return !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder && window.indexedDB);
        }

        async init(existingStream = null) {
            if (!GunterTranscriptionService.isSupported()) {
                throw new Error('Transcription service not supported in this browser');
            }

            this.db = await openDB();

            this.stream = existingStream || await navigator.mediaDevices.getUserMedia({
                audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
            });

            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            const src = this.audioContext.createMediaStreamSource(this.stream);
            src.connect(this.analyser);

            await idbPutMeta(this.db, {
                sessionId: this.sessionId,
                startedAt: Date.now(),
                status: 'active'
            });

            return true;
        }

        getStream() { return this.stream; }
        getAnalyser() { return this.analyser; }
        getAudioContext() { return this.audioContext; }
        getSessionId() { return this.sessionId; }

        // ---------- Recording lifecycle ----------
        async start() {
            if (this.isRunning) return;
            this.isRunning = true;
            this.startedAt = Date.now();

            this._startMainRecorder();
            this._startRollingRecorder();
            this._startWebSpeech();
            this._startBackupWatchdog();
        }

        pause() {
            if (!this.isRunning || this.isPaused) return;
            this.isPaused = true;
            try { this.mainRecorder?.pause(); } catch { }
            try { this.rollingRecorder?.pause(); } catch { }
            try { this.recognition?.stop(); } catch { }
        }

        resume() {
            if (!this.isRunning || !this.isPaused) return;
            this.isPaused = false;
            try { this.mainRecorder?.resume(); } catch { }
            try { this.rollingRecorder?.resume(); } catch { }
            this._startWebSpeech();
        }

        async stop() {
            if (!this.isRunning) return null;
            this.isRunning = false;

            if (this.rollingTimer) { clearInterval(this.rollingTimer); this.rollingTimer = null; }
            if (this.backupWatchdog) { clearInterval(this.backupWatchdog); this.backupWatchdog = null; }

            try { this.recognition?.stop(); } catch { }
            this.webSpeechAlive = false;

            // Flush rolling recorder (send last partial chunk)
            await this._flushRollingRecorder();

            // Stop main recorder and return full blob
            const fullBlob = await this._stopMainRecorder();

            // Wait for any in-flight uploads to complete (up to 30s)
            await this._waitForUploads(30000);

            await idbPutMeta(this.db, {
                sessionId: this.sessionId,
                startedAt: this.startedAt,
                stoppedAt: Date.now(),
                status: 'completed'
            });

            return fullBlob;
        }

        async destroy(deletePersistence = false) {
            try { await this.stop(); } catch { }
            try { this.stream?.getTracks().forEach(t => t.stop()); } catch { }
            try { if (this.audioContext && this.audioContext.state !== 'closed') await this.audioContext.close(); } catch { }
            if (deletePersistence && this.db) {
                try { await idbDeleteSession(this.db, this.sessionId); } catch { }
            }
            this.stream = null;
            this.audioContext = null;
            this.analyser = null;
        }

        // ---------- Helper: pick best supported mimeType (Android-ready chain) ----------
        // Fase 3: Android puede no soportar webm/opus. Cae a mp4/aac → wav → default.
        _pickMimeType() {
            const CHAIN = [
                'audio/webm;codecs=opus',
                'audio/webm',
                'audio/mp4;codecs=mp4a.40.2',
                'audio/mp4',
                'audio/ogg;codecs=opus',
                'audio/wav'
            ];
            for (const m of CHAIN) {
                if (MediaRecorder.isTypeSupported(m)) return m;
            }
            return ''; // browser default
        }

        // ---------- Main recorder (for final download) ----------
        _startMainRecorder() {
            const mimeType = this._pickMimeType();
            this.mainRecorder = mimeType
                ? new MediaRecorder(this.stream, { mimeType })
                : new MediaRecorder(this.stream);
            this.mainChunks = [];
            this.mainRecorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) this.mainChunks.push(e.data);
            };
            this.mainRecorder.start(1000);
        }

        _stopMainRecorder() {
            return new Promise((resolve) => {
                if (!this.mainRecorder || this.mainRecorder.state === 'inactive') {
                    resolve(null); return;
                }
                const mime = this.mainRecorder.mimeType;
                this.mainRecorder.onstop = () => {
                    const blob = new Blob(this.mainChunks, { type: mime });
                    resolve(blob);
                };
                try { this.mainRecorder.stop(); } catch { resolve(null); }
            });
        }

        // ---------- Rolling recorder (15s windows to Whisper) ----------
        _startRollingRecorder() {
            this._openRollingWindow();
            this.rollingTimer = setInterval(() => {
                if (!this.isRunning || this.isPaused) return;
                this._rotateRollingWindow();
            }, this.options.chunkDurationMs);
        }

        _openRollingWindow() {
            const mimeType = this._pickMimeType();
            const recorder = mimeType
                ? new MediaRecorder(this.stream, { mimeType })
                : new MediaRecorder(this.stream);
            // Para que el blob downstream tenga type correcto incluso si fue default
            const effectiveMime = mimeType || (recorder.mimeType || 'audio/webm');
            const chunks = [];
            const index = this.rollingChunkIndex++;
            const startedAt = Date.now();

            recorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) chunks.push(e.data);
            };
            recorder.onstop = async () => {
                if (chunks.length === 0) return;
                const blob = new Blob(chunks, { type: effectiveMime });
                await this._persistAndUploadChunk({ index, startedAt, blob });
            };
            recorder.start();
            this.rollingRecorder = recorder;
        }

        _rotateRollingWindow() {
            const old = this.rollingRecorder;
            // Open new window first (overlap avoids audio gaps)
            this._openRollingWindow();
            // Stop the old one after a small overlap
            setTimeout(() => {
                try { old?.stop(); } catch { }
            }, this.options.chunkOverlapMs);
        }

        async _flushRollingRecorder() {
            return new Promise((resolve) => {
                const r = this.rollingRecorder;
                if (!r || r.state === 'inactive') { resolve(); return; }
                const origOnStop = r.onstop;
                r.onstop = async (e) => {
                    try { if (origOnStop) await origOnStop(e); } catch { }
                    resolve();
                };
                try { r.stop(); } catch { resolve(); }
            });
        }

        async _persistAndUploadChunk({ index, startedAt, blob }) {
            const record = {
                sessionId: this.sessionId,
                index,
                startedAt,
                elapsedMs: startedAt - this.startedAt,
                size: blob.size,
                blob,
                status: 'pending',
                text: null
            };
            // Persist first so we survive a crash even before uploading
            try { await idbPutChunk(this.db, record); } catch (e) { this.options.onError(e); }
            this.options.onChunkStatus({ index, status: 'pending', elapsedMs: record.elapsedMs });

            this.pendingUploads++;
            try {
                this.options.onChunkStatus({ index, status: 'uploading', elapsedMs: record.elapsedMs });
                const text = await this._uploadToWhisper(blob, index);
                record.status = 'done';
                record.text = text;
                try { await idbUpdateChunk(this.db, record); } catch { }
                const entry = {
                    source: 'whisper',
                    text: (text || '').trim(),
                    index,
                    startedAtMs: record.elapsedMs,
                    timestamp: new Date(startedAt).toISOString()
                };
                if (entry.text) {
                    this.authoritativeEntries.push(entry);
                    this.options.onAuthoritative(entry);
                }
                this.options.onChunkStatus({ index, status: 'done', elapsedMs: record.elapsedMs });
                this.options.onBackupStatus({ whisper: 'ok' });
            } catch (err) {
                record.status = 'error';
                record.error = String(err && err.message || err);
                try { await idbUpdateChunk(this.db, record); } catch { }
                this.options.onChunkStatus({ index, status: 'error', error: record.error, elapsedMs: record.elapsedMs });
                this.options.onBackupStatus({ whisper: 'failing' });
                // Don't throw — chunk is persisted, can be retried later
            } finally {
                this.pendingUploads--;
            }
        }

        async _uploadToWhisper(blob, index) {
            const form = new FormData();
            form.append('file', blob, `chunk_${index}.webm`);
            form.append('model', (window.GUNTER_CONFIG && window.GUNTER_CONFIG.WHISPER_MODEL) || 'whisper-1');
            form.append('language', (this.options.language || 'es').split('-')[0]);
            form.append('response_format', 'json');

            const resp = await fetch(this.options.whisperUrl, { method: 'POST', body: form });
            if (!resp.ok) {
                const txt = await resp.text().catch(() => '');
                throw new Error(`Whisper HTTP ${resp.status}: ${txt.slice(0, 200)}`);
            }
            // Proxy may return text/plain containing JSON — be tolerant
            const raw = await resp.text();
            try {
                const json = JSON.parse(raw);
                return json.text || json.transcript || '';
            } catch {
                return raw;
            }
        }

        async _waitForUploads(timeoutMs) {
            const start = Date.now();
            while (this.pendingUploads > 0 && (Date.now() - start) < timeoutMs) {
                await new Promise(r => setTimeout(r, 250));
            }
        }

        // ---------- Web Speech (fast live feedback) ----------
        _startWebSpeech() {
            const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
            if (!SR) {
                this.options.onBackupStatus({ webSpeech: 'unsupported' });
                return;
            }
            try {
                if (this.recognition) { try { this.recognition.stop(); } catch { } }
                const r = new SR();
                r.continuous = true;
                r.interimResults = true;
                r.lang = this.options.language;

                r.onstart = () => {
                    this.webSpeechAlive = true;
                    this.webSpeechRetries = 0;
                    this.lastWebSpeechResultAt = Date.now();
                    this.options.onBackupStatus({ webSpeech: 'ok' });
                };

                r.onresult = (event) => {
                    this.lastWebSpeechResultAt = Date.now();
                    let interim = '';
                    for (let i = event.resultIndex; i < event.results.length; i++) {
                        const res = event.results[i];
                        const text = res[0].transcript;
                        if (res.isFinal) {
                            const t = text.trim();
                            if (!t) continue;
                            const elapsedMs = Date.now() - this.startedAt;
                            const entry = {
                                source: 'webspeech',
                                text: t,
                                startedAtMs: elapsedMs,
                                timestamp: new Date().toISOString()
                            };
                            this.liveEntries.push(entry);
                            this.options.onLiveTranscript(entry);
                        } else {
                            interim += text;
                        }
                    }
                    if (interim) this.options.onInterim(interim);
                };

                r.onerror = (event) => {
                    if (event.error === 'no-speech' || event.error === 'aborted') return;
                    this.options.onBackupStatus({ webSpeech: 'failing' });
                };

                r.onend = () => {
                    this.webSpeechAlive = false;
                    if (!this.isRunning || this.isPaused) return;
                    // Exponential-ish backoff capped at 2s
                    const delay = Math.min(2000, 250 * Math.pow(2, Math.min(3, this.webSpeechRetries++)));
                    setTimeout(() => { try { r.start(); } catch { } }, delay);
                };

                this.recognition = r;
                r.start();
            } catch (e) {
                this.options.onBackupStatus({ webSpeech: 'failing' });
            }
        }

        _startBackupWatchdog() {
            // If Web Speech has been silent for >10s while we're recording, flag as failing.
            // Whisper pipeline is our safety net in that case — nothing is lost.
            this.backupWatchdog = setInterval(() => {
                if (!this.isRunning || this.isPaused) return;
                const silentFor = Date.now() - (this.lastWebSpeechResultAt || this.startedAt);
                if (silentFor > 10000 && !this.webSpeechAlive) {
                    this.options.onBackupStatus({ webSpeech: 'failing', whisperActive: true });
                }
            }, 5000);
        }

        // ---------- Query & merge ----------
        getLiveEntries() { return this.liveEntries.slice(); }
        getAuthoritativeEntries() { return this.authoritativeEntries.slice(); }

        /**
         * Merge: prefer Whisper chunks as source of truth; fill any gaps with
         * Web Speech entries that don't overlap a Whisper chunk by time.
         */
        getMergedTranscript() {
            const whisper = this.authoritativeEntries.slice().sort((a, b) => a.startedAtMs - b.startedAtMs);
            const live = this.liveEntries.slice().sort((a, b) => a.startedAtMs - b.startedAtMs);

            if (whisper.length === 0) return live.map(e => e.text).join(' ').trim();

            const chunkMs = this.options.chunkDurationMs;
            const covered = whisper.map(w => [w.startedAtMs, w.startedAtMs + chunkMs]);

            const merged = [];
            whisper.forEach(w => merged.push({ at: w.startedAtMs, text: w.text, source: 'whisper' }));
            live.forEach(l => {
                const t = l.startedAtMs;
                const overlaps = covered.some(([a, b]) => t >= a && t < b);
                if (!overlaps) merged.push({ at: t, text: l.text, source: 'webspeech' });
            });
            merged.sort((a, b) => a.at - b.at);
            return merged.map(m => m.text).join(' ').trim();
        }

        getStats() {
            return {
                sessionId: this.sessionId,
                running: this.isRunning,
                paused: this.isPaused,
                webSpeechAlive: this.webSpeechAlive,
                pendingUploads: this.pendingUploads,
                whisperEntries: this.authoritativeEntries.length,
                liveEntries: this.liveEntries.length,
                chunksEmitted: this.rollingChunkIndex
            };
        }

        // ---------- Crash recovery ----------
        static async listRecoverableSessions() {
            const db = await openDB();
            const metas = await idbListSessions(db);
            db.close();
            return metas.filter(m => m.status === 'active');
        }

        static async recoverSession(sessionId) {
            const db = await openDB();
            const chunks = await idbGetSessionChunks(db, sessionId);
            db.close();
            return chunks.sort((a, b) => a.index - b.index);
        }

        static async purgeSession(sessionId) {
            const db = await openDB();
            await idbDeleteSession(db, sessionId);
            db.close();
        }

        /**
         * Garbage-collect sessions older than `maxAgeDays` or those marked
         * completed more than `completedTtlDays` ago. Call on page load to
         * keep IndexedDB lean — long recordings can accumulate hundreds of
         * chunks otherwise.
         */
        static async purgeOldSessions({ maxAgeDays = 14, completedTtlDays = 2 } = {}) {
            const db = await openDB();
            try {
                const metas = await idbListSessions(db);
                const now = Date.now();
                const maxAgeMs = maxAgeDays * 86400_000;
                const completedTtlMs = completedTtlDays * 86400_000;
                let purged = 0;
                for (const m of metas) {
                    const age = now - (m.startedAt || 0);
                    const completedAge = m.stoppedAt ? (now - m.stoppedAt) : null;
                    if (age > maxAgeMs || (m.status === 'completed' && completedAge !== null && completedAge > completedTtlMs)) {
                        await idbDeleteSession(db, m.sessionId);
                        purged++;
                    }
                }
                if (purged > 0) console.log(`[transcription-service] Purged ${purged} old session(s) from IndexedDB.`);
                return purged;
            } finally {
                db.close();
            }
        }
    }

    window.GunterTranscriptionService = GunterTranscriptionService;
})();
