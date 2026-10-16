/* One canvas and one identity. Layout stays still during a GPU particle current;
   GunterParticles owns physics, rendering and real-audio modulation. */
(function () {
    'use strict';
    if (window.GunterCorePresence) return;
    const DOCK_SIZE = 112, FLOW_DURATION = 2400, BEND = .18;
    const HANDOFF_KEY = 'gunter_core_visual_entry', HANDOFF_TTL = 5000;
    const PAGES = new Set(['day.html', 'dashboard.html', 'config.html', 'results.html', 'new-project.html', 'meeting.html', 'index.html']);
    const removers = [];
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let portal, art, anchor, bubble, home, mode = '', target, flight;
    let mutationObserver, resizeObserver, frame = 0, flowFrame = 0, started = false, disposed = false, suspended = false;
    let originalClass = '', borrowed = false, navigating = 0, entryPending;

    function listen(node, event, callback, options) {
        node?.addEventListener?.(event, callback, options);
        removers.push(() => node?.removeEventListener?.(event, callback, options));
    }
    function reduced() {
        let preference = false;
        try { preference = JSON.parse(window.localStorage?.getItem('gunter_prefs') || '{}')?.reduceMotion === true; } catch {}
        return preference || !!motionQuery?.matches || document.documentElement.classList.contains('reduce-motion')
            || document.body?.classList.contains('reduce-motion');
    }
    function speed() {
        const value = Number(window.GunterParticles?.getConfig?.()?.speed ?? 1);
        return Number.isFinite(value) ? Math.max(0, value) : 1;
    }
    function rect(node) {
        if (!node?.isConnected) return null;
        const box = node.getBoundingClientRect();
        return [box.left, box.top, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0
            ? { left: box.left, top: box.top, width: box.width, height: box.height } : null;
    }
    function same(a, b) {
        return a && b && ['left', 'top', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < .5);
    }
    function layout(box) {
        Object.assign(portal.style, { left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', height: box.height + 'px' });
    }
    function transport(value) { return window.GunterParticles?.setTransport?.(art, value); }
    function viewport() {
        return { width: window.innerWidth || document.documentElement.clientWidth || 1280,
            height: window.innerHeight || document.documentElement.clientHeight || 800 };
    }
    function dockRect() {
        const hit = rect(bubble);
        if (!hit) return null;
        const view = viewport();
        return { left: Math.max(0, Math.min(view.width - DOCK_SIZE, hit.left + (hit.width - DOCK_SIZE) / 2)),
            top: Math.max(0, Math.min(view.height - DOCK_SIZE, hit.top + (hit.height - DOCK_SIZE) / 2)),
            width: DOCK_SIZE, height: DOCK_SIZE };
    }
    function flowBounds(from, to) {
        const view = viewport();
        const distance = Math.hypot(to.left + to.width / 2 - from.left - from.width / 2,
            to.top + to.height / 2 - from.top - from.height / 2);
        const margin = Math.max(from.width, to.width) * .2 + distance * .22;
        const left = Math.max(0, Math.min(from.left, to.left) - margin);
        const top = Math.max(0, Math.min(from.top, to.top) - margin);
        const right = Math.min(view.width, Math.max(from.left + from.width, to.left + to.width) + margin);
        const bottom = Math.min(view.height, Math.max(from.top + from.height, to.top + to.height) + margin);
        return { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) };
    }
    function point(box, bounds) {
        return [(box.left + box.width / 2 - bounds.left) / bounds.width * 2 - 1,
            1 - (box.top + box.height / 2 - bounds.top) / bounds.height * 2];
    }
    function currentBox() {
        if (!flight) return target || rect(portal);
        // Same isotropic quadratic curve as the GPU, converted to screen coordinates.
        const { from, to, progress: p, params } = flight;
        const dx = to.left + to.width / 2 - from.left - from.width / 2;
        const dy = to.top + to.height / 2 - from.top - from.height / 2;
        const bow = 4 * params.bend * p * (1 - p), side = from.width + (to.width - from.width) * p;
        return { left: from.left + from.width / 2 + dx * p + dy * bow - side / 2,
            top: from.top + from.height / 2 + dy * p - dx * bow - side / 2, width: side, height: side };
    }
    function cancelFlow() {
        if (flowFrame) window.cancelAnimationFrame(flowFrame);
        flowFrame = 0;
        if (flight) { const resolve = flight.resolve; flight = null; resolve(false); }
        if (art) transport(null);
        if (portal) portal.dataset.flow = 'idle';
    }
    function settle() {
        const active = flight;
        if (!active) return;
        flight = null; flowFrame = 0;
        transport(null); layout(active.to); portal.dataset.flow = 'idle';
        active.resolve(true);
    }
    function flowTick(now) {
        flowFrame = 0;
        if (!flight || disposed || suspended) return;
        if (reduced() || speed() === 0) { settle(); return; }
        const elapsed = Math.max(0, Math.min(64, now - flight.last));
        flight.last = now;
        flight.progress = Math.min(1, flight.progress + elapsed * speed() / FLOW_DURATION);
        if (transport({ ...flight.params, progress: flight.progress }) === false) { settle(); return; }
        if (flight.progress >= 1) settle();
        else flowFrame = window.requestAnimationFrame(flowTick);
    }
    function move(next, nextMode, initial) {
        portal.hidden = false;
        if (!initial && same(target, next) && mode === nextMode) {
            if (flight && (reduced() || speed() === 0)) settle();
            if (!flight) layout(next);
            return flight ? flight.promise : Promise.resolve(true);
        }
        const from = initial || (mode ? currentBox() : null);
        cancelFlow();
        mode = nextMode; target = next; portal.dataset.mode = nextMode;
        if (!from || same(from, next) || reduced() || speed() === 0 || !window.GunterParticles?.setTransport) {
            layout(next); return Promise.resolve(true);
        }
        const bounds = flowBounds(from, next), min = Math.min(bounds.width, bounds.height);
        // Both directions arc into the space above the lower-left dock, rather
        // than sending the expanded current underneath the viewport edge.
        const bend = from.left + from.width / 2 > next.left + next.width / 2 ? -BEND : BEND;
        const params = { from: point(from, bounds), to: point(next, bounds),
            fromScale: from.width / min, toScale: next.width / min, bend };
        let resolve;
        const promise = new Promise(done => { resolve = done; });
        flight = { from, to: next, params, progress: 0, last: window.performance?.now?.() || 0, resolve, promise };
        layout(bounds); portal.dataset.flow = 'active';
        if (transport({ ...params, progress: 0 }) === false) { settle(); return promise; }
        flowFrame = window.requestAnimationFrame(flowTick);
        return promise;
    }
    function findTargets() {
        const nextHome = document.getElementById('gunter-orbit-home');
        if (nextHome !== home) {
            if (home) resizeObserver?.unobserve?.(home);
            home = nextHome;
            if (home) resizeObserver?.observe?.(home);
        }
        const nextBubble = document.querySelector('#gunter-companion .gn-comp__bubble');
        if (nextBubble !== bubble) {
            if (bubble) resizeObserver?.unobserve?.(bubble);
            bubble = nextBubble;
            if (bubble) resizeObserver?.observe?.(bubble);
        }
        if (!art) {
            const hero = home?.querySelector('.gn-orbit-core[data-gunter-particles]');
            if (!hero && !bubble) return false;
            portal = document.createElement('div');
            portal.className = 'gn-core-presence';
            portal.setAttribute('aria-hidden', 'true');
            portal.style.pointerEvents = 'none';
            if (hero) {
                originalClass = hero.className;
                anchor = document.createElement('div');
                anchor.className = 'gn-orbit-core gn-core-presence-anchor';
                anchor.setAttribute('aria-hidden', 'true');
                hero.replaceWith(anchor);
                art = hero; borrowed = true;
                art.classList.remove('gn-orbit-core');
                resizeObserver?.observe?.(anchor);
            } else {
                art = document.createElement('div');
                art.dataset.gunterParticles = 'hero';
            }
            art.classList.add('gn-core-presence__art');
            portal.append(art); document.body.append(portal);
            document.body.classList.add('gunter-core-presence-active');
            window.GunterParticles?.mount?.(art);
            mutationObserver?.observe(art, { attributes: true, attributeFilter: ['data-particles-ready'] });
        }
        return true;
    }
    function consumeEntry() {
        try {
            const value = window.sessionStorage?.getItem(HANDOFF_KEY);
            if (!value) return false;
            window.sessionStorage.removeItem(HANDOFF_KEY);
            const entry = JSON.parse(value), age = Date.now() - Number(entry?.at);
            return entry?.kind === 'home-entry' && age >= 0 && age <= HANDOFF_TTL ? entry : null;
        } catch { return null; }
    }
    function sync() {
        if (disposed || suspended || navigating || !document.body || !findTargets()) return;
        const isHome = !!home && !home.hidden && document.body.classList.contains('gunter-orbit-home-active');
        const destination = isHome ? rect(anchor) : null;
        if (destination) {
            if (entryPending === undefined) entryPending = consumeEntry();
            if (entryPending && Date.now() - entryPending.at > HANDOFF_TTL) entryPending = null;
            // Intersection/resize observers initialize the existing compositor after
            // mount. Wait for its real ready transition, never a polling loop.
            if (entryPending && mutationObserver && art.dataset.particlesReady === 'pending' && !reduced() && speed() > 0) {
                const dock = dockRect();
                if (dock) move(dock, 'dock');
                return;
            }
            const initial = entryPending ? dockRect() : null;
            entryPending = null;
            move(destination, 'home', initial); return;
        }
        const companion = document.getElementById('gunter-companion');
        if (companion?.hidden || companion?.classList.contains('is-hidden')) {
            portal.hidden = true; cancelFlow(); target = null; return;
        }
        const dock = dockRect();
        if (dock) move(dock, 'dock');
        else { portal.hidden = true; cancelFlow(); target = null; }
    }
    function queueSync() {
        if (disposed || suspended || frame) return;
        frame = window.requestAnimationFrame(() => { frame = 0; sync(); });
    }
    function safeTarget(href) {
        try {
            const current = new URL(window.location.href), next = new URL(href, current);
            const file = next.pathname.split('/').pop();
            const directory = pathname => pathname.slice(0, pathname.lastIndexOf('/') + 1);
            if (next.origin !== current.origin || !['http:', 'https:', 'file:'].includes(next.protocol)
                || directory(next.pathname) !== directory(current.pathname) || !PAGES.has(file)) return null;
            if (next.pathname === current.pathname && next.search === current.search
                && !(file === 'day.html' && isHomeTarget(next) && !isHomeTarget(current))) return null;
            return next;
        } catch { return null; }
    }
    function isHomeTarget(url) {
        return ['day.html', 'index.html'].includes(url.pathname.split('/').pop()) && (!url.hash || url.hash === '#home');
    }
    async function navigate(href) {
        const next = safeTarget(href);
        if (!next || disposed || suspended) return false;
        const current = new URL(window.location.href);
        if (next.pathname === current.pathname && next.search === current.search) {
            // Returning from a day section must use the existing hash router:
            // a document reload would discard this same live canvas and phase.
            navigating = 0;
            window.location.hash = '#home';
            return true;
        }
        const id = ++navigating;
        if (isHomeTarget(next) && !reduced() && speed() > 0) {
            try { window.sessionStorage?.setItem(HANDOFF_KEY, JSON.stringify({ kind: 'home-entry', at: Date.now() })); } catch {}
        }
        if (mode === 'home' && !isHomeTarget(next) && !reduced() && speed() > 0) {
            const dock = dockRect();
            if (dock) await move(dock, 'dock');
        }
        if (disposed || suspended || navigating !== id) {
            const error = new Error('La navegación anterior se canceló porque cambiaste de destino.');
            error.name = 'AbortError';
            throw error;
        }
        window.location.assign(next.href);
        return true;
    }
    function linkNavigation(event) {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const link = event.target?.closest?.('a[href]');
        if (!link || link.hasAttribute?.('download') || (link.getAttribute?.('target') && link.getAttribute('target') !== '_self')) return;
        const href = link.getAttribute?.('href');
        const next = safeTarget(href);
        if (!next || disposed || suspended) return;
        const current = new URL(window.location.href);
        const sameDocument = next.pathname === current.pathname && next.search === current.search;
        if (!sameDocument && (reduced() || speed() === 0)) return;
        event.preventDefault();
        navigate(href).catch(error => {
            if (error?.name !== 'AbortError' && !disposed && !suspended) window.location.assign(href);
        });
    }
    function dispose() {
        if (disposed) return;
        disposed = true;
        if (frame) window.cancelAnimationFrame(frame);
        frame = 0; cancelFlow();
        mutationObserver?.disconnect(); resizeObserver?.disconnect();
        removers.splice(0).forEach(remove => remove());
        if (borrowed && anchor?.isConnected) { art.className = originalClass; anchor.replaceWith(art); }
        portal?.remove(); document.body?.classList.remove('gunter-core-presence-active');
    }
    function init() {
        if (started || disposed || !document.body) return;
        started = true;
        if (window.ResizeObserver) resizeObserver = new window.ResizeObserver(queueSync);
        if (window.MutationObserver) {
            mutationObserver = new window.MutationObserver(entries => {
                if (entries.some(entry => !portal?.contains?.(entry.target)
                    || (entry.target === art && entry.attributeName === 'data-particles-ready'
                        && entryPending && art.dataset.particlesReady !== 'pending'))) queueSync();
            });
            mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true,
                attributeFilter: ['class', 'hidden', 'aria-selected'] });
            mutationObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        }
        for (const event of ['hashchange', 'gunter-open-tab', 'resize', 'orientationchange', 'gunter-core-config-changed']) listen(window, event, queueSync);
        listen(window, 'storage', event => { if (!event.key || event.key === 'gunter_prefs') queueSync(); });
        listen(window.visualViewport, 'resize', queueSync);
        if (motionQuery?.addEventListener) listen(motionQuery, 'change', queueSync);
        listen(document, 'click', linkNavigation);
        listen(window, 'pagehide', event => {
            suspended = true;
            if (frame) window.cancelAnimationFrame(frame);
            frame = 0; cancelFlow();
            if (!event.persisted) dispose();
        });
        listen(window, 'pageshow', () => { suspended = false; navigating = 0; sync(); });
        sync();
    }
    window.GunterCorePresence = { init, sync, dispose, navigate,
        getState: () => ({ initialized: started, disposed, mode, animating: !!flight,
            progress: flight?.progress ?? null, target: target ? { ...target } : null }) };
    if (document.readyState === 'loading') listen(document, 'DOMContentLoaded', init, { once: true });
    else init();
})();
