/* Explicit personal facts and preferences, stored only through GunterMemory. */
(function (root) {
    if (root.GunterPersonalMemory) return;
    const TYPES = new Set(['personal_fact', 'preference']);
    const LIMIT = 100;

    function memory() {
        if (!root.GunterMemory) throw new Error('MEMORY_UNAVAILABLE');
        return root.GunterMemory;
    }
    function normalize(text) {
        return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .toLocaleLowerCase('es').replace(/\s+/g, ' ').trim();
    }
    function validContent(content) {
        const value = String(content || '').trim();
        if (value.length < 4 || value.length > 2000) throw new TypeError('PERSONAL_MEMORY_CONTENT_INVALID');
        return value;
    }
    async function list() {
        async function byType(type) {
            const rows = [];
            const seen = new Set();
            for (;;) {
                const page = await memory().list({ type, limit: LIMIT, offset: rows.length, includeLegacy: false });
                if (page.some(record => seen.has(record.id))) throw new Error('MEMORY_PAGINATION_UNAVAILABLE');
                page.forEach(record => seen.add(record.id));
                rows.push(...page);
                if (page.length < LIMIT) return rows;
            }
        }
        const [facts, preferences] = await Promise.all([byType('personal_fact'), byType('preference')]);
        return facts.concat(preferences).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    async function save({ id, type = 'personal_fact', content, source = 'personal.ui' } = {}) {
        if (!TYPES.has(type)) throw new TypeError('PERSONAL_MEMORY_TYPE_INVALID');
        const value = validContent(content);
        if (id) {
            const previous = await memory().get(id);
            if (!previous || !TYPES.has(previous.type)) throw new Error('PERSONAL_MEMORY_NOT_FOUND');
            return { record: await memory().put({ id, type, content: value, source: previous.source,
                metadata: previous.metadata, privacy: previous.privacy }), duplicate: false };
        }
        const existing = (await list()).find(row => row.type === type && normalize(row.content) === normalize(value));
        if (existing) return { record: existing, duplicate: true };
        return { record: await memory().put({ type, content: value, source, privacy: 'LOCAL' }), duplicate: false };
    }
    async function search(query) {
        const words = normalize(query);
        const rows = await list();
        return words ? rows.filter(row => normalize(row.content).includes(words)) : rows;
    }
    async function remove(id) {
        const record = await memory().get(id);
        if (!record || !TYPES.has(record.type)) return false;
        return memory().delete(id);
    }
    function parseCommand(text) {
        const input = String(text || '').trim()
            .replace(/^(?:(?:hola|hi|oye)\s+)?gunter\b[\s,:.!?]*/i, '');
        const preference = input.match(/^(?:guarda (?:esta )?preferencia|recuerda como preferencia)(?:\s+que\b|\s*:\s*|\s+)(.+)$/i);
        if (preference) return { action: 'save', type: 'preference', content: preference[1].trim() };
        const fact = input.match(/^(?:guarda en (?:tu )?memoria|recuerda como dato)(?:\s+que\b|\s*:\s*|\s+)(.+)$/i);
        if (fact) return { action: 'save', type: 'personal_fact', content: fact[1].trim() };
        if (/^(?:¿?qu[eé] (?:recuerdas|sabes) de m[ií]|(?:muestra|lista) (?:mi|tu) memoria personal)\??$/i.test(input))
            return { action: 'list' };
        return null;
    }
    async function handleCommand(text) {
        const command = parseCommand(text);
        if (!command) return null;
        try {
            if (command.action === 'save') {
                const result = await save({ type: command.type, content: command.content, source: 'personal.chat' });
                return { handled: true, reply: result.duplicate
                    ? 'Eso ya está en mi memoria personal. Puedes verlo o editarlo en Configuración → Datos.'
                    : 'Lo guardé en mi memoria personal de este dispositivo. Puedes revisarlo o borrarlo en Configuración → Datos.' };
            }
            const rows = (await list()).slice(0, 5);
            return { handled: true, reply: rows.length
                ? 'Recuerdo explícitamente:\n' + rows.map(row => `• ${row.content}`).join('\n') +
                    '\nPuedes ver y gestionar todo en Configuración → Datos.'
                : 'Aún no tengo datos personales guardados explícitamente. Puedes decirme “guarda en memoria que…” o añadirlos en Configuración → Datos.' };
        } catch (error) {
            return { handled: true, reply: error?.message === 'MEMORY_AUTH_REQUIRED'
                ? 'No pude acceder a tu memoria local porque no hay una sesión autorizada en este dispositivo.'
                : error instanceof TypeError
                    ? 'No pude guardarlo: el recuerdo debe tener entre 4 y 2000 caracteres.'
                    : 'No pude comprobar que se guardara en este dispositivo. Revisa Configuración → Datos antes de repetirlo.' };
        }
    }
    root.GunterPersonalMemory = Object.freeze({ save, list, search, remove, parseCommand, handleCommand });
})(typeof window !== 'undefined' ? window : globalThis);
