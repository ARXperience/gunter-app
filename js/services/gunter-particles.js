/* Shared Gunter identity: original local video, light SVG geometry and real audio levels.
 * Existing mount API/routes stay unchanged. This renderer never captures a microphone. */
(function () {
    'use strict';
    if (window.GunterParticles) return;
    const script = document.currentScript?.src || new URL('js/services/gunter-particles.js', location.href).href;
    const videoURL = new URL('../../assets/gunter/gunter-core-video.mp4', script).href;
    const posterURL = new URL('../../assets/gunter/gunter-core-video-poster.jpg', script).href;
    const DEFAULTS = Object.freeze({ color: '#8b6cff', size: 1, mouseSensitivity: .65,
        voiceIntensity: 1, geometry: 'flower', geometryOpacity: .12 });
    const records = new Map(), signals = new Map(), disposers = [];
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let config, savedReduced = false, raf = 0, lastFrame = 0, disposed = false;
    let conversation = 'idle', voiceSpeaking = false;
    const clamp = (value, low, high, fallback) => typeof value === 'number' && Number.isFinite(value)
        ? Math.max(low, Math.min(high, value)) : fallback;
    function normalize(value = {}) {
        return {
            color: /^#[0-9a-f]{6}$/i.test(value.color) ? value.color.toLowerCase() : DEFAULTS.color,
            size: clamp(value.size, .7, 1.3, DEFAULTS.size),
            mouseSensitivity: clamp(value.mouseSensitivity, 0, 1.5, DEFAULTS.mouseSensitivity),
            voiceIntensity: clamp(value.voiceIntensity, 0, 2, DEFAULTS.voiceIntensity),
            geometry: ['flower', 'metatron', 'none'].includes(value.geometry) ? value.geometry : DEFAULTS.geometry,
            geometryOpacity: clamp(value.geometryOpacity, 0, .4, DEFAULTS.geometryOpacity)
        };
    }
    function readPreferences() {
        try {
            const value = JSON.parse(window.localStorage?.getItem('gunter_prefs') || '{}');
            return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        } catch { return {}; }
    }
    function refreshPreferences() {
        const prefs = readPreferences();
        savedReduced = prefs.reduceMotion === true;
        config = normalize(prefs.coreVisual || {});
    }
    function reduced() { return !!motionQuery?.matches || savedReduced || document.documentElement.classList.contains('reduce-motion'); }
    function capturing() {
        const ptt = window.GunterSTT?.pushToTalk?.getState?.();
        const wake = window.GunterWakeWord?.getState?.();
        return ptt?.phase === 'recording' || window.GunterVoiceActivity?.getState?.().active === true
            || (wake?.active === true && ['wake', 'query'].includes(wake.mode));
    }
    function state() {
        const playback = window.GunterVoice?.getPlaybackState?.();
        if (typeof playback?.speaking === 'boolean' ? playback.speaking : voiceSpeaking) return 'speaking';
        const value = window.GunterConversationState?.getState?.().value || conversation;
        if (playback?.pending || ['speaking', 'thinking'].includes(value)) return 'thinking';
        if (['awaiting_confirmation', 'error'].includes(value)) return value;
        return capturing() ? 'listening' : 'idle';
    }
    function measuredLevel(current, now) {
        const source = current === 'speaking' ? 'assistant' : current === 'listening' ? 'microphone' : null;
        const signal = signals.get(source);
        const valid = signal?.active === true && signal.available === true && now - signal.at < 250;
        return { source, available: valid, level: valid ? signal.level : 0 };
    }
    function colorSettings(color) {
        const rgb = color.match(/[0-9a-f]{2}/gi).map(part => parseInt(part, 16) / 255);
        const max = Math.max(...rgb), min = Math.min(...rgb), delta = max - min;
        let hue = 0;
        if (delta) {
            const channel = rgb.indexOf(max);
            hue = (channel === 0 ? (rgb[1] - rgb[2]) / delta : channel === 1
                ? 2 + (rgb[2] - rgb[0]) / delta : 4 + (rgb[0] - rgb[1]) / delta) * 60;
        }
        return { hue: (hue + 360) % 360 - 6, saturation: max ? (delta / max) / .85 : 0 };
    }
    function geometryMarkup(kind) {
        if (kind === 'none') return '';
        const centers = [[100, 100]];
        const circle = (x, y, radius) => '<circle cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" r="' + radius + '"/>';
        if (kind === 'flower') {
            let result = circle(100, 100, 30);
            for (const radius of [30, 30 * Math.sqrt(3), 60]) for (let n = 0; n < 6; n++) {
                const angle = Math.PI * n / 3 + (radius > 40 && radius < 60 ? Math.PI / 6 : 0);
                result += circle(100 + Math.cos(angle) * radius, 100 + Math.sin(angle) * radius, 30);
            }
            return result;
        }
        for (const radius of [35, 70]) for (let n = 0; n < 6; n++) {
            const angle = n * Math.PI / 3 - Math.PI / 2;
            centers.push([100 + Math.cos(angle) * radius, 100 + Math.sin(angle) * radius]);
        }
        const lines = centers.flatMap(([x1, y1], index) => centers.slice(index + 1).map(([x2, y2]) =>
            '<path d="M' + x1.toFixed(2) + ' ' + y1.toFixed(2) + 'L' + x2.toFixed(2) + ' ' + y2.toFixed(2) + '"/>')).join('');
        return lines + centers.map(([x, y]) => circle(x, y, 14)).join('');
    }
    function listen(target, type, fn, options, list = disposers) {
        target.addEventListener(type, fn, options);
        list.push(() => target.removeEventListener(type, fn, options));
    }
    function applyConfig(record) {
        const colors = colorSettings(config.color);
        record.el.style.setProperty('--core-color', config.color);
        record.el.style.setProperty('--core-hue', colors.hue + 'deg');
        record.el.style.setProperty('--core-saturation', Math.min(1.5, colors.saturation).toFixed(3));
        record.el.style.setProperty('--core-size', String(config.size));
        record.el.style.setProperty('--core-geometry-opacity', String(config.geometryOpacity));
        if (record.geometryKind !== config.geometry) {
            record.geometry.innerHTML = geometryMarkup(config.geometry);
            record.geometryKind = config.geometry;
        }
        record.dirty = true;
    }
    function configure(patch = {}, options = {}) {
        const next = normalize({ ...config, ...patch });
        if (options.persist === true) {
            // Merge the existing preferences; do not replace other settings/accounts.
            const prefs = readPreferences();
            window.localStorage?.setItem('gunter_prefs', JSON.stringify({ ...prefs, coreVisual: next }));
        }
        config = next;
        records.forEach(applyConfig);
        updatePlayback(); schedule();
        window.dispatchEvent(new CustomEvent('gunter-core-config-changed', { detail: { ...config } }));
        return { ...config };
    }
    function showPoster(record) {
        record.poster.hidden = false;
        if (record.video) record.video.hidden = true;
    }
    function ensureVideo(record) {
        if (record.video) return record.video;
        const video = document.createElement('video');
        video.className = 'gunter-core-video';
        video.muted = video.defaultMuted = true;
        video.loop = true; video.autoplay = true; video.playsInline = true;
        video.preload = 'metadata'; video.disablePictureInPicture = true;
        video.setAttribute('muted', ''); video.setAttribute('playsinline', '');
        video.setAttribute('aria-hidden', 'true'); video.setAttribute('tabindex', '-1');
        video.poster = posterURL;
        record.video = video;
        listen(video, 'playing', () => {
            record.playPending = false;
            if (!record.wanted) { video.pause(); return; }
            record.poster.hidden = true; video.hidden = false;
            record.el.dataset.videoPlayback = 'playing';
            record.el.dataset.particlesReady = 'true';
        }, undefined, record.disposers);
        listen(video, 'error', () => {
            record.playPending = false; record.failed = true;
            record.el.dataset.videoPlayback = 'error'; showPoster(record);
        }, undefined, record.disposers);
        record.media.appendChild(video);
        video.src = videoURL;
        return video;
    }
    function play(record) {
        const video = ensureVideo(record);
        if (!video.paused || record.playPending) return;
        record.playPending = true;
        const pending = video.play();
        pending?.catch?.(() => {
            record.playPending = false;
            record.el.dataset.videoPlayback = 'blocked'; showPoster(record);
        });
    }
    function syncAnalysis() {
        const enabled = !document.hidden && !disposed && !reduced() && config.voiceIntensity > 0
            && [...records.values()].some(record => record.visible && record.width > 0 && record.height > 0);
        window.GunterVoice?.setAudioAnalysisEnabled?.(enabled);
        window.GunterVoiceActivity?.setVisualLevelsEnabled?.(enabled);
    }
    function updatePlayback() {
        if (disposed) return;
        // At most two decoders; small avatars use the identical local poster.
        const eligible = !document.hidden && !reduced() ? [...records.values()]
            .filter(record => record.visible && record.el.isConnected && !record.failed
                && record.variant !== 'thumb' && record.width >= 96 && record.height >= 96)
            .sort((a, b) => b.width * b.height - a.width * a.height).slice(0, 2) : [];
        const selected = new Set(eligible);
        for (const record of records.values()) {
            record.wanted = selected.has(record);
            if (record.wanted) play(record);
            else {
                record.video?.pause(); showPoster(record);
                record.el.dataset.videoPlayback = reduced() ? 'reduced-motion' : 'poster';
            }
        }
        syncAnalysis();
    }
    const observer = 'IntersectionObserver' in window ? new window.IntersectionObserver(entries => {
        entries.forEach(entry => { const record = records.get(entry.target); if (record) { record.visible = entry.isIntersecting; record.dirty = true; } });
        updatePlayback(); schedule();
    }, { rootMargin: '0px' }) : null;
    function mountOne(el) {
        if (disposed || records.has(el) || !el.isConnected) return;
        const variant = ['hero', 'chat'].includes(el.dataset.gunterParticles) ? el.dataset.gunterParticles : 'thumb';
        const motion = document.createElement('span'), media = document.createElement('span');
        motion.className = 'gunter-core-motion'; media.className = 'gunter-core-media';
        motion.setAttribute('aria-hidden', 'true');
        const poster = document.createElement('img');
        poster.src = posterURL; poster.alt = ''; poster.draggable = false;
        poster.className = 'gunter-core-video-poster';
        const geometry = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        geometry.setAttribute('viewBox', '0 0 200 200'); geometry.setAttribute('aria-hidden', 'true');
        geometry.classList.add('gunter-core-geometry');
        media.appendChild(poster); motion.appendChild(media); motion.appendChild(geometry);
        const record = { el, variant, motion, media, poster, geometry, geometryKind: null, width: 0, height: 0,
            visible: !observer, dirty: true, video: null, wanted: false, failed: false, playPending: false,
            pointerX: 0, pointerY: 0, targetX: 0, targetY: 0, envelope: 0, disposers: [] };
        records.set(el, record);
        el.classList.add('gunter-particle-art', 'gunter-energy-core', 'gunter-video-core');
        el.replaceChildren(motion);
        el.dataset.particlesRenderer = 'html-video'; el.dataset.particlesReady = 'poster';
        el.dataset.videoPlayback = 'poster';
        const resize = () => {
            const box = el.getBoundingClientRect();
            record.width = box.width; record.height = box.height; record.dirty = true;
            updatePlayback(); schedule();
        };
        if ('ResizeObserver' in window) {
            record.resizeObserver = new window.ResizeObserver(resize); record.resizeObserver.observe(el);
        } else listen(window, 'resize', resize, undefined, record.disposers);
        if (variant === 'hero') {
            const pointer = event => {
                if (reduced() || event.pointerType === 'touch') return;
                const box = el.getBoundingClientRect();
                if (!box.width || !box.height) return;
                record.targetX = Math.max(-1, Math.min(1, (event.clientX - box.left) / box.width * 2 - 1));
                record.targetY = Math.max(-1, Math.min(1, (event.clientY - box.top) / box.height * 2 - 1));
                schedule();
            };
            const reset = () => { record.targetX = record.targetY = 0; schedule(); };
            listen(el, 'pointermove', pointer, { passive: true }, record.disposers);
            listen(el, 'pointerleave', reset, { passive: true }, record.disposers);
            listen(el, 'pointercancel', reset, { passive: true }, record.disposers);
        }
        applyConfig(record); observer?.observe(el); resize(); schedule();
    }
    function mount(root = document) {
        const elements = [...(root.querySelectorAll?.('[data-gunter-particles]') || [])];
        if (root.matches?.('[data-gunter-particles]')) elements.push(root);
        elements.forEach(mountOne);
    }
    function render(record, dt, now) {
        const current = state(), signal = measuredLevel(current, now), motion = !reduced();
        const target = motion ? Math.min(1, signal.level * 4) * config.voiceIntensity : 0;
        if (!motion) { record.envelope = 0; record.pointerX = record.pointerY = 0; }
        record.envelope += (target - record.envelope) * (1 - Math.exp(-dt * (target > record.envelope ? 15 : 8)));
        const px = motion ? record.targetX * config.mouseSensitivity : 0, py = motion ? record.targetY * config.mouseSensitivity : 0;
        record.pointerX += (px - record.pointerX) * (1 - Math.exp(-dt * 8));
        record.pointerY += (py - record.pointerY) * (1 - Math.exp(-dt * 8));
        const hover = Math.min(1, Math.hypot(record.pointerX, record.pointerY));
        record.motion.style.setProperty('--core-x', (record.pointerX * 12).toFixed(2) + 'px');
        record.motion.style.setProperty('--core-y', (record.pointerY * 10).toFixed(2) + 'px');
        record.motion.style.setProperty('--core-react-scale', (1 + record.envelope * .12 + hover * .02).toFixed(4));
        record.motion.style.setProperty('--core-brightness', (1 + record.envelope * .85).toFixed(4));
        record.el.dataset.coreState = current;
        record.el.dataset.audioSignal = signal.source ? signal.available ? signal.source : 'unavailable' : 'none';
        record.el.dataset.audioLevel = signal.level.toFixed(3);
        if (record.video) {
            const speed = { idle: .85, listening: .95, thinking: 1.1, speaking: 1 }[current] || .85;
            if (record.video.playbackRate !== speed) record.video.playbackRate = speed;
        }
        record.dirty = false;
    }
    function schedule() { if (!raf && !disposed && !document.hidden) raf = window.requestAnimationFrame(tick); }
    function tick(now) {
        raf = 0;
        if (disposed || document.hidden) { lastFrame = 0; return; }
        if (lastFrame && now - lastFrame < 32) { schedule(); return; }
        const dt = lastFrame ? Math.min((now - lastFrame) / 1000, .06) : 1 / 30;
        lastFrame = now;
        let continuing = false;
        for (const record of records.values()) {
            if (!record.el.isConnected) { destroy(record); continue; }
            if (!record.visible || !record.width || !record.height) continue;
            const current = state(), signal = measuredLevel(current, now);
            const signalName = signal.source ? signal.available ? signal.source : 'unavailable' : 'none';
            const moving = !reduced() && (record.envelope > .001 || signal.available
                || Math.abs(record.pointerX - record.targetX * config.mouseSensitivity) > .001
                || Math.abs(record.pointerY - record.targetY * config.mouseSensitivity) > .001);
            if (record.dirty || moving || record.el.dataset.audioSignal !== signalName) render(record, dt, now);
            continuing ||= moving;
        }
        if (continuing) schedule(); else lastFrame = 0;
    }
    function destroy(record) {
        observer?.unobserve(record.el); record.resizeObserver?.disconnect();
        record.wanted = false; record.video?.pause();
        if (record.video) { record.video.removeAttribute('src'); record.video.load(); }
        record.disposers.forEach(remove => remove()); record.motion.remove(); records.delete(record.el);
        updatePlayback();
    }
    function invalidate() { records.forEach(record => { record.dirty = true; }); schedule(); }
    function init() {
        mount();
        const mutations = new window.MutationObserver(entries => {
            for (const entry of entries) {
                if (entry.type === 'attributes') {
                    if (entry.target === document.body || entry.target === document.documentElement) {
                        refreshPreferences(); records.forEach(applyConfig); updatePlayback(); invalidate();
                    }
                } else for (const node of entry.addedNodes) if (node.nodeType === 1) mount(node);
            }
            for (const record of records.values()) if (!record.el.isConnected) destroy(record);
        });
        mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        mutations.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        listen(window, 'gunter-conversation-state', event => { conversation = event.detail?.value || 'idle'; invalidate(); });
        listen(window, 'gunter-voice-state', event => { voiceSpeaking = event.detail?.speaking === true || event.detail?.state === 'speaking'; invalidate(); });
        for (const type of ['gunter-push-to-talk-state', 'wake-word-state', 'gunter-vad-state']) listen(window, type, invalidate);
        listen(window, 'gunter-audio-level', event => {
            const value = event.detail;
            if (!value || !['assistant', 'microphone'].includes(value.source)) return;
            signals.set(value.source, { level: clamp(value.level, 0, 1, 0), available: value.available === true,
                active: value.active === true, at: performance.now() });
            invalidate();
        });
        const preferencesChanged = () => { refreshPreferences(); records.forEach(applyConfig); updatePlayback(); invalidate(); };
        listen(window, 'storage', event => { if (event.key === 'gunter_prefs' || event.key === null) preferencesChanged(); });
        if (motionQuery?.addEventListener) listen(motionQuery, 'change', preferencesChanged);
        listen(document, 'visibilitychange', () => {
            if (document.hidden) { window.cancelAnimationFrame(raf); raf = 0; lastFrame = 0; }
            updatePlayback(); invalidate();
        });
        // Retry muted autoplay only after a real user interaction if the OS blocked it.
        listen(document, 'pointerdown', () => { for (const record of records.values()) if (record.wanted && record.el.dataset.videoPlayback === 'blocked') play(record); }, { passive: true });
        listen(window, 'pagehide', event => {
            window.cancelAnimationFrame(raf); raf = 0; lastFrame = 0;
            for (const record of records.values()) { record.wanted = false; record.video?.pause(); }
            window.GunterVoice?.setAudioAnalysisEnabled?.(false);
            window.GunterVoiceActivity?.setVisualLevelsEnabled?.(false);
            if (event.persisted) return;
            disposed = true; records.forEach(destroy); mutations.disconnect(); observer?.disconnect();
            disposers.splice(0).forEach(remove => remove());
        });
        listen(window, 'pageshow', () => { updatePlayback(); invalidate(); });
        syncAnalysis();
    }
    refreshPreferences();
    window.GunterParticles = { mount, configure, getConfig: () => ({ ...config }), getDefaults: () => ({ ...DEFAULTS }) };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
