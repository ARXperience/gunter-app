/* Unified /api/control router. Keeps control-plane concerns out of server.js. */
const auth = require('../auth');
const path = require('path');
const userContext = require('../user-context');
const authStore = require('../auth/store');
const contracts = require('./contracts');
const flags = require('./feature-flags');
const entitlements = require('./entitlements');
const settings = require('./settings');
const nodes = require('./nodes');
const skills = require('./skills');
const brain = require('./brain');
const cortex = require('./cortex');
const missions = require('./missions');
const attention = require('./attention');
const evolution = require('./evolution');
const modelRouter = require('./model-router');
const localBrain = require('../local-brain');
const localSTT = require('../local-stt');
const observability = require('./observability');
const operations = require('./operations');
const capabilities = require('./capabilities');
const contextGateway = require('./context-gateway');
const knowledgeGraph = require('./knowledge-graph');
const errorLearning = require('./error-learning');
const privacy = require('./privacy');
const sync = require('./sync');
const workflows = require('./workflows');
const activity = require('./activity');
const socialHub = require('./social-hub');
const beeperClient = require('./beeper-client');
const mobilePush = require('../push/mobile');
const mobilePushScheduler = require('../push/mobile-scheduler');

function traceRequest(req, res, pathname) { return observability.beginRequest(req, res, pathname); }
function authenticateNodeRequest(req, pathname) { return nodes.authenticateRequest(req, pathname); }

