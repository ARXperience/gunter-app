'use strict';
// Visual-shell checks only: no browser, microphone, network, model or application-data writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/services/gunter-orbit-home.js'), 'utf8');
let passed = 0;
const checks = [];
function check(name, fn) { checks.push([name, fn]); }
function emitter(object = {}) {
    const listeners = new Map();
    return Object.assign(object, {
        addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
        fire(name, detail = {}) { for (const fn of listeners.get(name) || []) fn(detail); },
        removeEventListener(name, fn) { listeners.set(name, (listeners.get(name) || []).filter(item => item !== fn)); }
    });
}
function node() {
    const classes = new Set();
    return emitter({ hidden: false, dataset: {}, attributes: {}, textContent: '',
        setAttribute(name, value) { this.attributes[name] = String(value); },
        getAttribute(name) { return this.attributes[name]; },
        classList: {
            toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
            contains(name) { return classes.has(name); }, add(name) { classes.add(name); }, remove(name) { classes.delete(name); }
        }
    });
}
function environment({ hash = '', pathname = '/day.html', companion = true, voiceControl = true, loading = false } = {}) {
    const calls = { mounts: 0, show: 0, expand: 0, voice: 0, activate: [], history: [], scroll: 0, cleared: [], permission: 0 };
    const body = node(), html = node(), tabs = node(); body.children = [];
    body.append = child => body.children.push(child);
    const selected = node(); selected.dataset.tab = 'today';
    const controls = Object.fromEntries(['[data-orbit-chat]', '[data-orbit-voice]', '[data-orbit-theme]',
        '[data-orbit-status]', '[data-orbit-voice-label]', 'time'].map(selector => [selector, node()]));
    const microphone = node(); microphone.click = () => { calls.voice++; };
    let observer = null;
    const location = { hash, pathname };
    const document = emitter({ body, documentElement: html, readyState: loading ? 'loading' : 'complete',
        getElementById(id) { return id === 'gday-tabs' ? tabs : body.children.find(child => child.id === id) || null; },
        querySelector(selector) {
            if (selector === '.gday__tab[aria-selected="true"]') return selected;
            if (selector === '[data-gunter-voice-toggle]') return voiceControl ? microphone : null;
            return null;
        },
        createElement() { const el = node(); el.querySelector = selector => controls[selector] || null; return el; }
    });
    const state = { conversation: 'idle', playback: { speaking: false }, ptt: { active: false, phase: 'off' }, wake: { active: false, mode: 'off' } };
    class Observer {
        constructor(callback) { this.callback = callback; this.connected = false; observer = this; }
        observe(target) { assert.equal(target, tabs); this.connected = true; }
        disconnect() { this.connected = false; }
    }
    const window = emitter({ MutationObserver: Observer,
        scrollTo() { calls.scroll++; },
        setInterval(fn, ms) { assert.equal(ms, 30000); calls.clock = fn; return 42; },
        clearInterval(id) { calls.cleared.push(id); },
        GunterParticles: { mount() { calls.mounts++; } },
        GunterConversationState: { getState: () => ({ value: state.conversation }) },
        GunterVoice: { getPlaybackState: () => state.playback },
        GunterSTT: { pushToTalk: { getState: () => state.ptt } },
        GunterWakeWord: { getState: () => state.wake },
        GunterPresence: { timezone: () => 'America/Bogota' },
        GunterDayTabs: { activate(id) {
            calls.activate.push(id); selected.dataset.tab = id;
            if (observer?.connected) observer.callback([]);
        } },
        GunterThemeToggle: { apply(value) { calls.theme = value; } },
        navigator: { mediaDevices: { getUserMedia() { calls.permission++; throw new Error('Visual shell must never capture'); } } }
    });
    if (companion) window.GunterCompanion = { show() { calls.show++; }, expand() { calls.expand++; } };
    // Reproduce existing router ordering: it handles hashes before the final visual shell does.
    const staticTabs = new Set(['#tasks', '#events', '#reminders', '#capture', '#chat']);
    window.addEventListener('hashchange', () => {
        if (staticTabs.has(location.hash)) window.GunterDayTabs.activate('today');
        else if (['#conversations', '#activity', '#commitments'].includes(location.hash)) window.GunterDayTabs.activate(location.hash.slice(1));
    });
    window.addEventListener('gunter-open-tab', event => window.GunterDayTabs.activate(event.detail.tab));
    const history = { state: { kept: true }, replaceState(stateValue, title, value) {
        assert.deepEqual(stateValue, this.state); calls.history.push(value); location.hash = value;
    } };
    const sandbox = { window, document, location, history, MutationObserver: Observer, queueMicrotask, Date, Intl, console };
    vm.runInNewContext(source, sandbox, { filename: 'gunter-orbit-home.js' });
    const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); assert.ok(calls.activate.length < 35, 'routing must not loop'); };
    return { window, document, location, state, calls, controls, body, html, selected, sandbox, flush,
        home: () => document.getElementById('gunter-orbit-home'), observer: () => observer,
        async navigate(nextHash) { location.hash = nextHash; window.fire('hashchange'); await flush(); }
    };
}

