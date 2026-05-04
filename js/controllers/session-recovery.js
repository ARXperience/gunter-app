/* =============================================
   GUNTER - Session Recovery
   -------------------------------------------------
   Detecta sesiones de transcripción que quedaron
   activas (la pestaña se cerró sin llamar stop()),
   y ofrece al usuario:
   - Reanudar: re-transcribe los chunks persistidos
     y guarda la transcripción en localStorage
   - Descartar: purga la sesión
   ============================================= */

(function () {
    const MIN_AGE_MS = 2 * 60 * 1000;     // ignora sesiones de los últimos 2 min (puede estar grabando)
    const MAX_AGE_MS = 14 * 24 * 3600 * 1000;

    function injectStyles() {
        if (document.getElementById('gsr-styles')) return;
        const s = document.createElement('style');
        s.id = 'gsr-styles';
        s.textContent = `
            .gsr-banner {
                position: relative;
                margin: 0 auto 16px;
                max-width: 1100px;
                padding: 14px 18px;
                display: flex;
                gap: 14px;
                align-items: center;
                flex-wrap: wrap;
                border-radius: 12px;
                background: linear-gradient(135deg,
                    color-mix(in srgb, #f59e0b 14%, transparent),
                    color-mix(in srgb, var(--bg-deep-navy, #0b0f16) 80%, transparent));
                border: 1px solid rgba(245, 158, 11, 0.4);
                color: var(--text-primary, #fff);
                animation: gsrIn 380ms cubic-bezier(.22,.61,.36,1);
                z-index: 100;
            }
            @keyframes gsrIn {
                from { opacity: 0; transform: translateY(-8px); }
                to   { opacity: 1; transform: translateY(0); }
            }
            .gsr-banner__icon { font-size: 24px; flex-shrink: 0; }
            .gsr-banner__body { flex: 1; min-width: 220px; }
            .gsr-banner__title { font-weight: 600; font-size: 14px; margin-bottom: 2px; color: #fbbf24; }
            .gsr-banner__sub   { font-size: 12px; color: rgba(255,255,255,0.75); line-height: 1.5; }
            .gsr-banner__actions { display: flex; gap: 8px; flex-shrink: 0; flex-wrap: wrap; }
            .gsr-banner__btn {
                padding: 8px 14px; border-radius: 8px; font-family: inherit; font-size: 13px;
                cursor: pointer; border: 1px solid rgba(255,255,255,0.2); background: transparent;
                color: var(--text-primary, #fff); font-weight: 500;
                transition: all 200ms ease;
            }
            .gsr-banner__btn:hover { border-color: rgba(255,255,255,0.5); transform: translateY(-1px); }
            .gsr-banner__btn--primary {
                background: #fbbf24; color: #1a1a1a; border-color: #fbbf24; font-weight: 600;
            }
            .gsr-banner__btn--primary:hover { background: #fcd34d; border-color: #fcd34d; }
            .gsr-banner__btn--danger { color: #fca5a5; border-color: rgba(248,113,113,0.4); }
            .gsr-banner__btn[disabled] { opacity: 0.5; cursor: not-allowed; }

            .gsr-progress {
                width: 100%; height: 4px; background: rgba(255,255,255,0.1);
                border-radius: 999px; overflow: hidden; margin-top: 10px;
            }
            .gsr-progress__bar {
                height: 100%; background: #fbbf24;
                width: 0%; transition: width 300ms ease;
            }
        `;
        document.head.appendChild(s);
    }

    async function detectRecoverable() {
        if (!window.GunterTranscriptionService?.listRecoverableSessions) return [];
        try {
            const list = await window.GunterTranscriptionService.listRecoverableSessions();
            const now = Date.now();
            return (list || []).filter(meta => {
                if (!meta.startedAt) return false;
                const age = now - meta.startedAt;
                return age > MIN_AGE_MS && age < MAX_AGE_MS;
            });
        } catch (e) {
            console.warn('[session-recovery] detect failed:', e);
            return [];
        }
    }

    async function getChunkCount(sessionId) {
        if (!window.GunterTranscriptionService?.recoverSession) return 0;
        try {
            const chunks = await window.GunterTranscriptionService.recoverSession(sessionId);
            return chunks.length;
        } catch { return 0; }
    }

    function fmtAge(startedAt) {
        const mins = Math.round((Date.now() - startedAt) / 60000);
        if (mins < 60) return `hace ${mins} min`;
        const hours = Math.round(mins / 60);
        if (hours < 24) return `hace ${hours} h`;
        const days = Math.round(hours / 24);
        return `hace ${days} d`;
    }

    function renderBanner(host, meta, chunkCount) {
        host.innerHTML = `
            <div class="gsr-banner">
                <div class="gsr-banner__icon">⚠️</div>
                <div class="gsr-banner__body">
                    <div class="gsr-banner__title">Detectamos una reunión sin finalizar</div>
                    <div class="gsr-banner__sub">
                        Iniciada ${fmtAge(meta.startedAt)} con <strong>${chunkCount} fragmentos</strong> de audio guardados.
                        Puedes recuperar la transcripción ahora o descartarla.
                    </div>
                    <div class="gsr-progress" id="gsr-progress" style="display:none;">
                        <div class="gsr-progress__bar" id="gsr-progress-bar"></div>
                    </div>
                </div>
                <div class="gsr-banner__actions" id="gsr-actions">
                    <button class="gsr-banner__btn gsr-banner__btn--primary" id="gsr-recover">↻ Recuperar transcripción</button>
                    <button class="gsr-banner__btn gsr-banner__btn--danger" id="gsr-discard">Descartar</button>
                    <button class="gsr-banner__btn" id="gsr-later">Más tarde</button>
                </div>
            </div>
        `;
        host.querySelector('#gsr-recover').addEventListener('click', () => recover(host, meta));
        host.querySelector('#gsr-discard').addEventListener('click', () => discard(host, meta));
        host.querySelector('#gsr-later').addEventListener('click', () => host.innerHTML = '');
    }

    /** Reenvía cada chunk persistido a Whisper y construye un transcript. */
    async function recover(host, meta) {
        const banner = host.querySelector('.gsr-banner');
        const actions = host.querySelector('#gsr-actions');
        const progress = host.querySelector('#gsr-progress');
        const bar = host.querySelector('#gsr-progress-bar');
        const sub = host.querySelector('.gsr-banner__sub');

        actions.querySelectorAll('button').forEach(b => b.disabled = true);
        progress.style.display = 'block';
        sub.textContent = 'Recuperando audio… espera unos minutos.';

        try {
            const chunks = await window.GunterTranscriptionService.recoverSession(meta.sessionId);
            if (!chunks.length) throw new Error('Sin fragmentos para recuperar');

            const cfg = window.GUNTER_CONFIG || {};
            const url = cfg.PROXY_TRANSCRIBE_URL || '/api/transcribe';
            const transcripts = [];
            for (let i = 0; i < chunks.length; i++) {
                const c = chunks[i];
                if (c.text && c.status === 'done') {
                    // ya transcrito — reutilizar
                    transcripts.push(c.text);
                } else {
                    // reintentar
                    try {
                        const text = await sendChunkToWhisper(c.blob, i, url);
                        transcripts.push(text);
                    } catch (e) {
                        console.warn(`[session-recovery] chunk ${i} failed:`, e.message);
                        transcripts.push(c.text || ''); // fallback al texto previo si lo había
                    }
                }
                bar.style.width = `${Math.round(((i + 1) / chunks.length) * 100)}%`;
            }
            const fullText = transcripts.join(' ').replace(/\s+/g, ' ').trim();

            // Persistir (Fase A.A2 — helper guard >200KB)
            if (window.GunterTranscriptStore) {
                await window.GunterTranscriptStore.save(fullText);
            } else {
                try { localStorage.setItem('gunter_full_transcript', fullText); } catch (e) { console.warn('localStorage exceeded:', e); }
            }
            localStorage.setItem('gunter_transcript_recovered_at', new Date().toISOString());

            // Marcar la sesión como completada para que purgue eventualmente
            await window.GunterTranscriptionService.purgeSession(meta.sessionId);

            sub.textContent = `Transcripción recuperada (${fullText.split(/\s+/).length} palabras). Redirigiendo a resultados…`;
            bar.style.width = '100%';

            // Toast si hay servicio
            if (window.GunterNotificationsService?.showToast) {
                window.GunterNotificationsService.showToast(
                    '✅ Transcripción recuperada con éxito.',
                    { priority: 'normal', duration: 4000 }
                );
            }

            setTimeout(() => {
                window.location.href = 'results.html';
            }, 1500);

        } catch (err) {
            const f = window.GunterErrors?.format(err, { context: 'audio' }) || { user: 'Error al recuperar.' };
            sub.innerHTML = `<span style="color:#fca5a5;">⚠️ ${f.user}${f.hint ? ' · ' + f.hint : ''}</span>`;
            actions.querySelectorAll('button').forEach(b => b.disabled = false);
        }
    }

    async function sendChunkToWhisper(blob, index, url) {
        const form = new FormData();
        form.append('file', blob, `recover_${index}.webm`);
        form.append('model', (window.GUNTER_CONFIG?.WHISPER_MODEL) || 'whisper-1');
        form.append('language', 'es');
        form.append('response_format', 'json');
        const r = await fetch(url, { method: 'POST', body: form });
        if (!r.ok) throw new Error(`Whisper HTTP ${r.status}`);
        const raw = await r.text();
        try { return (JSON.parse(raw).text || '').trim(); } catch { return raw.trim(); }
    }

    async function discard(host, meta) {
        if (!confirm('¿Descartar la sesión sin recuperar?\nLos fragmentos de audio se borrarán.')) return;
        try {
            await window.GunterTranscriptionService.purgeSession(meta.sessionId);
            host.innerHTML = '';
            if (window.GunterNotificationsService?.showToast) {
                window.GunterNotificationsService.showToast('Sesión descartada.', { duration: 2500 });
            }
        } catch (e) {
            window.GunterErrors?.toast(e, { context: 'audio' });
        }
    }

    /**
     * Mounts the recovery banner on the given host element.
     * If no recoverable session is found, renders nothing.
     */
    async function mount(hostSelector = '#gsr-mount') {
        const host = typeof hostSelector === 'string' ? document.querySelector(hostSelector) : hostSelector;
        if (!host) return;

        // Esperar a que TranscriptionService cargue
        if (!window.GunterTranscriptionService) {
            setTimeout(() => mount(hostSelector), 600);
            return;
        }

        injectStyles();
        const recoverable = await detectRecoverable();
        if (!recoverable.length) return;

        // Tomar la más reciente
        const meta = recoverable.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))[0];
        const chunkCount = await getChunkCount(meta.sessionId);
        if (chunkCount === 0) {
            // Sin chunks → purgar silencioso
            try { await window.GunterTranscriptionService.purgeSession(meta.sessionId); } catch {}
            return;
        }
        renderBanner(host, meta, chunkCount);
    }

    window.GunterSessionRecovery = { mount, detectRecoverable };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => mount());
    } else {
        mount();
    }
})();