async function handle(req, res, pathname, query = {}) {
    if (!pathname.startsWith('/api/control/')) return false;
    const route = pathname.slice('/api/control/'.length).replace(/\/+$/, '');
    const actor = actorFor(req);
    try {
        if (req.method === 'GET' && route === 'contracts') return send(res, 200, { success: true, data: contracts.catalog() });
        if (req.method === 'GET' && route === 'health') return send(res, 200, { success: true, data: healthSnapshot(actor) });
        if (req.method === 'GET' && route === 'hybrid/status') {
            const userId = targetUser(actor, query.userId);
            const local = await localBrain.health();
            const stt = await localSTT.health();
            return send(res, 200, { success: true, data: {
                ...settings.hybridStatus(userId), providers: modelRouter.hybridInventory(),
                ...local, ...stt,
                flags: Object.fromEntries(['ai.local', 'stt.local', 'tts.local', 'embeddings.local', 'hybrid.routing'].map(key => [key, flags.evaluate(key, { ...actor, userId }).enabled])),
                sync: sync.status(userId), storage: { web: 'CURRENT_STORES', sqlite: 'NOT_CONFIGURED' }
            } });
        }
        if (req.method === 'POST' && ['local-brain/start', 'local-brain/stop', 'local-brain/restart'].includes(route)) {
            if (!isAdmin(actor)) return forbidden(res);
            const action = route.slice('local-brain/'.length);
            if (action !== 'stop' && !flags.evaluate('ai.local', actor).enabled)
                return send(res, 403, { success: false, error: 'LOCAL_PROVIDER_UNAVAILABLE' });
            const result = action === 'start' ? await localBrain.start() : action === 'restart' ? await localBrain.restart() : localBrain.stop();
            return send(res, 200, { success: true, data: result });
        }
        if (req.method === 'POST' && ['local-stt/start', 'local-stt/stop', 'local-stt/restart'].includes(route)) {
            if (!isAdmin(actor)) return forbidden(res);
            const action = route.slice('local-stt/'.length);
            if (action !== 'stop' && !flags.evaluate('stt.local', actor).enabled)
                return send(res, 403, { success: false, error: 'LOCAL_STT_UNAVAILABLE' });
            const result = action === 'stop' ? localSTT.stop() : action === 'restart' ? await localSTT.restart() : await localSTT.health();
            return send(res, 200, { success: true, data: result });
        }
        if (req.method === 'POST' && route === 'hybrid/mode') {
            const body = await readBody(req);
            const userId = targetUser(actor, body.userId);
            return sendResult(res, settings.patchHybrid(userId, body));
        }
        if (req.method === 'GET' && route === 'capabilities') {
            const userId = targetUser(actor, query.userId);
            return send(res, 200, { success: true, data: capabilities.catalog(userId, { ...actor, userId }) });
        }

        if (req.method === 'POST' && route === 'context/envelope') {
            const body = await readBody(req);
            // Local service calls are also used during first-run health checks, before an owner exists.
            const userId = targetUser(actor, body.userId) || (actor.kind === 'service' ? '_local' : null);
            if (!userId) return send(res, 400, { success: false, error: 'user_id_required' });
            const denied = capabilityDenied(userId, 'core.context', actor);
            if (denied) return send(res, 403, denied);
            return sendResult(res, contextGateway.build(userId, body, { ...actor, userId }, req.gunterTraceId));
        }
        if (req.method === 'GET' && route === 'sync/status') {
            const userId = targetUser(actor, query.userId);
            const denied = capabilityDenied(userId, 'core.connection', actor); if (denied) return send(res, 403, denied);
            return send(res, 200, { success: true, data: sync.status(userId) });
        }
        if (req.method === 'POST' && route === 'sync') {
            const body = await readBody(req); const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'core.connection', actor); if (denied) return send(res, 403, denied);
            return sendResult(res, sync.applyBatch(userId, body, { ...actor, userId }));
        }

        if (req.method === 'GET' && route === 'flags') {
            const data = flags.list(actor);
            return send(res, 200, { success: true, data: { items: data, stats: flags.stats(actor) } });
        }
        if (['POST', 'PATCH'].includes(req.method) && route === 'flags') {
            if (!isAdmin(actor)) return forbidden(res);
            const body = await readBody(req);
            const result = flags.set(body.key, body, actor.userId || actor.kind);
            if (result.ok && body.key === 'ai.local' && body.state === 'off') localBrain.stop();
            return sendResult(res, result);
        }

        if (req.method === 'GET' && route === 'plans') {
            return send(res, 200, { success: true, data: { items: entitlements.listPlans({ includeInactive: isAdmin(actor) }) } });
        }
        if (['POST', 'PATCH'].includes(req.method) && route === 'plans') {
            if (!isAdmin(actor)) return forbidden(res);
            return sendResult(res, entitlements.upsertPlan(await readBody(req), actor.userId || actor.kind));
        }
        if (req.method === 'GET' && route === 'subscriptions') {
            if (!isAdmin(actor)) return forbidden(res);
            return send(res, 200, { success: true, data: { items: entitlements.listSubscriptions() } });
        }
        if (['POST', 'PATCH'].includes(req.method) && route === 'subscriptions') {
            if (!isAdmin(actor)) return forbidden(res);
            const body = await readBody(req);
            if (!authStore.findById(body.userId)) return send(res, 404, { success: false, error: 'user_not_found' });
            return sendResult(res, entitlements.setSubscription(body, actor.userId || actor.kind));
        }
        if (req.method === 'GET' && route === 'entitlements') {
            const userId = targetUser(actor, query.userId);
            if (!userId) return send(res, 400, { success: false, error: 'user_id_required' });
            return send(res, 200, { success: true, data: entitlements.snapshot(userId) });
        }
        if (req.method === 'POST' && route === 'leases') {
            const body = await readBody(req);
            const userId = targetUser(actor, body.userId);
            const node = nodes.get(body.nodeId);
            if (!node || node.userId !== userId) return send(res, 404, { success: false, error: 'node_not_found' });
            return send(res, 200, { success: true, data: entitlements.issueLease(userId, node.nodeId, body) });
        }
        if (req.method === 'GET' && route === 'billing/events') {
            if (!isAdmin(actor)) return forbidden(res);
            return send(res, 200, { success: true, data: { items: entitlements.listBillingEvents(query) } });
        }
        if (req.method === 'POST' && route === 'billing/events') {
            if (!isAdmin(actor)) return forbidden(res);
            return sendResult(res, entitlements.recordBillingEvent(await readBody(req)));
        }

        if (req.method === 'GET' && route === 'settings') {
            const userId = targetUser(actor, query.userId);
            return send(res, 200, { success: true, data: { items: settings.list(userId, { ...actor, userId }) } });
        }
        if (['POST', 'PATCH'].includes(req.method) && route === 'settings') {
            const body = await readBody(req);
            const userId = targetUser(actor, body.userId);
            return sendResult(res, settings.patch(userId, body, { ...actor, userId }));
        }

        if (req.method === 'GET' && route === 'nodes') {
            const all = isAdmin(actor) && String(query.all || '') === '1';
            const userId = all ? null : targetUser(actor, query.userId);
            return send(res, 200, { success: true, data: { items: nodes.list({ userId, includeRevoked: all }), stats: nodes.stats() } });
        }
        if (req.method === 'POST' && route === 'nodes/pairing') {
            const body = await readBody(req);
            const userId = targetUser(actor, body.userId);
            return sendResult(res, nodes.createPairing(userId, body, { ...actor, userId }));
        }
        if (req.method === 'GET' && route === 'nodes/pairing/status') {
            const userId = targetUser(actor, query.userId);
            return sendResult(res, nodes.pairingStatus(userId, String(query.pairingId || '')));
        }
        if (req.method === 'POST' && route === 'nodes/claim') {
            if (!req.gunterPairing) return send(res, 401, { success: false, error: 'pairing_auth_required' });
            return sendResult(res, nodes.claimPairing(req.gunterPairing.pairingId, await readBody(req)));
        }
        if (req.method === 'POST' && route === 'nodes/push-token') {
            if (!req.gunterNode) return send(res, 401, { success: false, error: 'node_auth_required' });
            const result = nodes.registerPushToken(req.gunterNode.nodeId, await readBody(req));
            if (result.ok) result.push.deliveryConfigured = mobilePush.isConfigured(result.push.provider);
            return sendResult(res, result);
        }
        if (req.method === 'DELETE' && route === 'nodes/push-token') {
            if (!req.gunterNode) return send(res, 401, { success: false, error: 'node_auth_required' });
            return sendResult(res, nodes.clearPushToken(req.gunterNode.nodeId));
        }
        if (req.method === 'POST' && route === 'nodes/register') {
            const body = await readBody(req);
            const userId = targetUser(actor, body.userId);
            return sendResult(res, nodes.register(userId, body, { ...actor, userId }));
        }
        if (req.method === 'POST' && route === 'nodes/heartbeat') {
            const body = await readBody(req);
            const nodeId = req.gunterNode?.nodeId || body.nodeId;
            const contextUserId = req.gunterNode?.userId || targetUser(actor, body.userId);
            return sendResult(res, nodes.heartbeat(nodeId, body, { userId: contextUserId, ip: clientIp(req) }));
        }
        if (req.method === 'POST' && route === 'nodes/rename') {
            const body = await readBody(req);
            const node = nodes.get(body.nodeId);
            if (!node) return send(res, 404, { success: false, error: 'node_not_found' });
            if (!isAdmin(actor) && node.userId !== actor.userId) return forbidden(res);
            return sendResult(res, nodes.rename(body.nodeId, node.userId, body.deviceName));
        }
        if (req.method === 'POST' && route === 'nodes/revoke') {
            const body = await readBody(req);
            return sendResult(res, nodes.revoke(body.nodeId, { userId: actor.userId, admin: isAdmin(actor) }));
        }
        if (req.method === 'POST' && route === 'events') {
            if (!req.gunterNode) return send(res, 401, { success: false, error: 'node_auth_required' });
            const body = await readBody(req);
            if (body.type === 'social.snapshot') return sendResult(res, nodes.updateIntegration(req.gunterNode.nodeId, 'beeper', body.snapshot));
            if (body.type === 'social.message') return sendResult(res, socialHub.appendMessage(req.gunterNode.userId, body.message));
            if (body.type === 'social.batch') {
                const messages = (Array.isArray(body.messages) ? body.messages : []).slice(0, 100);
                const results = messages.map(message => socialHub.appendMessage(req.gunterNode.userId, message));
                return send(res, 200, { success: true, data: { ok: true, accepted: results.filter(item => item.ok).length } });
            }
            return send(res, 400, { success: false, error: 'node_event_type_invalid' });
        }

        if (req.method === 'GET' && route === 'skills') {
            return send(res, 200, { success: true, data: { items: skills.list() } });
        }
        if (req.method === 'POST' && route === 'brain/plan') {
            const body = await readBody(req);
            const userId = targetUser(actor, body.userId);
            return sendResult(res, brain.plan(userId, { ...body, traceId: req.gunterTraceId }, { ...actor, userId }));
        }
        if (req.method === 'POST' && route === 'brain/transition') {
            const body = await readBody(req);
            return sendResult(res, brain.transition(body.taskId, body.state, body, actor));
        }
        if (req.method === 'GET' && route === 'brain/runs') {
            const userId = isAdmin(actor) && query.all === '1' ? null : targetUser(actor, query.userId);
            return send(res, 200, { success: true, data: { items: brain.list({ userId, state: query.state, limit: query.limit }), stats: brain.stats() } });
        }
        if (req.method === 'GET' && route === 'workflows') {
            const userId = targetUser(actor, query.userId);
            const denied = capabilityDenied(userId, 'core.brain', actor);
            if (denied) return send(res, 403, denied);
            return send(res, 200, { success: true, data: { items: workflows.list({ userId, status: query.status, limit: query.limit }), stats: workflows.stats(userId) } });
        }
        if (req.method === 'POST' && route === 'workflows') {
            const body = await readBody(req); const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'core.brain', actor);
            if (denied) return send(res, 403, denied);
            return sendResult(res, workflows.create(userId, { ...body, traceId: req.gunterTraceId }, { ...actor, userId }));
        }
        if (req.method === 'PATCH' && route === 'workflows') {
            const body = await readBody(req); const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'core.brain', actor);
            if (denied) return send(res, 403, denied);
            return sendResult(res, workflows.action(userId, body.workflowId, body, { ...actor, userId }));
        }
        if (req.method === 'POST' && route === 'workflows/claim') {
            const body = await readBody(req); const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'core.brain', actor);
            if (denied) return send(res, 403, denied);
            return sendResult(res, workflows.claim(userId, body.workflowId, body, { ...actor, userId }));
        }
        if (req.method === 'POST' && route === 'workflows/result') {
            const body = await readBody(req); const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'core.brain', actor);
            if (denied) return send(res, 403, denied);
            return sendResult(res, workflows.submitResult(userId, body.workflowId, body, { ...actor, userId }));
        }
        if (req.method === 'GET' && route === 'activity') {
            const userId = targetUser(actor, query.userId);
            const denied = capabilityDenied(userId, 'core.brain', actor);
            if (denied) return send(res, 403, denied);
            return send(res, 200, { success: true, data: activity.list(userId, query) });
        }

        if (req.method === 'GET' && route === 'social/connections') {
            const userId = targetUser(actor, query.userId);
            const denied = capabilityDenied(userId, 'integrations.core', actor);
            if (denied) return send(res, 403, denied);
            if (!nodes.socialSnapshot(userId)) {
                await beeperClient.refresh(userId);
                ensureBeeperLive(userId);
            }
            const runtime = socialRuntime(userId);
            return send(res, 200, { success: true, data: { items: socialHub.listConnections(userId, runtime), beeper: runtime.beeper } });
        }
        if (req.method === 'PATCH' && route === 'social/connections') {
            const body = await readBody(req); const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'integrations.core', actor);
            if (denied) return send(res, 403, denied);
            return sendResult(res, socialHub.setEnabled(userId, String(body.provider || '').toLowerCase(), body.enabled === true));
        }
        if (req.method === 'POST' && route === 'social/connect') {
            const body = await readBody(req); const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'integrations.core', actor);
            if (denied) return send(res, 403, denied);
            const provider = String(body.provider || '').toLowerCase();
            if (provider !== 'whatsapp' && !nodes.socialSnapshot(userId)) await beeperClient.refresh(userId);
            const ready = socialHub.connectionReadiness(userId, provider, socialRuntime(userId));
            if (!ready.ok) return sendResult(res, ready);
            if (provider === 'whatsapp') {
                if (!isAdmin(actor)) return forbidden(res);
                const manager = whatsappManager();
                if (!manager) return send(res, 503, { success: false, error: 'whatsapp_runtime_unavailable' });
                await manager.start();
                return send(res, 200, { success: true, data: { ok: true, connection: socialHub.listConnections(userId, socialRuntime(userId)).find(item => item.id === provider) } });
            }
            if (!nodes.socialSnapshot(userId)) ensureBeeperLive(userId);
            return send(res, 200, { success: true, data: { ok: true, connection: ready.connection } });
        }
        if (req.method === 'POST' && route === 'social/beeper/pair') {
            const body = await readBody(req); const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'integrations.core', actor);
            if (denied) return send(res, 403, denied);
            const provider = String(body.provider || '').toLowerCase();
            if (!['instagram', 'messenger'].includes(provider)) return send(res, 400, { success: false, error: 'social_provider_invalid' });
            try {
                socialHub.setEnabled(userId, provider, true);
                await beeperClient.pair(userId, body);
                ensureBeeperLive(userId);
                await syncBeeperMessages(userId, true);
                const connection = socialHub.listConnections(userId, socialRuntime(userId)).find(item => item.id === provider);
                return send(res, 200, { success: true, data: { ok: true, connection, beeper: beeperClient.snapshot(userId) } });
            } catch (error) { return sendBeeperError(res, error); }
        }
        if (req.method === 'POST' && route === 'social/beeper/unpair') {
            const body = await readBody(req); const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'integrations.core', actor);
            if (denied) return send(res, 403, denied);
            beeperClient.unpair(userId);
            socialHub.setEnabled(userId, 'instagram', false);
            socialHub.setEnabled(userId, 'messenger', false);
            return send(res, 200, { success: true, data: { ok: true } });
        }
        if (req.method === 'POST' && route === 'social/disconnect') {
            const body = await readBody(req); const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'integrations.core', actor);
            if (denied) return send(res, 403, denied);
            const provider = String(body.provider || '').toLowerCase();
            if (!socialHub.PROVIDERS[provider]) return send(res, 400, { success: false, error: 'social_provider_invalid' });
            if (provider === 'whatsapp') {
                if (!isAdmin(actor)) return forbidden(res);
                const manager = whatsappManager();
                if (manager) await manager.disconnect();
            }
            socialHub.setEnabled(userId, provider, false);
            return send(res, 200, { success: true, data: { ok: true } });
        }
        if (req.method === 'GET' && route === 'conversations') {
            const userId = targetUser(actor, query.userId);
            const denied = capabilityDenied(userId, 'gunter.inbox', actor);
            if (denied) return send(res, 403, denied);
            if (!nodes.socialSnapshot(userId)) {
                await beeperClient.refresh(userId);
                ensureBeeperLive(userId);
                await syncBeeperMessages(userId);
            }
            return send(res, 200, { success: true, data: socialHub.listConversations(userId, { whatsappMessages: whatsappMessages(query.limit), limit: query.limit }) });
        }
        if (req.method === 'GET' && route === 'conversations/insight') {
            const userId = targetUser(actor, query.userId);
            const denied = capabilityDenied(userId, 'gunter.inbox', actor);
            if (denied) return send(res, 403, denied);
            return sendResult(res, socialHub.insight(userId, String(query.threadId || ''), { whatsappMessages: whatsappMessages(200) }));
        }
        if (req.method === 'POST' && route === 'conversations/send') {
            const body = await readBody(req); const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'gunter.inbox', actor);
            if (denied) return send(res, 403, denied);
            if (!nodes.socialSnapshot(userId)) await beeperClient.refresh(userId);
            const checked = socialHub.validateSend(userId, body, socialRuntime(userId));
            if (!checked.ok) return sendResult(res, checked);
            if (checked.provider === 'whatsapp') {
                const manager = whatsappManager();
                if (!manager) return send(res, 503, { success: false, error: 'whatsapp_runtime_unavailable' });
                await manager.sendMessage(checked.peerId, checked.text);
                return send(res, 200, { success: true, data: { ok: true, provider: checked.provider, sentAt: new Date().toISOString() } });
            }
            try {
                const remote = nodes.socialSnapshot(userId);
                if (remote?.nodeId) {
                    const queued = nodes.queueCommand(userId, {
                        nodeId: remote.nodeId, skill: 'social.beeper.send',
                        payload: { provider: checked.provider, chatId: checked.peerId, text: checked.text, filePath: checked.attachmentPath || undefined },
                        idempotencyKey: `social-send:${checked.provider}:${checked.peerId}:${Date.now()}`,
                        autonomy: 'L3', confirmed: true, ttlMs: 120000, traceId: req.gunterTraceId
                    }, { ...actor, userId });
                    if (!queued.ok) return sendResult(res, queued);
                    const displayText = checked.text || `Archivo: ${path.basename(checked.attachmentPath)}`;
                    socialHub.appendMessage(userId, { id: `pending:${queued.command.id}`, provider: checked.provider, peerId: checked.peerId, peerName: body.peerName || checked.peerId, direction: 'out', text: displayText, status: 'QUEUED' });
                    return send(res, 202, { success: true, data: { ok: true, queued: true, provider: checked.provider, commandId: queued.command.id, sentAt: null } });
                }
                if (checked.attachmentPath) return send(res, 503, { success: false, error: 'beeper_attachment_requires_node' });
                const sent = await beeperClient.sendMessage(userId, checked.peerId, checked.text);
                socialHub.appendMessage(userId, { id: `beeper:${sent.pendingMessageID || Date.now()}`, provider: checked.provider, peerId: checked.peerId, peerName: body.peerName || checked.peerId, direction: 'out', text: checked.text, status: 'PENDING' });
                return send(res, 200, { success: true, data: { ok: true, provider: checked.provider, sentAt: new Date().toISOString(), pendingMessageId: sent.pendingMessageID || null } });
            } catch (error) { return sendBeeperError(res, error); }
        }

        if (req.method === 'GET' && route === 'cortex/memories') {
            const userId = targetUser(actor, query.userId);
            const denied = capabilityDenied(userId, 'cortex.basic', actor);
            if (denied) return send(res, 403, denied);
            return send(res, 200, { success: true, data: { items: cortex.search(userId, query), stats: cortex.stats(userId) } });
        }
        if (req.method === 'POST' && route === 'cortex/memories') {
            const body = await readBody(req);
            const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'cortex.basic', actor);
            if (denied) return send(res, 403, denied);
            return sendResult(res, cortex.remember(userId, body, req.gunterTraceId));
        }
        if (req.method === 'PATCH' && route === 'cortex/memories') {
            const body = await readBody(req);
            const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'cortex.basic', actor);
            if (denied) return send(res, 403, denied);
            return sendResult(res, cortex.correct(userId, body.id, body, req.gunterTraceId));
        }
        if (req.method === 'POST' && route === 'cortex/forget') {
            const body = await readBody(req);
            const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'cortex.basic', actor);
            if (denied) return send(res, 403, denied);
            return sendResult(res, cortex.forget(userId, body.id, req.gunterTraceId));
        }
        if (req.method === 'GET' && route === 'cortex/export') {
            const userId = targetUser(actor, query.userId);
            const denied = capabilityDenied(userId, 'cortex.export', actor);
            if (denied) return send(res, 403, denied);
            return send(res, 200, { success: true, data: cortex.exportAll(userId) });
        }

        if (req.method === 'GET' && route === 'graph') {
            const userId = targetUser(actor, query.userId);
            const denied = capabilityDenied(userId, 'cortex.graph', actor);
            if (denied) return send(res, 403, denied);
            return send(res, 200, { success: true, data: knowledgeGraph.search(userId, query) });
        }
        if (req.method === 'POST' && route === 'graph/entities') {
            const body = await readBody(req); const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'cortex.graph', actor); if (denied) return send(res, 403, denied);
            return sendResult(res, knowledgeGraph.upsertEntity(userId, body, req.gunterTraceId));
        }
        if (req.method === 'POST' && route === 'graph/edges') {
            const body = await readBody(req); const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'cortex.graph', actor); if (denied) return send(res, 403, denied);
            return sendResult(res, knowledgeGraph.link(userId, body, req.gunterTraceId));
        }
        if (req.method === 'DELETE' && route === 'graph/entities') {
            const body = await readBody(req); const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'cortex.graph', actor); if (denied) return send(res, 403, denied);
            return sendResult(res, knowledgeGraph.forget(userId, body.entityId));
        }

        if (req.method === 'GET' && route === 'learnings') {
            const userId = targetUser(actor, query.userId);
            const denied = capabilityDenied(userId, 'cortex.learning', actor); if (denied) return send(res, 403, denied);
            return send(res, 200, { success: true, data: { items: errorLearning.list(userId, query), stats: errorLearning.stats(userId) } });
        }
        if (req.method === 'POST' && route === 'learnings') {
            const body = await readBody(req); const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'cortex.learning', actor); if (denied) return send(res, 403, denied);
            return sendResult(res, errorLearning.capture(userId, body, req.gunterTraceId));
        }
        if (req.method === 'PATCH' && route === 'learnings') {
            const body = await readBody(req); const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'cortex.learning', actor); if (denied) return send(res, 403, denied);
            return sendResult(res, errorLearning.review(userId, { ...body, reviewedBy: actor.userId || actor.kind }));
        }
        if (req.method === 'DELETE' && route === 'learnings') {
            const body = await readBody(req); const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'cortex.learning', actor); if (denied) return send(res, 403, denied);
            return sendResult(res, errorLearning.forget(userId, body.candidateId));
        }

        if (req.method === 'GET' && route === 'missions') {
            const userId = targetUser(actor, query.userId);
            const denied = capabilityDenied(userId, 'automation.missions', actor);
            if (denied) return send(res, 403, denied);
            return send(res, 200, { success: true, data: { items: missions.listMissions(userId, query), stats: missions.stats(userId).missions } });
        }
        if (req.method === 'POST' && route === 'missions') {
            const body = await readBody(req);
            const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'automation.missions', actor);
            if (denied) return send(res, 403, denied);
            return sendResult(res, missions.createMission(userId, body, req.gunterTraceId));
        }
        if (req.method === 'PATCH' && route === 'missions') {
            const body = await readBody(req);
            const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'automation.missions', actor);
            if (denied) return send(res, 403, denied);
            return sendResult(res, missions.updateMission(userId, body.id, body, req.gunterTraceId));
        }

        if (req.method === 'GET' && route === 'procedures') {
            const userId = targetUser(actor, query.userId);
            const denied = capabilityDenied(userId, 'automation.procedures', actor);
            if (denied) return send(res, 403, denied);
            return send(res, 200, { success: true, data: { items: missions.listProcedures(userId, query), stats: missions.stats(userId).procedures } });
        }
        if (req.method === 'POST' && route === 'procedures') {
            const body = await readBody(req);
            const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'automation.procedures', actor);
            if (denied) return send(res, 403, denied);
            return sendResult(res, missions.createProcedure(userId, body, req.gunterTraceId));
        }
        if (req.method === 'PATCH' && route === 'procedures') {
            const body = await readBody(req);
            const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'automation.procedures', actor);
            if (denied) return send(res, 403, denied);
            return sendResult(res, missions.transitionProcedure(userId, body.id, body.state, body, req.gunterTraceId));
        }

        if (req.method === 'GET' && route === 'attention') {
            const userId = targetUser(actor, query.userId);
            const denied = capabilityDenied(userId, 'automation.proactive', actor);
            if (denied) return send(res, 403, denied);
            return send(res, 200, { success: true, data: { items: attention.list(userId, query) } });
        }
        if (req.method === 'POST' && route === 'attention/evaluate') {
            const body = await readBody(req);
            const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'automation.proactive', actor);
            if (denied) return send(res, 403, denied);
            return sendResult(res, attention.evaluate(userId, body));
        }
        if (req.method === 'PATCH' && route === 'attention') {
            const body = await readBody(req);
            const userId = targetUser(actor, body.userId);
            const denied = capabilityDenied(userId, 'automation.proactive', actor);
            if (denied) return send(res, 403, denied);
            return sendResult(res, attention.act(userId, body.id, body.action, body));
        }

        if (req.method === 'GET' && route === 'models') {
            return send(res, 200, { success: true, data: { items: modelRouter.inventory() } });
        }
        if (req.method === 'POST' && route === 'models/route') {
            const body = await readBody(req);
            const userId = targetUser(actor, body.userId);
            return sendResult(res, modelRouter.route(userId, body, { ...actor, userId }));
        }

        if (req.method === 'GET' && route === 'evolution') {
            if (!isAdmin(actor)) return forbidden(res);
            return send(res, 200, { success: true, data: { items: evolution.list(query), stats: evolution.stats() } });
        }
        if (req.method === 'POST' && route === 'evolution') {
            if (!isAdmin(actor)) return forbidden(res);
            const denied = capabilityDenied(actor.userId, 'evolution.skill_forge', actor);
            if (denied) return send(res, 403, denied);
            return sendResult(res, evolution.propose(await readBody(req), actor.userId || actor.kind, req.gunterTraceId));
        }
        if (req.method === 'PATCH' && route === 'evolution') {
            if (!isAdmin(actor)) return forbidden(res);
            const denied = capabilityDenied(actor.userId, 'evolution.skill_forge', actor);
            if (denied) return send(res, 403, denied);
            const body = await readBody(req);
            return sendResult(res, evolution.transition(body.id, body.state, body, actor.userId || actor.kind, req.gunterTraceId));
        }

        if (req.method === 'POST' && route === 'commands') {
            const body = await readBody(req);
            const userId = targetUser(actor, body.userId);
            const queued = nodes.queueCommand(userId, { ...body, traceId: req.gunterTraceId }, { ...actor, userId });
            if (queued.ok && !queued.duplicate && queued.command) {
                const target = nodes.get(queued.command.nodeId);
                if (target?.nodeType === 'ANDROID' && target.push?.enabled) {
                    mobilePushScheduler.notifyCommand(queued.command.id);
                }
            }
            return sendResult(res, queued);
        }
        if (req.method === 'GET' && route === 'commands') {
            const userId = isAdmin(actor) && query.all === '1' ? null : targetUser(actor, query.userId);
            return send(res, 200, { success: true, data: { items: nodes.commandList({ userId, nodeId: query.nodeId, limit: query.limit }) } });
        }
        if (req.method === 'GET' && route === 'commands/pull') {
            if (!req.gunterNode) return send(res, 401, { success: false, error: 'node_auth_required' });
            return send(res, 200, { success: true, data: { items: nodes.pullCommands(req.gunterNode.nodeId, query) } });
        }
        if (req.method === 'POST' && route === 'commands/result') {
            if (!req.gunterNode) return send(res, 401, { success: false, error: 'node_auth_required' });
            return sendResult(res, nodes.submitResult(req.gunterNode.nodeId, await readBody(req)));
        }

        if (req.method === 'GET' && route === 'operations/overview') {
            if (!isAdmin(actor)) return forbidden(res);
            scanNodeIncidents();
            return send(res, 200, { success: true, data: operationsOverview() });
        }
        if (req.method === 'GET' && route === 'operations/traces') {
            if (!isAdmin(actor)) return forbidden(res);
            return send(res, 200, { success: true, data: { items: observability.list({ limit: query.limit, traceId: query.traceId, severity: query.severity, service: query.service }), stats: observability.stats() } });
        }
        if (req.method === 'GET' && route === 'operations/incidents') {
            if (!isAdmin(actor)) return forbidden(res);
            return send(res, 200, { success: true, data: { items: operations.list(query), stats: operations.stats() } });
        }
        if (req.method === 'POST' && route === 'operations/incidents') {
            if (!isAdmin(actor)) return forbidden(res);
            const body = await readBody(req);
            return sendResult(res, operations.transition(body.incidentId, body.action, { ...body, actor: actor.userId || actor.kind, traceId: req.gunterTraceId }));
        }

        return send(res, 404, { success: false, error: `control_route_not_found:${route}` });
    } catch (error) {
        const traceId = req.gunterTraceId || observability.newTraceId();
        observability.record({
            trace_id: traceId, severity: 'HIGH', service: 'control-plane', event_type: 'control.error',
            action: `${req.method} ${route}`, status: 'failed', error_code: error.code || 'CONTROL_ERROR',
            error_fingerprint: operations.fingerprint({ code: error.code || error.message, service: 'control-plane' }),
            metadata_redacted: { message: String(error.message || error).slice(0, 220) }
        });
        operations.report({ code: error.code || 'CONTROL_ERROR', severity: 'HIGH', service: 'control-plane', summary: 'Falló una operación del Control Plane', traceId });
        return send(res, 500, { success: false, error: 'control_plane_error', traceId });
    }
}

