/* Local structured memory facade. No network, embedding, or cloud sync. */
(function (root) {
    if (root.GunterMemory) return;
    const repo = root.GunterDataRepository?.memory;
    if (!repo) throw new Error('MEMORY_REPOSITORY_UNAVAILABLE');
    const TYPES = new Set(['preference', 'personal_fact', 'project', 'conversation', 'task', 'person', 'decision', 'context']);
    const PRIVACY = new Set(['LOCAL', 'SYNCABLE', 'SENSITIVE_LOCAL_ONLY']);
    const MAX_LIMIT = 100;

    function ownerId() {
        const auth = root.GunterAuth;
        const trusted = auth?.canAccessLocalData?.() ?? auth?.isVerified?.();
        const id = trusted && auth.getUser?.()?.id;
        if (typeof id !== 'string' || !id) throw new Error('MEMORY_AUTH_REQUIRED');
        return id;
    }
    function ownedLegacy(owner) {
        try { return root.localStorage?.getItem('gunter_device_user') === owner &&
            root.localStorage?.getItem('gunter_memory_legacy_owner') === owner; }
        catch { return false; }
    }
    function readableTurn(turn, owner) {
        return turn?.ownerId === owner || (!turn?.ownerId && ownedLegacy(owner));
    }
    function normalized(value) {
        return String(value || '').toLocaleLowerCase('es').normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
    }
    function publicRecord(row) {
        if (!row) return null;
        const { key, ownerId: owner, ...record } = row;
        return record;
    }
    function fromLegacy(turn) {
        if (!turn?.id || typeof turn.text !== 'string') return null;
        const at = new Date(turn.ts || Date.now()).toISOString();
        return { id: turn.id, createdAt: at, updatedAt: at, type: 'conversation',
            source: 'conversation.legacy', content: turn.text,
            metadata: { role: turn.role || 'user', channel: turn.channel || 'chat',
                projectId: turn.projectId || null, sessionId: turn.sessionId || null },
            privacy: 'LOCAL', version: 1, legacy: true };
    }
    function validate(input) {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('MEMORY_RECORD_REQUIRED');
        if (!TYPES.has(input.type)) throw new TypeError('MEMORY_TYPE_INVALID');
        if (typeof input.source !== 'string' || !input.source.trim() || input.source.length > 100)
            throw new TypeError('MEMORY_SOURCE_INVALID');
        if (typeof input.content !== 'string' || !input.content.trim() || input.content.length > 20000)
            throw new TypeError('MEMORY_CONTENT_INVALID');
        if (input.id !== undefined && !/^[a-zA-Z0-9_:-]{1,120}$/.test(input.id))
            throw new TypeError('MEMORY_ID_INVALID');
        if (input.metadata !== undefined && (!input.metadata || typeof input.metadata !== 'object' || Array.isArray(input.metadata)))
            throw new TypeError('MEMORY_METADATA_INVALID');
        if (!PRIVACY.has(input.privacy || 'LOCAL')) throw new TypeError('MEMORY_PRIVACY_INVALID');
        const metadata = JSON.parse(JSON.stringify(input.metadata || {}));
        if (JSON.stringify(metadata).length > 8192) throw new TypeError('MEMORY_METADATA_TOO_LARGE');
        return metadata;
    }
    async function put(input) {
        const owner = ownerId();
        const metadata = validate(input);
        const id = input.id || `mem_${root.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
        const key = `${owner}:${id}`;
        const prior = await repo.get(key);
        const now = new Date().toISOString();
        const row = { key, ownerId: owner, id, type: input.type, source: input.source.trim(),
            content: input.content.trim(), metadata, privacy: input.privacy || 'LOCAL',
            createdAt: prior?.createdAt || now, updatedAt: now, version: (prior?.version || 0) + 1 };
        await repo.put(row);
        return publicRecord(row);
    }
    async function get(id) {
        const owner = ownerId();
        if (typeof id !== 'string' || !id) return null;
        const row = await repo.get(`${owner}:${id}`);
        if (row?.ownerId === owner) return publicRecord(row);
        if (!id.startsWith('turn_')) return null;
        const turn = await repo.get(id, 'turns');
        return readableTurn(turn, owner) ? fromLegacy(turn) : null;
    }
    async function matchingRecords(options = {}) {
        const owner = ownerId();
        const current = (await repo.all()).filter(row => row.ownerId === owner).map(publicRecord);
        let records = current;
        if (options.includeLegacy !== false && (!options.type || options.type === 'conversation')) {
            const legacy = (await repo.all('turns')).filter(turn => readableTurn(turn, owner)).map(fromLegacy).filter(Boolean);
            records = records.concat(legacy);
        }
        return records.filter(record => (!options.type || record.type === options.type) &&
            (!options.source || record.source === options.source) &&
            (!options.privacy || record.privacy === options.privacy))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    async function list(options = {}) {
        const limit = Math.min(Math.max(Number(options.limit) || 50, 1), MAX_LIMIT);
        return (await matchingRecords(options)).slice(0, limit);
    }
    async function search(query, options = {}) {
        const q = normalized(query);
        if (!q) return [];
        const terms = [...new Set(q.split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 3))];
        const rows = await matchingRecords(options);
        return rows.map(record => {
            const haystack = normalized(record.content);
            const score = haystack.includes(q) ? 1 : terms.length ? terms.filter(term => haystack.includes(term)).length / terms.length : 0;
            return { record, score };
        }).filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score || b.record.updatedAt.localeCompare(a.record.updatedAt))
            .slice(0, Math.min(Math.max(Number(options.limit) || 5, 1), MAX_LIMIT))
            .map(item => item.record);
    }
    async function remove(id) {
        const owner = ownerId();
        const record = await get(id);
        if (!record) return false;
        if (record.legacy) await repo.delete(id, 'turns');
        else await repo.delete(`${owner}:${id}`);
        return true;
    }
    // Adapter for the existing vector-backed turn store. No duplicate record.
    async function rememberConversation(turn) {
        ownerId();
        return root.GunterConversationMemory?.remember?.(turn) || null;
    }
    async function recallConversation(query, options = {}) {
        const owner = ownerId();
        const turns = await root.GunterConversationMemory?.recall?.(query, options) || [];
        return turns.filter(turn => readableTurn(turn, owner));
    }
    root.GunterMemory = Object.freeze({ put, get, search, delete: remove, list,
        rememberConversation, recallConversation,
        TYPES: Object.freeze([...TYPES]), PRIVACY: Object.freeze([...PRIVACY]) });
})(typeof window !== 'undefined' ? window : globalThis);
