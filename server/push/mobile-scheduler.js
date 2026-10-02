/* Durable retries for native push wakeups; queued commands remain authoritative. */
const nodes = require('../control-plane/nodes');
const mobilePush = require('./mobile');

const DEFAULT_INTERVAL_MS = 5_000;
const MAX_BATCH = 20;
let timer = null;
let ticking = false;

async function drain(options = {}) {
    if (ticking) return { skipped: true, reason: 'already_running', processed: 0, outcomes: [] };
    if (!mobilePush.isConfigured() && !options._sender) return { skipped: true, reason: 'native_push_not_configured', processed: 0, outcomes: [] };
    ticking = true;
    const outcomes = [];
    const sender = options._sender || mobilePush.wakeNode;
    const nowMs = Number(options._nowMs) || Date.now();
    try {
        for (let index = 0; index < Math.max(1, Math.min(Number(options._limit) || MAX_BATCH, 100)); index += 1) {
            const claimed = nodes.claimNextPushWakeup({ nowMs: options._nowMs });
            if (!claimed) break;
            let result;
            try { result = await sender(claimed.nodeId, claimed.commandId); }
            catch { result = { delivered: false, reason: 'native_push_delivery_failed' }; }
            const saved = nodes.finishPushWakeup(claimed.commandId, result, { nowMs: options._nowMs });
            outcomes.push({ commandId: claimed.commandId, delivered: result?.delivered === true, state: saved.pushWakeup?.state || null });
        }
        return { skipped: false, processed: outcomes.length, outcomes, nowMs };
    } finally { ticking = false; }
}

function notifyCommand() {
    setImmediate(() => drain().catch(() => null));
}

function start({ intervalMs = DEFAULT_INTERVAL_MS } = {}) {
    if (timer) return;
    const delay = Math.max(1_000, Number(intervalMs) || DEFAULT_INTERVAL_MS);
    timer = setInterval(() => drain().catch(() => null), delay);
    timer.unref?.();
    setTimeout(() => drain().catch(() => null), 250).unref?.();
}

function stop() { if (timer) clearInterval(timer); timer = null; }

module.exports = { drain, notifyCommand, start, stop, _state: () => ({ running: ticking, scheduled: Boolean(timer) }) };
