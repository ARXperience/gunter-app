/* Provider-neutral routing decision. Execution remains in the existing provider clients. */
const flags = require('./feature-flags');
const entitlements = require('./entitlements');
const localBrain = require('../local-brain');
const localSTT = require('../local-stt');
const localTTS = require('../local-tts');

function inventory() {
    return [
        // An URL or enabled flag is not proof of an installed/verified model.
        provider('local.fast', localBrain.snapshot().localBrainReady, 'local', ['classify','chat'], 1, 0, true),
        provider('supertonic3.local', localTTS.snapshot().localTTSReady, 'local', ['tts'], 3, 0, true),
        provider('openai.cloud', !!process.env.OPENAI_API_KEY, 'cloud', ['chat','reasoning','transcribe','tts','embeddings','vision'], 3, 3, false),
        provider('gemini.cloud', !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY), 'cloud', ['chat','reasoning','vision','image'], 3, 2, false),
        provider('fallback.cloud', !!(process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY || process.env.MISTRAL_API_KEY), 'cloud', ['chat','classify'], 2, 1, false),
        provider('browser.local', true, 'local', ['wake_word','simple_classify','tts'], 1, 0, true)
    ];
}

function route(userId, input = {}, actor = {}) {
    const capability = String(input.capability || 'chat');
    const privacy = String(input.privacy || 'standard');
    const offline = input.offline === true;
    const preferred = input.preferred ? String(input.preferred) : null;
    const localRequired = offline || privacy === 'never_cloud';
    const featureKey = localRequired ? 'ai.local' : capability === 'reasoning' ? 'ai.cloud.reasoning' : capability === 'vision' ? 'ai.vision' : 'ai.cloud.standard';
    const feature = flags.evaluate(featureKey, actor);
    const entitlement = entitlements.check(userId, featureKey);
    const candidates = inventory().filter(item => item.available && item.capabilities.includes(capability) && (!localRequired || item.location === 'local'))
        .filter(item => preferred ? item.id === preferred : true)
        .sort((a, b) => scoreProvider(b, input) - scoreProvider(a, input));
    if (!feature.enabled || !entitlement.allowed) return { ok: false, error: !feature.enabled ? 'feature_flag_disabled' : 'entitlement_required', featureKey, candidates: [] };
    if (!candidates.length) return { ok: false, error: localRequired ? 'local_model_unavailable' : 'provider_unavailable', featureKey, candidates: [] };
    return { ok: true, featureKey, selected: candidates[0], fallback: candidates.slice(1), rationale: { offline, privacy, capability, localRequired } };
}

function provider(id, available, location, capabilities, quality, cost, privateByDefault) { return { id, available, location, capabilities, quality, cost, privateByDefault }; }
const HYBRID_CAPABILITIES = Object.freeze(['chat', 'stt', 'tts', 'embeddings']);
const HYBRID_ERRORS = Object.freeze(['PROVIDER_UNAVAILABLE', 'LOCAL_MODEL_NOT_INSTALLED', 'NETWORK_UNAVAILABLE',
    'PERMISSION_DENIED', 'CONFIRMATION_REQUIRED', 'LOCAL_ONLY_MODE', 'SYNC_UNAVAILABLE', 'LOCAL_PROVIDER_NOT_INSTALLED', 'LOCAL_PROVIDER_UNAVAILABLE', 'LOCAL_STT_NOT_INSTALLED', 'LOCAL_STT_UNAVAILABLE', 'LOCAL_TTS_NOT_INSTALLED', 'LOCAL_TTS_UNAVAILABLE']);
