'use strict';
// Focused DOM/VM checks for the existing Day controller. No browser, network or models.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/controllers/day-controller.js'), 'utf8');
const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const turn = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function emitter(object = {}) {
    const listeners = new Map();
    return Object.assign(object, {
        addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
        removeEventListener(name, fn) { listeners.set(name, (listeners.get(name) || []).filter(item => item !== fn)); },
        async fire(name, event = {}) {
            event.target ||= this; event.currentTarget ||= this; event.preventDefault ||= () => {};
            await Promise.all((listeners.get(name) || []).map(fn => fn(event)));
            if (this.parentElement) await this.parentElement.fire(name, event);
        },
        dispatchEvent(event) { void this.fire(event.type, event); }
    });
}
const unescape = text => String(text).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function element(id = '') {
    const node = emitter({ id, value: '', disabled: false, hidden: false, dataset: {}, style: {}, children: [], attributes: {},
        focus() {}, setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return this.attributes[name] ?? null; },
        removeAttribute(name) { delete this.attributes[name]; },
        classList: { add() {}, remove() {}, toggle() {} },
        querySelectorAll(selector) { return this.children.filter(item => matches(item, selector)); },
        querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
        contains(target) { return target === this || this.children.includes(target); }
    });
    let markup = '', text = '';
    Object.defineProperties(node, {
        innerHTML: { get: () => markup, set(value) {
            markup = String(value); text = ''; node.children = [];
            for (const match of markup.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
                const child = element(); child.tagName = match[1].toUpperCase(); child.parentElement = node;
                for (const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) {
                    const name = attr[1], value = unescape(attr[2] || ''); child.attributes[name] = value;
                    if (name.startsWith('data-')) child.dataset[name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
                    if (name === 'disabled') child.disabled = true;
                }
                child.textContent = unescape(match[3].replace(/<[^>]*>/g, ''));
                child.closest = selector => matches(child, selector) ? child : matches(node, selector) ? node : null;
                node.children.push(child);
            }
        } },
        textContent: { get: () => text || unescape(markup.replace(/<[^>]*>/g, '')), set(value) { text = String(value); markup = ''; node.children = []; } }
    });
    return node;
}
function matches(node, selector) {
    if (selector.startsWith('#')) return node.id === selector.slice(1);
    const attrs = [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
    if (attrs.length) return attrs.every(([, key, value]) => key in node.attributes && (value === undefined || node.attributes[key] === value));
    return selector.toUpperCase() === node.tagName;
}
const baseItem = (id, status = 'scheduled', extra = {}) => ({ id, ownerId: 'alice', type: 'reminder', title: `Aviso ${id}`,
    fireAt: '2026-11-12T15:30:00.000Z', runAt: '2026-11-12T15:30:00.000Z', status, durable: true,
    revision: 1, attempts: 0, priority: 'normal', updatedAt: '2026-10-12T13:00:00.000Z', ...extra });
const available = () => ({ local: { available: true }, durable: { available: true } });
function guardedDispatch(text, settings, state) {
    if (text === 'sí' || text === 'si' || text === 'confirmo') {
        assert.equal(settings.inputSource, 'text'); assert.ok(state.pending, 'confirmation must retain the exact proposal');
        const pending = state.pending; state.writes.push(clone(pending)); state.pending = null;
        const row = state.items.find(item => item.id === pending.args.id);
        if (row) { row.status = pending.toolId === 'jobs.cancel' ? 'cancelled' : 'scheduled'; row.revision++; }
        return { handled: true, intent: pending.toolId, status: 'completed', reply: 'Cambio guardado y verificado.' };
    }
    if (text === 'no') { state.pending = null; return { handled: true, status: 'cancelled', reply: 'Sin cambios.' }; }
    const retry = /reintenta|reintentar/i.test(text), cancel = /cancela|cancelar/i.test(text);
    if (retry || cancel) {
        assert.equal(settings.inputSource, 'text'); assert.equal(settings.requireReminderGuard, true);
        const row = state.items.find(item => text.includes(item.id)); assert.ok(row, 'request selects an exact ID, not the user title');
        state.pending = { toolId: retry ? 'reminder.retry' : 'jobs.cancel', actorId: state.owner, createdAt: Date.now(),
            args: { id: row.id, targetId: row.id, ownerId: state.owner, requireReminderGuard: true, expected: clone(row), snapshot: clone(row) } };
        return { handled: true, intent: state.pending.toolId, status: 'awaiting_confirmation', requiresConfirmation: true,
            reply: `Confirma el cambio de ${row.title}.` };
    }
    return { handled: true, intent: 'assistant.inspect', status: 'completed', reply: 'Estado: fallido. No pude confirmar una causa conocida.' };
}
function environment(options = {}) {
    const ids = ['gday-reminders-mount', 'gday-reminder-filter', 'gday-refresh-reminders', 'gday-reminders-status',
        'gday-reminder-detail', 'gday-reminder-detail-text', 'gday-reminder-confirm-actions', 'gday-reminder-confirm',
        'gday-reminder-reject', 'gday-reminder-close', 'gday-reminder-more'];
    const elements = Object.fromEntries(ids.map(id => [id, element(id)]));
    elements['gday-reminder-filter'].value = 'active'; elements['gday-reminder-detail'].hidden = true;
    const state = { owner: options.owner === undefined ? 'alice' : options.owner, trusted: options.trusted !== false,
        device: options.owner === undefined ? 'alice' : options.owner, items: clone(options.items || []),
        sources: clone(options.sources || available()), limited: !!options.limited, reads: [], cancels: [], dispatches: [],
        writes: [], permissionRequests: 0, pending: null };
    const document = emitter({ readyState: 'loading', getElementById: id => elements[id] || null,
        querySelectorAll: () => [], querySelector: () => null, createElement: tag => Object.assign(element(), { tagName: tag.toUpperCase() }) });
    const localStorage = { getItem: key => key === 'gunter_device_user' ? state.device : null };
    const window = emitter({ localStorage, GunterAuth: { canAccessLocalData: () => state.trusted,
        isVerified: () => state.trusted, getUser: () => state.owner ? { id: state.owner } : null },
        GunterPresence: { timezone: () => 'America/Bogota' } });
    window.GunterJobs = { retryReminder: () => assert.fail('view must reuse the tools, not write directly'),
        cancelReminder: () => assert.fail('view must reuse the tools, not write directly') };
    window.GunterNotificationsService = {
        async listSnapshot() {
            state.reads.push(state.owner);
            return options.read ? options.read(state) : { ownerId: state.owner, items: clone(state.items), sources: clone(state.sources), limited: state.limited };
        },
        async get(id) { return options.get ? options.get(id, state) : clone(state.items.find(item => item.id === id) || null); },
        async cancel(id, guard) { state.cancels.push({ id, guard: clone(guard) }); if (options.cancel) return options.cancel(id, guard, state);
            const row = state.items.find(item => item.id === id); if (row) row.status = 'cancelled'; return clone(row); },
        async requestPermission() { state.permissionRequests++; throw new Error('must_not_request_permission'); },
        async enablePush() { throw new Error('must_not_enable_push'); }, showToast() {}
    };
    window.GunterAssistantTools = {
        getPending: () => clone(state.pending), clearPending: () => { state.pending = null; },
        async dispatch(text, settings) {
            state.dispatches.push({ text, settings: clone(settings) });
            if (options.dispatch) return options.dispatch(text, settings, state);
            return { handled: true, status: 'completed', reply: 'Estado consultado sin errores sensibles.' };
        }
    };
    vm.runInNewContext(source, { window, document, localStorage, Intl, Date, Number, Math, Promise, JSON,
        console, navigator: {}, CustomEvent: class { constructor(type, { detail = {} } = {}) { this.type = type; this.detail = detail; } },
        setTimeout: fn => { fn(); return 1; }, clearTimeout() {}, setInterval() {}, clearInterval() {} });
    const api = window.GunterDayController;
    return { elements, state, window, document, api,
        init: async () => { api.initRemindersView(); await api.renderReminders(); await turn(); },
        render: async () => { await api.renderReminders(); await turn(); },
        markup: () => elements['gday-reminders-mount'].innerHTML,
        status: () => elements['gday-reminders-status'].textContent,
        change: async value => { elements['gday-reminder-filter'].value = value; await elements['gday-reminder-filter'].fire('change'); await turn(); },
        action: async (mode, index = 0) => {
            const button = elements['gday-reminders-mount'].querySelector(`[data-rem-action="${mode}"][data-rem-index="${index}"]`);
            assert.ok(button, `missing action ${mode} at index ${index}`); await button.fire('click'); await turn();
        }, click: async id => { await elements[id].fire('click'); await turn(); }
    };
}
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`✓ ${name}`); }

