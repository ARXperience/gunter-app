/* Deterministic Control Plane contract, entitlement, node and verification tests. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gunter-control-test-'));
process.env.GUNTER_CONTROL_DATA_DIR = testDir;

const contracts = require('../server/control-plane/contracts');
const flags = require('../server/control-plane/feature-flags');
const entitlements = require('../server/control-plane/entitlements');
const nodes = require('../server/control-plane/nodes');
const skills = require('../server/control-plane/skills');
const brain = require('../server/control-plane/brain');
const observability = require('../server/control-plane/observability');
const operations = require('../server/control-plane/operations');
const capabilities = require('../server/control-plane/capabilities');
const contextGateway = require('../server/control-plane/context-gateway');
const knowledgeGraph = require('../server/control-plane/knowledge-graph');
const errorLearning = require('../server/control-plane/error-learning');
const privacy = require('../server/control-plane/privacy');
const sync = require('../server/control-plane/sync');
const workflows = require('../server/control-plane/workflows');
const activity = require('../server/control-plane/activity');
const missions = require('../server/control-plane/missions');
const socialHub = require('../server/control-plane/social-hub');
const beeperClient = require('../server/control-plane/beeper-client');
const mobilePushScheduler = require('../server/push/mobile-scheduler');

let passed = 0;
async function test(name, fn) {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
}

(async () => {
    console.log('GUNTER CONTROL PLANE CORE');
    const userId = 'u_control_test';
    const admin = { kind: 'service', role: 'admin', userId };

    await test('catálogo expone contratos v1 esperados', () => {
        const catalog = contracts.catalog();
        assert.equal(catalog.version, '1.0.0');
        assert.ok(catalog.schemas.task_run && catalog.schemas.node && catalog.schemas.license_lease && catalog.schemas.context_envelope);
    });

    await test('mapa funcional cubre 44 capacidades y 4 matrices obligatorias', () => {
        const catalog = capabilities.catalog(userId, admin);
        assert.equal(catalog.items.length, 44);
        assert.equal(catalog.governance.length, 4);
        assert.equal(new Set(catalog.items.map(item => item.id)).size, 44);
        assert.equal(catalog.items.find(item => item.id === 'C1').status, 'partial');
        const retiredPages = new Set(['chat.html', 'tasks.html', 'calendar.html', 'meetings.html', 'documents.html', 'inbox.html']);
        assert.equal(catalog.items.some(item => retiredPages.has(item.route)), false);
    });

    await test('Context Gateway usa hora real, resuelve referencias y aísla usuarios', () => {
        const first = contextGateway.build(userId, { sessionId: 's1', text: 'revisa este proyecto hoy a las 14:30', timezone: 'America/Bogota', current: { project: 'Atlas' } }, admin, 'tr_ctx_1');
        assert.equal(first.ok, true);
        assert.equal(first.envelope.references.temporal[0].date.length, 10);
        assert.equal(first.envelope.references.temporal.some(item => item.time === '14:30'), true);
        const referenced = contextGateway.build(userId, { sessionId: 's1', text: 'hazlo mañana', timezone: 'America/Bogota' }, admin, 'tr_ctx_2');
        assert.equal(referenced.envelope.current.project, 'Atlas');
        assert.equal(referenced.envelope.needs_clarification, false);
        const isolated = contextGateway.build('otro_usuario', { sessionId: 's1', text: 'hazlo' }, admin, 'tr_ctx_3');
        assert.equal(isolated.envelope.needs_clarification, true);
        assert.notEqual(first.envelope.user_id_hash, isolated.envelope.user_id_hash);
    });

    await test('Knowledge Graph exige procedencia y nunca fusiona por similitud', () => {
        assert.equal(knowledgeGraph.upsertEntity(userId, { label: 'Atlas' }).ok, false);
        const one = knowledgeGraph.upsertEntity(userId, { type: 'project', label: 'Atlas', source: { type: 'user', id: 'manual' }, confidence: 0.9 });
        const two = knowledgeGraph.upsertEntity(userId, { type: 'project', label: 'atlas', source: { type: 'document', id: 'doc-1' }, confidence: 0.8 });
        assert.equal(one.ok && two.ok, true);
        assert.notEqual(one.entity.entityId, two.entity.entityId);
        assert.equal(knowledgeGraph.search(userId, { q: 'atlas' }).entities.length, 2);
    });

    await test('Error Learning redacta secretos y no autoaplica dominios protegidos', () => {
        const result = errorLearning.capture(userId, { domain: 'security', summary: 'falló api_key=secreto-123', evidence: [{ note: 'Bearer token.super.secreto' }] }, 'tr_learn');
        assert.equal(result.ok, true);
        assert.equal(result.candidate.protected, true);
        assert.equal(result.candidate.autoApplicable, false);
        assert.equal(JSON.stringify(result.candidate).includes('secreto-123'), false);
        const reviewed = errorLearning.review(userId, { candidateId: result.candidate.candidateId, state: 'VALIDATED', suggestion: 'cambiar policy automáticamente' });
        assert.equal(reviewed.candidate.autoApplicable, false);
    });

    await test('outbox aplica cambios idempotentes y detecta conflictos', () => {
        const first = sync.applyBatch(userId, { items: [{ operationId: 'op_sync_1', idempotencyKey: 'sync-voice-1', type: 'settings.patch', payload: { key: 'voice.continuous', enabled: false, advanced: { privacyMode: 'local' } } }] }, admin);
        assert.equal(first.ok, true);
        assert.equal(first.results[0].status, 'APPLIED');
        const duplicate = sync.applyBatch(userId, { items: [{ operationId: 'op_sync_1_retry', idempotencyKey: 'sync-voice-1', type: 'settings.patch', payload: { key: 'voice.continuous', enabled: true } }] }, admin);
        assert.equal(duplicate.results[0].duplicate, true);
        const base = first.results[0].setting.updatedAt;
        settingsPatchForConflict();
        const conflict = sync.applyBatch(userId, { items: [{ operationId: 'op_sync_2', idempotencyKey: 'sync-voice-2', type: 'settings.patch', baseUpdatedAt: base, conflictPolicy: 'server_wins', payload: { key: 'voice.continuous', enabled: false } }] }, admin);
        assert.equal(conflict.results[0].status, 'CONFLICT');
        const rejected = sync.applyBatch(userId, { items: [{ operationId: 'op_sync_3', idempotencyKey: 'sync-unknown-1', type: 'desktop.execute', payload: {} }] }, admin);
        assert.equal(rejected.results[0].status, 'REJECTED');
    });

    function settingsPatchForConflict() {
        const settingsModule = require('../server/control-plane/settings');
        const result = settingsModule.patch(userId, { key: 'voice.continuous', enabled: false, advanced: { privacyMode: 'session' } }, admin);
        assert.equal(result.ok, true);
    }

    await test('validador rechaza node incompleto', () => {
        const result = contracts.validate('node', { node_id: 'n1' });
        assert.equal(result.ok, false);
        assert.ok(result.errors.includes('required:user_id'));
    });

    await test('feature flags respetan on, off y canary', () => {
        assert.equal(flags.evaluate('desktop.node', admin).enabled, true);
        assert.equal(flags.set('desktop.node', { state: 'off' }, 'test').ok, true);
        assert.equal(flags.evaluate('desktop.node', admin).enabled, false);
        assert.equal(flags.set('desktop.node', { state: 'canary', canaryUsers: [userId] }, 'test').ok, true);
        assert.equal(flags.evaluate('desktop.node', { role: 'user', userId }).enabled, true);
        flags.set('desktop.node', { state: 'on' }, 'test');
        flags.set('desktop.apps', { state: 'on' }, 'test');
    });

    await test('plan configurable produce snapshot sin deploy', () => {
        const result = entitlements.upsertPlan({
            id: 'control-test', name: 'Control test', active: true, limits: { nodes: 3 },
            features: {
                'gunter.chat': true, 'gunter.tasks': true, 'gunter.calendar': true,
                'desktop.node': true, 'desktop.apps': true, 'mobile.node': true,
                'mobile.media': true, 'mobile.messaging': true
            }
        }, 'test');
        assert.equal(result.ok, true);
        assert.equal(entitlements.setSubscription({ userId, planId: 'control-test', state: 'ACTIVE' }, 'test').ok, true);
        assert.equal(entitlements.check(userId, 'desktop.node').allowed, true);
        assert.equal(entitlements.check(userId, 'mobile.node').allowed, true);
    });

    let nodeToken;
    let nodeId;
    await test('Device Registry emite token opaco y heartbeat', () => {
        const registered = nodes.register(userId, {
            nodeType: 'DESKTOP', deviceName: 'PC QA', os: 'Windows', protocolVersion: '1.0.0',
            capabilities: ['desktop.apps.open']
        }, admin);
        assert.equal(registered.ok, true);
        assert.match(registered.nodeToken, /^gn_/);
        nodeToken = registered.nodeToken;
        nodeId = registered.node.nodeId;
        assert.equal(nodes.authenticateToken(nodeToken).nodeId, nodeId);
        const heartbeat = nodes.heartbeat(nodeId, { state: 'ONLINE', health: { runtime: true }, clientTime: Date.now() }, { userId });
        assert.equal(heartbeat.ok, true);
        assert.equal(heartbeat.node.state, 'ONLINE');
    });

    await test('emparejamiento de un solo uso vincula un PC sin exponer credenciales permanentes', () => {
        const created = nodes.createPairing(userId, { nodeType: 'DESKTOP', deviceName: 'Portátil QA' }, { role: 'user', userId });
        assert.equal(created.ok, true);
        assert.match(created.pairingToken, /^gp_/);
        const authorized = nodes.authenticatePairingToken(created.pairingToken);
        assert.equal(authorized.pairingId, created.pairing.pairingId);
        const claimed = nodes.claimPairing(authorized.pairingId, { os: 'Windows', appVersion: '0.1.0', protocolVersion: '1.0.0' });
        assert.equal(claimed.ok, true);
        assert.match(claimed.nodeToken, /^gn_/);
        assert.equal(nodes.authenticatePairingToken(created.pairingToken), null);
        assert.equal(nodes.claimPairing(authorized.pairingId, {}).error, 'pairing_invalid_or_expired');
    });

    await test('emparejamiento móvil conserva capacidades declaradas y credencial opaca', async () => {
        assert.equal(nodes.nodeAuthPath('/api/control/nodes/push-token'), true);
        const created = nodes.createPairing(userId, { nodeType: 'ANDROID', deviceName: 'Móvil QA' }, { role: 'user', userId });
        assert.equal(created.ok, true);
        assert.ok(created.pairing.capabilities.includes('mobile.files.read'));
        const pairing = nodes.authenticatePairingToken(created.pairingToken);
        const claimed = nodes.claimPairing(pairing.pairingId, { os: 'Android', appVersion: '0.1.0', protocolVersion: '1.0.0' });
        assert.equal(claimed.ok, true);
        assert.equal(claimed.node.nodeType, 'ANDROID');
        assert.match(claimed.nodeToken, /^gn_/);
        assert.equal(nodes.authenticatePairingToken(created.pairingToken), null);
        const fcmToken = `fcm-registration-token-${'x'.repeat(80)}`;
        assert.equal(nodes.registerPushToken(claimed.node.nodeId, { provider: 'fcm', token: fcmToken }).ok, true);
        assert.equal(nodes.getPushToken(claimed.node.nodeId), fcmToken);
        assert.equal(JSON.stringify(nodes.get(claimed.node.nodeId)).includes(fcmToken), false);
        assert.equal(JSON.stringify(nodes._load()).includes(fcmToken), false);
        const queued = nodes.queueCommand(userId, {
            nodeId: claimed.node.nodeId, skill: 'mobile.open_app', payload: { app: 'calendar' },
            idempotencyKey: 'mobile-open-calendar-push', autonomy: 'L3', confirmed: true
        }, admin);
        assert.equal(queued.ok, true, JSON.stringify(queued));
        assert.equal(queued.command.pushWakeup.state, 'PENDING');
        const nowMs = Date.now() + 2_000;
        const failedAttempt = await mobilePushScheduler.drain({
            _nowMs: nowMs,
            _sender: async () => ({ attempted: true, delivered: false, reason: 'fcm_delivery_failed' })
        });
        assert.equal(failedAttempt.processed, 1);
        assert.equal(failedAttempt.outcomes[0].state, 'RETRY');
        const retryAt = new Date(nodes.commandList(userId).find(item => item.id === queued.command.id).pushWakeup.nextAttemptAt).getTime();
        const successfulAttempt = await mobilePushScheduler.drain({
            _nowMs: retryAt,
            _sender: async () => ({ attempted: true, delivered: true })
        });
        assert.equal(successfulAttempt.outcomes[0].state, 'SENT');
        const publicCommand = nodes.commandList(userId).find(item => item.id === queued.command.id);
        assert.equal(publicCommand.pushWakeup.attempts, 2);
        assert.equal(Object.hasOwn(publicCommand.pushWakeup, 'leaseUntil'), false);
        assert.equal(nodes.clearPushToken(claimed.node.nodeId).push.enabled, false);
        assert.equal(nodes.getPushToken(claimed.node.nodeId), null);
        assert.equal(nodes.revoke(claimed.node.nodeId, { userId }).ok, true);
    });

    await test('iOS registra APNs de forma cifrada y usa el outbox de avisos', async () => {
        const created = nodes.createPairing(userId, { nodeType: 'IOS', deviceName: 'iPhone QA' }, { role: 'user', userId });
        assert.equal(created.ok, true);
        const pairing = nodes.authenticatePairingToken(created.pairingToken);
        const claimed = nodes.claimPairing(pairing.pairingId, { os: 'iOS', appVersion: '0.1.0', protocolVersion: '1.0.0' });
        assert.equal(claimed.ok, true);
        const apnsToken = 'b'.repeat(64);
        assert.equal(nodes.registerPushToken(claimed.node.nodeId, { provider: 'fcm', token: apnsToken }).ok, false);
        assert.equal(nodes.registerPushToken(claimed.node.nodeId, { provider: 'apns', token: apnsToken }).ok, true);
        assert.deepEqual(nodes.getPushRegistration(claimed.node.nodeId), { token: apnsToken, provider: 'apns' });
        assert.equal(JSON.stringify(nodes._load()).includes(apnsToken), false);
        assert.equal(nodes.queueCommand(userId, {
            nodeId: claimed.node.nodeId, skill: 'mobile.media.play_pause', payload: {},
            idempotencyKey: 'ios-media-wakeup', autonomy: 'L3', confirmed: true
        }, admin).command.pushWakeup.state, 'PENDING');
        const result = await mobilePushScheduler.drain({
            _nowMs: Date.now() + 2_000,
            _sender: async (nodeId, commandId) => {
                assert.equal(nodeId, claimed.node.nodeId);
                assert.match(commandId, /^cmd_/);
                return { attempted: true, delivered: true };
            }
        });
        assert.equal(result.processed, 1);
        assert.equal(result.outcomes[0].state, 'SENT');
        assert.equal(nodes.clearPushToken(claimed.node.nodeId).push.enabled, false);
    });

    await test('lease offline está firmado y expira de forma verificable', () => {
        const lease = entitlements.issueLease(userId, nodeId, { ttlHours: 4, protocolVersion: '1.0.0' });
        assert.equal(entitlements.verifyLease(lease).ok, true);
        assert.equal(entitlements.verifyLease({ ...lease, node_id: 'altered' }).ok, false);
    });

    await test('Permission Gate distingue origen de voz y exige confirmación para efectos', () => {
        const base = { userId, actor: admin, skillName: 'desktop.media.play_pause',
            node: { nodeType: 'DESKTOP' }, payload: {}, autonomy: 'L3', inputSource: 'voice' };
        assert.equal(skills.authorizeProposal({ ...base, confirmed: false }).error, 'confirmation_required');
        assert.equal(skills.authorizeProposal({ ...base, confirmed: true }).ok, true);
        const read = { ...base, skillName: 'desktop.ui.inspect', inputSource: 'voice', confirmed: false };
        const readDecision = skills.authorizeProposal(read);
        assert.equal(readDecision.ok, true, JSON.stringify(readDecision));
    });

    await test('comando idempotente exige skill, permiso y confirmación', () => {
        const queued = nodes.queueCommand(userId, {
            nodeId, skill: 'desktop.apps.open', payload: { app: 'notepad' },
            idempotencyKey: 'open-notepad-once', autonomy: 'L3', confirmed: true
        }, admin);
        assert.equal(queued.ok, true);
        const duplicate = nodes.queueCommand(userId, {
            nodeId, skill: 'desktop.apps.open', payload: { app: 'notepad' },
            idempotencyKey: 'open-notepad-once', autonomy: 'L3', confirmed: true
        }, admin);
        assert.equal(duplicate.duplicate, true);
    });

    await test('Execution Engine no declara éxito sin evidencia', () => {
        const command = nodes.pullCommands(nodeId, { limit: 1 })[0];
        assert.ok(command);
        const failed = nodes.submitResult(nodeId, { commandId: command.id, result: { launched: true }, evidence: {} });
        assert.equal(failed.ok, false);
        assert.equal(failed.verification.state, 'VERIFICATION_FAILED');
    });

    await test('verificador acepta evidencia específica de app visible', () => {
        const queued = nodes.queueCommand(userId, {
            nodeId, skill: 'desktop.apps.open', payload: { app: 'calculator' },
            idempotencyKey: 'open-calculator-once', autonomy: 'L3', confirmed: true
        }, admin);
        const command = nodes.pullCommands(nodeId, { limit: 1 }).find(item => item.id === queued.command.id);
        const result = nodes.submitResult(nodeId, { commandId: command.id, result: { launched: true }, evidence: { processVisible: true } });
        assert.equal(result.ok, true);
        assert.equal(result.verification.state, 'VERIFIED');
    });

    await test('multimedia e interacción accesible requieren evidencia específica', () => {
        assert.equal(skills.verify('desktop.media.next', { evidence: { mediaCommandSent: true } }).verified, true);
        assert.equal(skills.verify('desktop.ui.inspect', { evidence: { controlsInspected: true, targetHash: 'hash' } }).verified, true);
        assert.equal(skills.verify('desktop.ui.capture_target', { evidence: { targetCaptured: true, targetHash: 'hash' } }).verified, true);
        assert.equal(skills.verify('desktop.ui.click', { evidence: { controlInvoked: true, targetHash: 'hash' } }).verified, true);
        assert.equal(skills.verify('desktop.ui.type', { evidence: { valueSet: true, targetHash: 'hash' } }).verified, true);
        assert.equal(skills.verify('desktop.ui.wait', { evidence: { targetObserved: true, targetHash: 'hash' } }).verified, true);
        assert.equal(skills.verify('desktop.ui.scroll', { evidence: { scrollChanged: true, targetHash: 'hash' } }).verified, true);
        assert.equal(skills.verify('desktop.ui.hotkey', { evidence: { shortcutSent: true, targetHash: 'hash' } }).verified, true);
        assert.equal(skills.verify('desktop.ui.select_file', { evidence: { fileSelected: true, pathHash: 'hash' } }).verified, true);
        assert.equal(skills.verify('mobile.files.list', { evidence: { folderRead: true } }).verified, true);
        assert.equal(skills.verify('mobile.files.search', { evidence: { searchCompleted: true } }).verified, true);
        assert.equal(skills.verify('mobile.files.open', { evidence: { fileOpened: true } }).verified, true);
        assert.equal(skills.verify('mobile.files.open', { evidence: { opened: true } }).verified, false);
        assert.equal(skills.verify('desktop.ui.type', { evidence: { valueSet: true } }).verified, false);
    });

    await test('Brain Core conserva transiciones y policy', () => {
        const planned = brain.plan(userId, { skill: 'tasks.create', intent: 'crear tarea', confirmed: true, autonomy: 'L3' }, admin);
        assert.equal(planned.ok, true);
        assert.equal(planned.run.state, 'authorized');
        const invalid = brain.transition(planned.run.taskId, 'verified', {}, admin);
        assert.equal(invalid.ok, false);
        assert.equal(invalid.error, 'invalid_state_transition');
    });

    await test('flujos multipaso avanzan solo con evidencia y confirmación', () => {
        const input = {
            title: 'Preparar y registrar seguimiento', objective: 'Revisar agenda y crear la tarea de seguimiento',
            idempotencyKey: 'flow-control-1',
            steps: [
                { skill: 'agenda.list', input: { scope: 'today' } },
                { skill: 'tasks.create', input: { title: 'Seguimiento QA' }, autonomy: 'L3' }
            ]
        };
        const created = workflows.create(userId, input, admin);
        assert.equal(created.ok, true, JSON.stringify(created));
        assert.equal(created.workflow.status, 'READY');
        assert.equal(workflows.create(userId, input, admin).duplicate, true);

        const first = workflows.claim(userId, created.workflow.workflowId, { executorId: 'qa-web' }, admin);
        assert.equal(first.ok, true);
        const firstResult = workflows.submitResult(userId, created.workflow.workflowId, {
            stepId: first.step.stepId, leaseId: first.step.lease.leaseId,
            result: { events: [] }, evidence: { verified: true }
        }, admin);
        assert.equal(firstResult.ok, true);
        assert.equal(firstResult.workflow.status, 'WAITING_CONFIRMATION');
        assert.equal(workflows.claim(userId, created.workflow.workflowId, {}, admin).error, 'confirmation_required');

        const authorized = workflows.action(userId, created.workflow.workflowId, { action: 'authorize', confirmed: true }, admin);
        assert.equal(authorized.workflow.status, 'READY');
        assert.equal(workflows.action(userId, created.workflow.workflowId, { action: 'pause' }, admin).workflow.status, 'PAUSED');
        assert.equal(workflows.action(userId, created.workflow.workflowId, { action: 'resume' }, admin).workflow.status, 'READY');
        const second = workflows.claim(userId, created.workflow.workflowId, { executorId: 'qa-web' }, admin);
        const secondResult = workflows.submitResult(userId, created.workflow.workflowId, {
            stepId: second.step.stepId, leaseId: second.step.lease.leaseId,
            result: { created: true }, evidence: { persistedId: 'task_qa_1' }
        }, admin);
        assert.equal(secondResult.ok, true);
        assert.equal(secondResult.workflow.status, 'COMPLETED');
        assert.equal(secondResult.workflow.evidence.length, 2);
    });

    await test('lease vencido en una escritura no repite efectos sin revisión explícita', () => {
        const created = workflows.create(userId, {
            objective: 'Agendar un evento con recuperación segura', idempotencyKey: 'flow-unknown-outcome-1',
            steps: [{ skill: 'calendar.create', input: { title: 'Revisión de seguridad', startAt: '2026-10-01T15:00:00.000Z' }, autonomy: 'L3' }]
        }, admin);
        assert.equal(created.workflow.status, 'WAITING_CONFIRMATION');
        const authorized = workflows.action(userId, created.workflow.workflowId, { action: 'authorize', confirmed: true }, admin);
        assert.equal(authorized.workflow.status, 'READY');
        const nowMs = Date.now();
        const claimed = workflows.claim(userId, created.workflow.workflowId, { leaseMs: 15_000 }, admin, { nowMs });
        assert.equal(claimed.ok, true);

        const expired = workflows.claim(userId, created.workflow.workflowId, {}, admin, { nowMs: nowMs + 15_001 });
        assert.equal(expired.ok, false);
        assert.equal(expired.error, 'step_outcome_unknown');
        assert.equal(expired.workflow.status, 'BLOCKED');
        assert.equal(expired.workflow.steps[0].state, 'OUTCOME_UNKNOWN');
        assert.equal(expired.workflow.steps[0].attempts, 1);

        const refusedRetry = workflows.action(userId, created.workflow.workflowId, { action: 'retry' }, admin);
        assert.equal(refusedRetry.error, 'retry_confirmation_required');
        const acceptedRetry = workflows.action(userId, created.workflow.workflowId, { action: 'retry', confirmed: true }, admin);
        assert.equal(acceptedRetry.ok, true);
        assert.equal(acceptedRetry.workflow.status, 'WAITING_CONFIRMATION');
        assert.equal(acceptedRetry.workflow.steps[0].attempts, 1);

        const readFlow = workflows.create(userId, {
            objective: 'Consultar la agenda después de recuperar un lease', idempotencyKey: 'flow-read-lease-reclaim',
            steps: [{ skill: 'agenda.list', input: { scope: 'today' } }]
        }, admin);
        const readStart = Date.now();
        assert.equal(workflows.claim(userId, readFlow.workflow.workflowId, { leaseMs: 15_000 }, admin, { nowMs: readStart }).ok, true);
        const readReclaimed = workflows.claim(userId, readFlow.workflow.workflowId, {}, admin, { nowMs: readStart + 15_001 });
        assert.equal(readReclaimed.ok, true);
        assert.equal(readReclaimed.step.attempts, 2);
    });

    await test('fallo al verificar una escritura marca resultado incierto y exige doble control', () => {
        const created = workflows.create(userId, {
            objective: 'Crear una tarea verificable', idempotencyKey: 'flow-unknown-outcome-2',
            steps: [{ skill: 'tasks.create', input: { title: 'Tarea de QA' }, autonomy: 'L3' }]
        }, admin);
        const authorized = workflows.action(userId, created.workflow.workflowId, { action: 'authorize', confirmed: true }, admin);
        const claimed = workflows.claim(userId, created.workflow.workflowId, {}, admin);
        assert.equal(claimed.ok, true);
        const result = workflows.submitResult(userId, created.workflow.workflowId, {
            stepId: claimed.step.stepId, leaseId: claimed.step.lease.leaseId,
            result: { accepted: true }, evidence: {}
        }, admin);
        assert.equal(result.error, 'step_outcome_unknown');
        assert.equal(result.workflow.steps[0].state, 'OUTCOME_UNKNOWN');
        assert.equal(activity.list(userId).items.find(item => item.id === created.workflow.workflowId).retryRequiresConfirmation, true);
        assert.equal(authorized.workflow.status, 'READY');

        const failedWrite = workflows.create(userId, {
            objective: 'Crear una tarea cuando hay fallo de red', idempotencyKey: 'flow-unknown-outcome-3',
            steps: [{ skill: 'tasks.create', input: { title: 'Resultado ambiguo' }, autonomy: 'L3' }]
        }, admin);
        workflows.action(userId, failedWrite.workflow.workflowId, { action: 'authorize', confirmed: true }, admin);
        const failedWriteClaim = workflows.claim(userId, failedWrite.workflow.workflowId, {}, admin);
        const transportFailure = workflows.submitResult(userId, failedWrite.workflow.workflowId, {
            stepId: failedWriteClaim.step.stepId, leaseId: failedWriteClaim.step.lease.leaseId,
            error: 'network_timeout_after_submit'
        }, admin);
        assert.equal(transportFailure.outcomeUnknown, true);
        assert.equal(transportFailure.workflow.steps[0].state, 'OUTCOME_UNKNOWN');
    });

    await test('fallo de verificación bloquea el flujo y permite reintento explícito', () => {
        const created = workflows.create(userId, {
            objective: 'Consultar la agenda con recuperación verificable', idempotencyKey: 'flow-control-2',
            steps: [{ skill: 'agenda.list', input: { scope: 'week' } }]
        }, admin);
        const claimed = workflows.claim(userId, created.workflow.workflowId, {}, admin);
        const failed = workflows.submitResult(userId, created.workflow.workflowId, {
            stepId: claimed.step.stepId, leaseId: claimed.step.lease.leaseId, result: { events: [] }, evidence: {}
        }, admin);
        assert.equal(failed.ok, false);
        assert.equal(failed.workflow.status, 'BLOCKED');
        const retried = workflows.action(userId, created.workflow.workflowId, { action: 'retry' }, admin);
        assert.equal(retried.ok, true);
        assert.equal(retried.workflow.status, 'READY');
        const cancelled = workflows.action(userId, created.workflow.workflowId, { action: 'cancel', reason: 'fin de QA' }, admin);
        assert.equal(cancelled.workflow.status, 'CANCELLED');
    });

    await test('fallo del ejecutor queda registrado y es reintentable', () => {
        const created = workflows.create(userId, {
            objective: 'Consultar agenda aunque el adaptador falle', idempotencyKey: 'flow-control-executor-fail',
            steps: [{ skill: 'agenda.list', input: { scope: 'today' } }]
        }, admin);
        const claimed = workflows.claim(userId, created.workflow.workflowId, {}, admin);
        const reported = workflows.submitResult(userId, created.workflow.workflowId, {
            stepId: claimed.step.stepId, leaseId: claimed.step.lease.leaseId,
            error: 'adapter_temporarily_unavailable'
        }, admin);
        assert.equal(reported.ok, true);
        assert.equal(reported.executionFailed, true);
        assert.equal(reported.workflow.status, 'BLOCKED');
        assert.equal(reported.workflow.steps[0].state, 'FAILED');
        const retried = workflows.action(userId, created.workflow.workflowId, { action: 'retry' }, admin);
        assert.equal(retried.workflow.status, 'READY');
    });

    await test('actividad unificada expone progreso sin mezclar usuarios', () => {
        const own = activity.list(userId, { limit: 30 });
        assert.ok(own.items.some(item => item.type === 'workflow' && item.state === 'COMPLETED'));
        assert.ok(own.stats.verified >= 1);
        const other = activity.list('u_control_other', { limit: 30 });
        assert.equal(other.items.some(item => item.type === 'workflow'), false);
    });

    await test('bandeja social unifica canales y nunca valida un envío implícito', () => {
        socialHub.setEnabled(userId, 'whatsapp', true);
        socialHub.appendMessage(userId, { id: 'ig-1', provider: 'instagram', peerId: 'ana', peerName: 'Ana', direction: 'in', text: '¿Podemos revisar la propuesta mañana?', timestamp: '2026-08-30T15:00:00.000Z' });
        const inbox = socialHub.listConversations(userId, { whatsappMessages: [{ id: 'wa-1', direction: 'in', from: '57300111', text: 'Hola Gunter', timestamp: '2026-08-30T14:00:00.000Z' }] });
        assert.equal(inbox.items.length, 2);
        assert.equal(inbox.items.some(item => item.provider === 'whatsapp'), true);
        const insight = socialHub.insight(userId, 'instagram:ana');
        assert.equal(insight.ok, true);
        assert.equal(insight.insight.awaitingReply, true);
        assert.equal(insight.insight.suggestions.length, 3);
        const rejected = socialHub.validateSend(userId, { provider: 'whatsapp', peerId: '57300111', text: 'Respuesta' }, { whatsappStatus: { state: 'connected' } });
        assert.equal(rejected.error, 'explicit_send_confirmation_required');
        const accepted = socialHub.validateSend(userId, { provider: 'whatsapp', peerId: '57300111', text: 'Respuesta', confirmed: true, source: 'user_click' }, { whatsappStatus: { state: 'connected' } });
        assert.equal(accepted.ok, true);
        socialHub.setEnabled(userId, 'instagram', true);
        const beeperRuntime = { beeper: { paired: true, reachable: true, accounts: [{ provider: 'instagram', status: 'connected', label: 'Ana' }] } };
        const attachment = socialHub.validateSend(userId, { provider: 'instagram', peerId: 'ana', attachmentPath: 'C:\\Users\\Ana\\Downloads\\foto.png', confirmed: true, source: 'user_click' }, beeperRuntime);
        assert.equal(attachment.ok, true);
        assert.equal(path.basename(attachment.attachmentPath), 'foto.png');
    });

    await test('cuentas personales no fingen conexión sin nodo Beeper verificado', () => {
        socialHub.setEnabled(userId, 'instagram', true);
        const connection = socialHub.listConnections(userId, { whatsappStatus: { state: 'disconnected' }, beeper: { paired: false, reachable: false, live: false, accounts: [] } }).find(item => item.id === 'instagram');
        assert.equal(connection.connected, false);
        assert.equal(connection.state, 'node_required');
        assert.equal(socialHub.connectionReadiness(userId, 'instagram', { beeper: { paired: false, reachable: false, accounts: [] } }).error, 'beeper_node_required');
    });

    await test('Beeper distingue Instagram y Messenger y respeta la reconexión', () => {
        const instagram = beeperClient.normalizeAccount({ accountID: 'local-instagram_ana', network: 'Instagram', status: 'connected', user: { username: 'ana' }, bridge: { provider: 'local', type: 'instagram' } });
        const messenger = beeperClient.normalizeAccount({ accountID: 'facebook-main', network: 'Facebook Messenger', status: 'reconnect_required', user: { fullName: 'Ada' }, bridge: { provider: 'cloud', type: 'facebook' } });
        assert.equal(instagram.provider, 'instagram');
        assert.equal(messenger.provider, 'messenger');
        socialHub.setEnabled(userId, 'messenger', true);
        const runtime = { beeper: { paired: true, reachable: true, live: true, accounts: [instagram, messenger] } };
        assert.equal(socialHub.listConnections(userId, runtime).find(item => item.id === 'instagram').connected, true);
        assert.equal(socialHub.listConnections(userId, runtime).find(item => item.id === 'messenger').state, 'reconnect_required');
        assert.equal(socialHub.connectionReadiness(userId, 'messenger', runtime).error, 'beeper_reconnect_required');
    });

    await test('rutas aprendidas guardan objetivos estables, no secretos, y exigen aprobación', () => {
        const created = missions.createProcedure(userId, {
            name: 'Abrir conversaciones y enviar', consent: true, captureMode: 'web_observation', supportedNodes: ['WEB'],
            steps: [{ action: 'Abrir conversaciones', kind: 'click', nodeType: 'WEB', route: '/day.html', target: { elementId: 'open-conversations', xpath: '//button' }, payloadTemplate: { token: 'secreto', view: 'inbox' }, risk: 'local_write' }]
        }, 'tr_proc');
        assert.equal(created.ok, true);
        assert.equal(created.procedure.steps[0].target.xpath, undefined);
        assert.equal(created.procedure.steps[0].payloadTemplate.token, undefined);
        const native = missions.createProcedure(userId, {
            name: 'Completar editor', consent: true, captureMode: 'native_observation', supportedNodes: ['DESKTOP'],
            steps: [{ action: 'Escribir contenido', kind: 'ui.type', skill: 'desktop.ui.type', nodeType: 'DESKTOP', target: { app: 'notepad', window: 'Bloc de notas', name: 'Contenido', automationId: '15', controlType: 'Edit', coordinates: '20,40' }, risk: 'external_write' }]
        }, 'tr_proc_native');
        assert.equal(native.procedure.steps[0].target.automationId, '15');
        assert.equal(native.procedure.steps[0].target.controlType, 'Edit');
        assert.equal(native.procedure.steps[0].target.coordinates, undefined);
        assert.equal(native.procedure.steps[0].requiresConfirmation, true);
        assert.equal(missions.transitionProcedure(userId, created.procedure.id, 'OBSERVED', {}, 'tr_proc_2').ok, true);
        assert.equal(missions.transitionProcedure(userId, created.procedure.id, 'APPROVED', { evidence: { approved: true } }, 'tr_proc_bad').error, 'procedure_transition_invalid');
        assert.equal(missions.transitionProcedure(userId, created.procedure.id, 'SIMULATED', { evidence: { checkedSteps: 1 } }, 'tr_proc_3').ok, true);
        assert.equal(missions.transitionProcedure(userId, created.procedure.id, 'APPROVED', { evidence: { approvedByUser: true } }, 'tr_proc_4').ok, true);
    });

    await test('observabilidad persiste trace_id sin payload sensible', () => {
        const recorded = observability.record({
            trace_id: 'tr_control_test', severity: 'INFO', service: 'test', event_type: 'test.event', status: 'ok',
            metadata_redacted: { count: 1, token: 'do-not-store' }
        });
        assert.equal(recorded.ok, true);
        const row = observability.list({ traceId: 'tr_control_test' })[0];
        assert.equal(row.metadata_redacted.count, 1);
        assert.equal(row.metadata_redacted.token, undefined);
    });

    await test('incidentes correlacionan y admiten recuperación', () => {
        const first = operations.report({ code: 'NODE_OFFLINE', service: 'nodes', severity: 'WARN', nodeId });
        const second = operations.report({ code: 'NODE_OFFLINE', service: 'nodes', severity: 'WARN', nodeId });
        assert.equal(first.id, second.id);
        assert.equal(second.occurrences, 2);
        const recovered = operations.transition(first.id, 'recover', { actor: 'test' });
        assert.equal(recovered.incident.status, 'RECOVERED');
    });

    await test('revocar node invalida su credencial', () => {
        assert.equal(nodes.revoke(nodeId, { admin: true }).ok, true);
        assert.equal(nodes.authenticateToken(nodeToken), null);
    });

    await test('eliminar cuenta purga nodos, ejecuciones y memoria gobernada', () => {
        const result = privacy.purgeUser(userId);
        assert.equal(result.ok, true);
        assert.equal(nodes.list({ userId, includeRevoked: true }).length, 0);
        assert.equal(brain.list({ userId }).length, 0);
        assert.equal(workflows.list({ userId }).length, 0);
        assert.equal(knowledgeGraph.stats(userId).entities, 0);
        assert.equal(errorLearning.stats(userId).total, 0);
        assert.equal(contextGateway._load(userId).items.length, 0);
        assert.equal(entitlements.listSubscriptions().some(item => item.userId === userId), false);
        assert.equal(sync.status(userId).receipts, 0);
    });

    console.log(`═══ CONTROL PLANE: ${passed} ✓ · 0 ✗ ═══`);
})().catch(error => {
    console.error('  ✗', error.stack || error.message);
    process.exitCode = 1;
}).finally(() => {
    const resolved = path.resolve(testDir);
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (resolved.startsWith(tempRoot) && fs.existsSync(resolved)) fs.rmSync(resolved, { recursive: true, force: true });
});
