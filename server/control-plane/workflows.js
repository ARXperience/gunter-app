/* Durable multi-step coordinator for Gunter Brain.
   It never performs side effects itself: an allowlisted executor claims one step,
   reports a result and the coordinator advances only after evidence verification. */
const crypto = require('crypto');
const store = require('./persistence');
const skills = require('./skills');
const brain = require('./brain');
const nodes = require('./nodes');
const observability = require('./observability');

const FILE = 'workflows.json';
const ACTIVE = new Set(['READY', 'RUNNING', 'WAITING_CONFIRMATION', 'PAUSED', 'BLOCKED']);
const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);
const MAX_STEPS = 20;
const DEFAULT_LEASE_MS = 60_000;

function load() {
    const data = store.loadJson(FILE, { version: 1, workflows: [], savedAt: null });
    if (!Array.isArray(data.workflows)) data.workflows = [];
    return data;
}
function save(data) {
    data.savedAt = new Date().toISOString();
    store.saveJson(FILE, data);
}

function create(userId, input = {}, actor = {}) {
    if (!userId) return { ok: false, error: 'user_id_required' };
    const validation = validateCreate(input);
    if (!validation.ok) return validation;
    const data = load();
    const duplicate = data.workflows.find(item => item.userId === userId && item.idempotencyKey === validation.value.idempotencyKey);
    if (duplicate) return { ok: true, duplicate: true, workflow: publicWorkflow(duplicate) };

    const now = new Date().toISOString();
    const workflow = {
        workflowId: `flow_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`,
        traceId: input.traceId || observability.newTraceId(), userId,
        title: validation.value.title, objective: validation.value.objective,
        idempotencyKey: validation.value.idempotencyKey, priority: validation.value.priority,
        status: 'PLANNING', currentStepIndex: 0, pauseReason: null, resumeStatus: null,
        createdAt: now, updatedAt: now, completedAt: null, cancelledAt: null,
        evidence: [], errors: [], history: [{ state: 'REQUESTED', at: now, reason: 'workflow.created' }],
        steps: validation.value.steps.map((step, index) => ({
            stepId: `step_${index + 1}_${crypto.randomBytes(4).toString('hex')}`,
            index, skill: step.skill, input: step.input, nodeId: step.nodeId,
            autonomy: step.autonomy, idempotencyKey: `${validation.value.idempotencyKey}:step:${index + 1}`,
            state: 'REQUESTED', attempts: 0, lease: null, result: null, evidence: null,
            verification: null, error: null,
            history: [{ state: 'REQUESTED', at: now, reason: 'workflow.created' }]
        }))
    };
    transitionWorkflow(workflow, 'UNDERSTANDING', 'steps_received');
    transitionWorkflow(workflow, 'PLANNING', 'skill_routing');
    prepareCurrent(workflow, actor);
    data.workflows.push(workflow);
    if (data.workflows.length > 2000) data.workflows.splice(0, data.workflows.length - 2000);
    save(data);
    audit(workflow, 'workflow.created');
    return { ok: workflow.status !== 'FAILED', duplicate: false, workflow: publicWorkflow(workflow) };
}

function claim(userId, workflowId, input = {}, actor = {}, options = {}) {
    return mutateOwned(userId, workflowId, actor, (workflow) => {
        if (workflow.status === 'PAUSED') return { ok: false, error: 'workflow_paused' };
        if (workflow.status === 'WAITING_CONFIRMATION') return { ok: false, error: 'confirmation_required' };
        if (TERMINAL.has(workflow.status)) return { ok: false, error: 'workflow_terminal', state: workflow.status };
        const step = currentStep(workflow);
        if (!step) return { ok: false, error: 'workflow_has_no_current_step' };
        const nowMs = Number(options.nowMs) || Date.now();
        if (step.state === 'STARTED' && !leaseExpired(step.lease, nowMs)) {
            return { ok: false, error: 'step_already_claimed', leaseExpiresAt: step.lease.expiresAt };
        }
        if (step.state === 'STARTED' && leaseExpired(step.lease, nowMs)) {
            step.lease = null;
            if (skills.get(step.skill)?.risk !== 'read') {
                blockWithUnknownOutcome(workflow, step, 'lease_expired_result_unknown');
                return { ok: false, error: 'step_outcome_unknown', workflow: publicWorkflow(workflow) };
            }
            transitionStep(step, 'AUTHORIZED', 'lease_expired_reclaim');
        }
        if (step.state !== 'AUTHORIZED') return { ok: false, error: 'step_not_authorized', state: step.state };
        const leaseMs = Math.max(15_000, Math.min(Number(input.leaseMs) || DEFAULT_LEASE_MS, 300_000));
        const now = new Date(nowMs);
        step.attempts += 1;
        step.lease = {
            leaseId: `lease_${crypto.randomBytes(8).toString('hex')}`,
            claimedBy: clean(input.executorId || actor.nodeId || actor.userId || actor.kind || 'web', 120),
            claimedAt: now.toISOString(), expiresAt: new Date(now.getTime() + leaseMs).toISOString()
        };
        transitionStep(step, 'STARTED', step.attempts > 1 ? 'step.reclaimed' : 'step.claimed');
        transitionWorkflow(workflow, 'RUNNING', 'step.claimed');
        return { ok: true, workflow: publicWorkflow(workflow), step: publicStep(step) };
    });
}

