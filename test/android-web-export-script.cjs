const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

// Runs the exact native-injected script in a synthetic JS realm; no browser/device/network.
const file = path.resolve(__dirname, '../gunter-mobile/android/app/src/main/java/com/gunter/mobile/WebExportScript.kt');
const kotlin = fs.readFileSync(file, 'utf8');
const literal = kotlin.match(/fun source\(origin: String\): String = """([\s\S]*?)"""\.trimIndent\(\)/)?.[1];
assert.ok(literal, 'native script literal is discoverable');
const ORIGIN = 'https://gunter.example';
const source = literal.replace('${JSONObject.quote(origin)}', JSON.stringify(ORIGIN));
new vm.Script(source, { filename: 'WebExportScript.production.js' });

function fixture({ origin = ORIGIN, childFrame = false, autoStart = true } = {}) {
  const messages = [], states = [], chunks = [], listeners = new Map();
  let clicks = 0, revoked = 0, nextBlob = 0;
  class URLMock extends URL {
    static createObjectURL() { return `blob:${ORIGIN}/${++nextBlob}`; }
    static revokeObjectURL() { revoked++; }
  }
  class Anchor {
    constructor(href, name) { this.href = href; this.download = name; }
    hasAttribute(name) { return name === 'download'; }
    closest() { return this; }
    click() { clicks++; }
    dispatchEvent() { clicks++; return true; }
  }
  const bridge = {
    onmessage: null,
    postMessage(raw) {
      assert.ok(raw.length < 36000, 'every outgoing message is bounded');
      const value = JSON.parse(raw); messages.push(value);
      if (value.type === 'begin' && autoStart) queueMicrotask(() => bridge.onmessage({ data: JSON.stringify({ type: 'start', id: value.id }) }));
      if (value.type === 'chunk') {
        chunks.push(Buffer.from(value.data, 'base64'));
        queueMicrotask(() => bridge.onmessage({ data: JSON.stringify({ type: 'ack', id: value.id, seq: value.seq }) }));
      }
      if (value.type === 'end') queueMicrotask(() => bridge.onmessage({ data: JSON.stringify({ type: 'prepared', id: value.id }) }));
    }
  };
  const context = { Blob, URL: URLMock, Uint8Array, Map, crypto: webcrypto, HTMLAnchorElement: Anchor, Element: Anchor,
    location: { origin }, GunterFileExport: bridge,
    btoa: value => Buffer.from(value, 'binary').toString('base64'),
    fetch: value => { assert.ok(value.startsWith('data:'), 'never fetch a remote URL'); return fetch(value); },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    document: { addEventListener(type, handler) { listeners.set(`document:${type}`, handler); } },
    addEventListener(type, handler) { listeners.set(type, handler); },
    dispatchEvent(event) { states.push(event.detail.state); }
  };
  context.window = context;
  context.top = childFrame ? {} : context;
  vm.runInNewContext(source, context);
  return { context, Anchor, bridge, messages, chunks, states, listeners, stats: () => ({ clicks, revoked }) };
}

async function until(check) {
  for (let i = 0; i < 200; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 2)); }
  throw new Error('synthetic export did not complete');
}

test('production script retains Blob after immediate URL revocation and streams ordered bounded chunks', async () => {
  const f = fixture();
  const expected = Buffer.alloc(70003, 37);
  const blob = new Blob([expected], { type: 'application/json' });
  const url = f.context.URL.createObjectURL(blob);
  new f.Anchor(url, 'gunter-backup.json').click();
  f.context.URL.revokeObjectURL(url); // Exact lifecycle used by config-settings/advanced-settings.
  await until(() => f.states.includes('prepared-not-saved'));
  assert.equal(f.messages.filter(m => m.type === 'begin').length, 1);
  assert.equal(f.messages[0].size, String(expected.length));
  assert.equal(f.messages[0].name, 'gunter-backup.json');
  assert.deepEqual(f.messages.filter(m => m.type === 'chunk').map(m => m.seq), [0, 1, 2]);
  assert.ok(f.chunks.every(chunk => chunk.length <= 24576));
  assert.deepEqual(Buffer.concat(f.chunks), expected);
  assert.deepEqual(f.stats(), { clicks: 0, revoked: 1 });
});

test('data URLs use the same protocol without sending their whole URL to native', async () => {
  const f = fixture();
  new f.Anchor('data:text/plain;base64,aG9sYQ==', 'nota.txt').click();
  await until(() => f.states.includes('prepared-not-saved'));
  assert.equal(Buffer.concat(f.chunks).toString(), 'hola');
  assert.equal(f.messages[0].size, '4');
  assert.ok(!JSON.stringify(f.messages).includes('data:text'));
});

test('detached anchor dispatchEvent used by FileSaver also exports without browser download', async () => {
  const f = fixture();
  const expected = Buffer.from('%PDF-synthetic');
  const url = f.context.URL.createObjectURL(new Blob([expected], { type: 'application/pdf' }));
  let prevented = false;
  const result = new f.Anchor(url, 'slides.pdf').dispatchEvent({ type: 'click', preventDefault() { prevented = true; } });
  f.context.URL.revokeObjectURL(url);
  await until(() => f.states.includes('prepared-not-saved'));
  assert.equal(result, false); assert.ok(prevented);
  assert.deepEqual(Buffer.concat(f.chunks), expected);
  assert.equal(f.stats().clicks, 0);
});

test('foreign origins and subframes never receive download hooks', () => {
  for (const settings of [{ origin: 'https://evil.example' }, { childFrame: true }]) {
    const f = fixture(settings);
    new f.Anchor('data:text/plain,x', 'x.txt').click();
    assert.equal(f.messages.length, 0);
    assert.equal(f.stats().clicks, 1);
  }
});

test('unknown/external Blob URLs fall through without claiming native export support', () => {
  const f = fixture();
  new f.Anchor('blob:https://evil.example/unknown', 'x.json').click();
  new f.Anchor(`${ORIGIN}/download/x.json`, 'x.json').click();
  assert.equal(f.messages.length, 0);
  assert.equal(f.stats().clicks, 2);
});

test('main-frame user anchor click prevents default, duplicate pending exports are not queued', () => {
  const f = fixture({ autoStart: false });
  const url = f.context.URL.createObjectURL(new Blob(['x'], { type: 'text/plain' }));
  let prevented = false;
  f.listeners.get('document:click')({ target: new f.Anchor(url, 'x.txt'), preventDefault() { prevented = true; } });
  new f.Anchor(url, 'second.txt').click();
  assert.ok(prevented);
  assert.equal(f.messages.filter(m => m.type === 'begin').length, 1);
  assert.ok(f.states.includes('rejected'));
});

test('pagehide cancels a pending export without transferring any bytes', () => {
  const f = fixture({ autoStart: false });
  const url = f.context.URL.createObjectURL(new Blob(['x'], { type: 'text/plain' }));
  new f.Anchor(url, 'x.txt').click();
  f.listeners.get('pagehide')();
  assert.equal(f.messages.filter(m => m.type === 'cancel').length, 1);
  assert.equal(f.chunks.length, 0);
});