function normalizeHybridError(code) {
    const raw = String(code || 'PROVIDER_UNAVAILABLE').toUpperCase();
    return HYBRID_ERRORS.includes(raw) ? raw : ({ provider_unavailable: 'PROVIDER_UNAVAILABLE',
        confirmation_required: 'CONFIRMATION_REQUIRED', permission_denied: 'PERMISSION_DENIED' })[String(code || '').toLowerCase()] || 'PROVIDER_UNAVAILABLE';
}
function resolveHybrid(kind, preferences = {}, actor = {}) {
    if (!HYBRID_CAPABILITIES.includes(kind)) return { ok: false, code: 'PROVIDER_NOT_SUPPORTED' };
    if (kind === 'tts' && (preferences.privacy === 'LOCAL_ONLY' || preferences.mode !== 'CLOUD')) {
        const localRequired = preferences.privacy === 'LOCAL_ONLY' || preferences.mode === 'LOCAL';
        if (localTTS.installed()) {
            if (flags.evaluate('tts.local', actor).enabled)
                return { ok: true, provider: 'local', kind, mode: preferences.mode || 'AUTO' };
            if (localRequired) return { ok: false, code: 'LOCAL_TTS_UNAVAILABLE', provider: 'local', kind };
        } else if (localRequired) return { ok: false, code: 'LOCAL_TTS_NOT_INSTALLED', provider: 'local', kind };
    }
    if (preferences.privacy === 'LOCAL_ONLY' || preferences.mode === 'LOCAL') {
        if (kind === 'stt') {
            if (!localSTT.installed()) return { ok: false, code: 'LOCAL_STT_NOT_INSTALLED', provider: 'local', kind };
            if (!flags.evaluate('stt.local', actor).enabled || !localSTT.snapshot().localSTTRuntimeAvailable)
                return { ok: false, code: 'LOCAL_STT_UNAVAILABLE', provider: 'local', kind };
            return { ok: true, provider: 'local', kind, mode: preferences.mode || 'AUTO' };
        }
        if (kind !== 'chat') return { ok: false, code: 'LOCAL_PROVIDER_NOT_INSTALLED', provider: 'local', kind };
        if (!localBrain.installed()) return { ok: false, code: preferences.privacy === 'LOCAL_ONLY' ? 'LOCAL_PROVIDER_NOT_INSTALLED' : 'LOCAL_MODEL_NOT_INSTALLED', provider: 'local', kind };
        if (!flags.evaluate('ai.local', actor).enabled) return { ok: false, code: 'LOCAL_PROVIDER_UNAVAILABLE', provider: 'local', kind };
        return { ok: true, provider: 'local', kind, mode: preferences.mode || 'AUTO' };
    }
    return { ok: true, provider: 'cloud', kind, mode: preferences.mode || 'AUTO' };
}
function hybridInventory() {
    const openai = !!process.env.OPENAI_API_KEY;
    const gemini = !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
    return Object.fromEntries(HYBRID_CAPABILITIES.map(kind => [kind, {
        cloud: { installed: true, status: 'CURRENT_PROVIDER', configured: kind === 'embeddings' ? openai
            : kind === 'stt' || kind === 'tts' ? openai || gemini
                : inventory().some(p => p.location === 'cloud' && p.available && p.capabilities.includes('chat')) },
        local: kind === 'chat' ? { installed: localBrain.snapshot().localBrainInstalled,
            status: localBrain.snapshot().localBrainReady ? 'READY' : localBrain.installed() ? 'INSTALLED_NOT_READY' : 'NOT_INSTALLED',
            runtimeAvailable: localBrain.snapshot().localBrainRuntimeAvailable,
            model: localBrain.snapshot().localBrainModel,
            error: localBrain.snapshot().localBrainError } : kind === 'stt' ? {
                installed: localSTT.snapshot().localSTTInstalled,
                status: localSTT.snapshot().localSTTReady ? 'READY' : localSTT.installed() ? 'INSTALLED_NOT_READY' : 'NOT_INSTALLED',
                runtimeAvailable: localSTT.snapshot().localSTTRuntimeAvailable,
                model: localSTT.snapshot().localSTTModel,
                error: localSTT.snapshot().localSTTError
            } : kind === 'tts' ? {
                installed: localTTS.snapshot().localTTSInstalled,
                status: localTTS.snapshot().localTTSReady ? 'READY' : localTTS.installed() ? 'INSTALLED_NOT_READY' : 'NOT_INSTALLED',
                runtimeAvailable: localTTS.snapshot().localTTSRuntimeAvailable,
                model: localTTS.snapshot().localTTSModel,
                error: localTTS.snapshot().localTTSError
            } : { installed: false, status: 'NOT_INSTALLED' },
        ...(kind === 'tts' ? { browserFallback: { installed: true, status: 'CURRENT_BROWSER_FALLBACK' } } : {})
    }]));
}
function scoreProvider(item, input) { let score = item.quality * 2 - item.cost; if (input.lowLatency) score += item.location === 'local' ? 3 : 0; if (input.lowCost) score -= item.cost * 2; if (input.highQuality) score += item.quality * 2; if (input.privacy === 'local_preferred') score += item.location === 'local' ? 2 : 0; return score; }

module.exports = { inventory, route, resolveHybrid, hybridInventory, HYBRID_CAPABILITIES, HYBRID_ERRORS, normalizeHybridError };