function actorFor(req) {
    if (req.gunterNode) return { kind: 'node', userId: req.gunterNode.userId, nodeId: req.gunterNode.nodeId, role: 'node' };
    if (req.gunterPairing) return { kind: 'pairing', userId: req.gunterPairing.userId, pairingId: req.gunterPairing.pairingId, role: 'pairing' };
    const who = auth.authenticate(req);
    if (who?.kind === 'service') return { kind: 'service', userId: userContext.ownerId(), role: 'admin' };
    if (who?.kind === 'user') return { kind: 'user', userId: who.user.id, role: who.user.role, status: who.user.status };
    return { kind: 'anonymous', userId: null, role: null };
}
function targetUser(actor, requested) {
    if (requested && isAdmin(actor)) return String(requested);
    return actor.userId || userContext.ownerId();
}
function isAdmin(actor) { return actor.kind === 'service' || actor.role === 'admin'; }
function forbidden(res) { return send(res, 403, { success: false, error: 'admin_only' }); }
function capabilityDenied(userId, featureKey, actor) {
    const flag = flags.evaluate(featureKey, actor);
    if (!flag.enabled) return { success: false, error: 'feature_not_available', reason: flag.reason, featureKey };
    const entitlement = entitlements.check(userId, featureKey);
    if (!entitlement.allowed) return { success: false, error: 'entitlement_required', reason: entitlement.reason, featureKey };
    return null;
}

