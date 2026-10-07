/* Shared STT facade. Meeting audio and future consumers use the same route. */
(function (root) {
    if (root.GunterSTT) return;
    function unavailable(code) { return Object.assign(new Error(code), { code }); }
    const CloudSTT = {
        id: 'cloud.current', health: () => ({ installed: true, status: 'CURRENT_PROVIDER' }),
        async transcribe(form, options = {}) {
            const response = await fetch(options.url || root.GUNTER_CONFIG?.PROXY_TRANSCRIBE_URL || '/api/transcribe',
                { method: 'POST', body: form, signal: options.signal });
            if (!response.ok) {
                const raw = await response.text().catch(() => '');
                let data = {}; try { data = JSON.parse(raw); } catch { /* text response */ }
                if (['LOCAL_PROVIDER_NOT_INSTALLED', 'LOCAL_MODEL_NOT_INSTALLED', 'LOCAL_STT_NOT_INSTALLED',
                    'LOCAL_STT_UNAVAILABLE', 'LOCAL_STT_INVALID_AUDIO', 'LOCAL_STT_AUDIO_TOO_LARGE', 'LOCAL_STT_BUSY'].includes(data.code)) throw unavailable(data.code);
                throw new Error(`Whisper HTTP ${response.status}: ${raw.slice(0, 200)}`);
            }
            const raw = await response.text();
            try { const data = JSON.parse(raw); return data.text || data.transcript || ''; }
            catch { return raw; }
        }
    };
    // The server-side hybrid router is authoritative; both providers use the
    // existing endpoint, which never falls back to cloud in LOCAL/LOCAL_ONLY.
    const LocalSTT = { id: 'moonshine.local',
        health: () => { const state = root.GunterRuntimeState?.getState?.() || {};
            return { installed: !!state.localSTTInstalled, ready: !!state.localSTTReady,
                runtimeAvailable: !!state.localSTTRuntimeAvailable, model: state.localSTTModel || null,
                error: state.localSTTError || null }; },
        transcribe: (form, options = {}) => CloudSTT.transcribe(form, options) };
    let recorder = null;
    let captureStream = null;
    let captureTimer = null;
    function captureState(active) {
        try { root.dispatchEvent(new CustomEvent('gunter-push-to-talk-state', { detail: { active } })); } catch {}
    }
    const pushToTalk = {
        isActive: () => !!recorder && recorder.state === 'recording',
        async start() {
            if (recorder) return;
            if (!root.GunterCompanion?.__handleFromWake) throw unavailable('LOCAL_STT_UNAVAILABLE');
            if (!navigator.mediaDevices?.getUserMedia || !root.MediaRecorder) throw unavailable('LOCAL_STT_UNAVAILABLE');
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            captureStream = stream;
            const allowed = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
            const mime = allowed.find(value => root.MediaRecorder.isTypeSupported?.(value));
            try {
                recorder = mime ? new root.MediaRecorder(stream, { mimeType: mime }) : new root.MediaRecorder(stream);
                const current = recorder;
                const chunks = [];
                current.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
                current.onerror = () => { captureState(false); };
                current.onstop = async () => {
                    clearTimeout(captureTimer);
                    recorder = null;
                    stream.getTracks().forEach(track => track.stop());
                    captureStream = null;
                    captureState(false);
                    try {
                        const type = current.mimeType.split(';')[0];
                        const blob = new Blob(chunks, { type });
                        if (!blob.size || blob.size > 30 * 1024 * 1024) throw unavailable('LOCAL_STT_INVALID_AUDIO');
                        const form = new FormData();
                        form.append('file', blob, type === 'audio/ogg' ? 'voice.ogg' : 'voice.webm');
                        const transcript = (await root.GunterSTT.transcribe(form)).trim();
                        if (transcript) await root.GunterCompanion.__handleFromWake(transcript);
                        else root.GunterNotificationsService?.showToast?.('No detecté voz. Inténtalo de nuevo.', { variant: 'info' });
                    } catch (error) {
                        root.GunterNotificationsService?.showToast?.(`No pude transcribir: ${error.code || error.message}`, { variant: 'warn' });
                    }
                };
                current.start(500);
                captureTimer = setTimeout(() => pushToTalk.stop(), 25000);
                captureState(true);
            } catch (error) {
                stream.getTracks().forEach(track => track.stop());
                captureStream = null; recorder = null;
                throw error;
            }
        },
        stop() {
            clearTimeout(captureTimer);
            if (recorder?.state === 'recording') recorder.stop();
            else if (captureStream) { captureStream.getTracks().forEach(track => track.stop()); captureStream = null; }
        }
    };
    root.GunterSTT = { providers: { CloudSTT, LocalSTT }, pushToTalk,
        health: () => ({ cloud: CloudSTT.health(), local: LocalSTT.health() }),
        transcribe(form, options) {
            const state = root.GunterRuntimeState?.getState?.() || {};
            if (state.privacy === 'LOCAL_ONLY' || state.mode === 'LOCAL') return LocalSTT.transcribe(form, options);
            return CloudSTT.transcribe(form, options);
        } };
})(typeof window !== 'undefined' ? window : globalThis);
