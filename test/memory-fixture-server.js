/* Read-only, allowlisted localhost fixture server for real IndexedDB checks. */
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const files = new Map([
    ['/test/fixtures/memory.html', ['test/fixtures/memory.html', 'text/html; charset=utf-8']],
    ['/js/services/data-repository.js', ['js/services/data-repository.js', 'text/javascript; charset=utf-8']],
    ['/js/services/conversation-memory-service.js', ['js/services/conversation-memory-service.js', 'text/javascript; charset=utf-8']],
    ['/js/services/gunter-memory.js', ['js/services/gunter-memory.js', 'text/javascript; charset=utf-8']]
]);
const port = Number(process.argv[2] || 55824);
http.createServer((request, response) => {
    const entry = files.get((request.url || '').split('?')[0]);
    if (!entry) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': entry[1], 'Cache-Control': 'no-store' });
    fs.createReadStream(path.join(root, entry[0])).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`MEMORY_FIXTURE_READY http://127.0.0.1:${port}/test/fixtures/memory.html`));
