'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/config-settings.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '../config.html'), 'utf8');
const defaults = () => ({ respectWorkingHours: false, workingDays: [1, 2, 3, 4, 5], workStart: '09:00', workEnd: '18:00', bufferMinutes: 0 });
const turn = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function emitter(object = {}) {
    const listeners = new Map();
    return Object.assign(object, {
        addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
        async fire(name, event = {}) { await Promise.all((listeners.get(name) || []).map(fn => fn(event))); }
    });
}
function environment({ owner = 'a', trusted = true, unavailable = false, get, update, realService = false } = {}) {
    const elements = Object.fromEntries(['calendar-planning-form', 'calendar-working-hours', 'calendar-work-start',
        'calendar-work-end', 'calendar-buffer-minutes', 'calendar-planning-save', 'calendar-planning-status',
        'calendar-planning-timezone', 'calendar-planning-reload'].map(id => [id, emitter({ value: '', checked: false, disabled: true, textContent: '' })]));
    const days = Array.from({ length: 7 }, (_, day) => emitter({ value: String(day), checked: day > 0 && day < 6, disabled: true }));
    elements['calendar-planning-form'].querySelectorAll = () => days;
    const state = { owner, trusted, prefs: { a: defaults(), b: { ...defaults(), workStart: '10:00', workEnd: '17:00', bufferMinutes: 20 } }, reads: [], writes: [], storageWrites: 0 };
    const document = emitter({ readyState: 'complete', getElementById: id => elements[id] || null,
        querySelector: () => null, querySelectorAll: () => [] });
    const stored = new Map(realService ? [['gunter_prefs', JSON.stringify({ calendarPlanningByAccount: state.prefs, language: 'es-MX' })]] : []);
    const localStorage = { getItem: key => stored.get(key) || null,
        setItem: (key, value) => { state.storageWrites++; stored.set(key, value); } };
    const window = emitter({ GunterAuth: { canAccessLocalData: () => state.trusted,
        getUser: () => ({ id: state.owner }) }, GunterPresence: { timezone: () => 'America/Bogota' } });
    if (!unavailable) window.GunterEventsService = {
        getPlanningPreferences(id) { state.reads.push(id); return get ? get(id, state) : state.prefs[id]; },
        updatePlanningPreferences(patch, id, options) {
            if (JSON.stringify(options.expected) !== JSON.stringify(state.prefs[id])) throw new Error('EVENT_PLANNING_CHANGED');
            state.writes.push({ id, patch: JSON.parse(JSON.stringify(patch)) });
            if (update) return update(patch, id, state);
            state.prefs[id] = JSON.parse(JSON.stringify(patch)); return state.prefs[id];
        }
    };
    if (realService) {
        window.localStorage = localStorage;
        window.dispatchEvent = event => { void window.fire(event.type, event); };
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/services/events-service.js'), 'utf8'), {
            window, Intl, Date, Math, Number, Promise,
            indexedDB: { open: () => assert.fail('preference form must not create a database') },
            CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } }
        });
    }
    vm.runInNewContext(source, { window, document, localStorage, Intl,
        navigator: {}, location: { hash: '#premium' }, history: { replaceState() {} }, console });
    return { elements, days, state, window, document, stored,
        submit: () => elements['calendar-planning-form'].fire('submit', { preventDefault() {} }),
        change: id => elements[id].fire('change'),
        status: () => elements['calendar-planning-status'].textContent };
}
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`✓ ${name}`); }
(async () => {
    await check('real EventsService and Config boot load and persist the same owned policy without an alias or duplicate store', async () => {
        const env = environment({ realService: true }); await turn();
        assert.equal(env.state.storageWrites, 0);
        assert.equal(env.elements['calendar-planning-save'].disabled, false);
        env.elements['calendar-buffer-minutes'].value = '15'; await env.change('calendar-buffer-minutes');
        await env.submit();
        assert.equal(env.state.storageWrites, 1);
        assert.match(env.status(), /guardada/);
        const data = JSON.parse(env.stored.get('gunter_prefs'));
        assert.equal(data.calendarPlanningByAccount.a.bufferMinutes, 15);
        assert.equal(data.calendarPlanningByAccount.b.bufferMinutes, 20);
        assert.equal(data.language, 'es-MX');
        assert.equal(env.window.GunterEventsService.getPlanningPreferences('a').bufferMinutes, 15);
    });
    await check('boot reads only the verified account; defaults do not write or enable working hours', async () => {
        const env = environment(); await turn();
        assert.deepEqual(env.state.reads, ['a']); assert.equal(env.state.writes.length, 0);
        assert.equal(env.state.storageWrites, 0);
        assert.equal(env.elements['calendar-working-hours'].checked, false);
        assert.equal(env.elements['calendar-buffer-minutes'].value, '0');
        assert.equal(env.elements['calendar-planning-save'].disabled, false);
        assert.match(env.elements['calendar-planning-timezone'].textContent, /America\/Bogota/);
    });
    await check('editing is a draft; explicit Save sends all validated fields to its captured owner', async () => {
        const env = environment(); await turn();
        env.elements['calendar-working-hours'].checked = true;
        env.elements['calendar-work-start'].value = '08:30';
        env.elements['calendar-work-end'].value = '16:30';
        env.elements['calendar-buffer-minutes'].value = '15';
        env.days.forEach(day => { day.checked = [1, 3, 5].includes(Number(day.value)); });
        await env.change('calendar-work-start'); assert.equal(env.state.writes.length, 0);
        await env.submit();
        assert.deepEqual(env.state.writes, [{ id: 'a', patch: { respectWorkingHours: true,
            workingDays: [1, 3, 5], workStart: '08:30', workEnd: '16:30', bufferMinutes: 15 } }]);
        assert.match(env.status(), /guardada/);
    });
    await check('same-account preference/storage/profile events preserve unsaved draft', async () => {
        const env = environment(); await turn();
        env.elements['calendar-work-start'].value = '07:15'; await env.change('calendar-work-start');
        await env.window.fire('gunter-calendar-preferences-change');
        await env.window.fire('storage', { key: 'gunter_prefs' });
        await env.document.fire('gunter-auth-profile-changed');
        assert.equal(env.elements['calendar-work-start'].value, '07:15');
        assert.deepEqual(env.state.reads, ['a']); assert.equal(env.state.writes.length, 0);
        assert.match(env.status(), /sin guardar/);
    });
    await check('stale drafts cannot overwrite saved decisions and explicit reload recovers the current values', async () => {
        const env = environment(); await turn();
        env.elements['calendar-buffer-minutes'].value = '15'; await env.change('calendar-buffer-minutes');
        env.state.prefs.a = { ...defaults(), workEnd: '16:00' };
        await env.window.fire('storage', { key: 'gunter_prefs' });
        await env.submit();
        assert.equal(env.state.writes.length, 0);
        assert.equal(env.state.prefs.a.workEnd, '16:00');
        assert.match(env.status(), /cambiaron/);
        await env.elements['calendar-planning-reload'].fire('click'); await turn();
        assert.equal(env.elements['calendar-work-end'].value, '16:00');
        assert.equal(env.elements['calendar-buffer-minutes'].value, '0');
    });
    await check('invalid overnight, blank/fractional/oversized margins and empty working days never write', async () => {
        for (const adjust of [env => { env.elements['calendar-work-start'].value = '22:00'; env.elements['calendar-work-end'].value = '06:00'; },
            env => { env.elements['calendar-buffer-minutes'].value = ''; },
            env => { env.elements['calendar-buffer-minutes'].value = '1.5'; },
            env => { env.elements['calendar-buffer-minutes'].value = '121'; },
            env => { env.days.forEach(day => { day.checked = false; }); }]) {
            const env = environment(); await turn(); adjust(env); await env.submit();
            assert.equal(env.state.writes.length, 0); assert.match(env.status(), /Selecciona/);
        }
    });
    await check('untrusted account and absent agenda service stay disabled, without private reads', async () => {
        const env = environment({ trusted: false }); await turn();
        assert.equal(env.state.reads.length, 0); assert.equal(env.elements['calendar-planning-save'].disabled, true);
        assert.match(env.status(), /verificada/);
        env.state.trusted = true; await env.document.fire('gunter-auth-ready');
        assert.equal(env.elements['calendar-planning-save'].disabled, false);
        const missing = environment({ unavailable: true }); await turn();
        assert.equal(missing.elements['calendar-planning-save'].disabled, true); assert.match(missing.status(), /no está disponible/);
    });
    await check('switching accounts discards the old draft and loads the new account', async () => {
        const env = environment(); await turn();
        env.elements['calendar-work-start'].value = '07:00'; await env.change('calendar-work-start');
        env.state.owner = 'b'; await env.document.fire('gunter-auth-profile-changed');
        assert.equal(env.elements['calendar-work-start'].value, '10:00');
        assert.equal(env.elements['calendar-buffer-minutes'].value, '20');
        assert.equal(env.state.writes.length, 0);
    });
    await check('late private reads cannot display the previous account after an actor switch', async () => {
        const late = deferred();
        const env = environment({ get: (id, state) => id === 'a' ? late.promise : state.prefs[id] });
        env.state.owner = 'b'; await env.document.fire('gunter-auth-ready');
        late.resolve({ ...defaults(), workStart: '05:00' }); await turn();
        assert.equal(env.elements['calendar-work-start'].value, '10:00');
        assert.equal(env.elements['calendar-buffer-minutes'].value, '20');
    });
    await check('a save in flight cannot attribute the old draft to a new account or display its success', async () => {
        const late = deferred(); const env = environment({ update: () => late.promise }); await turn();
        env.elements['calendar-work-start'].value = '07:00'; await env.change('calendar-work-start');
        const saving = env.submit(); env.state.owner = 'b';
        late.resolve(defaults()); await saving; await turn();
        assert.equal(env.state.writes.length, 1); assert.equal(env.state.writes[0].id, 'a');
        assert.equal(env.elements['calendar-work-start'].value, '10:00');
        assert.doesNotMatch(env.status(), /guardada/);
    });
    await check('submitting after a silent account change only reloads; it never saves the stale draft', async () => {
        const env = environment(); await turn(); env.state.owner = 'b'; await env.submit(); await turn();
        assert.equal(env.state.writes.length, 0); assert.equal(env.elements['calendar-work-start'].value, '10:00');
    });
    await check('a late save from an earlier visit cannot consume a newer draft after switching away and back', async () => {
        const late = deferred(); const env = environment({ update: () => late.promise }); await turn();
        const saving = env.submit();
        env.state.owner = 'b'; await env.document.fire('gunter-auth-ready');
        env.state.owner = 'a'; await env.document.fire('gunter-auth-ready');
        env.elements['calendar-work-start'].value = '07:00'; await env.change('calendar-work-start');
        late.resolve(defaults()); await saving;
        assert.match(env.status(), /sin guardar/);
        await env.window.fire('storage', { key: 'gunter_prefs' });
        assert.equal(env.elements['calendar-work-start'].value, '07:00');
    });
    await check('storage failure reports honestly and preserves the draft for retry', async () => {
        const env = environment({ update: () => { throw new Error('EVENT_PLANNING_STORAGE'); } }); await turn();
        env.elements['calendar-work-start'].value = '07:00'; await env.change('calendar-work-start'); await env.submit();
        assert.match(env.status(), /anteriores se conservan/);
        assert.equal(env.elements['calendar-work-start'].value, '07:00');
        assert.equal(env.elements['calendar-planning-save'].disabled, false);
        await env.window.fire('storage', { key: 'gunter_prefs' });
        assert.equal(env.elements['calendar-work-start'].value, '07:00');
    });
    await check('unreadable preferences remain untouched and disabled', async () => {
        const env = environment({ get: () => { throw new Error('EVENT_PLANNING_CORRUPT'); } }); await turn();
        assert.match(env.status(), /No se sobrescribieron/); assert.equal(env.state.writes.length, 0);
        assert.equal(env.elements['calendar-planning-save'].disabled, true);
        await env.submit(); assert.equal(env.state.writes.length, 0);
    });
    await check('form has explicit labels, status, bounds and seven day controls in the existing AI section', async () => {
        const form = html.slice(html.indexOf('<form class="settings-card" id="calendar-planning-form"'), html.indexOf('</form>', html.indexOf('id="calendar-planning-form"')));
        for (const id of ['calendar-working-hours', 'calendar-work-start', 'calendar-work-end', 'calendar-buffer-minutes']) {
            assert.match(form, new RegExp(`label for="${id}"`));
        }
        assert.equal((form.match(/name="calendar-working-day"/g) || []).length, 7);
        assert.match(form, /min="0" max="120" step="1"/); assert.match(form, /role="status" aria-live="polite"/);
        assert.match(form, /No mueve otras reuniones/);
    });
    console.log(`CALENDAR PLANNING UI: ${passed} checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