function healthSnapshot(actor = {}) {
    const nodeStats = nodes.stats();
    const incidentStats = operations.stats();
    const status = incidentStats.critical > 0 ? 'unhealthy' : incidentStats.high > 0 ? 'degraded' : 'ok';
    return {
        status, timestamp: new Date().toISOString(), protocolVersion: nodes.PROTOCOL_VERSION,
        contractsVersion: contracts.VERSION, features: flags.stats(actor), nodes: nodeStats.nodes,
        incidents: incidentStats, observability: observability.stats(), brain: brain.stats(), workflows: workflows.stats(actor.userId || null),
        models: { available: modelRouter.inventory().filter(item => item.available).length, total: modelRouter.inventory().length },
        capabilities: capabilities.catalog(actor.userId || userContext.ownerId(), actor).stats
    };
}

function operationsOverview() {
    let jobsStats = { total: 0, byStatus: {} };
    try { jobsStats = require('../jobs').stats(); } catch { }
    return {
        health: healthSnapshot({ kind: 'service', role: 'admin' }),
        nodes: nodes.list({ includeRevoked: true }), nodeStats: nodes.stats(),
        incidents: operations.list({ limit: 20 }), incidentStats: operations.stats(),
        traces: observability.list({ limit: 30 }), traceStats: observability.stats(),
        subscriptions: entitlements.listSubscriptions(), plans: entitlements.listPlans({ includeInactive: true }),
        featureFlags: flags.list({ kind: 'service', role: 'admin' }), jobs: jobsStats,
        skills: { total: skills.REGISTRY.length }, brain: brain.stats(), workflows: workflows.stats(), evolution: evolution.stats(),
        models: modelRouter.inventory(),
        capabilities: capabilities.catalog(userContext.ownerId(), { kind: 'service', role: 'admin' }),
        governedMemory: { graph: knowledgeGraph.stats(userContext.ownerId()), learnings: errorLearning.stats(userContext.ownerId()) }
    };
}

