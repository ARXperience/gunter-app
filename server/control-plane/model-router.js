/* Provider-neutral routing decision. Execution remains in the existing provider clients. */
const flags = require('./feature-flags');
const entitlements = require('./entitlements');

function inventory() {
    return [
        provider('local.fast', !!process.env.GUNTER_LOCAL_MODEL_URL, 'local', ['classify','chat','embeddings'], 1, 0, true),
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
function scoreProvider(item, input) { let score = item.quality * 2 - item.cost; if (input.lowLatency) score += item.location === 'local' ? 3 : 0; if (input.lowCost) score -= item.cost * 2; if (input.highQuality) score += item.quality * 2; if (input.privacy === 'local_preferred') score += item.location === 'local' ? 2 : 0; return score; }

module.exports = { inventory, route };
