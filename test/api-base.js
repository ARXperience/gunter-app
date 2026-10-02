const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'config.js'), 'utf8');
function resolve(location, override) {
    const window = { location, __GUNTER_API_BASE__: override };
    vm.runInNewContext(source, { window, console: { log() {}, warn() {} } });
    return window.GUNTER_CONFIG.PROXY_BASE_URL;
}

assert.equal(resolve({ protocol: 'http:', hostname: '127.0.0.1', origin: 'http://127.0.0.1:50187' }), 'http://127.0.0.1:50187');
assert.equal(resolve({ protocol: 'https:', hostname: 'gunter.example', origin: 'https://gunter.example' }), 'https://gunter.example');
assert.equal(resolve({ protocol: 'file:', hostname: '', origin: 'null' }), 'http://localhost:3001');
assert.equal(resolve({ protocol: 'http:', hostname: 'app.example', origin: 'https://app.example' }, 'https://api.example/v1/'), 'https://api.example/v1');

console.log('API base: same-origin HTTP(S), file fallback and explicit override passed.');
