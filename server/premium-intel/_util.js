/* =============================================
   PREMIUM INTEL - Shared utilities
   ============================================= */

const knowledge = require('../knowledge');
const openai = require('../openai-client');

/** Respuesta canónica de cualquier módulo premium-intel. */
function ok(data, opts = {}) {
    return {
        success: true,
        data,
        summary: opts.summary || '',
        naturalResponse: opts.naturalResponse || '',
        warnings: opts.warnings || [],
        sources: opts.sources || [],
        requiresConfirmation: !!opts.requiresConfirmation,
        confirmationQuestion: opts.confirmationQuestion || null,
        generatedAt: new Date().toISOString()
    };
}

function fail(reason, hint = '') {
    return {
        success: false,
        data: null,
        summary: '',
        naturalResponse: hint || 'No pude completar la operación.',
        warnings: [reason],
        sources: [],
        requiresConfirmation: false,
        confirmationQuestion: null,
        generatedAt: new Date().toISOString()
    };
}

function noSnapshot() {
    return fail(
        'no-snapshot',
        'No tengo la memoria de proyectos sincronizada todavía. Abre Gunter Web para actualizarla.'
    );
}

/** Lee snapshot o falla con respuesta amable. */
function snapshotOrFail() {
    const snap = knowledge.getSnapshot();
    if (!snap || !snap.projects?.length) return { snap: null, error: noSnapshot() };
    return { snap, error: null };
}

/** ¿La fecha ISO es del día solicitado (YYYY-MM-DD) en la TZ del snapshot? */
function isSameLocalDay(iso, dateStr, tz = 'America/Bogota') {
    if (!iso) return false;
    try {
        const d = new Date(iso);
        const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
        return fmt.format(d) === dateStr;
    } catch { return false; }
}

function todayString(tz = 'America/Bogota') {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

/** Llama al LLM con system+prompt y devuelve string limpio o null en caso de error. */
async function safeLLM({ system, prompt, jsonMode = false, maxTokens = 500, temperature = 0.4 }) {
    if (!openai.hasKey()) return null;
    try {
        const raw = await openai.chatComplete({
            messages: [
                { role: 'system', content: system || 'Eres Gunter, asistente personal. Responde en español neutro latinoamericano.' },
                { role: 'user', content: prompt }
            ],
            temperature, maxTokens, jsonMode
        });
        if (!raw) return null;
        if (jsonMode) {
            try { return JSON.parse(raw); }
            catch {
                const m = raw.match(/\{[\s\S]*\}/);
                return m ? JSON.parse(m[0]) : null;
            }
        }
        return raw;
    } catch (e) {
        console.warn('[premium-intel] LLM call failed:', e.message);
        return null;
    }
}

/** Cache LRU básico con TTL — para no recalcular planes idénticos. */
function makeTtlCache(ttlMs = 30 * 60 * 1000, maxEntries = 64) {
    const map = new Map();
    return {
        get(key) {
            const it = map.get(key);
            if (!it) return null;
            if (Date.now() - it.at > ttlMs) { map.delete(key); return null; }
            return it.value;
        },
        set(key, value) {
            if (map.size >= maxEntries) {
                const firstKey = map.keys().next().value;
                map.delete(firstKey);
            }
            map.set(key, { value, at: Date.now() });
        },
        clear() { map.clear(); },
        size: () => map.size
    };
}

module.exports = {
    ok, fail, noSnapshot, snapshotOrFail,
    isSameLocalDay, todayString, addDays,
    safeLLM, makeTtlCache,
    knowledge, openai
};
