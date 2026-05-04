/* =============================================
   STYLE MIRROR — Facade (v2 — F5)
   -------------------------------------------------
   Aprende el estilo de escritura del usuario hacia un
   contacto específico (formal/cercano, largo/corto,
   con/sin emojis, jerga típica) y genera mensajes
   "en su estilo" para delegación o redacción asistida.

   Storage: data/style-mirror.json
   Schema (perfil):
     {
       contactKey: 'wa:521555...' | 'email:juan@...' | 'name:Juan Pérez',
       displayName, sampleCount,
       traits: { formality, warmth, length, emojiUse, exclamationUse, jergaWords[], openings[], closings[] },
       updatedAt, signature
     }
   ============================================= */

const fs = require('fs');
const path = require('path');
const openai = require('../openai-client');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const FILE     = path.join(DATA_DIR, 'style-mirror.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }

function loadAll() {
    try {
        ensureDir();
        if (!fs.existsSync(FILE)) return {};
        return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {};
    } catch (e) {
        console.warn('[style-mirror] loadAll:', e.message);
        return {};
    }
}

function saveAll(obj) {
    try {
        ensureDir();
        fs.writeFileSync(FILE, JSON.stringify(obj, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.warn('[style-mirror] saveAll:', e.message);
        return false;
    }
}

/**
 * Construye / actualiza perfil de estilo a partir de mensajes salientes
 * del usuario hacia un contacto.
 * @param {Object} opts
 * @param {string} opts.contactKey
 * @param {string} [opts.displayName]
 * @param {string[]} opts.messages — mensajes que el usuario envió a ese contacto
 */
async function buildProfile({ contactKey, displayName = '', messages = [] } = {}) {
    if (!contactKey) throw new Error('contactKey required');
    const samples = (messages || []).filter(m => typeof m === 'string' && m.trim().length > 5).slice(-50);
    if (samples.length < 3) {
        return { ok: false, reason: 'not-enough-samples', need: 3, have: samples.length };
    }

    // Heurísticas locales rápidas
    const localTraits = analyzeLocal(samples);

    // LLM refinement (si key disponible)
    let llmTraits = null;
    if (openai.hasKey()) {
        llmTraits = await llmRefine(samples, displayName);
    }

    const traits = { ...localTraits, ...(llmTraits || {}) };
    const all = loadAll();
    all[contactKey] = {
        contactKey,
        displayName: displayName || all[contactKey]?.displayName || contactKey,
        sampleCount: samples.length,
        traits,
        updatedAt: new Date().toISOString(),
        signature: signatureOf(traits)
    };
    saveAll(all);
    return { ok: true, profile: all[contactKey] };
}

function analyzeLocal(samples) {
    const allText = samples.join('\n');
    const words = allText.split(/\s+/).filter(Boolean);
    const avgLen = words.length / samples.length;
    const emojiCount = (allText.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu) || []).length;
    const exclamCount = (allText.match(/!/g) || []).length;
    const formal = /\b(estimad[oa]|cordialmente|atentamente|saludos cordiales|buenas tardes|por favor)\b/i.test(allText);
    const casual = /\b(jeje|jaja|tipo|onda|bro|amig[oa]|wei|xd|porfis|porfa|broo)\b/i.test(allText);
    const openings = samples.map(s => s.trim().split(/[\.\!\?\n]/)[0]).filter(s => s && s.length < 60).slice(0, 5);

    return {
        formality: formal ? 'alta' : (casual ? 'baja' : 'media'),
        warmth: casual ? 'alta' : 'media',
        length: avgLen < 12 ? 'corta' : (avgLen > 35 ? 'larga' : 'media'),
        emojiUse: emojiCount / samples.length > 0.4 ? 'frecuente' : (emojiCount > 0 ? 'ocasional' : 'nulo'),
        exclamationUse: exclamCount / samples.length > 0.4 ? 'frecuente' : 'ocasional',
        openings
    };
}

async function llmRefine(samples, displayName) {
    const prompt = `Analiza estos mensajes que un usuario envió a ${displayName || 'un contacto'} y extrae:
- "tono": "ejecutivo|cercano|amistoso|protocolar|sarcástico|neutro"
- "jergaWords": array con expresiones típicas que el usuario usa con esta persona (máx 8)
- "closings": frases típicas con las que cierra (máx 3)
- "examples": 1 frase representativa del estilo que sirva de plantilla mental

Mensajes:
${samples.slice(-25).map((m, i) => `${i+1}. ${m.slice(0, 240)}`).join('\n')}

Responde SOLO con JSON: {"tono":"...","jergaWords":[],"closings":[],"examples":"..."}`;
    try {
        const raw = await openai.chatComplete({
            messages: [
                { role: 'system', content: 'Eres un analista de estilo lingüístico. Devuelves SOLO JSON.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.2, maxTokens: 400, jsonMode: true
        });
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (e) {
        console.warn('[style-mirror] LLM refine failed:', e.message);
        return null;
    }
}

function signatureOf(t) {
    return `${t.formality || 'media'}/${t.warmth || 'media'}/${t.length || 'media'}/${t.emojiUse || 'nulo'}`;
}

/**
 * Redacta un mensaje en el estilo del usuario hacia ese contacto.
 * @param {Object} opts
 * @param {string} opts.contactKey
 * @param {string} opts.intent — qué quiere comunicar el usuario, en sus palabras
 * @param {string} [opts.context]
 */
async function redactInStyle({ contactKey, intent, context = '' } = {}) {
    if (!contactKey || !intent) throw new Error('contactKey + intent required');
    const all = loadAll();
    const profile = all[contactKey];
    if (!profile) {
        // Sin perfil, devolvemos algo plano
        return await redactGeneric({ intent, context });
    }
    if (!openai.hasKey()) {
        return { text: intent, style: profile.signature, fallback: true };
    }
    const t = profile.traits || {};
    const prompt = `Redacta un mensaje en español para el destinatario "${profile.displayName}" siguiendo ESTE estilo:
- Formalidad: ${t.formality || 'media'}
- Calidez: ${t.warmth || 'media'}
- Longitud preferida: ${t.length || 'media'}
- Uso de emojis: ${t.emojiUse || 'nulo'}
- Uso de signos exclamativos: ${t.exclamationUse || 'ocasional'}
- Tono general: ${t.tono || 'neutro'}
- Jerga típica del usuario con este contacto: ${(t.jergaWords || []).join(', ') || '(ninguna)'}
- Cierres típicos: ${(t.closings || []).join(' | ') || '(libres)'}
- Aperturas observadas: ${(t.openings || []).slice(0,3).join(' | ') || '(libres)'}
${t.examples ? `- Ejemplo de estilo: "${t.examples}"` : ''}

Lo que el usuario quiere comunicar (intención cruda, NO usar literal):
"""
${intent}
"""
${context ? `Contexto adicional: ${context}` : ''}

REDACTA el mensaje final, en una sola pieza, listo para enviar. No agregues comillas. No expliques.`;

    try {
        const raw = await openai.chatComplete({
            messages: [
                { role: 'system', content: 'Eres un asistente que clona el estilo de escritura del usuario.' },
                { role: 'user', content: prompt }
            ],
            temperature: 0.7, maxTokens: 500
        });
        return { text: raw?.trim() || intent, style: profile.signature, profileUsed: profile.contactKey };
    } catch (e) {
        return { text: intent, error: e.message, fallback: true };
    }
}

async function redactGeneric({ intent, context = '' }) {
    if (!openai.hasKey()) return { text: intent, fallback: true };
    const prompt = `Redacta un mensaje en español neutro y profesional para comunicar:
"""
${intent}
"""
${context ? `Contexto: ${context}` : ''}
Una sola pieza. No agregues comillas.`;
    try {
        const raw = await openai.chatComplete({
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.5, maxTokens: 400
        });
        return { text: raw?.trim() || intent, style: 'genérico', fallback: true };
    } catch { return { text: intent, fallback: true }; }
}

function listProfiles() {
    const all = loadAll();
    return Object.values(all).map(p => ({
        contactKey: p.contactKey,
        displayName: p.displayName,
        sampleCount: p.sampleCount,
        signature: p.signature,
        updatedAt: p.updatedAt
    }));
}

function getProfile(contactKey) {
    return loadAll()[contactKey] || null;
}

function removeProfile(contactKey) {
    const all = loadAll();
    if (!all[contactKey]) return false;
    delete all[contactKey];
    saveAll(all);
    return true;
}

function clear() { saveAll({}); return true; }

module.exports = {
    buildProfile, redactInStyle, listProfiles, getProfile, removeProfile, clear
};
