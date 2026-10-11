'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fixture, snapshot, clone, input, fireAt } = require('./event-reminders');

const settle = () => new Promise(resolve => setTimeout(resolve, 250));

function notificationsFixture() {
    const f = fixture(), timers = new Map(), windowListeners = new Map(), documentListeners = new Map();
    const elements = new Map(), toasts = [], notifications = [], publications = [], statuses = [], speech = [];
    let nextTimer = 0, channelListener;
    const subscribe = (map, name, fn) => map.set(name, [...(map.get(name) || []), fn]);
    const dispatch = (map, event) => (map.get(event.type) || []).forEach(fn => fn(event));
    function node() {
        return { style: {}, appendChild(child) {
            if (child.id) elements.set(child.id, child);
            if (child.className?.startsWith('gunter-toast ')) toasts.push(child);
        }, remove() {}, querySelector() { return { style: {}, textContent: '' }; } };
    }
    const document = { readyState: 'loading', hidden: false,
        body: node(), head: node(), createElement: node, getElementById: id => elements.get(id),
        addEventListener: (name, fn) => subscribe(documentListeners, name, fn) };
    class NotificationMock {
        static permission = 'granted';
        static async requestPermission() { throw new Error('NO_AUTOMATIC_PERMISSION'); }
        constructor(title, options) { notifications.push({ title, options }); }
    }
    f.window.addEventListener = (name, fn) => subscribe(windowListeners, name, fn);
    f.window.dispatchEvent = event => { f.emitted.push(event); dispatch(windowListeners, event); };
    f.window.Notification = NotificationMock;
    f.window.GunterStatusBus = {
        set: (key, state, meta) => statuses.push({ key, state, meta: clone(meta) }), clear() {}
    };
    f.window.GunterVoice = { speak: message => speech.push(message) };
    f.window.BroadcastChannel = class {
        constructor(name) { assert.equal(name, 'gunter-reminders-invalidation'); }
        addEventListener(name, fn) { assert.equal(name, 'message'); channelListener = fn; }
        postMessage(data) { publications.push(clone(data)); }
    };
    Object.assign(f.context, { document, Notification: NotificationMock, navigator: {},
        setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; },
        clearTimeout(id) { timers.delete(id); }, requestAnimationFrame: fn => fn() });
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/services/notifications-service.js'), 'utf8'), f.context);
    return { ...f, notificationsService: f.window.GunterNotificationsService, timers, toasts, notifications, publications, statuses, speech,
        document,
        signalWindow: (type, extra = {}) => dispatch(windowListeners, { type, ...extra }),
        signalDocument: type => dispatch(documentListeners, { type }),
        remote: ownerId => channelListener({ data: { ownerId } }),
        async tick(entry) {
            const selected = [...timers].find(([, timer]) => timer === entry);
            if (selected) timers.delete(selected[0]);
            entry.fn(); await settle();
        } };
}

async function linked(f, data = input, at = fireAt) {
    const event = await f.service.create(data);
    const reminder = await f.notificationsService.schedule({ title: event.title, fireAt: at,
        meta: { eventLink: { eventId: event.id, ownerId: 'alice', expected: snapshot(event) } } });
    await settle();
    return { event, reminder };
}
let cases = 0;
async function check(name, run) { await run(); cases++; console.log(`PASS ${name}`); }

