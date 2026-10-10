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
    let elapsedTimer = null;
    let silenceTimer = null;
    let unsubscribeVAD = null;
    let starting = false;
    let captureGeneration = 0;
    let startedAt = 0;
    let phase = 'off';
    function limits() {
        let prefs = {};
        try { prefs = JSON.parse(root.localStorage?.getItem('gunter_prefs') || '{}'); } catch {}
        const clamp = (value, fallback, min, max) => Number.isFinite(Number(value))
            ? Math.min(max, Math.max(min, Math.round(Number(value)))) : fallback;
        return {
            maxSeconds: clamp(prefs.voiceDictationMaxSeconds, 90, 30, 120),
            silenceSeconds: clamp(prefs.voiceDictationSilenceSeconds, 12, 5, 30)
        };
    }
    function metric(name) {
        try { root.dispatchEvent(new CustomEvent('gunter-voice-metric', {
            detail: { name, at: performance.now() }
        })); } catch { /* optional telemetry */ }
    }
    function captureState(active, nextPhase, extra = {}) {
        phase = nextPhase;
        try { root.dispatchEvent(new CustomEvent('gunter-push-to-talk-state', {
            detail: { active, phase, elapsedSeconds: startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0, ...extra }
        })); } catch {}
    }
    const pushToTalk = {
        isActive: () => !!recorder && recorder.state === 'recording',
        getState: () => ({ active: pushToTalk.isActive(), phase, elapsedSeconds: startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0, ...limits() }),
        async start() {
            if (recorder || starting) return;
            if (root.PremiumFeaturesService?.isEnabled?.('dictationEnabled') === false) throw unavailable('DICTATION_DISABLED_BY_USER');
            if (!root.GunterCompanion?.reviewTranscript) throw unavailable('LOCAL_STT_UNAVAILABLE');
            if (!navigator.mediaDevices?.getUserMedia || !root.MediaRecorder) throw unavailable('LOCAL_STT_UNAVAILABLE');
            const generation = ++captureGeneration;
            const isCurrent = () => generation === captureGeneration
                && root.PremiumFeaturesService?.isEnabled?.('dictationEnabled') !== false;
            starting = true;
            captureState(false, 'permission_pending');
            root.dispatchEvent(new CustomEvent('gunter-barge-in'));
            root.GunterWakeWord?.suspendForCapture?.();
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({ audio: {
                    echoCancellation: true, noiseSuppression: true, autoGainControl: true
                } });
            } catch (error) {
                starting = false;
                if (!isCurrent()) return;
                captureState(false, 'error', { error: error.name || error.message });
                root.GunterWakeWord?.resumeAfterCapture?.();
                throw error;
            }
            if (!isCurrent()) {
                stream.getTracks().forEach(track => track.stop());
                starting = false;
                return;
            }
            captureStream = stream;
            const settings = limits();
            const allowed = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
            const mime = allowed.find(value => root.MediaRecorder.isTypeSupported?.(value));
            try {
                recorder = mime ? new root.MediaRecorder(stream, { mimeType: mime }) : new root.MediaRecorder(stream);
                const current = recorder;
                const chunks = [];
                current.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
                current.onerror = event => { captureState(false, 'error', { error: event?.error?.message || 'RECORDER_ERROR' }); };
                current.onstop = async () => {
                    clearTimeout(captureTimer);
                    clearTimeout(silenceTimer);
                    clearInterval(elapsedTimer);
                    unsubscribeVAD?.(); unsubscribeVAD = null;
                    root.GunterVoiceActivity?.stop?.('dictation-stopped');
                    recorder = null;
                    stream.getTracks().forEach(track => track.stop());
                    captureStream = null;
                    startedAt = 0;
                    if (!isCurrent()) {
                        captureState(false, 'off');
                        root.GunterWakeWord?.resumeAfterCapture?.();
                        return;
                    }
                    captureState(false, 'transcribing');
                    try {
                        const type = current.mimeType.split(';')[0];
                        const blob = new Blob(chunks, { type });
                        if (!blob.size || blob.size > 30 * 1024 * 1024) throw unavailable('LOCAL_STT_INVALID_AUDIO');
                        const form = new FormData();
                        form.append('file', blob, type === 'audio/ogg' ? 'voice.ogg' : 'voice.webm');
                        const transcript = (await root.GunterSTT.transcribe(form)).trim();
                        if (!isCurrent()) return;
                        metric('sttFinal');
                        if (transcript) {
                            captureState(false, 'review', { transcript });
                            root.GunterCompanion.reviewTranscript(transcript);
                        } else {
                            captureState(false, 'off');
                            root.GunterNotificationsService?.showToast?.('No detecté voz. Inténtalo de nuevo.', { variant: 'info' });
                        }
                    } catch (error) {
                        if (!isCurrent()) return;
                        captureState(false, 'error', { error: error.code || error.message });
                        root.GunterNotificationsService?.showToast?.(`No pude transcribir: ${error.code || error.message}`, { variant: 'warn' });
                    } finally {
                        root.GunterWakeWord?.resumeAfterCapture?.();
                    }
                };
                // A deliberate Hablar press interrupts output before recording,
                // so Moonshine hears the user rather than Gunter's own TTS.
                root.GunterVoice?.cancel?.('push-to-talk');
                if (root.GunterVoiceActivity?.start) {
                    unsubscribeVAD = root.GunterVoiceActivity.onChange?.(state => {
                        if (!pushToTalk.isActive()) return;
                        if (state.activity === 'speech') clearTimeout(silenceTimer);
                        if (state.reason === 'speech-ended') {
                            clearTimeout(silenceTimer);
                            silenceTimer = setTimeout(() => pushToTalk.stop(), settings.silenceSeconds * 1000);
                        }
                        if (state.reason === 'level') captureState(true, 'recording', { level: state.rms, threshold: state.threshold });
                    });
                    await root.GunterVoiceActivity.start(stream).catch(() => {});
                }
                if (!isCurrent()) {
                    unsubscribeVAD?.(); unsubscribeVAD = null;
                    root.GunterVoiceActivity?.stop?.('dictation-cancelled');
                    stream.getTracks().forEach(track => track.stop());
                    captureStream = null; recorder = null; starting = false;
                    return;
                }
                current.start(500);
                starting = false;
                startedAt = Date.now();
                captureState(true, 'recording', { maxSeconds: settings.maxSeconds });
                elapsedTimer = setInterval(() => captureState(true, 'recording'), 1000);
                captureTimer = setTimeout(() => pushToTalk.stop(), settings.maxSeconds * 1000);
            } catch (error) {
                stream.getTracks().forEach(track => track.stop());
                captureStream = null; recorder = null; starting = false;
                if (!isCurrent()) return;
                captureState(false, 'error', { error: error.code || error.message });
                root.GunterWakeWord?.resumeAfterCapture?.();
                throw error;
            }
        },
        stop(options = {}) {
            const cancelled = starting || options.cancel === true
                || root.PremiumFeaturesService?.isEnabled?.('dictationEnabled') === false;
            if (cancelled) captureGeneration++;
            clearTimeout(captureTimer);
            clearTimeout(silenceTimer);
            clearInterval(elapsedTimer);
            if (recorder?.state === 'recording') { metric('userAudioEnd'); recorder.stop(); }
            else if (captureStream) { captureStream.getTracks().forEach(track => track.stop()); captureStream = null; }
            if (cancelled) {
                unsubscribeVAD?.(); unsubscribeVAD = null;
                root.GunterVoiceActivity?.stop?.('dictation-cancelled');
                startedAt = 0;
                captureState(false, 'off');
                root.GunterWakeWord?.resumeAfterCapture?.();
            }
        }
    };
    root.GunterSTT = { providers: { CloudSTT, LocalSTT }, pushToTalk,
        health: () => ({ cloud: CloudSTT.health(), local: LocalSTT.health() }),
        transcribe(form, options) {
            const state = root.GunterRuntimeState?.getState?.() || {};
            if (state.privacy === 'LOCAL_ONLY' || state.mode === 'LOCAL') return LocalSTT.transcribe(form, options);
            return CloudSTT.transcribe(form, options);
        } };
    root.addEventListener?.('gunterPremiumFeaturesChange', event => {
        if (event.detail?.key === 'dictationEnabled' && event.detail.value === false) pushToTalk.stop({ cancel: true });
    });
})(typeof window !== 'undefined' ? window : globalThis);
