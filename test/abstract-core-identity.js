const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
let checks = 0;
function check(fn) { fn(); checks++; }
const image = 'assets/gunter/gunter-core.svg';
const assetPath = source => source.split('?')[0];
const pages = ['config.html', 'dashboard.html', 'index.html', 'meeting.html', 'new-project.html', 'results.html', 'login.html'];
for (const page of pages) {
    check(() => assert.doesNotMatch(read(page), /(?:src|href)=["']assets\/gunter\/(?:gunter-prism|gunter_transparent|gunter_default)/, `${page} has no old character image source`));
    check(() => assert.match(read(page), /assets\/gunter\/gunter-core\.svg/, `${page} exposes the shared core image`));
}
const manifest = JSON.parse(read('manifest.json'));
check(() => assert.equal(manifest.start_url, '/day.html', 'installed app opens the new entrance'));
check(() => assert.equal(manifest.id, '/dashboard.html', 'installed app identity is preserved'));
const allowedIcons = [image, 'assets/gunter/gunter-core-192.png', 'assets/gunter/gunter-core-512.png'];
check(() => assert.ok(manifest.icons.every(icon => allowedIcons.includes(assetPath(icon.src)))));
check(() => assert.ok(manifest.icons.some(icon => assetPath(icon.src) === image && icon.type === 'image/svg+xml' && icon.sizes === 'any')));
check(() => assert.ok(manifest.shortcuts.every(shortcut => shortcut.icons.every(icon => allowedIcons.includes(assetPath(icon.src))))));
for (const size of [192, 512]) {
    const source = `assets/gunter/gunter-core-${size}.png`;
    const png = fs.readFileSync(path.join(__dirname, '..', source));
    check(() => assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
    check(() => assert.equal(png.readUInt32BE(16), size));
    check(() => assert.equal(png.readUInt32BE(20), size));
    check(() => assert.ok(manifest.icons.some(icon => assetPath(icon.src) === source && icon.sizes === `${size}x${size}` && icon.type === 'image/png' && icon.purpose.includes('maskable'))));
}
check(() => assert.match(read('day.html'), /rel="apple-touch-icon" href="assets\/gunter\/gunter-core-192\.png(?:\?[^\"]+)?"/));

const listeners = new Map(), calls = [];
const ring = { style: {}, attrs: {}, setAttribute(key, value) { this.attrs[key] = value; } };
const core = { style: {}, dataset: {}, offsetWidth: 52 };
const container = { id: 'test-avatar', innerHTML: '', dataset: {}, querySelector(selector) { return selector === '.gunter-svg' ? core : selector === '.gunter-state-ring' ? ring : null; } };
const context = {
    window: { GunterParticles: { mount(node) { calls.push(node); } }, addEventListener(name, cb) { listeners.set(name, cb); }, removeEventListener(name) { listeners.delete(name); } },
    document: { getElementById: id => id === container.id ? container : null, createElement: () => ({}), head: { appendChild() {} } },
    localStorage: { getItem: () => 'zen' },
    setTimeout: () => 1, clearTimeout() {},
    requestAnimationFrame() { throw new Error('The compatibility avatar must not start a parallel render loop'); }
};
vm.createContext(context);
vm.runInContext(read('js/gunter-avatar.js'), context);
const avatar = new context.window.GunterAvatar(container.id, { size: 52 });
check(() => assert.match(container.innerHTML, /data-gunter-particles="avatar"/));
check(() => assert.match(container.innerHTML, /assets\/gunter\/gunter-core\.svg/));
check(() => assert.doesNotMatch(container.innerHTML, /gunter-(?:body|belly|face|eye|flipper|beak|outfit)/));
check(() => assert.deepEqual(calls, [core]));
avatar.setMode('podcast');
check(() => assert.equal(core.dataset.mode, 'podcast'));
avatar.setState('listening');
check(() => assert.equal(core.dataset.state, 'listening'));
check(() => assert.equal(ring.style.opacity, '0.6'));
avatar.setState('default');
check(() => assert.equal(ring.style.opacity, '0'));
avatar.playAnimation('nod', { duration: 100 });
check(() => assert.match(core.style.animation, /gunterNod 100ms/));
avatar.destroy();
check(() => assert.equal(listeners.has('themechange'), false));
check(() => assert.match(read('js/advanced-settings.js'), /id: 'minimal_penguin',[^\n]*name: 'Minimalista'/));
check(() => assert.match(read('js/services/gunter-icon-system.js'), /\['🐧', 'core'\]/));
check(() => assert.doesNotMatch(read('js/theme-manager.js'), /assets\/gunter\/(?:gunter_transparent|gunter_default)/));
check(() => assert.doesNotMatch(read('js/services/gunter-cinematic-shell.js'), /assets\/gunter\/gunter-prism/));
console.log(`Abstract core identity: ${checks} checks passed.`);