(async () => {
    await check('linked scheduling stays local and timers notify once only after an atomic claim', async () => {
        const f = notificationsFixture(); let jobCalls = 0;
        f.window.GunterJobs = { scheduleReminder() { jobCalls++; throw new Error('UNEXPECTED_CLOUD_JOB'); } };
        const { reminder } = await linked(f);
        assert.equal(jobCalls, 0); assert.equal(f.timers.size, 1);
        assert.equal((await f.notificationsService.get(reminder.id)).id, reminder.id);
        const timer = [...f.timers.values()][0];
        assert.equal(timer.delay, 165 * 60000);
        f.advance(fireAt); await f.tick(timer);
        assert.equal(f.reminders().get(reminder.id).status, 'fired');
        assert.equal(f.toasts.length, 1); assert.equal(f.notifications.length, 1);
        await f.tick(timer);
        assert.equal(f.toasts.length, 1, 'obsolete callbacks cannot notify twice');
        assert.ok(f.publications.every(message => Object.keys(message).join() === 'ownerId'),
            'cross-tab invalidations never transmit memory or reminder contents');
    });

    await check('moving and cancelling a meeting invalidates its old armed callback', async () => {
        const f = notificationsFixture(); const { event, reminder } = await linked(f);
        const oldTimer = [...f.timers.values()][0];
        const moved = await f.service.update(event.id,
            { startAt: '2026-10-12T18:00:00Z', endAt: '2026-10-12T19:00:00Z' },
            { ownerId: 'alice', expected: snapshot(event), skipSync: true });
        await settle();
        assert.equal(f.timers.size, 1); assert.notEqual([...f.timers.values()][0], oldTimer);
        f.advance(fireAt); await f.tick(oldTimer);
        assert.equal(f.toasts.length, 0); assert.equal(f.reminders().get(reminder.id).status, 'scheduled');
        const movedTimer = [...f.timers.values()][0];
        await f.service.update(event.id, { status: 'cancelled' },
            { ownerId: 'alice', expected: snapshot(moved), skipSync: true });
        await settle(); assert.equal(f.timers.size, 0);
        f.advance('2026-10-12T17:45:00Z'); await f.tick(movedTimer);
        assert.equal(f.toasts.length, 0); assert.equal(f.notifications.length, 0);
    });

    await check('maximum timeout wakes to recheck and rearm, never to fire an early notice', async () => {
        const f = notificationsFixture();
        const { reminder } = await linked(f,
            { ...input, startAt: '2026-12-12T15:00:00Z', endAt: '2026-12-12T16:00:00Z' },
            '2026-12-12T14:45:00Z');
        const timer = [...f.timers.values()][0];
        assert.equal(timer.delay, 2 ** 31 - 1);
        f.advance('2026-11-06T08:31:23Z'); await f.tick(timer);
        assert.equal(f.reminders().get(reminder.id).status, 'scheduled');
        assert.equal(f.toasts.length, 0); assert.equal(f.timers.size, 1);
        assert.equal([...f.timers.values()][0].delay, 2 ** 31 - 1);
    });

    await check('a failed atomic claim gives a diagnostic without false audio or notification', async () => {
        const f = notificationsFixture(); const { reminder } = await linked(f);
        const timer = [...f.timers.values()][0];
        f.fake.failPutStore = 'reminders'; f.advance(fireAt);
        await f.tick(timer);
        assert.equal(f.reminders().get(reminder.id).status, 'scheduled', 'failed claim has no partial fired status');
        assert.equal(f.toasts.length, 0); assert.equal(f.notifications.length, 0); assert.equal(f.speech.length, 0);
        assert.ok(f.statuses.some(status => status.state === 'error' && status.meta?.label && status.meta?.hint),
            'existing status bus explains the failure and provides a recovery hint');
        assert.ok(f.statuses.every(status => !JSON.stringify(status).includes(reminder.title)),
            'diagnostics must not expose personal reminder content');
        assert.ok(!f.emitted.some(event => event.type === 'reminders-changed' && event.detail?.op === 'fire'),
            'a failed claim must not emit a false delivery event');
    });

    await check('local lists and rehydration exclude foreign or quarantined legacy reminders', async () => {
        const f = notificationsFixture(); const { reminder } = await linked(f);
        for (const ownerId of ['bob', 'local-user', undefined]) {
            f.reminders().set(`legacy-${ownerId}`, { ...clone(reminder), id: `legacy-${ownerId}`, ownerId });
        }
        await f.notificationsService.rehydrate();
        assert.equal(f.timers.size, 1);
        const rows = await f.notificationsService.list({ status: 'scheduled' });
        assert.deepEqual(clone(rows.map(row => row.id)), [reminder.id]);
        assert.equal(await f.notificationsService.get('legacy-bob'), null);
        assert.equal(await f.notificationsService.get('legacy-undefined'), null);
        await assert.rejects(f.notificationsService.cancel('legacy-bob'), /Reminder no encontrado/);
        assert.equal(f.reminders().get('legacy-bob').status, 'scheduled');
    });

    await check('linked reminders do not arm when their event service is unavailable', async () => {
        const f = notificationsFixture(); const { reminder } = await linked(f);
        delete f.window.GunterEventsService;
        await f.notificationsService.rehydrate();
        assert.equal(f.timers.size, 0); assert.equal(f.reminders().get(reminder.id).status, 'scheduled');
        await assert.rejects(f.notificationsService.schedule({ title: input.title, fireAt,
            meta: { eventLink: { eventId: 'missing' } } }), /LINKED_REMINDER_SERVICE_UNAVAILABLE/);
        assert.equal(f.toasts.length, 0);
    });

    await check('cross-tab invalidation and account changes refresh or stop local timers safely', async () => {
        const f = notificationsFixture(); const { reminder } = await linked(f);
        const oldTimer = [...f.timers.values()][0], publications = f.publications.length;
        f.reminders().get(reminder.id).status = 'cancelled';
        f.remote('alice'); await settle();
        assert.equal(f.timers.size, 0); assert.equal(f.publications.length, publications,
            'received invalidation must not echo forever');
        f.advance(fireAt); await f.tick(oldTimer); assert.equal(f.toasts.length, 0);
        f.reminders().get(reminder.id).status = 'scheduled';
        await f.notificationsService.rehydrate(); assert.equal(f.timers.size, 1);
        f.window.localStorage.setItem('gunter_device_user', 'bob');
        f.signalWindow('storage', { key: 'gunter_device_user' }); await settle();
        assert.equal(f.timers.size, 0);
        assert.deepEqual(clone(await f.notificationsService.list()), []);
        await assert.rejects(f.notificationsService.get(reminder.id), /REMINDER_ACCOUNT_CHANGED/);
        assert.equal(f.toasts.length, 0);
    });

    await check('independent reminders preserve existing durable server scheduling', async () => {
        const f = notificationsFixture(); await f.service.create(input);
        let calls = 0;
        f.window.GunterJobs = { async scheduleReminder(params) {
            calls++; assert.equal(params.title, 'Llamar a soporte'); assert.equal(params.runAt, fireAt);
            return { id: 'job_independent', type: 'reminder', title: params.title, runAt: params.runAt, status: 'scheduled' };
        } };
        const reminder = await f.notificationsService.schedule({ title: 'Llamar a soporte', fireAt });
        await settle(); assert.equal(calls, 1); assert.equal(reminder.durable, true);
        assert.equal(f.timers.size, 0); assert.equal(f.reminders().size, 0);
    });

    console.log(`event-reminder-notifications: ${cases} focused timer/invalidation/privacy cases PASS`);
})().catch(error => { console.error(error); process.exitCode = 1; });
