/* Browser client for the versioned Gunter Control Plane. */
(function (root, factory) {
    const api = factory(root);
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (root) root.GunterControlPlane = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
    const BASE = '/api/control';

    async function request(path, options = {}) {
        const response = await fetch(BASE + path, {
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            ...options,
            body: options.body === undefined ? undefined : JSON.stringify(options.body)
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok || json.success === false) {
            const error = new Error(json.message || json.error || `control_http_${response.status}`);
            error.code = json.error || `HTTP_${response.status}`;
            error.status = response.status;
            error.reason = json.reason || null;
            throw error;
        }
        return json.data;
    }

    const get = path => request(path);
    const post = (path, body) => request(path, { method: 'POST', body });
    const patch = (path, body) => request(path, { method: 'PATCH', body });
    const remove = (path, body) => request(path, { method: 'DELETE', body });

    async function updateSetting(value) {
        try { return await patch('/settings', value); }
        catch (error) {
            const retryable = root?.navigator?.onLine === false || error.status >= 500 || error.name === 'TypeError' || /fetch|network|conexi[oó]n/i.test(error.message);
            if (!retryable || !root?.GunterConnectionManager?.enqueueSetting) throw error;
            const queued = root.GunterConnectionManager.enqueueSetting(value, { baseUpdatedAt: value.baseUpdatedAt || null, conflictPolicy: 'client_wins' });
            return { queued: true, operationId: queued.operation.operationId, setting: { key: value.key, enabled: value.enabled, advanced: value.advanced || {} } };
        }
    }

    async function ensureWebNode() {
        const storageKey = 'gunter_web_node_id';
        let nodeId = null;
        try { nodeId = localStorage.getItem(storageKey); } catch { }
        const nodes = await get('/nodes');
        let node = (nodes.items || []).find(item => item.nodeId === nodeId && item.nodeType === 'WEB' && item.state !== 'REVOKED');
        if (!node) node = (nodes.items || []).find(item => item.nodeType === 'WEB' && item.state !== 'REVOKED');
        if (!node) {
            const registered = await post('/nodes/register', {
                nodeType: 'WEB', deviceName: browserName(), os: navigator.platform || 'Web',
                osVersion: navigator.userAgent.slice(0, 80), appVersion: '2.0.0', protocolVersion: '1.0.0',
                capabilities: ['gunter.chat', 'gunter.voice', 'gunter.tasks', 'gunter.calendar']
            });
            node = registered.node;
        }
        try { localStorage.setItem(storageKey, node.nodeId); } catch { }
        await heartbeat(node.nodeId).catch(() => {});
        return node;
    }

    async function heartbeat(nodeId, state = 'ONLINE') {
        const sync = root?.GunterConnectionManager?.status?.() || { pending: 0, conflicts: 0 };
        return post('/nodes/heartbeat', {
            nodeId, state, protocolVersion: '1.0.0', clientTime: Date.now(),
            syncCursor: sync.pending ? `pending:${sync.pending}` : 'clean',
            health: { browser: navigator.onLine !== false, localStorage: storageAvailable(), outbox: sync.conflicts ? false : true }
        });
    }

    async function waitForCommand(commandId, options = {}) {
        const timeoutMs = Math.max(1000, Math.min(Number(options.timeoutMs) || 30000, 120000));
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            const data = await get('/commands?limit=200');
            const command = (data.items || []).find(item => item.id === commandId);
            if (command && ['VERIFIED', 'VERIFICATION_FAILED', 'EXPIRED', 'CANCELLED'].includes(command.state)) return command;
            await new Promise(resolve => setTimeout(resolve, 900));
        }
        const error = new Error('El dispositivo no respondió dentro del tiempo esperado.');
        error.code = 'node_command_timeout';
        throw error;
    }

    function browserName() {
        const ua = navigator.userAgent || '';
        const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
        return `${browser} · Web`;
    }
    function storageAvailable() {
        try { const key = '__gunter_cp__'; localStorage.setItem(key, '1'); localStorage.removeItem(key); return true; }
        catch { return false; }
    }

    return {
        request, get, post, patch, remove, ensureWebNode, heartbeat, waitForCommand,
        contracts: () => get('/contracts'),
        capabilities: () => get('/capabilities'),
        contextEnvelope: value => post('/context/envelope', value),
        health: () => get('/health'),
        flags: () => get('/flags'),
        hybridStatus: () => get('/hybrid/status'),
        updateHybridMode: value => post('/hybrid/mode', value),
        localBrainAction: action => post(`/local-brain/${encodeURIComponent(action)}`, {}),
        settings: () => get('/settings'),
        updateSetting,
        sync: items => post('/sync', { items }),
        syncStatus: () => get('/sync/status'),
        entitlements: () => get('/entitlements'),
        plans: () => get('/plans'),
        nodes: () => get('/nodes'),
        createNodePairing: value => post('/nodes/pairing', value),
        nodePairingStatus: pairingId => get(`/nodes/pairing/status?pairingId=${encodeURIComponent(pairingId)}`),
        revokeNode: nodeId => post('/nodes/revoke', { nodeId }),
        commands: query => get(`/commands${query ? `?${new URLSearchParams(query)}` : ''}`),
        queueCommand: value => post('/commands', value),
        operations: () => get('/operations/overview'),
        incidents: () => get('/operations/incidents'),
        updateIncident: value => post('/operations/incidents', value),
        updateFlag: value => patch('/flags', value),
        upsertPlan: value => post('/plans', value),
        setSubscription: value => post('/subscriptions', value),
        planTask: value => post('/brain/plan', value),
        transitionTask: value => post('/brain/transition', value),
        workflows: query => get(`/workflows${query ? `?${new URLSearchParams(query)}` : ''}`),
        createWorkflow: value => post('/workflows', value),
        workflowAction: value => patch('/workflows', value),
        claimWorkflowStep: value => post('/workflows/claim', value),
        submitWorkflowResult: value => post('/workflows/result', value),
        activity: query => get(`/activity${query ? `?${new URLSearchParams(query)}` : ''}`),
        socialConnections: () => get('/social/connections'),
        updateSocialConnection: value => patch('/social/connections', value),
        connectSocial: provider => post('/social/connect', { provider }),
        disconnectSocial: provider => post('/social/disconnect', { provider }),
        pairBeeper: value => post('/social/beeper/pair', value),
        unpairBeeper: () => post('/social/beeper/unpair', {}),
        conversations: query => get(`/conversations${query ? `?${new URLSearchParams(query)}` : ''}`),
        conversationInsight: threadId => get(`/conversations/insight?threadId=${encodeURIComponent(threadId)}`),
        sendConversationMessage: value => post('/conversations/send', value),
        procedures: query => get(`/procedures${query ? `?${new URLSearchParams(query)}` : ''}`),
        createProcedure: value => post('/procedures', value),
        transitionProcedure: value => patch('/procedures', value),
        graph: query => get(`/graph${query ? `?q=${encodeURIComponent(query)}` : ''}`),
        rememberEntity: value => post('/graph/entities', value),
        linkEntities: value => post('/graph/edges', value),
        forgetEntity: entityId => remove('/graph/entities', { entityId }),
        learnings: () => get('/learnings'),
        captureLearning: value => post('/learnings', value),
        reviewLearning: value => patch('/learnings', value),
        forgetLearning: candidateId => remove('/learnings', { candidateId })
    };
});
