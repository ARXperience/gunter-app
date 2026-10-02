/* Runtime core embedded by the Android/iOS companion. The native bridge owns OS permissions. */
const { GunterApiClient } = require('../gunter-node/lib/api-client');
const { execute } = require('./lib/executors');

class GunterMobileRuntime {
    constructor(config, adapter, options = {}) {
        if (!config?.serverUrl || !config?.nodeId || !config?.nodeToken || !['ANDROID', 'IOS'].includes(config.nodeType)) throw new Error('gunter_mobile_not_paired');
        this.config = config; this.adapter = adapter;
        this.api = options.api || new GunterApiClient(config.serverUrl, config.nodeToken);
        this.running = false; this.lastError = null; this.pollTimer = null; this.heartbeatTimer = null;
    }
    capabilities() { return [...(this.adapter.capabilities || [])].filter(value => typeof value === 'string'); }
    heartbeatPayload(state = 'ONLINE') {
        return { nodeId: this.config.nodeId, state, protocolVersion: '1.0.0', clientTime: Date.now(), capabilities: this.capabilities(), health: { runtime: this.running, nativeBridge: true, permissions: this.adapter.permissionState?.() || 'unknown' }, syncCursor: this.lastError ? `error:${String(this.lastError).slice(0, 80)}` : 'clean' };
    }
    async start() {
        if (this.running) return; this.running = true; await this.heartbeat(); await this.poll();
        this.heartbeatTimer = setInterval(() => this.heartbeat().catch(() => {}), 20000);
        this.pollTimer = setInterval(() => this.poll().catch(() => {}), 2500);
    }
    async stop() { this.running = false; clearInterval(this.heartbeatTimer); clearInterval(this.pollTimer); this.heartbeatTimer = this.pollTimer = null; await this.api.heartbeat(this.heartbeatPayload('DEGRADED')).catch(() => {}); }
    async heartbeat() { try { const value = await this.api.heartbeat(this.heartbeatPayload()); this.lastError = null; return value; } catch (error) { this.lastError = error.code || error.message; throw error; } }
    async poll() {
        if (!this.running || this.polling) return; this.polling = true;
        try { const payload = await this.api.pull(10); for (const command of payload.items || []) await this.runCommand(command); this.lastError = null; }
        catch (error) { this.lastError = error.code || error.message; } finally { this.polling = false; }
    }
    async runCommand(command) {
        try {
            const output = await execute(command, this.adapter);
            return this.api.result({ commandId: command.id, result: output.result, evidence: output.evidence });
        } catch (error) {
            return this.api.result({ commandId: command.id, result: { ok: false, error: error.code || error.message }, evidence: { verified: false } }).catch(() => null);
        }
    }
}
module.exports = { GunterMobileRuntime };
