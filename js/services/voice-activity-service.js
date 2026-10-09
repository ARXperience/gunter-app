/* =============================================
   GUNTER SERVICE - Voice Activity Detection
   -------------------------------------------------
   VAD local con Web Audio. No envía audio a ningún
   servidor: calcula energía RMS y umbral adaptativo.
   ============================================= */

(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.GunterVoiceActivity = api.create();
})(typeof window !== 'undefined' ? window : null, function (root) {
    function analyzeSamples(samples, noiseFloor = 0.008, options = {}) {
        let sum = 0;
        const length = samples?.length || 0;
        for (let i = 0; i < length; i++) sum += samples[i] * samples[i];
        const rms = length ? Math.sqrt(sum / length) : 0;
        const minThreshold = options.minThreshold ?? 0.018;
        const multiplier = options.multiplier ?? 2.6;
        const threshold = Math.max(minThreshold, noiseFloor * multiplier);
        return { rms, threshold, speech: rms >= threshold };
    }

    function create(options = {}) {
        let stream = null;
        let ownsStream = false;
        let context = null;
        let analyser = null;
        let source = null;
        let frameId = null;
        let active = false;
        let activity = 'off';
        let noiseFloor = options.initialNoiseFloor ?? 0.008;
        let speechFrames = 0;
        let silenceFrames = 0;
        let lastTelemetry = 0;
        const listeners = new Set();

        function snapshot(extra = {}) {
            return { active, activity, noiseFloor, ...extra };
        }

        function emit(reason, extra = {}) {
            const detail = snapshot({ reason, ...extra });
            listeners.forEach(listener => {
                try { listener(detail); } catch { /* listener aislado */ }
            });
            if (root?.dispatchEvent && root.CustomEvent) {
                try { root.dispatchEvent(new root.CustomEvent('gunter-vad-state', { detail })); } catch { /* noop */ }
            }
        }

        function setActivity(next, reason, metrics = {}) {
            if (activity === next) return;
            activity = next;
            emit(reason, metrics);
            if (next === 'speech' && root?.GunterVoice?.isSpeaking?.()) {
                try {
                    root.dispatchEvent(new root.CustomEvent('gunter-vad-barge-candidate', { detail: metrics }));
                } catch { /* noop */ }
            }
        }

        function loop() {
            if (!active || !analyser) return;
            const data = new Float32Array(analyser.fftSize);
            analyser.getFloatTimeDomainData(data);
            const metrics = analyzeSamples(data, noiseFloor, options);

            if (!metrics.speech) {
                noiseFloor = Math.min(0.08, Math.max(0.002, noiseFloor * 0.97 + metrics.rms * 0.03));
                silenceFrames += 1;
                speechFrames = 0;
                if (activity === 'speech' && silenceFrames >= (options.silenceFrames || 28)) {
                    setActivity('silence', 'speech-ended', metrics);
                }
            } else {
                speechFrames += 1;
                silenceFrames = 0;
                if (activity !== 'speech' && speechFrames >= (options.speechFrames || 6)) {
                    setActivity('speech', 'speech-started', metrics);
                }
            }

            const now = Date.now();
            if (now - lastTelemetry >= 300) {
                lastTelemetry = now;
                emit('level', metrics);
            }
            frameId = root.requestAnimationFrame(loop);
        }

        async function start(sharedStream = null) {
            if (active) return snapshot();
            const AudioContextCtor = root?.AudioContext || root?.webkitAudioContext;
            if (!root?.navigator?.mediaDevices?.getUserMedia || !AudioContextCtor) {
                return { active: false, activity: 'unsupported', supported: false };
            }
            try {
                ownsStream = !sharedStream;
                stream = sharedStream || await root.navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
                });
                context = new AudioContextCtor();
                if (context.state === 'suspended') await context.resume();
                analyser = context.createAnalyser();
                analyser.fftSize = options.fftSize || 1024;
                analyser.smoothingTimeConstant = 0.25;
                source = context.createMediaStreamSource(stream);
                source.connect(analyser);
                active = true;
                activity = 'silence';
                speechFrames = 0;
                silenceFrames = 0;
                emit('started', { supported: true });
                frameId = root.requestAnimationFrame(loop);
                return snapshot({ supported: true });
            } catch (error) {
                stop('start-failed');
                emit('error', { error: error.message || String(error) });
                return { active: false, activity: 'error', error: error.message || String(error) };
            }
        }

        function stop(reason = 'stopped') {
            if (frameId !== null && root?.cancelAnimationFrame) root.cancelAnimationFrame(frameId);
            frameId = null;
            try { source?.disconnect(); } catch { /* noop */ }
            if (ownsStream) try { stream?.getTracks?.().forEach(track => track.stop()); } catch { /* noop */ }
            try { context?.close?.(); } catch { /* noop */ }
            stream = null;
            ownsStream = false;
            source = null;
            analyser = null;
            context = null;
            active = false;
            activity = 'off';
            emit(reason);
        }

        function onChange(listener) {
            if (typeof listener !== 'function') return () => {};
            listeners.add(listener);
            return () => listeners.delete(listener);
        }

        return {
            supported: !!(root?.navigator?.mediaDevices?.getUserMedia && (root.AudioContext || root.webkitAudioContext)),
            start, stop, onChange, getState: () => snapshot()
        };
    }

    return { analyzeSamples, create };
});