function submitResult(userId, workflowId, input = {}, actor = {}) {
    return mutateOwned(userId, workflowId, actor, (workflow) => {
        if (workflow.status === 'PAUSED') return { ok: false, error: 'workflow_paused' };
        const step = currentStep(workflow);
        if (!step || step.state !== 'STARTED') return { ok: false, error: 'step_not_started' };
        if (input.stepId && input.stepId !== step.stepId) return { ok: false, error: 'workflow_step_mismatch' };
        if (input.leaseId && input.leaseId !== step.lease?.leaseId) return { ok: false, error: 'workflow_lease_mismatch' };
        step.result = safeObject(input.result);
        step.evidence = safeObject(input.evidence);
        step.lease = null;
        if (input.error) {
            step.error = clean(input.error, 180) || 'step_execution_failed';
            const uncertain = skills.get(step.skill)?.risk !== 'read';
            if (uncertain) blockWithUnknownOutcome(workflow, step, 'executor_error_result_unknown');
            else {
                transitionStep(step, 'FAILED', step.error);
                workflow.errors.push({ stepId: step.stepId, code: step.error, at: new Date().toISOString() });
                transitionWorkflow(workflow, 'BLOCKED', 'step_execution_failed');
            }
            audit(workflow, 'workflow.step_failed', 'HIGH');
            return { ok: true, executionFailed: true, outcomeUnknown: uncertain, workflow: publicWorkflow(workflow) };
        }
        transitionStep(step, 'RESULT_RECEIVED', 'executor.result');
        transitionStep(step, 'VERIFYING', 'evidence.verify');
        const verification = skills.verify(step.skill, {
            result: step.result, evidence: step.evidence, evidenceRef: clean(input.evidenceRef, 240) || null
        });
        step.verification = verification;
        if (!verification.verified) {
            step.error = 'verification_failed';
            const uncertain = skills.get(step.skill)?.risk !== 'read';
            if (uncertain) blockWithUnknownOutcome(workflow, step, 'side_effect_not_verified');
            else {
                transitionStep(step, 'VERIFICATION_FAILED', 'evidence.insufficient');
                workflow.errors.push({ stepId: step.stepId, code: 'verification_failed', at: new Date().toISOString() });
                transitionWorkflow(workflow, 'BLOCKED', 'verification_failed');
            }
            audit(workflow, 'workflow.verification_failed', 'HIGH');
            return { ok: false, error: uncertain ? 'step_outcome_unknown' : 'verification_failed', outcomeUnknown: uncertain, verification, workflow: publicWorkflow(workflow) };
        }

        transitionStep(step, 'VERIFIED', 'evidence.verified');
        workflow.evidence.push({ stepId: step.stepId, skill: step.skill, evidenceRef: clean(input.evidenceRef, 240) || null, at: new Date().toISOString(), limitation: verification.limitation || null });
        workflow.currentStepIndex += 1;
        if (workflow.currentStepIndex >= workflow.steps.length) {
            workflow.completedAt = new Date().toISOString();
            transitionWorkflow(workflow, 'COMPLETED', 'all_steps_verified');
        } else {
            prepareCurrent(workflow, actor);
        }
        audit(workflow, workflow.status === 'COMPLETED' ? 'workflow.completed' : 'workflow.step_verified');
        return { ok: true, verification, workflow: publicWorkflow(workflow) };
    });
}

