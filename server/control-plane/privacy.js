/* Cross-store privacy cleanup for account deletion. Exact user targets only. */
const nodes = require('./nodes');
const brain = require('./brain');
const entitlements = require('./entitlements');
const contextGateway = require('./context-gateway');
const knowledgeGraph = require('./knowledge-graph');
const errorLearning = require('./error-learning');
const sync = require('./sync');
const workflows = require('./workflows');
const beeperClient = require('./beeper-client');

function purgeUser(userId) {
    if (!userId) return { ok: false, error: 'user_id_required' };
    const result = {
        nodes: nodes.purgeUser(userId),
        brainRuns: brain.purgeUser(userId),
        workflows: workflows.purgeUser(userId),
        beeper: beeperClient.unpair(userId),
        commerce: entitlements.purgeUser(userId)
    };
    contextGateway.purge(userId);
    knowledgeGraph.purge(userId);
    errorLearning.purge(userId);
    sync.purge(userId);
    return { ok: true, result };
}

module.exports = { purgeUser };
