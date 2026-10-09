const os = require('os');
const { GunterApiClient } = require('./lib/api-client');
const configStore = require('./lib/config-store');
const executors = require('./lib/executors');
const { BeeperBridge } = require('./lib/beeper-bridge');

class GunterNodeRuntime {
    constructor(config = configStore.load(), options = {}) {
        if (!config.nodeToken || !config.nodeId || !config.serverUrl) throw new Error('gunter_node_not_paired');
        this.config = config;
        this.api = options.api || new GunterApiClient(config.serverUrl, config.nodeToken);
        this.execute = options.execute || executors.execute;
        this.running = false;
        this.pollTimer = null;
        this.heartbeatTimer = null;
        this.lastError = null;
        this.beeper = options.beeper || new BeeperBridge(config.beeperToken, {
            onSnapshot: snapshot => this.publish({ type: 'social.snapshot', snapshot }),
            onMessage: message => this.publish({ type: 'social.message', message })
        });
    }

    async start() {
        if (this.running) return;
        this.running = true;
        await this.beeper.start().catch(error => { this.lastError = error.code || error.message; });
        await this.heartbeat();
        await this.poll();
        this.heartbeatTimer = setInterval(() => this.heartbeat().catch(() => {}), 20000);
        this.pollTimer = setInterval(() => this.poll().catch(() => {}), 2500);
    }

    async stop() {
        this.running = false;
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.pollTimer) clearInterval(this.pollTimer);
        this.heartbeatTimer = null; this.pollTimer = null;
        this.beeper.stop();
        await this.api.heartbeat(this.heartbeatPayload('DEGRADED')).catch(() => {});
    }

    heartbeatPayload(state = 'ONLINE') {
        return {
            nodeId: this.config.nodeId, state, protocolVersion: '1.0.0', clientTime: Date.now(),
            capabilities: [
                'desktop.apps.open', 'desktop.apps.discover', 'desktop.permissions.write',
                'desktop.browser.control',
                'desktop.files.read', 'desktop.files.open', 'desktop.files.latest', 'desktop.files.list', 'desktop.files.search',
                'desktop.media.control', 'desktop.ui.inspect', 'desktop.ui.capture_target', 'desktop.ui.focus', 'desktop.ui.click', 'desktop.ui.type',
                'desktop.ui.wait', 'desktop.ui.scroll', 'desktop.ui.hotkey', 'desktop.ui.select_file',
                'social.beeper.bridge'
            ],
            health: {
                runtime: this.running, beeper: this.beeper.snapshot.reachable || !this.config.beeperToken,
                commandLoop: !this.lastError, filesystemScope: this.config.fullFilesystemAccess ? 'all' : 'standard',
                programScope: this.config.fullProgramAccess ? 'all' : 'standard'
            },
            syncCursor: this.lastError ? `error:${String(this.lastError).slice(0, 80)}` : 'clean'
        };
    }

    async heartbeat() {
        try { const result = await this.api.heartbeat(this.heartbeatPayload('ONLINE')); this.lastError = null; return result; }
        catch (error) { this.lastError = error.code || error.message; throw error; }
    }

    async poll() {
        if (!this.running || this.polling) return;
        this.polling = true;
        try {
            const payload = await this.api.pull(10);
            for (const command of payload.items || []) await this.runCommand(command);
            this.lastError = null;
        } catch (error) { this.lastError = error.code || error.message; }
        finally { this.polling = false; }
    }

    async runCommand(command) {
        try {
            const output = await this.execute(command, {
                allowedApps: this.config.allowedApps || {}, allowedFolders: this.config.allowedFolders || [],
                fullFilesystemAccess: this.config.fullFilesystemAccess === true,
                fullProgramAccess: this.config.fullProgramAccess === true,
                updatePermissions: async payload => {
                    if (payload.confirmed !== true) throw Object.assign(new Error('desktop_permission_confirmation_required'), { code: 'desktop_permission_confirmation_required' });
                    const filesystemScope = ['standard', 'all'].includes(payload.filesystemScope) ? payload.filesystemScope : 'standard';
                    const programScope = ['standard', 'all'].includes(payload.programScope) ? payload.programScope : 'standard';
                    this.config = configStore.patch({ fullFilesystemAccess: filesystemScope === 'all', fullProgramAccess: programScope === 'all', permissionsUpdatedAt: new Date().toISOString() });
                    return { result: { filesystemScope, programScope }, evidence: { permissionsUpdated: true, filesystemScope, programScope } };
                },
                beeperSync: async () => {
                    const messages = await this.beeper.syncRecent();
                    if (messages.length) await this.publish({ type: 'social.batch', messages });
                    return { result: { messages: messages.length }, evidence: { syncCompleted: true } };
                },
                beeperSend: async payload => {
                    let attachment = null;
                    if (payload.filePath) {
                        const filePath = executors.allowedPath(payload.filePath, this.config.allowedFolders || [], this.config.fullFilesystemAccess === true);
                        const stat = require('fs').statSync(filePath);
                        if (!stat.isFile()) throw Object.assign(new Error('desktop_file_not_found'), { code: 'desktop_file_not_found' });
                        attachment = { filePath };
                    }
                    const sent = await this.beeper.send(payload.chatId, payload.text, attachment);
                    return {
                        result: { pendingMessageId: sent.pendingMessageID || null },
                        evidence: { channelAccepted: true, delivered: false, attachmentUploaded: Boolean(attachment) }
                    };
                }
            });
            const reported = await this.api.result({ commandId: command.id, result: output.result || {}, evidence: output.evidence || {} });
            if (command.skill === 'desktop.permissions.update') await this.heartbeat().catch(() => {});
            return reported;
        } catch (error) {
            return this.api.result({ commandId: command.id, result: { ok: false, error: error.code || error.message }, evidence: { verified: false } }).catch(() => null);
        }
    }

    async publish(event) {
        if (!this.running) return null;
        try { return await this.api.event(event); }
        catch (error) { this.lastError = error.code || error.message; return null; }
    }
}

function descriptor(name) {
    return { nodeType: 'DESKTOP', deviceName: name || `${os.hostname()} · Gunter Node`, os: os.platform() === 'win32' ? 'Windows' : os.platform(), osVersion: os.release(), appVersion: '0.1.0', protocolVersion: '1.0.0' };
}

module.exports = { GunterNodeRuntime, descriptor };
