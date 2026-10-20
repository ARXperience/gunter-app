'use strict';

// Deliberately separate from server.js: no auth, WhatsApp, .env, database,
// API routes or account preferences are loaded for renderer-only QA.
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const assets = new Map([
    ['/js/dev/core-bio-lab.html', ['js/dev/core-bio-lab.html', 'text/html; charset=utf-8']],
    ['/js/dev/core-bio-anatomy-lab.html', ['js/dev/core-bio-anatomy-lab.html', 'text/html; charset=utf-8']],
    ['/js/dev/gunter-idle-core-anatomy.js', ['js/dev/gunter-idle-core-anatomy.js', 'text/javascript; charset=utf-8']],
    ['/js/dev/core-bio-lab.js', ['js/dev/core-bio-lab.js', 'text/javascript; charset=utf-8']],
    ['/js/components/gunter-core-forms.js', ['js/components/gunter-core-forms.js', 'text/javascript; charset=utf-8']],
    ['/js/components/gunter-idle-core.js', ['js/components/gunter-idle-core.js', 'text/javascript; charset=utf-8']]
]);

function resolveAsset(rawUrl, method = 'GET') {
    if (method !== 'GET' && method !== 'HEAD') return { status: 405 };
    let pathname;
    try { pathname = new URL(rawUrl, 'http://127.0.0.1').pathname; }
    catch { return { status: 400 }; }
    if (pathname === '/') pathname = '/js/dev/core-bio-lab.html';
    const asset = assets.get(pathname);
    return asset ? { status: 200, file: path.join(root, asset[0]), type: asset[1] } : { status: 404 };
}

function createLabServer() {
    return http.createServer(async (request, response) => {
        const asset = resolveAsset(request.url, request.method);
        const headers = {
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; media-src blob:; img-src data: blob:; connect-src 'none'; frame-ancestors 'none'"
        };
        if (asset.status !== 200) {
            if (asset.status === 405) headers.Allow = 'GET, HEAD';
            response.writeHead(asset.status, headers);
            response.end();
            return;
        }
        try {
            const body = await fs.readFile(asset.file);
            response.writeHead(200, { ...headers, 'Content-Type': asset.type, 'Content-Length': body.length });
            response.end(request.method === 'HEAD' ? undefined : body);
        } catch {
            response.writeHead(404, headers);
            response.end();
        }
    });
}

if (require.main === module) {
    const port = Number(process.argv[2] || 3013);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        console.error('Puerto de laboratorio inválido.');
        process.exitCode = 1;
    } else {
        const server = createLabServer();
        server.on('error', error => { console.error('Laboratorio: ' + error.message); process.exitCode = 1; });
        server.listen(port, '127.0.0.1', () => {
            console.log(`Laboratorio visual: http://127.0.0.1:${port}/js/dev/core-bio-lab.html`);
            console.log('Sólo seis archivos visuales; backend e integraciones desconectados.');
        });
    }
}

module.exports = { createLabServer, resolveAsset };
