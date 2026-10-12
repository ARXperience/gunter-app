/* Commitments reuse the account-scoped server store and existing local tasks. */
(function () {
    if (window.GunterCommitmentsService) return;
    const SNAPSHOT_KEYS = ['id', 'ownerId', 'owner', 'beneficiary', 'action', 'context', 'dueAt',
        'projectId', 'source', 'channel', 'status', 'createdAt', 'updatedAt', 'revision'];
    function flagOn() { return !!window.PremiumFeaturesService?.isEnabled?.('commitmentTracker'); }
    function fail(code) {
        code = ({ commitment_auth_required: 'COMMITMENT_AUTH_REQUIRED', commitment_owner_mismatch: 'COMMITMENT_ACCOUNT_CHANGED',
            commitment_changed: 'COMMITMENT_CHANGED', commitment_not_pending: 'COMMITMENT_CHANGED',
            commitment_confirmation_required: 'COMMITMENT_CONFIRM_REQUIRED' })[code] || code;
        const messages = {
            COMMITMENT_AUTH_REQUIRED: 'Verifica tu sesión para consultar los compromisos de tu cuenta.',
            COMMITMENT_ACCOUNT_CHANGED: 'La cuenta cambió. Actualiza la lista antes de continuar.',
            COMMITMENT_DISABLED: 'Activa el seguimiento de compromisos en Configuración → Asistente e IA.',
            COMMITMENT_CONFIRM_REQUIRED: 'Confirma la acción antes de modificar el compromiso.',
            COMMITMENT_CHANGED: 'El compromiso cambió. Actualiza la lista y confirma sus datos actuales.',
            COMMITMENT_TASK_INVALID: 'La acción debe tener entre 2 y 180 caracteres y un plazo válido para crear una tarea.',
            COMMITMENT_UNAVAILABLE: 'No pude consultar los compromisos. Comprueba tu sesión y el servidor local.',
            commitment_provider_unavailable: 'No hay un proveedor autorizado disponible para detectar compromisos automáticamente. Revisa la configuración o agrega el compromiso manualmente.',
            commitment_extraction_failed: 'No pude validar el análisis de compromisos. No guardé resultados de ese análisis; puedes agregar el compromiso manualmente.',
            commitment_store_invalid: 'Los compromisos guardados no tienen un formato válido. No los sobrescribí; revisa tu respaldo.',
            commitment_persistence_failed: 'No pude guardar el cambio. El archivo anterior se conserva; revisa el almacenamiento del servidor local.',
            LOCAL_ONLY_MODE: 'La detección automática de compromisos todavía requiere un proveedor cloud. No envié tu texto: puedes agregar compromisos manualmente en modo local.'
        };
        const error = new Error(messages[code] || 'No pude verificar la operación. Actualiza la lista antes de repetir: podría haberse guardado.');
        error.code = code;
        return error;
    }
    function currentOwner() {
        try {
            const auth = window.GunterAuth;
            const trusted = auth?.canAccessLocalData?.() ?? auth?.isVerified?.();
            const id = trusted && auth.getUser?.()?.id;
            if (typeof id !== 'string' || !id.trim() || id === 'local-user') return null;
            const deviceOwner = window.localStorage?.getItem('gunter_device_user');
            return deviceOwner && deviceOwner !== id ? null : id;
        } catch { return null; }
    }
    function requireOwner(expected) {
        const ownerId = currentOwner();
        if (!ownerId) throw fail('COMMITMENT_AUTH_REQUIRED');
        if (expected !== undefined && ownerId !== expected) throw fail('COMMITMENT_ACCOUNT_CHANGED');
        return ownerId;
    }
    function snapshot(item) {
        if (!item || typeof item !== 'object') return null;
        return Object.fromEntries(SNAPSHOT_KEYS.map(key => [key, key === 'revision' ? item[key] || 0 : item[key] ?? null]));
    }
    function canonical(value) {
        if (Array.isArray(value)) return value.map(canonical);
        if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
        return value;
    }
    function sameSnapshot(item, expected) {
        return !!expected && SNAPSHOT_KEYS.every(key => Object.hasOwn(expected, key))
            && JSON.stringify(canonical(snapshot(item))) === JSON.stringify(canonical(expected));
    }
    async function call(op, params = {}) {
        const ownerId = requireOwner(params.ownerId);
        const response = await fetch((window.GUNTER_CONFIG?.PROXY_BASE_URL || '') + '/api/commitments', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ op, params: { ...params, ownerId } })
        });
        requireOwner(ownerId);
        const json = await response.json().catch(() => ({}));
        requireOwner(ownerId);
        if (!response.ok || !json.success) throw fail(json.code || json.error || 'COMMITMENT_UNAVAILABLE');
        return json.data;
    }
    function scoped(item, ownerId) {
        if (!item || typeof item !== 'object' || item.ownerId !== ownerId) throw fail('COMMITMENT_ACCOUNT_CHANGED');
        return item;
    }
    async function list(params = {}) {
        const ownerId = requireOwner(params.ownerId);
        const result = await call('list', params);
        requireOwner(ownerId);
        if (!Array.isArray(result?.items)) throw fail('COMMITMENT_UNAVAILABLE');
        return result.items.map(item => scoped(item, ownerId));
    }
    async function get(id) {
        const ownerId = requireOwner();
        const result = await call('get', { id });
        requireOwner(ownerId);
        return result?.item == null ? null : scoped(result.item, ownerId);
    }
    async function stats() { return call('stats'); }
    function requireGuard(guard) {
        if (!flagOn()) throw fail('COMMITMENT_DISABLED');
        if (guard?.confirmed !== true) throw fail('COMMITMENT_CONFIRM_REQUIRED');
        const ownerId = requireOwner(guard.ownerId);
        if (!guard.ownerId || guard.expected?.ownerId !== ownerId) throw fail('COMMITMENT_ACCOUNT_CHANGED');
        return ownerId;
    }
    async function change(op, id, note, guard) {
        const ownerId = requireGuard(guard);
        const result = await call(op, { ...guard, id, note, reason: note });
        requireOwner(ownerId);
        if (result?.ok !== true || (op === 'remove' ? result.id !== id : result.item?.id !== id)) throw fail('COMMITMENT_UNAVAILABLE');
        if (result.item) scoped(result.item, ownerId);
        if (op === 'remove') {
            if (await get(id)) throw fail('COMMITMENT_UNAVAILABLE');
        } else {
            const expectedStatus = op === 'mark_fulfilled' ? 'fulfilled' : 'cancelled';
            const stored = await get(id);
            if (!stored || stored.status !== expectedStatus || stored.revision !== (guard.expected.revision || 0) + 1
                || ['owner', 'beneficiary', 'action', 'context', 'dueAt', 'projectId', 'source', 'channel', 'createdAt'].some(key =>
                    JSON.stringify(canonical(stored[key] ?? null)) !== JSON.stringify(canonical(guard.expected[key] ?? null))))
                throw fail('COMMITMENT_UNAVAILABLE');
        }
        requireOwner(ownerId);
        window.dispatchEvent(new CustomEvent('gunter-commitments-changed', { detail: { ownerId } }));
        return result.item || result;
    }
    async function addManual(payload = {}) {
        if (!flagOn()) throw fail('COMMITMENT_DISABLED');
        const ownerId = requireOwner();
        const result = await call('add_manual', { ...payload, ownerId });
        requireOwner(ownerId);
        const item = scoped(result, ownerId);
        window.dispatchEvent(new CustomEvent('gunter-commitments-changed', { detail: { ownerId } }));
        return item;
    }
    async function createTask(id, guard) {
        const ownerId = requireGuard(guard);
        const item = await get(id);
        requireOwner(ownerId);
        if (!flagOn()) throw fail('COMMITMENT_DISABLED');
        if (!item || !['pending', 'overdue'].includes(item.status) || !sameSnapshot(item, guard.expected)) throw fail('COMMITMENT_CHANGED');
        if (typeof item.action !== 'string' || item.action.trim().length < 2 || item.action.length > 180
            || (item.dueAt !== null && !Number.isFinite(Date.parse(item.dueAt)))) throw fail('COMMITMENT_TASK_INVALID');
        const service = window.GunterTasksService;
        if (!service?.createFromCommitment || !service?.list) throw fail('COMMITMENT_UNAVAILABLE');
        const result = await service.createFromCommitment({ title: item.action, dueAt: item.dueAt,
            notes: [item.owner ? `Responsable del compromiso: ${item.owner}` : '',
                item.beneficiary && item.beneficiary !== 'unknown' ? `Para: ${item.beneficiary}` : '', item.context || ''].filter(Boolean).join('\n'),
            projectId: item.projectId,
            meta: { commitmentId: item.id, sourceType: item.source?.type || 'manual',
                sourceRefId: item.source?.refId || null, sourceTs: item.source?.ts || null, excerpt: item.context || '' }
        }, { ownerId, confirmed: true });
        requireOwner(ownerId);
        const stored = (await service.list()).find(task => task.id === result?.task?.id && task.ownerId === ownerId
            && task.source === 'commitment' && task.meta?.commitmentId === id);
        requireOwner(ownerId);
        if (!stored) throw fail('COMMITMENT_UNAVAILABLE');
        if (typeof result.created !== 'boolean') throw fail('COMMITMENT_UNAVAILABLE');
        return { task: stored, created: result.created };
    }
    async function ingestText({ text, sourceType = 'manual', sourceRefId = null, sourceTs = null, projectId = null } = {}) {
        if (!flagOn()) return { detected: 0, created: [], disabled: true };
        if (!text || String(text).length < 20) return { detected: 0, created: [] };
        const ownerId = requireOwner();
        const context = window.GunterContextProvider?.get?.() || {};
        const result = await call('ingest', { text, sourceType, sourceRefId,
            sourceTs: sourceTs || new Date().toISOString(), projectId,
            userName: context.userName || 'yo', timezone: context.timezone || 'America/Bogota' });
        requireOwner(ownerId);
        if (!Array.isArray(result?.created)) throw fail('COMMITMENT_UNAVAILABLE');
        result.created.forEach(item => scoped(item, ownerId));
        window.dispatchEvent(new CustomEvent('gunter-commitments-changed', { detail: { ownerId } }));
        return result;
    }
    window.GunterCommitmentsService = {
        flagOn, currentOwner, snapshot, list, get, stats, addManual, ingestText, createTask,
        markFulfilled: (id, note = '', guard) => change('mark_fulfilled', id, note, guard),
        markCancelled: (id, reason = '', guard) => change('mark_cancelled', id, reason, guard),
        remove: (id, guard) => change('remove', id, '', guard),
        // Fuzzy text resemblance is not evidence of fulfillment; no automatic write.
        reconcile: async () => ({ matched: [], updated: 0, suggestions: [], reviewRequired: true }),
        clear: () => call('clear')
    };
})();