function scanNodeIncidents() {
    for (const node of nodes.list({ includeRevoked: false })) {
        if (node.state === 'OFFLINE') operations.report({
            code: 'NODE_OFFLINE', severity: 'WARN', service: 'nodes', nodeId: node.nodeId,
            summary: `${node.deviceName} perdió el heartbeat`, impact: 'Las acciones dirigidas a este nodo quedan pendientes.',
            suggestedAction: 'Comprueba la conexión o revoca el nodo si ya no es confiable.'
        });
        if (node.state === 'DEGRADED') operations.report({
            code: 'NODE_DEGRADED', severity: 'WARN', service: 'nodes', nodeId: node.nodeId,
            summary: `${node.deviceName} opera en modo degradado`, impact: 'Una o más capacidades no están disponibles.',
            suggestedAction: 'Revisa versión de protocolo, lease y salud local.'
        });
    }
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
            if (Buffer.byteLength(body) > 2 * 1024 * 1024) reject(Object.assign(new Error('payload_too_large'), { code: 'PAYLOAD_TOO_LARGE' }));
        });
        req.on('end', () => {
            if (!body) return resolve({});
            try { resolve(JSON.parse(body)); }
            catch { reject(Object.assign(new Error('invalid_json'), { code: 'INVALID_JSON' })); }
        });
        req.on('error', reject);
    });
}
function sendResult(res, result) {
    const status = result?.ok === false ? (result.error?.includes('not_found') ? 404 : result.error?.includes('required') ? 403 : 400) : 200;
    return send(res, status, { success: result?.ok !== false, data: result?.ok === false ? undefined : result, error: result?.ok === false ? result.error : undefined, reason: result?.reason });
}
function send(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); return true; }
function clientIp(req) { const forwarded = process.env.TRUST_PROXY === 'true' ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : ''; return forwarded || req.socket?.remoteAddress || ''; }
function whatsappManager() { try { return require('../whatsapp'); } catch { return null; } }
function whatsappStore() { try { return require('../whatsapp/message-log'); } catch { return null; } }
function whatsappMessages(limit) { try { return whatsappStore()?.getRecentMessages(Math.max(1, Math.min(Number(limit) || 200, 500))) || []; } catch { return []; } }
function socialRuntime(userId) {
    const manager = whatsappManager();
    return {
        whatsappStatus: manager?.getStatus?.() || { state: 'unavailable' },
        beeper: nodes.socialSnapshot(userId) || beeperClient.snapshot(userId)
    };
}
function ensureBeeperLive(userId) { beeperClient.ensureLive(userId, message => socialHub.appendMessage(userId, message)); }
async function syncBeeperMessages(userId, force = false) {
    try {
        const messages = await beeperClient.syncRecent(userId, { force });
        messages.forEach(message => socialHub.appendMessage(userId, message));
    } catch { /* The connection status already explains an unavailable local node. */ }
}
function sendBeeperError(res, error) {
    const code = error.code || error.message || 'beeper_request_failed';
    const status = code === 'beeper_node_offline' ? 503 : code === 'beeper_token_invalid' ? 401 : 400;
    return send(res, status, { success: false, error: code });
}

module.exports = {
    handle, traceRequest, authenticateNodeRequest, healthSnapshot, operationsOverview,
    contracts, flags, entitlements, settings, nodes, skills, brain, cortex, missions, attention,
    evolution, modelRouter, observability, operations, capabilities, contextGateway, knowledgeGraph, errorLearning, privacy, sync, workflows, activity, socialHub
};