(async () => {
    await check('active view unifies local and persistent reminders with real status and full local date', async () => {
        const env = environment({ items: [baseItem('persistent'), baseItem('local', 'scheduled', { durable: false }),
            baseItem('linked', 'scheduled', { durable: false, meta: { eventLink: { eventId: 'event_a' } } }),
            baseItem('retry', 'retry_wait'), baseItem('running', 'running'), baseItem('failed', 'failed'),
            baseItem('completed', 'completed')] });
        await env.init();
        for (const id of ['persistent', 'local', 'linked', 'retry', 'running']) assert.match(env.markup(), new RegExp(`Aviso ${id}`));
        for (const id of ['failed', 'completed']) assert.doesNotMatch(env.markup(), new RegExp(`Aviso ${id}`));
        assert.match(env.markup(), /persistente/i); assert.match(env.markup(), /local/i); assert.match(env.markup(), /reuni[oó]n|evento/i);
        assert.match(env.markup(), /12/); assert.match(env.markup(), /nov|11/); assert.match(env.markup(), /10:30|10:30 a/);
        assert.equal(env.state.permissionRequests, 0); assert.equal(env.state.cancels.length, 0);
    });
    await check('failed and history filters display only the selected states, without hiding other-source history', async () => {
        const env = environment({ items: [baseItem('scheduled'), baseItem('failed', 'failed'), baseItem('completed', 'completed'),
            baseItem('fired', 'fired', { durable: false }), baseItem('cancelled', 'cancelled')] });
        await env.init(); await env.change('failed');
        assert.match(env.markup(), /Aviso failed/); assert.doesNotMatch(env.markup(), /Aviso scheduled|Aviso completed|Aviso fired|Aviso cancelled/);
        await env.change('history');
        for (const id of ['completed', 'fired', 'cancelled']) assert.match(env.markup(), new RegExp(`Aviso ${id}`));
        assert.doesNotMatch(env.markup(), /Aviso scheduled|Aviso failed/);
    });
    await check('all filter exposes unknown statuses read-only and does not claim delivery acknowledgement', async () => {
        const env = environment({ items: [baseItem('unknown', 'future_state'), baseItem('completed', 'completed')] });
        await env.init(); await env.change('all'); assert.match(env.markup(), /Aviso unknown/);
        const unknownActions = env.elements['gday-reminders-mount'].children.filter(node => node.dataset.remIndex === '0');
        assert.ok(unknownActions.every(node => !['retry', 'cancel'].includes(node.dataset.remAction)));
        assert.doesNotMatch(env.markup(), /recibido|le[ií]do|entregado correctamente/i);
    });
    await check('title markup and identifiers are escaped; raw errors, payload and failure history never leak', async () => {
        const secret = 'PRIVATE_BEARER_SECRET';
        const env = environment({ items: [baseItem('job_"<x>', 'scheduled', { title: '<img src=x onerror=steal()> & "Title"',
            payload: { message: secret }, lastError: `Authorization=${secret}`, lastFailure: { rawError: secret } })] });
        await env.init(); assert.doesNotMatch(env.markup(), /<img|Authorization=|PRIVATE_BEARER_SECRET|<x>/);
        assert.match(env.markup(), /&lt;img/); assert.match(env.markup(), /&amp;/);
    });
    await check('an unavailable source reports a partial view rather than falsely reporting no reminders', async () => {
        for (const missing of ['local', 'durable']) {
            const sources = available(); sources[missing] = { available: false, error: 'PRIVATE_INTERNAL_STACK' };
            const env = environment({ sources }); await env.init();
            assert.match(env.status(), /no.*disponible|no.*pud|parcial|sin.*conexi[oó]n|no.*cargar/i);
            assert.doesNotMatch(env.markup(), /No tienes recordatorios/i);
            assert.doesNotMatch(env.status(), /PRIVATE_INTERNAL_STACK/);
        }
    });
    await check('limited server collection is disclosed and pagination retains all loaded items', async () => {
        const env = environment({ limited: true, items: Array.from({ length: 31 }, (_, i) => baseItem(`p${String(i).padStart(3, '0')}`)) });
        await env.init(); assert.match(env.status(), /200|l[ií]mit|parcial/i);
        assert.match(env.markup(), /Aviso p000/); assert.doesNotMatch(env.markup(), /Aviso p030/);
        const more = env.elements['gday-reminders-mount'].querySelector('[data-rem-more]'); assert.ok(more);
        await more.fire('click'); await turn(); assert.match(env.markup(), /Aviso p030/);
    });
    await check('untrusted, absent and stale-device accounts do not read or show private reminders', async () => {
        for (const options of [{ trusted: false }, { owner: null }]) {
            const env = environment({ ...options, items: [baseItem('private')] }); await env.init();
            assert.equal(env.state.reads.length, 0); assert.doesNotMatch(env.markup(), /Aviso private/);
            assert.match(env.status(), /cuenta|sesi[oó]n|verificada/i);
        }
        const env = environment({ items: [baseItem('private')] }); env.state.device = 'bob'; await env.init();
        assert.equal(env.state.reads.length, 0); assert.doesNotMatch(env.markup(), /Aviso private/);
    });
    await check('foreign records from malformed snapshots are excluded and never automatically attributed', async () => {
        const foreign = baseItem('bob_private', 'scheduled', { ownerId: 'bob' });
        const env = environment({ items: [baseItem('own'), foreign] }); await env.init();
        assert.match(env.markup(), /Aviso own/); assert.doesNotMatch(env.markup(), /bob_private/);
        assert.equal(env.state.items[1].ownerId, 'bob');
    });
    await check('a late private snapshot cannot render after account changes', async () => {
        const late = deferred(); const env = environment({ read: () => late.promise });
        const rendering = env.api.renderReminders(); env.state.owner = env.state.device = 'bob';
        late.resolve({ ownerId: 'alice', items: [baseItem('alice_private')], sources: available(), limited: false });
        await rendering; await turn(); assert.doesNotMatch(env.markup(), /alice_private/);
    });
    await check('overlapping refreshes keep the newest result when responses arrive out of order', async () => {
        const old = deferred(), current = deferred(); let count = 0;
        const env = environment({ read: () => (++count === 1 ? old.promise : current.promise) });
        const first = env.api.renderReminders(), second = env.api.renderReminders();
        current.resolve({ ownerId: 'alice', items: [baseItem('newest')], sources: available(), limited: false });
        await second;
        old.resolve({ ownerId: 'alice', items: [baseItem('outdated')], sources: available(), limited: false });
        await first; assert.match(env.markup(), /Aviso newest/); assert.doesNotMatch(env.markup(), /Aviso outdated/);
    });
    await check('durable failure detail reuses assistant diagnosis and never makes a write or discloses raw failure', async () => {
        const env = environment({ items: [baseItem('job_failed', 'failed', { lastError: 'PRIVATE_INTERNAL_STACK' })], dispatch: guardedDispatch });
        await env.init(); await env.change('failed'); await env.action('detail');
        assert.equal(env.state.dispatches.length, 1); assert.match(env.state.dispatches[0].text, /job_failed/);
        assert.equal(env.state.writes.length, 0); assert.equal(env.state.cancels.length, 0);
        assert.equal(env.elements['gday-reminder-detail'].hidden, false);
        assert.doesNotMatch(env.elements['gday-reminder-detail-text'].textContent, /PRIVATE_INTERNAL_STACK/);
    });
    await check('retry creates a guarded proposal only; screen confirmation performs exactly one mutation', async () => {
        const env = environment({ items: [baseItem('job_retry', 'failed')], dispatch: guardedDispatch });
        await env.init(); await env.change('failed'); await env.action('retry');
        assert.equal(env.state.writes.length, 0); assert.ok(env.state.pending);
        assert.equal(env.elements['gday-reminder-confirm-actions'].hidden, false);
        await env.click('gday-reminder-confirm'); assert.equal(env.state.writes.length, 1);
        assert.equal(env.state.writes[0].toolId, 'reminder.retry');
        assert.equal(env.state.items[0].status, 'scheduled'); assert.equal(env.state.permissionRequests, 0);
    });
    await check('rejecting a pending reminder change leaves the existing reminder untouched', async () => {
        const env = environment({ items: [baseItem('job_retry', 'failed')], dispatch: guardedDispatch });
        await env.init(); await env.change('failed'); await env.action('retry'); await env.click('gday-reminder-reject');
        assert.equal(env.state.writes.length, 0); assert.equal(env.state.items[0].status, 'failed'); assert.equal(env.state.pending, null);
    });
    await check('confirmation refuses another chat proposal instead of authorizing the replaced action', async () => {
        const env = environment({ items: [baseItem('job_retry', 'failed')], dispatch: guardedDispatch });
        await env.init(); await env.change('failed'); await env.action('retry');
        const replacement = { toolId: 'tasks.complete', actorId: 'alice', args: { id: 'task_private' }, createdAt: Date.now() };
        env.state.pending = clone(replacement); await env.click('gday-reminder-confirm');
        assert.equal(env.state.writes.length, 0); assert.deepEqual(env.state.pending, replacement);
        assert.match(env.elements['gday-reminder-detail-text'].textContent, /cambi[oó]|otra|nueva|actual/i);
    });
    await check('an account switch clears private details and prevents stale confirmation', async () => {
        const env = environment({ items: [baseItem('job_retry', 'failed')], dispatch: guardedDispatch });
        await env.init(); await env.change('failed'); await env.action('retry');
        env.state.owner = env.state.device = 'bob';
        await env.window.fire('storage', { key: 'gunter_device_user' }); await env.click('gday-reminder-confirm');
        assert.equal(env.state.writes.length, 0); assert.doesNotMatch(env.markup(), /Aviso job_retry/);
        assert.doesNotMatch(env.elements['gday-reminder-detail-text'].textContent, /job_retry|Aviso job_retry/);
        assert.equal(env.elements['gday-reminder-confirm-actions'].hidden, true);
    });
    await check('canceling independent local and durable reminders uses the same explicit guarded tool confirmation', async () => {
        for (const durable of [false, true]) {
            const env = environment({ items: [baseItem('cancel_me', 'scheduled', { durable })], dispatch: guardedDispatch });
            await env.init(); await env.action('cancel'); assert.equal(env.state.writes.length, 0);
            await env.click('gday-reminder-confirm'); assert.equal(env.state.writes.length, 1);
            assert.equal(env.state.writes[0].toolId, 'jobs.cancel'); assert.equal(env.state.items[0].status, 'cancelled');
            assert.equal(env.state.cancels.length, 0, 'the view must not bypass the tool gate');
        }
    });
    await check('linked event reminders direct the user to their event rather than canceling an event behind the view', async () => {
        const env = environment({ items: [baseItem('linked', 'scheduled', { durable: false, meta: { eventLink: { eventId: 'event_alice' } } })], dispatch: guardedDispatch });
        await env.init(); assert.doesNotMatch(env.markup(), /data-rem-action="cancel"|data-rem-action="retry"/);
        assert.match(env.markup(), /day\.html#events|#events/); assert.equal(env.state.dispatches.length, 0);
    });
    await check('closing the view clears only its own proposal, never a newer confirmation owned by the chat', async () => {
        const env = environment({ items: [baseItem('job_retry', 'failed')], dispatch: guardedDispatch });
        await env.init(); await env.change('failed'); await env.action('retry'); await env.click('gday-reminder-close');
        assert.equal(env.state.pending, null); assert.equal(env.elements['gday-reminder-detail'].hidden, true);
        await env.action('retry');
        const replacement = { toolId: 'tasks.complete', actorId: 'alice', args: { id: 'task_private' }, createdAt: Date.now() };
        env.state.pending = clone(replacement); await env.click('gday-reminder-close');
        assert.deepEqual(env.state.pending, replacement); assert.equal(env.state.writes.length, 0);
    });
    await check('a late private action read is ignored after switching away and back to the same account', async () => {
        const late = deferred(); const row = baseItem('job_retry', 'failed');
        const env = environment({ items: [row], get: () => late.promise, dispatch: guardedDispatch });
        await env.init(); await env.change('failed'); await env.action('retry');
        env.state.owner = env.state.device = 'bob'; await env.window.fire('storage', { key: 'gunter_device_user' });
        env.state.owner = env.state.device = 'alice'; await env.window.fire('storage', { key: 'gunter_device_user' });
        late.resolve(clone(row)); await turn();
        assert.equal(env.state.dispatches.length, 0, 'a response captured before the account transition cannot create a new proposal');
        assert.equal(env.state.writes.length, 0); assert.equal(env.state.pending, null);
    });
    await check('duplicate confirmation clicks are locked while a guarded write is in flight', async () => {
        const late = deferred(); let confirmations = 0;
        const env = environment({ items: [baseItem('job_retry', 'failed')], dispatch: (text, options, state) => {
            if (/^(?:s[ií]|confirmo)$/.test(text)) { confirmations++; return late.promise; }
            return guardedDispatch(text, options, state);
        } });
        await env.init(); await env.change('failed'); await env.action('retry');
        const first = env.elements['gday-reminder-confirm'].fire('click'); await turn();
        await env.elements['gday-reminder-confirm'].fire('click'); assert.equal(confirmations, 1);
        late.resolve({ handled: true, status: 'completed', reply: 'Guardado.' }); await first;
    });
    console.log(`REMINDERS VIEW: ${passed} checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
