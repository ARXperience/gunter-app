/* =============================================
   GUNTER SERVICE — Actions (v1)
   -------------------------------------------------
   Cliente del /api/actions unificado. Usado por:
     - Gunter Companion (el widget flotante)
     - Chat assistant existente
     - UI de Premium al hacer toggle en switches

   API pública:
     window.GunterActions.dispatch(text)       → respuesta natural + effect
     window.GunterActions.setFlag(flag, val)   → set directo (sin lenguaje)
     window.GunterActions.getState()           → snapshot server-side
     window.GunterActions.syncCurrentToServer() → empuja localStorage al server
   ============================================= */

(function () {
    if (window.GunterActions) return;
    const defaultOnFlags = new Set(['voiceEnabled', 'wakeWordEnabled', 'dictationEnabled',
        'conversationContinuity', 'personalMemoryContext', 'contextualRecommendations', 'diagnosticsEnabled', 'contextualHumor', 'entryVoiceGreeting']);
    const voiceFlags = new Set(['voiceEnabled', 'voiceMode', 'voiceOnlyAfterWakeWord', 'wakeWordResponseMode',
        'voiceInMeetings', 'voiceStyle', 'voiceSpeed', 'voiceTone', 'dictationEnabled', 'entryVoiceGreeting',
        'wakeWordEnabled', 'wakeWord', 'wakeWordListeningMode', 'wakeWordAutoStopSeconds']);
    const pendingFlags = new Map();
    let applyingServer = false;
    let writeChain = Promise.resolve();
    let writeRevision = 0;
    let lastVoice = voiceBundle();

    function voiceBundle() {
        const local = window.PremiumFeaturesService?.getAll?.() || {};
        return Object.fromEntries([...voiceFlags].filter(key => Object.hasOwn(local, key)).map(key => [key, local[key]]));
    }

    function enqueueWrite(work) {
        const next = writeChain.then(work);
        writeChain = next.catch(() => null);
        return next;
    }

    function queueFlagWrite(flag, value, source = 'browser') {
        return queueSettingsWrite({ [flag]: value }, 'set', { flag, value, meta: { source } });
    }

    function queuePatchWrite(flags) {
        return queueSettingsWrite(flags, 'sync_from_browser', { flags });
    }

    function queueSettingsWrite(flags, op, params) {
        const revision = ++writeRevision;
        const pending = Object.entries(flags).map(([flag, value]) => [flag, { value, revision }]);
        for (const [flag, entry] of pending) pendingFlags.set(flag, entry);
        return enqueueWrite(() => call(op, params)).then(result => {
            for (const [flag, entry] of pending) {
                if (result && pendingFlags.get(flag) === entry) pendingFlags.delete(flag);
            }
            return result;
        });
    }

    function mirrorVoice(flag, value, source) {
        const flags = voiceBundle();
        lastVoice = flags;
        // Keep the existing boolean route for older/minimal service clients.
        return Object.keys(flags).length > 1 ? queuePatchWrite(flags) : queueFlagWrite(flag, value, source);
    }

    async function flushWrites() {
        let pending;
        do { pending = writeChain; await pending; } while (pending !== writeChain);
    }

    function url() {
        const c = window.GUNTER_CONFIG || {};
        return (c.PROXY_BASE_URL || '') + '/api/actions';
    }

    async function call(op, params = {}) {
        try {
            const resp = await fetch(url(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ op, ...params })
            });
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            const json = await resp.json();
            if (!json.success) throw new Error(json.warnings?.[0] || 'action fail');
            return json.data;
        } catch (e) {
            console.warn('[actions] call fail:', op, e.message);
            return null;
        }
    }

    /**
     * Procesa texto libre. Devuelve:
     *   { intent, reply, feature?, value?, requiresConfirmation?, ... }
     * Si no matcheó ningún action registrado, devuelve null → caller usa LLM.
     */
    async function dispatch(text) {
        if (!text || !text.trim()) return null;
        const result = await call('dispatch', { text });
        if (!result || result.success === false) return null;

        // Si el dispatcher aplicó un cambio, refleja en localStorage local
        // y agrega una nota honesta sobre si quedó aplicado o no.
        if (result.intent === 'applied' && result.feature) {
            applyingServer = true;
            let applyRes;
            try { applyRes = _applyLocal(result.feature, result.value); }
            finally { applyingServer = false; }
            if (!applyRes.ok) {
                // No pudimos aplicar localmente → decirle al usuario la verdad
                const hint = applyRes.reason === 'no-service'
                    ? '\n\n⚠️ No pude persistirlo en esta pantalla porque falta el servicio de configuración. Recarga la página.'
                    : '\n\n⚠️ No quedó aplicado localmente (razón: ' + applyRes.reason + '). Verifica en Configuración.';
                result.reply = (result.reply || '') + hint;
                result.__localOk = false;
            } else {
                result.__localOk = true;
                // Añade una línea que confirma el estado real
                const state = window.PremiumFeaturesService?.get?.(result.feature);
                if (state !== result.value) {
                    result.reply = (result.reply || '') + '\n\n⚠️ Estado en configuración: ' + state + ' (esperado: ' + result.value + ').';
                    result.__localOk = false;
                }
                if (result.__localOk && voiceFlags.has(result.feature)) mirrorVoice(result.feature, result.value, 'browser');
            }
        }
        return result;
    }

    async function setFlag(flag, value, source = 'browser') {
        // Refleja local inmediatamente para UI responsiva
        applyingServer = true;
        try { _applyLocal(flag, value); }
        finally { applyingServer = false; }
        // Persistir en server
        return voiceFlags.has(flag) ? mirrorVoice(flag, value, source) : queueFlagWrite(flag, value, source);
    }

    async function getState() {
        const result = await call('get_state');
        return result?.state || {};
    }

    /**
     * Empuja el estado local de PremiumFeaturesService al server.
     * Útil al arrancar para que el server tenga la vista más reciente.
     */
    async function syncCurrentToServer() {
        try {
            const svc = window.PremiumFeaturesService;
            if (!svc?.getAll) return null;
            return queuePatchWrite(svc.getAll());
        } catch { return null; }
    }

    /**
     * Aplica un cambio a la UI local (para reflejar cambios del server).
     * Verifica que el flag realmente quedó en el estado esperado.
     */
    function _applyLocal(flag, value) {
        const svc = window.PremiumFeaturesService;
        if (!svc?.set) {
            console.error('[actions] PremiumFeaturesService no cargado — no se puede aplicar', flag, '=', value);
            return { ok: false, reason: 'no-service' };
        }
        try {
            const before = svc.get?.(flag);
            svc.set(flag, value);
            const after = svc.get?.(flag);
            const persisted = after === value;
            if (!persisted) {
                console.warn('[actions] flag no persistió:', flag, 'esperado:', value, 'quedó:', after);
                return { ok: false, reason: 'not-persisted', before, after };
            }
            console.log('[actions] flag aplicado:', flag, '=', value, before !== value ? '(cambió)' : '(sin cambio)');
            return { ok: true, before, after };
        } catch (e) {
            console.error('[actions] apply local error:', e.message);
            return { ok: false, reason: 'exception', error: e.message };
        }
    }

    /**
     * Escucha cambios del server (via polling ligero cada 30s si
     * la app está en primer plano). Reemplazable por WebSocket luego.
     */
    let pollTimer = null;
    async function pollServerState() {
        if (document.hidden) return;
        try {
            await flushWrites();
            if (pendingFlags.size) {
                await queuePatchWrite(Object.fromEntries([...pendingFlags].map(([flag, entry]) => [flag, entry.value])));
            }
            await flushWrites();
            const revision = writeRevision;
            const remote = await getState();
            if (!remote || revision !== writeRevision) return;
            const svc = window.PremiumFeaturesService;
            if (!svc?.getAll) return;
            const local = svc.getAll();
            const patch = {};
            for (const [k, v] of Object.entries(remote)) {
                if (k === '__meta' || pendingFlags.has(k) || !Object.hasOwn(local, k)) continue;
                if (local[k] !== v) patch[k] = v;
            }
            if (Object.keys(patch).length) {
                applyingServer = true;
                try {
                    // A replica is saved state, not a fresh mode selection.
                    if (svc.import) svc.import({ ...local, ...patch });
                    else if (svc.updateMany) svc.updateMany(patch);
                    else for (const [key, value] of Object.entries(patch)) svc.set(key, value);
                    lastVoice = voiceBundle();
                } finally { applyingServer = false; }
                console.log('[actions] state synced from server');
                window.dispatchEvent(new CustomEvent('gunter-actions-synced'));
            }
        } catch { /* silencioso */ }
    }

    function startSync() {
        if (pollTimer) return;
        // Sync inicial 3s después de boot (no bloquea)
        setTimeout(() => {
            syncCurrentToServer().then(() => pollServerState());
        }, 3000);
        pollTimer = setInterval(pollServerState, 30000);
    }

    function stopSync() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    }

    // Auto-start cuando el DOM está listo
    if (typeof window !== 'undefined') {
        window.addEventListener('gunterPremiumFeaturesChange', event => {
            const { key, value } = event.detail || {};
            const flags = voiceBundle();
            const voiceChanged = Object.keys(flags).some(flag => flags[flag] !== lastVoice[flag]);
            lastVoice = flags;
            if (applyingServer) return;
            if (voiceChanged) mirrorVoice(key, value, 'browser');
            else if (defaultOnFlags.has(key) && typeof value === 'boolean') queueFlagWrite(key, value);
        });
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', startSync);
        } else {
            startSync();
        }
        // Pause sync cuando app está en background (Fase 3 mobile UX)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) stopSync();
            else startSync();
        });
    }

    window.GunterActions = {
        dispatch,
        setFlag,
        getState,
        syncCurrentToServer,
        startSync,
        stopSync
    };
})();
