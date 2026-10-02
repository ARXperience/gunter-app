class GunterApiClient {
    constructor(serverUrl, token = null) {
        this.serverUrl = validateServerUrl(serverUrl);
        this.token = token;
    }

    async request(route, options = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeoutMs || 12000);
        try {
            const response = await fetch(`${this.serverUrl}/api/control${route}`, {
                method: options.method || 'GET', signal: controller.signal,
                headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
                body: options.body ? JSON.stringify(options.body) : undefined
            });
            const json = await response.json().catch(() => ({}));
            if (!response.ok || json.success === false) {
                const error = new Error(json.message || json.error || `http_${response.status}`);
                error.code = json.error || `HTTP_${response.status}`;
                error.status = response.status;
                throw error;
            }
            return json.data;
        } finally { clearTimeout(timer); }
    }

    claim(pairingToken, descriptor) {
        const client = new GunterApiClient(this.serverUrl, pairingToken);
        return client.request('/nodes/claim', { method: 'POST', body: descriptor });
    }
    heartbeat(body) { return this.request('/nodes/heartbeat', { method: 'POST', body }); }
    pull(limit = 10) { return this.request(`/commands/pull?limit=${encodeURIComponent(limit)}`); }
    result(body) { return this.request('/commands/result', { method: 'POST', body }); }
    event(body) { return this.request('/events', { method: 'POST', body }); }
}

function validateServerUrl(value) {
    const url = new URL(String(value || ''));
    const local = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (local || process.env.GUNTER_NODE_ALLOW_INSECURE === '1'))) {
        throw new Error('gunter_node_https_required');
    }
    return url.origin;
}

module.exports = { GunterApiClient, validateServerUrl };
