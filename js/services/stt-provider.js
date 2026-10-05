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
                if (['LOCAL_PROVIDER_NOT_INSTALLED', 'LOCAL_MODEL_NOT_INSTALLED'].includes(data.code)) throw unavailable(data.code);
                throw new Error(`Whisper HTTP ${response.status}: ${raw.slice(0, 200)}`);
            }
            const raw = await response.text();
            try { const data = JSON.parse(raw); return data.text || data.transcript || ''; }
            catch { return raw; }
        }
    };
    const LocalSTT = { id: 'local.stub', health: () => ({ installed: false, status: 'NOT_INSTALLED' }),
        transcribe: async () => { throw unavailable('LOCAL_PROVIDER_NOT_INSTALLED'); } };
    root.GunterSTT = { providers: { CloudSTT, LocalSTT },
        health: () => ({ cloud: CloudSTT.health(), local: LocalSTT.health() }),
        transcribe(form, options) {
            const state = root.GunterRuntimeState?.getState?.() || {};
            if (state.privacy === 'LOCAL_ONLY' || state.mode === 'LOCAL') return LocalSTT.transcribe();
            return CloudSTT.transcribe(form, options);
        } };
})(typeof window !== 'undefined' ? window : globalThis);
