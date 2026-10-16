/* Idle Gunter identity. All hosts share one generated WebGL core compositor. */
(function () {
    'use strict';
    if (window.GunterParticles) return;

    const DEFAULTS = Object.freeze({ particleColor: '#b8bec9', energyColor: '#ff452b', color: '#ff452b', glowColor: '#ff6d35', brightness: 1,
        density: 1, speed: 1, size: 1 });
    const STATIC_TIME = 8, FRAME_INTERVAL = 1000 / 30;
    const records = new Map(), disposers = [];
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let config, savedReduced = false, engine = null, engineError = '', raf = 0, lastFrame = 0;
    let animationTime = STATIC_TIME, disposed = false, suspended = false, mutations = null, drawBlocked = false;
    let pointerOwner = null;
    let voiceMeter = null, meterEnabled = false, bindingMeter = false, audioLive = false;
    let audioLevel = 0, audioFrame = 0;

    const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const clamp = (value, low, high, fallback) => typeof value === 'number' && Number.isFinite(value)
        ? Math.max(low, Math.min(high, value)) : fallback;
    const color = (value, fallback) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
        ? value.toLowerCase() : fallback;
    function normalize(value = {}) {
        value = object(value);
        const energyColor = color(Object.prototype.hasOwnProperty.call(value, 'energyColor')
            ? value.energyColor : value.color, DEFAULTS.energyColor);
        return {
            particleColor: color(value.particleColor, DEFAULTS.particleColor), energyColor, color: energyColor,
            glowColor: color(value.glowColor, DEFAULTS.glowColor),
            brightness: clamp(value.brightness, .2, 2.5, DEFAULTS.brightness),
            density: clamp(value.density, .25, 2, DEFAULTS.density),
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
    function assistantSignal() {
        if (!meterEnabled) return null;
        try {
            const signal = voiceMeter?.getAudioAnalysisState?.(), age = Date.now() - signal?.at;
            return signal?.source === 'assistant' && signal.enabled === true && signal.active === true
                && signal.available === true && Number.isFinite(signal.level) && signal.level >= 0
                && Number.isFinite(age) && age >= 0 && age <= 250 ? signal : null;
        } catch { return null; }
    }
    function clearAudio() {
        if (audioLevel || audioLive) records.forEach(record => { record.dirty = true; });
        audioLevel = 0; audioFrame = 0; audioLive = false;
        engine?.setAudioLevel?.(0, false);
    }
    function syncAudioMeter(wanted) {
        let service;
        try { service = window.GunterVoice; } catch { service = null; }
        bindingMeter = true;
        try {
            if (voiceMeter !== service) {
                if (meterEnabled) voiceMeter?.setAudioAnalysisEnabled?.(false);
                voiceMeter = service; meterEnabled = false; clearAudio();
            }
            wanted = wanted && typeof service?.setAudioAnalysisEnabled === 'function';
            if (meterEnabled !== wanted) {
                meterEnabled = wanted;
                service?.setAudioAnalysisEnabled?.(wanted);
            }
        } catch { meterEnabled = false; clearAudio(); }
        finally { bindingMeter = false; }
        if (!wanted) clearAudio();
    }
    function sampleAudio(now, signal) {
        if (!signal) { clearAudio(); return; }
        // Wall-clock smoothing is independent of the user's organic motion speed.
        const dt = audioFrame ? Math.max(0, Math.min(.1, (now - audioFrame) / 1000)) : FRAME_INTERVAL / 1000;
        audioFrame = now;
        const target = Math.min(1, signal.level), tau = target > audioLevel ? .035 : .12;
        audioLevel += (target - audioLevel) * (1 - Math.exp(-dt / tau));
        if (!target && audioLevel < .0001) audioLevel = 0;
        engine?.setAudioLevel?.(audioLevel, true);
    }
    function clearPointer(immediate = false) {
        const hadOwner = pointerOwner !== null; pointerOwner = null;
        if (immediate) {
            if (engine?.resetPointer?.()) records.forEach(record => { record.dirty = true; });
        } else if (hadOwner) engine?.setPointer?.(0, 0, false);
    }
    function movePointer(event) {
        if (disposed || suspended || document.hidden || reduced() || config.speed <= 0 || drawBlocked
            || !engine?.available || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
        // Observe only. Hosts stay pointer-transparent, and touch keeps native scroll/click behaviour.
        if (event.pointerType && !['mouse', 'pen'].includes(event.pointerType)) { clearPointer(); return; }
        const hovered = [...records.values()].filter(record => record.animated && record.visible && record.el.isConnected
                && record.width >= 96 && record.height >= 96)
            .map(record => ({ record, box: record.el.getBoundingClientRect() }))
            .filter(({ box }) => event.clientX >= box.left && event.clientX <= box.left + box.width
                && event.clientY >= box.top && event.clientY <= box.top + box.height)
            .sort((a, b) => a.box.width * a.box.height - b.box.width * b.box.height)[0];
        if (!hovered) { clearPointer(); return; }
        const { record, box } = hovered, radius = Math.min(box.width, box.height) * .5;
        if (!radius) { clearPointer(); return; }
        pointerOwner = record;
        engine.setPointer?.((event.clientX - box.left - box.width * .5) / radius,
            (box.top + box.height * .5 - event.clientY) / radius, true);
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
        const moving = active && !reduced() && config.speed > 0;
        const candidates = [...records.values()].filter(record => record.visible && record.el.isConnected
            && record.variant !== 'thumb' && record.width >= (record.variant === 'chat' ? 32 : 96)
            && record.height >= (record.variant === 'chat' ? 32 : 96));
        syncAudioMeter(moving && !drawBlocked && candidates.length > 0);
        const signal = assistantSignal();
        if (!signal) clearAudio(); else audioLive = true;
        const eligible = active && !reduced() && config.speed > 0 ? [...records.values()]
            .filter(record => record.visible && record.el.isConnected && record.variant !== 'thumb'
                && ((record.width >= 96 && record.height >= 96)
                    || (audioLive && record.variant === 'chat' && record.width >= 32 && record.height >= 32)))
            .sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 2) : [];
        const selected = new Set(eligible);
        if (!active || reduced() || config.speed <= 0 || drawBlocked || !engine?.available
            || (pointerOwner && !selected.has(pointerOwner))) clearPointer(true);
        for (const record of records.values()) {
            const animated = selected.has(record);
            if (record.animated !== animated) { record.animated = animated; record.dirty = true; }
            if ((!active || !record.visible) && record.el.dataset.particlesReady === 'true') {
                record.el.dataset.particlesStatus = 'paused';
            }
            if (!active || !record.visible || !record.el.isConnected || !record.width || !record.height) continue;
            if (record.dirty) render(record, animationTime);
        }
        if (!engine?.available || drawBlocked) syncAudioMeter(false);
        schedule();
    }
    function tick(now) {
        raf = 0;
        if (!canAnimate()) { lastFrame = 0; return; }
        if (lastFrame && now - lastFrame < FRAME_INTERVAL) { schedule(); return; }
        const signal = assistantSignal();
        if (!!signal !== audioLive) { reconcile(); if (!canAnimate()) return; }
        sampleAudio(now, signal);
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
        patch = object(patch);
        const values = { ...config, ...patch };
        if (Object.prototype.hasOwnProperty.call(patch, 'color')
            && !Object.prototype.hasOwnProperty.call(patch, 'energyColor')) values.energyColor = patch.color;
        const next = normalize(values);
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
        canvas.setAttribute('aria-label', 'Núcleo visual de Gunter');
        canvas.textContent = 'Núcleo visual de Gunter';
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
            // Layout dimensions stay stable during the presence controller's
            // FLIP scale. Measuring its animated bounds left the final hero
            // permanently rendered at the dock's low resolution.
            const width = Math.max(0, typeof el.clientWidth === 'number' ? el.clientWidth : box.width);
            const height = Math.max(0, typeof el.clientHeight === 'number' ? el.clientHeight : box.height);
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
        if (pointerOwner === record) clearPointer(true);
        observer?.unobserve(record.el); record.resizeObserver?.disconnect();
        if (record.revealedStatus) record.el.setAttribute('aria-hidden', record.originalAriaHidden);
        record.disposers.forEach(remove => remove()); record.canvas.remove(); record.status.remove();
        records.delete(record.el);
        if (!records.size) {
            syncAudioMeter(false);
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
        listen(window, 'pointermove', movePointer, { passive: true });
        listen(window, 'pointerout', event => { if (!event.relatedTarget) clearPointer(); }, { passive: true });
        listen(window, 'pointercancel', () => clearPointer(), { passive: true });
        listen(window, 'blur', () => clearPointer());
        listen(window, 'gunter-voice-ready', () => reconcile());
        listen(window, 'gunter-audio-level', event => {
            if (bindingMeter || event.detail?.source !== 'assistant' || !meterEnabled) return;
            // Events only wake the loop. Levels come from the actual voice meter,
            // not microphone events, "speaking" flags or arbitrary event payloads.
            const live = !!assistantSignal();
            if (live !== audioLive) reconcile();
        });
        listen(window, 'gunter-idle-core-availability', invalidate);
        listen(document, 'visibilitychange', () => {
            if (document.hidden) stopFrames();
            invalidate();
        });
        listen(window, 'pagehide', event => {
            suspended = true; stopFrames(); clearPointer(true); syncAudioMeter(false);
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
