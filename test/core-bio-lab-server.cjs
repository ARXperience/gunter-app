'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { resolveAsset, createLabServer } = require('../scripts/serve-core-bio-lab.cjs');

for (const url of ['/', '/js/dev/core-bio-lab.html', '/js/dev/core-bio-anatomy-lab.html',
    '/js/dev/core-bio-lab.js',
    '/js/components/gunter-core-forms.js?v200-reference-material',
    '/js/components/gunter-idle-core.js?v200-reference-material']) {
    const result = resolveAsset(url);
    assert.equal(result.status, 200, url);
    assert.ok(fs.statSync(result.file).isFile(), url);
    assert.match(result.type, /text\/(?:html|javascript)/);
}
console.log('ok 1 - only the two laboratory pages and three stable visual scripts resolve');

for (const url of ['/.env', '/server.js', '/api/auth/session', '/api/whatsapp', '/dashboard.html',
    '/service-worker.js', '/js/dev/gunter-idle-core-anatomy.js?v203-runtime-anatomy-loops',
    '/../.env', '/%2e%2e/.env', '/js/dev/%2e%2e/%2e%2e/server.js',
    '/js/dev/..%2f..%2fserver.js', '/js/components/gunter-idle-core.js/extra']) {
    assert.equal(resolveAsset(url).status, 404, url);
}
console.log('ok 2 - private files, API routes, service workers and traversal do not resolve');

assert.equal(resolveAsset('/', 'HEAD').status, 200);
for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']) {
    assert.equal(resolveAsset('/', method).status, 405, method);
}
console.log('ok 3 - only read-only GET and HEAD requests are supported');

const server = createLabServer();
assert.equal(server.listening, false);
assert.equal(server.listenerCount('request'), 1);
assert.equal(Object.keys(require.cache).some(key => /[\\/]server\.js$/.test(key)), false);
console.log('ok 4 - importing the preview creates no listener or application backend');
console.log('4 isolated laboratory server checks passed.');