function action(userId, workflowId, input = {}, actor = {}) {
    const actionName = String(input.action || '').toLowerCase();
    return mutateOwned(userId, workflowId, actor, (workflow) => {
        const step = currentStep(workflow);
        if (actionName === 'authorize') {
            if (workflow.status !== 'WAITING_CONFIRMATION' || !step || step.state !== 'WAITING_CONFIRMATION') return { ok: false, error: 'confirmation_not_pending' };
            if (input.confirmed !== true) return { ok: false, error: 'confirmation_required' };
            const authorization = authorizeStep(workflow, step, actor, true);
            if (!authorization.ok) return authorization;
            transitionStep(step, 'AUTHORIZED', 'user.confirmed');
            transitionWorkflow(workflow, 'READY', 'step.authorized');
        } else if (actionName === 'pause') {
            if (!ACTIVE.has(workflow.status) || workflow.status === 'PAUSED') return { ok: false, error: 'workflow_not_pausable', state: workflow.status };
            workflow.resumeStatus = workflow.status;
            workflow.pauseReason = clean(input.reason || 'Pausado por el usuario', 240);
            transitionWorkflow(workflow, 'PAUSED', workflow.pauseReason);
        } else if (actionName === 'resume') {
            if (workflow.status !== 'PAUSED') return { ok: false, error: 'workflow_not_paused' };
            workflow.pauseReason = null;
            const target = statusForStep(step);
            workflow.resumeStatus = null;
            transitionWorkflow(workflow, target, 'user.resumed');
        } else if (actionName === 'cancel') {
            if (TERMINAL.has(workflow.status)) return { ok: false, error: 'workflow_terminal', state: workflow.status };
            if (step && !['VERIFIED', 'CANCELLED'].includes(step.state)) {
                step.lease = null;
                transitionStep(step, 'CANCELLED', clean(input.reason || 'user.cancelled', 240));
            }
            workflow.cancelledAt = new Date().toISOString();
            transitionWorkflow(workflow, 'CANCELLED', clean(input.reason || 'user.cancelled', 240));
        } else if (actionName === 'retry') {
            if (workflow.status !== 'BLOCKED' || !step || !['VERIFICATION_FAILED', 'FAILED', 'OUTCOME_UNKNOWN'].includes(step.state)) return { ok: false, error: 'workflow_not_retryable' };
            if (step.state === 'OUTCOME_UNKNOWN' && input.confirmed !== true) return { ok: false, error: 'retry_confirmation_required' };
            step.error = null; step.result = null; step.evidence = null; step.verification = null; step.lease = null;
            transitionStep(step, 'REQUESTED', 'user.retry');
            prepareCurrent(workflow, actor);
        } else {
            return { ok: false, error: 'workflow_action_invalid' };
        }
        audit(workflow, `workflow.${actionName}`);
        return { ok: true, workflow: publicWorkflow(workflow) };
    });
}

function prepareCurrent(workflow, actor) {
    const step = currentStep(workflow);
    if (!step) return;
    transitionStep(step, 'UNDERSTANDING', 'skill.received');
    transitionStep(step, 'PLANNING', 'skill.routing');
    const authorization = authorizeStep(workflow, step, actor, false);
    if (authorization.ok) {
        transitionStep(step, 'AUTHORIZED', 'policy_entitlement_passed');
        transitionWorkflow(workflow, 'READY', 'step.authorized');
    } else if (authorization.requiresConfirmation) {
        transitionStep(step, 'WAITING_CONFIRMATION', authorization.error);
        transitionWorkflow(workflow, 'WAITING_CONFIRMATION', authorization.error);
    } else {
        step.error = authorization.error;
        workflow.errors.push({ stepId: step.stepId, code: authorization.error, at: new Date().toISOString() });
        transitionStep(step, 'FAILED', authorization.error);
        transitionWorkflow(workflow, 'FAILED', authorization.error);
    }
}

function authorizeStep(workflow, step, actor, confirmed) {
    const node = step.nodeId ? nodes.get(step.nodeId) : brain.selectNode(workflow.userId, step.skill);
    if (step.nodeId && (!node || node.userId !== workflow.userId)) return { ok: false, error: 'node_not_found' };
    if (node?.nodeId) step.nodeId = node.nodeId;
    return skills.authorize({
        userId: workflow.userId, actor: { ...actor, userId: workflow.userId }, skillName: step.skill,
        node: node || { nodeType: 'WEB' }, autonomy: step.autonomy, confirmed
    });
}

function mutateOwned(userId, workflowId, actor, fn) {
    const data = load();
    const workflow = data.workflows.find(item => item.workflowId === workflowId);
    if (!workflow) return { ok: false, error: 'workflow_not_found' };
    if (workflow.userId !== userId && actor.role !== 'admin' && actor.kind !== 'service') return { ok: false, error: 'workflow_owner_mismatch' };
    const result = fn(workflow);
    if (result?.ok !== false || result?.workflow) save(data);
    return result;
}

