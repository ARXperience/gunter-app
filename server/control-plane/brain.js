/* Minimal persistent Brain Core state machine. It plans; skills still execute through existing adapters/nodes. */
const crypto = require('crypto');
const store = require('./persistence');
const skills = require('./skills');
const nodes = require('./nodes');
const observability = require('./observability');

const FILE = 'task-runs.json';
const TRANSITIONS = Object.freeze({
    requested: ['understanding', 'cancelled'],
    understanding: ['planning', 'failed', 'cancelled'],
    planning: ['waiting_confirmation', 'authorized', 'failed', 'cancelled'],
    waiting_confirmation: ['authorized', 'cancelled'],
    authorized: ['started', 'cancelled'],
    started: ['result_received', 'paused', 'failed', 'cancelled'],
    paused: ['started', 'cancelled'],
    result_received: ['verifying', 'failed'],
    verifying: ['verified', 'verification_failed'],
    verification_failed: ['started', 'failed', 'cancelled'],
    verified: ['completed'],
    completed: [], failed: [], cancelled: []
});

function load() {
    const data = store.loadJson(FILE, { runs: [], savedAt: null });
    if (!Array.isArray(data.runs)) data.runs = [];
    return data;
}
function save(data) { data.savedAt = new Date().toISOString(); store.saveJson(FILE, data); }

function plan(userId, input = {}, actor = {}) {
    const traceId = input.traceId || observability.newTraceId();
    const now = new Date().toISOString();
    const data = load();
    const node = input.nodeId ? nodes.get(input.nodeId) : selectNode(userId, input.skill);
    const run = {
        taskId: `task_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`,
        traceId, userId, nodeId: node?.nodeId || null, intent: String(input.intent || input.skill || 'unknown').slice(0, 180),
        skill: input.skill || null, plan: [], state: 'requested', priority: normalizePriority(input.priority),
        evidence: [], errors: [], result: null, requiresConfirmation: false,
        createdAt: now, updatedAt: now, history: [{ state: 'requested', at: now, reason: 'brain.plan' }]
    };
    data.runs.push(run);
    transitionInternal(run, 'understanding', 'intent_received');
    transitionInternal(run, 'planning', 'skill_routing');
    const authorization = skills.authorize({
        userId, actor, skillName: input.skill, node: node || { nodeType: 'WEB' },
        autonomy: input.autonomy || 'L3', confirmed: input.confirmed === true
    });
    if (!authorization.ok) {
        if (authorization.requiresConfirmation) {
            run.requiresConfirmation = true;
            run.plan = [{ skill: input.skill, nodeId: node?.nodeId || null, state: 'awaiting_confirmation' }];
            transitionInternal(run, 'waiting_confirmation', authorization.error);
        } else {
            run.errors.push({ code: authorization.error, reason: authorization.reason || null, at: new Date().toISOString() });
            transitionInternal(run, 'failed', authorization.error);
        }
    } else {
        run.plan = [{
            step: 1, skill: authorization.skill.name, skillVersion: authorization.skill.version,
            nodeId: node?.nodeId || null, verify: true, state: 'authorized'
        }];
        transitionInternal(run, 'authorized', 'policy_entitlement_passed');
    }
    if (data.runs.length > 2000) data.runs.splice(0, data.runs.length - 2000);
    save(data);
    observability.record({
        trace_id: traceId, severity: run.state === 'failed' ? 'WARN' : 'INFO', service: 'brain',
        event_type: 'brain.plan', action: run.skill, skill: run.skill, node_id: run.nodeId,
        task_id: run.taskId, status: run.state, error_code: run.errors.at(-1)?.code || null,
        user_id_hash: store.hash(userId).slice(0, 16), metadata_redacted: { steps: run.plan.length, requiresConfirmation: run.requiresConfirmation }
    });
    return { ok: run.state !== 'failed', error: run.state === 'failed' ? authorization.error : undefined, run: publicRun(run), authorization };
}

function transition(taskId, nextState, input = {}, actor = {}) {
    const data = load();
    const run = data.runs.find(item => item.taskId === taskId);
    if (!run) return { ok: false, error: 'task_run_not_found' };
    if (actor.userId && actor.userId !== run.userId && actor.role !== 'admin' && actor.kind !== 'service') return { ok: false, error: 'task_owner_mismatch' };
    const allowed = TRANSITIONS[run.state] || [];
    if (!allowed.includes(nextState)) return { ok: false, error: 'invalid_state_transition', from: run.state, to: nextState };
    if (nextState === 'authorized' && run.state === 'waiting_confirmation' && input.confirmed !== true) return { ok: false, error: 'confirmation_required' };
    if (input.result !== undefined) run.result = safeObject(input.result);
    if (input.evidence !== undefined) run.evidence.push(safeObject(input.evidence));
    if (input.error) run.errors.push({ code: String(input.error).slice(0, 120), at: new Date().toISOString() });
    transitionInternal(run, nextState, input.reason || 'api_transition');
    if (nextState === 'authorized') run.requiresConfirmation = false;
    save(data);
    observability.record({
        trace_id: run.traceId, severity: ['failed', 'verification_failed'].includes(nextState) ? 'HIGH' : 'INFO',
        service: 'brain', event_type: 'brain.transition', action: `${run.history.at(-2)?.state}->${nextState}`,
        skill: run.skill, node_id: run.nodeId, task_id: run.taskId, status: nextState,
        error_code: input.error || null, metadata_redacted: { reason: String(input.reason || '').slice(0, 120) }
    });
    return { ok: true, run: publicRun(run) };
}

function get(taskId) { const run = load().runs.find(item => item.taskId === taskId); return run ? publicRun(run) : null; }
function list({ userId = null, state = null, limit = 100 } = {}) {
    return load().runs.filter(run => (!userId || run.userId === userId) && (!state || run.state === state))
        .slice(-Math.max(1, Math.min(Number(limit) || 100, 500))).reverse().map(publicRun);
}
function stats() { const runs = load().runs; return { total: runs.length, byState: runs.reduce((acc, run) => (acc[run.state] = (acc[run.state] || 0) + 1, acc), {}) }; }
function purgeUser(userId) { const data = load(); const before = data.runs.length; data.runs = data.runs.filter(run => run.userId !== userId); save(data); return before - data.runs.length; }

function selectNode(userId, skillName) {
    const entry = skills.get(skillName);
    if (!entry) return null;
    return nodes.list({ userId }).find(node => entry.supportedNodes.includes(node.nodeType) && ['ONLINE', 'DEGRADED', 'SYNCING'].includes(node.state)) ||
        (entry.supportedNodes.includes('WEB') ? { nodeId: null, nodeType: 'WEB', capabilities: [] } : null);
}
function transitionInternal(run, nextState, reason) { run.state = nextState; run.updatedAt = new Date().toISOString(); run.history.push({ state: nextState, at: run.updatedAt, reason }); }
function publicRun(run) { return JSON.parse(JSON.stringify(run)); }
function normalizePriority(value) { return ['low', 'normal', 'high', 'urgent'].includes(value) ? value : 'normal'; }
function safeObject(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) return {}; const text = JSON.stringify(value); return JSON.parse(text.length > 65536 ? '{}' : text); }

module.exports = { TRANSITIONS, plan, transition, get, list, stats, selectNode, purgeUser, _load: load };