check('no-hash entrance mounts one home and enables its isolated viewport mode', async () => {
    const e = environment(); await e.flush();
    assert.equal(e.body.children.length, 1); assert.equal(e.home().hidden, false);
    assert.equal(e.body.classList.contains('gunter-orbit-home-active'), true);
    assert.equal(e.html.classList.contains('gunter-orbit-home-active'), true);
    assert.equal(e.calls.permission, 0); assert.equal(e.calls.voice, 0);
});
check('repeated initialization does not duplicate home, timers or controls', async () => {
    const e = environment(); e.window.GunterOrbitHome.init(); vm.runInNewContext(source, e.sandbox); await e.flush();
    assert.equal(e.body.children.length, 1); assert.equal(e.calls.activate.length, 1);
});
check('other pages remain untouched', async () => {
    const e = environment({ pathname: '/config.html' }); await e.flush();
    assert.equal(e.home(), null); assert.equal(e.calls.mounts, 0); assert.equal(e.calls.activate.length, 0);
});
check('all retained static work destinations leave home without rebuilding panels', async () => {
    const e = environment(); await e.flush();
    for (const hash of ['#tasks', '#events', '#reminders', '#capture', '#chat']) {
        await e.navigate(hash); assert.equal(e.home().hidden, true, hash);
        assert.equal(e.body.classList.contains('gunter-orbit-home-active'), false, hash);
        assert.equal(e.selected.dataset.tab, 'today', hash);
    }
});
check('dynamic hash routes retain the existing selected tab', async () => {
    const e = environment({ hash: '#commitments' });
    e.window.GunterDayTabs.activate('commitments'); await e.flush();
    assert.equal(e.home().hidden, true); assert.equal(e.selected.dataset.tab, 'commitments');
    assert.equal(e.calls.history.length, 0);
});
check('programmatic tab activation cannot disappear behind an empty-hash home', async () => {
    const e = environment(); await e.flush();
    e.window.fire('gunter-open-tab', { detail: { tab: 'conversations' } }); await e.flush();
    assert.equal(e.home().hidden, true); assert.equal(e.location.hash, '#conversations');
    assert.deepEqual(e.calls.history, ['#conversations']);
});
check('return and back-forward-style navigation reset to home without observer loops', async () => {
    const e = environment(); await e.flush();
    await e.navigate('#conversations'); await e.navigate('');
    assert.equal(e.home().hidden, false); assert.equal(e.selected.dataset.tab, 'today'); assert.equal(e.location.hash, '');
    await e.navigate('#tasks'); await e.navigate(''); assert.equal(e.home().hidden, false);
    assert.equal(e.calls.history.length, 0);
});
check('home aliases and the skip target safely restore home', async () => {
    const e = environment(); await e.flush();
    for (const hash of ['#home', '#today', '#main-content']) {
        await e.navigate('#activity'); await e.navigate(hash);
        assert.equal(e.home().hidden, false); assert.equal(e.selected.dataset.tab, 'today');
    }
});
check('chat reuses the established companion without microphone or permission side effects', async () => {
    const e = environment(); await e.flush(); e.controls['[data-orbit-chat]'].fire('click');
    assert.equal(e.calls.show, 1); assert.equal(e.calls.expand, 1);
    assert.equal(e.calls.voice, 0); assert.equal(e.calls.permission, 0); assert.equal(e.location.hash, '');
});
check('chat fallback retains the existing chat route', async () => {
    const e = environment({ companion: false }); await e.flush(); e.controls['[data-orbit-chat]'].fire('click');
    assert.equal(e.location.hash.replace(/^#/, ''), 'chat'); assert.equal(e.calls.permission, 0);
});
check('voice only delegates the established guarded control after a user click', async () => {
    const e = environment(); await e.flush(); assert.equal(e.calls.voice, 0);
    e.controls['[data-orbit-voice]'].fire('click'); assert.equal(e.calls.voice, 1); assert.equal(e.calls.permission, 0);
    const fallback = environment({ voiceControl: false }); await fallback.flush();
    fallback.controls['[data-orbit-voice]'].fire('click'); assert.equal(fallback.calls.expand, 1);
});
check('unavailable capture never claims that Gunter is listening', async () => {
    const e = environment(); e.state.conversation = 'listening_query'; e.window.fire('gunter-conversation-state');
    assert.equal(e.controls['[data-orbit-status]'].textContent, 'Micrófono pendiente');
    assert.equal(e.controls['[data-orbit-voice]'].attributes['aria-pressed'], 'false');
    e.state.conversation = 'listening_wake'; e.state.wake = { active: false, mode: 'wake' }; e.window.fire('wake-word-state');
    assert.equal(e.controls['[data-orbit-status]'].textContent, 'En reposo');
});
check('real capture and playback update visual captions without fake telemetry', async () => {
    const e = environment(); e.state.conversation = 'listening_query'; e.state.ptt = { active: true, phase: 'recording' };
    e.window.fire('gunter-push-to-talk-state'); assert.equal(e.controls['[data-orbit-status]'].textContent, 'Escuchando tu consulta');
    assert.equal(e.controls['[data-orbit-voice]'].attributes['aria-pressed'], 'true');
    e.state.playback = { speaking: true }; e.window.fire('gunter-voice-state');
    assert.equal(e.controls['[data-orbit-status]'].textContent, 'Hablando'); assert.equal(e.home().dataset.coreState, 'speaking');
    e.state.ptt = { active: false, phase: 'off' }; e.state.playback = { speaking: false }; e.state.conversation = 'awaiting_confirmation';
    e.window.fire('gunter-conversation-state'); assert.equal(e.controls['[data-orbit-status]'].textContent, 'Espera tu confirmación');
});
check('audio preparation never claims speaking before real playback', async () => {
    const e = environment(); e.state.conversation = 'speaking'; e.state.playback = { speaking: false };
    e.window.fire('gunter-conversation-state');
    assert.equal(e.controls['[data-orbit-status]'].textContent, 'Procesando');
    assert.equal(e.home().dataset.coreState, 'thinking');
});
check('PTT capture is reflected even before the conversation state advances', async () => {
    const e = environment(); e.state.ptt = { active: true, phase: 'recording' };
    e.window.fire('gunter-push-to-talk-state');
    assert.equal(e.controls['[data-orbit-status]'].textContent, 'Escuchando tu consulta');
    assert.equal(e.home().dataset.coreState, 'listening_query');
});
check('route map reuses existing destinations and exposes no new services', async () => {
    const e = environment(); await e.flush();
    const hrefs = Array.from(e.window.GunterOrbitHome.routes, item => item.href);
    for (const href of ['day.html#tasks', 'day.html#events', 'day.html#reminders', 'day.html#capture',
        'day.html#conversations', 'day.html#activity', 'dashboard.html', 'results.html', 'config.html#data', 'config.html#connections']) {
        assert.ok(hrefs.includes(href), href);
    }
    assert.doesNotMatch(source, /fetch\(|getUserMedia\(|new (?:AudioContext|SpeechRecognition|WebSocket)|localStorage\.setItem|\.dispatch\(/);
});
check('theme uses the existing preference control instead of storing a parallel preference', async () => {
    const e = environment(); e.controls['[data-orbit-theme]'].fire('click'); assert.equal(e.calls.theme, 'light');
    e.body.classList.add('at-light'); e.controls['[data-orbit-theme]'].fire('click'); assert.equal(e.calls.theme, 'dark');
});
check('pagehide releases observer/timer while persisted navigation keeps the shell viable', async () => {
    const e = environment(); await e.flush(); e.window.fire('pagehide', { persisted: true });
    assert.equal(e.observer().connected, true); assert.deepEqual(e.calls.cleared, []);
    e.window.fire('pageshow'); await e.flush(); assert.equal(e.home().hidden, false);
    e.window.fire('pagehide', { persisted: false }); assert.equal(e.observer().connected, false);
    assert.deepEqual(e.calls.cleared, [42]); const scrolls = e.calls.scroll;
    e.window.GunterOrbitHome.syncRoute(true); assert.equal(e.calls.scroll, scrolls);
    e.selected.dataset.tab = 'conversations'; e.window.fire('gunter-open-tab', { detail: { tab: 'conversations' } }); await e.flush();
    assert.deepEqual(e.calls.history, []);
});

(async () => {
    for (const [name, fn] of checks) { await fn(); passed++; console.log(`✓ ${name}`); }
    console.log(`ORBIT HOME: ${passed} focused checks passed.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