function get(workflowId) {
    const workflow = load().workflows.find(item => item.workflowId === workflowId);
    return workflow ? publicWorkflow(workflow) : null;
}
function list({ userId = null, status = null, limit = 100 } = {}) {
    return load().workflows
        .filter(item => (!userId || item.userId === userId) && (!status || item.status === String(status).toUpperCase()))
        .slice(-Math.max(1, Math.min(Number(limit) || 100, 500))).reverse().map(publicWorkflow);
}
function stats(userId = null) {
    const items = load().workflows.filter(item => !userId || item.userId === userId);
    return { total: items.length, active: items.filter(item => ACTIVE.has(item.status)).length, byState: countBy(items, 'status') };
}
function purgeUser(userId) {
    const data = load(); const before = data.workflows.length;
    data.workflows = data.workflows.filter(item => item.userId !== userId); save(data);
    return before - data.workflows.length;
}

function validateCreate(input) {
    const objective = clean(input.objective, 500);
    const title = clean(input.title || objective, 100);
    const rawSteps = Array.isArray(input.steps) ? input.steps : [];
    if (objective.length < 3) return { ok: false, error: 'workflow_objective_invalid' };
    if (!rawSteps.length || rawSteps.length > MAX_STEPS) return { ok: false, error: 'workflow_steps_invalid' };
    const steps = [];
    for (const raw of rawSteps) {
        const skill = clean(raw?.skill, 120);
        if (!skills.get(skill)) return { ok: false, error: 'workflow_skill_not_found', skill };
        steps.push({
            skill, input: safeObject(raw.input), nodeId: clean(raw.nodeId, 120) || null,
            autonomy: skills.AUTONOMY.includes(raw.autonomy) ? raw.autonomy : 'L3'
        });
    }
    const idempotencyKey = clean(input.idempotencyKey, 160) || store.hash(`${objective}|${JSON.stringify(steps)}`).slice(0, 32);
    return { ok: true, value: { objective, title, steps, idempotencyKey, priority: normalizePriority(input.priority) } };
}

function currentStep(workflow) { return workflow.steps[workflow.currentStepIndex] || null; }
function statusForStep(step) {
    if (!step) return 'COMPLETED';
    if (step.state === 'WAITING_CONFIRMATION') return 'WAITING_CONFIRMATION';
    if (step.state === 'STARTED') return 'RUNNING';
    if (['VERIFICATION_FAILED', 'OUTCOME_UNKNOWN'].includes(step.state)) return 'BLOCKED';
    return 'READY';
}
function leaseExpired(lease, nowMs = Date.now()) { return !lease || new Date(lease.expiresAt).getTime() <= nowMs; }
function blockWithUnknownOutcome(workflow, step, reason) {
    step.error = 'execution_outcome_unknown';
    transitionStep(step, 'OUTCOME_UNKNOWN', reason);
    workflow.errors.push({ stepId: step.stepId, code: 'execution_outcome_unknown', at: new Date().toISOString() });
    transitionWorkflow(workflow, 'BLOCKED', reason);
}
function transitionWorkflow(workflow, state, reason) {
    workflow.status = state; workflow.updatedAt = new Date().toISOString();
    workflow.history.push({ state, at: workflow.updatedAt, reason: clean(reason, 240) });
}
function transitionStep(step, state, reason) {
    step.state = state; step.updatedAt = new Date().toISOString();
    step.history.push({ state, at: step.updatedAt, reason: clean(reason, 240) });
}
function audit(workflow, eventType, severity = 'INFO') {
    observability.record({
        trace_id: workflow.traceId, severity, service: 'workflows', event_type: eventType,
        action: currentStep(workflow)?.skill || 'workflow', task_id: workflow.workflowId,
        status: workflow.status, error_code: workflow.errors.at(-1)?.code || null,
        user_id_hash: store.hash(workflow.userId).slice(0, 16),
        metadata_redacted: { steps: workflow.steps.length, currentStep: workflow.currentStepIndex + 1 }
    });
}
function publicWorkflow(workflow) { return JSON.parse(JSON.stringify(workflow)); }
function publicStep(step) { return JSON.parse(JSON.stringify(step)); }
function safeObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const text = JSON.stringify(value); return JSON.parse(Buffer.byteLength(text) <= 64 * 1024 ? text : '{}');
}
function clean(value, max = 200) { return String(value || '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, max); }
function normalizePriority(value) { return ['low', 'normal', 'high', 'urgent'].includes(value) ? value : 'normal'; }
function countBy(items, key) { const out = {}; for (const item of items) out[item[key]] = (out[item[key]] || 0) + 1; return out; }

module.exports = { ACTIVE, TERMINAL, MAX_STEPS, create, claim, submitResult, action, get, list, stats, purgeUser, _load: load };
