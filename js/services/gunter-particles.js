/* Idle Gunter identity. All hosts share one generated WebGL core compositor. */
(function () {
    'use strict';
    if (window.GunterParticles) return;

    const DEFAULTS = Object.freeze({ color: '#ff452b', glowColor: '#ff6d35', brightness: 1,
        density: 1, speed: 1, size: 1 });
    const STATIC_TIME = 8, FRAME_INTERVAL = 1000 / 30;
    const records = new Map(), disposers = [];
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let config, savedReduced = false, engine = null, engineError = '', raf = 0, lastFrame = 0;
    let animationTime = STATIC_TIME, disposed = false, suspended = false, mutations = null, drawBlocked = false;

    const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const clamp = (value, low, high, fallback) => typeof value === 'number' && Number.isFinite(value)
        ? Math.max(low, Math.min(high, value)) : fallback;
    const color = (value, fallback) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
        ? value.toLowerCase() : fallback;
    function normalize(value = {}) {
        value = object(value);
        return {
            color: color(value.color, DEFAULTS.color), glowColor: color(value.glowColor, DEFAULTS.glowColor),
            brightness: clamp(value.brightness, .2, 2.5, DEFAULTS.brightness),
            density: clamp(value.density, .35, 1.8, DEFAULTS.density),
            speed: clamp(value.speed, 0, 2, DEFAULTS.speed),
            size: clamp(value.size, .7, 1.3, DEFAULTS.size)
        };
    }
    function readPreferences() {
        try { return object(JSON.parse(window.localStorage?.getItem('gunter_prefs') || '{}')); }
        catch { return {}; }
    }
    function refreshPreferences() {
        const prefs = readPreferences();
        savedReduced = prefs.reduceMotion === true;
        config = normalize(prefs.coreVisual);
    }
    function reduced() {
        return !!motionQuery?.matches || savedReduced || document.documentElement.classList.contains('reduce-motion');
    }
    function listen(target, type, fn, options, list = disposers) {
        target.addEventListener(type, fn, options);
        list.push(() => target.removeEventListener(type, fn, options));
    }
    function stopFrames() {
        if (raf) window.cancelAnimationFrame(raf);
        raf = 0; lastFrame = 0;
    }
    function ensureEngine() {
        if (drawBlocked && !engine) return null;
        if (!engine) {
            try {
                if (typeof window.GunterIdleCore !== 'function') throw new Error('WebGL no disponible');
                engine = new window.GunterIdleCore();
            } catch (error) { engineError = error?.message || 'WebGL no disponible'; drawBlocked = true; }
        }
        return engine;
    }
    function fallback(record, message) {
        record.canvas.hidden = true; record.status.hidden = false;
        if (record.el.getAttribute('aria-hidden') === 'true') {
            record.el.removeAttribute('aria-hidden'); record.revealedStatus = true;
        }
        record.status.textContent = 'Núcleo visual no disponible. Gunter sigue listo.';
        record.el.dataset.particlesReady = 'fallback';
        record.el.dataset.particlesStatus = 'unavailable';
        record.el.dataset.particlesError = String(message || 'WebGL no disponible');
    }
    function render(record, time) {
        const compositor = ensureEngine();
        if (!compositor || !compositor.available || drawBlocked) {
            fallback(record, engineError || compositor?.error); record.dirty = false; return;
        }
        try {
            // The shared phase already includes speed; changing speed must not reposition the core.
            const rendered = compositor.renderTo(record.canvas, record.pixelWidth, record.pixelHeight, time, { ...config, speed: 1 });
            if (rendered === false || !compositor.available) {
                drawBlocked = true;
                fallback(record, compositor.error); record.dirty = false; return;
            }
            record.canvas.hidden = false; record.status.hidden = true;
            if (record.revealedStatus) {
                record.el.setAttribute('aria-hidden', record.originalAriaHidden); record.revealedStatus = false;
            }
            record.el.dataset.particlesReady = 'true';
            record.el.dataset.particlesStatus = record.animated ? 'animated' : 'static';
            delete record.el.dataset.particlesError;
        } catch (error) {
            engineError = error?.message || 'No se pudo dibujar el núcleo visual';
            drawBlocked = true;
            fallback(record, engineError);
        }
        record.dirty = false;
    }
    function canAnimate() {
        return !disposed && !suspended && !document.hidden && !reduced() && config.speed > 0
            && !drawBlocked && engine?.available === true
            && [...records.values()].some(record => record.animated);
    }
    function schedule() {
        if (canAnimate()) { if (!raf) raf = window.requestAnimationFrame(tick); }
        else stopFrames();
    }
    function reconcile() {
        if (disposed) return;
        const active = !suspended && !document.hidden;
        const eligible = active && !reduced() && config.speed > 0 ? [...records.values()]
            .filter(record => record.visible && record.el.isConnected && record.variant !== 'thumb'
                && record.width >= 96 && record.height >= 96)
            .sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 2) : [];
        const selected = new Set(eligible);
        for (const record of records.values()) {
            const animated = selected.has(record);
            if (record.animated !== animated) { record.animated = animated; record.dirty = true; }
            if ((!active || !record.visible) && record.el.dataset.particlesReady === 'true') {
                record.el.dataset.particlesStatus = 'paused';
            }
            if (!active || !record.visible || !record.el.isConnected || !record.width || !record.height) continue;
            if (record.dirty) render(record, record.variant === 'thumb' ? STATIC_TIME : animationTime);
        }
        schedule();
    }
    function tick(now) {
        raf = 0;
        if (!canAnimate()) { lastFrame = 0; return; }
        if (lastFrame && now - lastFrame < FRAME_INTERVAL) { schedule(); return; }
        animationTime += (lastFrame ? Math.min((now - lastFrame) / 1000, .1) : 0) * config.speed;
        lastFrame = now;
        for (const record of records.values()) {
            if (record.animated && record.visible && record.el.isConnected) render(record, animationTime);
        }
        schedule();
    }
    function invalidate() {
        drawBlocked = false; engineError = '';
        records.forEach(record => { record.dirty = true; }); reconcile();
    }
    function applyConfig(record) {
        record.el.style.setProperty('--core-color', config.color);
        record.el.style.setProperty('--core-glow-color', config.glowColor);
        record.dirty = true;
    }
    function configure(patch = {}, options = {}) {
        const next = normalize({ ...config, ...object(patch) });
        if (options.persist === true) {
            // Preserve unrelated preferences and legacy fields within coreVisual.
            const prefs = readPreferences();
            window.localStorage?.setItem('gunter_prefs', JSON.stringify({ ...prefs,
                coreVisual: { ...object(prefs.coreVisual), ...next } }));
        }
        config = next; drawBlocked = false; engineError = '';
        records.forEach(applyConfig); reconcile();
        window.dispatchEvent(new CustomEvent('gunter-core-config-changed', { detail: { ...config } }));
        return { ...config };
    }
    const observer = 'IntersectionObserver' in window ? new window.IntersectionObserver(entries => {
        for (const entry of entries) {
            const record = records.get(entry.target);
            if (record && record.visible !== entry.isIntersecting) {
                record.visible = entry.isIntersecting; record.dirty = true;
            }
        }
        reconcile();
    }, { rootMargin: '0px' }) : null;

    function mountOne(el) {
        if (disposed || records.has(el) || !el.isConnected) return;
        const variant = ['hero', 'chat'].includes(el.dataset.gunterParticles) ? el.dataset.gunterParticles : 'thumb';
        const canvas = document.createElement('canvas'), status = document.createElement('span');
        canvas.className = 'gunter-idle-core-canvas';
        canvas.setAttribute('role', 'img');
        canvas.setAttribute('aria-label', 'Núcleo visual de Gunter en reposo');
        canvas.textContent = 'Núcleo visual de Gunter en reposo';
        status.className = 'gunter-idle-core-status'; status.setAttribute('role', 'status');
        status.hidden = true;
        const record = { el, variant, canvas, status, visible: !observer, animated: false, dirty: true,
            width: 0, height: 0, pixelWidth: 0, pixelHeight: 0, disposers: [],
            originalAriaHidden: el.getAttribute('aria-hidden'), revealedStatus: false };
        records.set(el, record);
        el.classList.remove('gunter-video-core');
        el.classList.add('gunter-particle-art', 'gunter-energy-core', 'gunter-idle-core');
        el.replaceChildren(canvas, status);
        el.dataset.particlesRenderer = 'webgl-filaments'; el.dataset.particlesReady = 'pending';
        el.dataset.coreState = 'idle';
        delete el.dataset.videoPlayback; delete el.dataset.audioSignal; delete el.dataset.audioLevel;
        const resize = () => {
            const box = el.getBoundingClientRect();
            const width = Math.max(0, box.width), height = Math.max(0, box.height);
            const ratio = Math.min(1.5, window.devicePixelRatio || 1, 720 / Math.max(1, width, height));
            const pixelWidth = Math.max(1, Math.round(width * ratio)), pixelHeight = Math.max(1, Math.round(height * ratio));
            if (record.width === width && record.height === height
                && record.pixelWidth === pixelWidth && record.pixelHeight === pixelHeight) return;
            drawBlocked = false; engineError = '';
            Object.assign(record, { width, height, pixelWidth, pixelHeight, dirty: true }); reconcile();
        };
        if ('ResizeObserver' in window) {
            record.resizeObserver = new window.ResizeObserver(resize); record.resizeObserver.observe(el);
        } else listen(window, 'resize', resize, undefined, record.disposers);
        applyConfig(record); observer?.observe(el); resize();
    }
    function mount(root = document) {
        if (disposed) return;
        const elements = [...(root.querySelectorAll?.('[data-gunter-particles]') || [])];
        if (root.matches?.('[data-gunter-particles]')) elements.push(root);
        elements.forEach(mountOne);
    }
    function destroy(record) {
        observer?.unobserve(record.el); record.resizeObserver?.disconnect();
        if (record.revealedStatus) record.el.setAttribute('aria-hidden', record.originalAriaHidden);
        record.disposers.forEach(remove => remove()); record.canvas.remove(); record.status.remove();
        records.delete(record.el);
        if (!records.size) {
            stopFrames(); engine?.dispose(); engine = null; engineError = ''; drawBlocked = false;
        }
    }
    function init() {
        if (disposed) return;
        mount();
        if ('MutationObserver' in window) {
            mutations = new window.MutationObserver(entries => {
                for (const entry of entries) {
                    if (entry.type === 'attributes') {
                        if (entry.target === document.body || entry.target === document.documentElement) {
                            savedReduced = readPreferences().reduceMotion === true; invalidate();
                        }
                    } else for (const node of entry.addedNodes) if (node.nodeType === 1) mount(node);
                }
                for (const record of records.values()) if (!record.el.isConnected) destroy(record);
                reconcile();
            });
            mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
            mutations.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        }
        listen(window, 'storage', event => {
            if (event.key === 'gunter_prefs' || event.key === null) {
                refreshPreferences(); records.forEach(applyConfig); reconcile();
            }
        });
        if (motionQuery?.addEventListener) listen(motionQuery, 'change', invalidate);
        listen(window, 'gunter-idle-core-availability', invalidate);
        listen(document, 'visibilitychange', () => {
            if (document.hidden) stopFrames();
            invalidate();
        });
        listen(window, 'pagehide', event => {
            suspended = true; stopFrames();
            records.forEach(record => {
                if (record.el.dataset.particlesReady === 'true') record.el.dataset.particlesStatus = 'paused';
            });
            if (event.persisted) return;
            disposed = true;
            records.forEach(destroy); engine?.dispose(); engine = null;
            mutations?.disconnect(); observer?.disconnect();
            disposers.splice(0).forEach(remove => remove());
        });
        listen(window, 'pageshow', () => { suspended = false; invalidate(); });
    }
    refreshPreferences();
    window.GunterParticles = { mount, configure, getConfig: () => ({ ...config }), getDefaults: () => ({ ...DEFAULTS }) };
    if (document.readyState === 'loading') listen(document, 'DOMContentLoaded', init, { once: true });
    else init();
})();
