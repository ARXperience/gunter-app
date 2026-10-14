/* Gunter's abstract energy identity. One local canvas renderer, no audio capture,
 * network, models or invented spectrum. Speaking topology follows real playback. */
(function () {
    'use strict';
    if (window.GunterParticles) return;
    const source = document.currentScript?.src || new URL('js/services/gunter-particles.js', location.href).href;
    const fallbackURL = new URL('../../assets/gunter/gunter-core.svg', source).href;
    const records = new Map();
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let raf = 0, lastFrame = 0, disposed = false, voiceSpeaking = false;
    let conversation = window.GunterConversationState?.getState?.().value || 'idle';
    let savedReduced = false;
    const TAU = Math.PI * 2;
    function refreshPreferences() {
        try { savedReduced = JSON.parse(window.localStorage?.getItem('gunter_prefs') || '{}').reduceMotion === true; }
        catch (_) { savedReduced = false; }
    }
    refreshPreferences();
    function reduced() { return !!motionQuery?.matches || savedReduced || document.documentElement.classList.contains('reduce-motion'); }
    function light() { return document.body.classList.contains('at-light') || document.documentElement.dataset.colorMode === 'light'; }
    function state() {
        let active = voiceSpeaking;
        try {
            const playback = window.GunterVoice?.getPlaybackState?.();
            if (typeof playback?.speaking === 'boolean') active = playback.speaking;
        } catch (_) { /* visual state must never interrupt the assistant */ }
        if (active) return 'speaking';
        // The conversational brain may be ready to speak before audio starts.
        if (conversation === 'speaking') return 'thinking';
        return ['thinking', 'listening_query', 'listening_wake', 'awaiting_confirmation', 'error'].includes(conversation) ? conversation : 'idle';
    }
    const observer = 'IntersectionObserver' in window ? new window.IntersectionObserver(entries => {
        entries.forEach(entry => { const record = records.get(entry.target); if (record) { record.visible = entry.isIntersecting; record.dirty = true; } });
        schedule();
    }, { rootMargin: '24px' }) : null;
    function listen(record, element, type, handler, options) {
        element.addEventListener(type, handler, options);
        record.listeners.push(() => element.removeEventListener(type, handler, options));
    }
    function seededPoints(count) {
        // Stable geometry prevents flicker, including on low-motion devices.
        let seed = 1917;
        const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
        return Array.from({ length: count }, () => ({
            angle: random() * TAU, radius: Math.pow(random(), .68), depth: random() * 2 - 1,
            phase: random() * TAU, size: .3 + random() * .7, brightness: random()
        }));
    }
    function mountOne(el) {
        if (records.has(el) || !el.isConnected || disposed) return;
        const variant = ['hero', 'chat'].includes(el.dataset.gunterParticles) ? el.dataset.gunterParticles : 'thumb';
        const fallback = document.createElement('img');
        fallback.src = fallbackURL; fallback.alt = ''; fallback.className = 'gunter-core-fallback';
        fallback.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;';
        fallback.setAttribute('aria-hidden', 'true'); fallback.draggable = false;
        const canvas = document.createElement('canvas');
        canvas.className = 'gunter-particle-art__canvas'; canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'display:block;width:100%;height:100%;position:absolute;inset:0;pointer-events:none;';
        let context;
        try { context = canvas.getContext('2d', { alpha: true }); } catch (_) { /* use static identity */ }
        const mobile = window.matchMedia?.('(max-width: 700px)')?.matches || false;
        const record = { el, variant, mobile, canvas, fallback, context, width: 0, height: 0, ratio: 1,
            visible: true, dirty: true, time: 0, activity: state() === 'speaking' ? 1 : 0,
            pointerX: 0, pointerY: 0, targetX: 0, targetY: 0, listeners: [],
            particles: seededPoints(variant === 'hero' ? (mobile ? 420 : 880) : variant === 'chat' ? 150 : 65) };
        records.set(el, record);
        el.classList.add('gunter-particle-art', 'gunter-energy-core');
        el.replaceChildren(fallback);
        el.dataset.particlesRenderer = context ? 'canvas-2d' : 'static-svg';
        el.dataset.particlesReady = context ? 'true' : 'fallback';
        el.dataset.coreState = state();
        if (context) el.appendChild(canvas);
        const resize = () => {
            const box = el.getBoundingClientRect(); record.width = box.width; record.height = box.height;
            if (!context || box.width <= 0 || box.height <= 0) return;
            record.ratio = Math.min(window.devicePixelRatio || 1, variant === 'hero' ? 1.5 : 1.75);
            canvas.width = Math.max(1, Math.round(box.width * record.ratio));
            canvas.height = Math.max(1, Math.round(box.height * record.ratio));
            record.dirty = true; schedule();
        };
        if ('ResizeObserver' in window) { record.resizeObserver = new window.ResizeObserver(resize); record.resizeObserver.observe(el); }
        else listen(record, window, 'resize', resize);
        if (variant === 'hero' && context) {
            const pointer = event => {
                if (reduced()) return;
                const box = el.getBoundingClientRect();
                if (!box.width || !box.height) return;
                record.targetX = Math.max(-1, Math.min(1, (event.clientX - box.left) / box.width * 2 - 1));
                record.targetY = Math.max(-1, Math.min(1, (event.clientY - box.top) / box.height * 2 - 1));
                schedule();
            };
            const reset = () => { record.targetX = record.targetY = 0; schedule(); };
            listen(record, el, 'pointermove', pointer, { passive: true });
            listen(record, el, 'pointerleave', reset, { passive: true });
            listen(record, el, 'pointercancel', reset, { passive: true });
        }
        observer?.observe(el); resize(); schedule();
    }
    function mount(root = document) {
        const elements = [...(root.querySelectorAll?.('[data-gunter-particles]') || [])];
        if (root.matches?.('[data-gunter-particles]')) elements.push(root);
        elements.forEach(mountOne);
    }
    function glow(context, x, y, radius, stops) {
        const gradient = context.createRadialGradient(x, y, 0, x, y, Math.max(radius, .1));
        stops.forEach(([offset, color]) => gradient.addColorStop(offset, color));
        context.fillStyle = gradient; context.beginPath(); context.arc(x, y, radius, 0, TAU); context.fill();
    }
    function trace(context, points, color, width, opacity, blur) {
        if (opacity <= .01) return;
        context.beginPath(); points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
        context.globalAlpha = opacity; context.strokeStyle = color; context.lineWidth = width;
        context.shadowColor = color; context.shadowBlur = blur; context.stroke(); context.shadowBlur = 0; context.globalAlpha = 1;
    }
    function render(record, dt) {
        const context = record.context;
        if (!context || !record.width || !record.height) { record.dirty = false; return; }
        const motion = !reduced(), current = state(), talking = current === 'speaking';
        if (record.el.dataset.coreState !== current) record.el.dataset.coreState = current;
        if (motion) record.time += dt;
        record.activity = motion ? record.activity + ((talking ? 1 : 0) - record.activity) * (1 - Math.exp(-dt * 5)) : talking ? 1 : 0;
        record.pointerX += ((motion ? record.targetX : 0) - record.pointerX) * .08;
        record.pointerY += ((motion ? record.targetY : 0) - record.pointerY) * .08;
        const time = motion ? record.time : 0, active = record.activity, isLight = light();
        const hero = record.variant === 'hero', compact = record.variant === 'thumb';
        const width = record.width, height = record.height, size = Math.min(width, height);
        const cx = width / 2, cy = height / 2, scale = size * (compact ? .94 : .96);
        const purple = isLight ? '#7135b4' : '#c198ff', violet = isLight ? '#9050c7' : '#9661ef';
        const white = isLight ? '#7433ac' : '#fff4ff', amber = isLight ? '#b6651c' : '#ffb95e';
        context.setTransform(record.ratio, 0, 0, record.ratio, 0, 0); context.clearRect(0, 0, width, height);
        context.globalCompositeOperation = isLight ? 'source-over' : 'lighter';
        const pulse = motion ? 1 + Math.sin(time * .65) * .025 : 1;
        glow(context, cx, cy, scale * .46, [[0, isLight ? '#9a67d41f' : '#8231e724'], [.55, isLight ? '#ae7adc12' : '#6230ce14'], [1, '#7b36ba00']]);
        // A luminous nucleus and distributed spherical mist, never a silhouette.
        const cloudRadius = scale * (.165 + active * .115) * pulse;
        context.shadowBlur = 0;
        for (const particle of record.particles) {
            const a = particle.angle + time * (.075 + particle.depth * .025);
            const irregular = 1 + active * (.24 * Math.sin(a * 5 + time * 1.2 + particle.phase) + .16 * Math.sin(a * 9 - time * .75));
            const radius = particle.radius * cloudRadius * irregular;
            const x = cx + Math.cos(a) * radius;
            const y = cy + Math.sin(a) * radius * (.87 + particle.depth * .12);
            const glint = motion ? .65 + .35 * Math.sin(time * .8 + particle.phase) : .9;
            context.fillStyle = particle.brightness > .83 ? white : violet;
            context.globalAlpha = (isLight ? .48 : .68) * glint * (1 - particle.radius * .58);
            context.beginPath(); context.arc(x, y, Math.max(.35, scale * .0017 * particle.size), 0, TAU); context.fill();
            if (active > .025) {
                // Clustered fine grain gives speech an organic, dense inner cloud
                // rather than enlarging the idle sphere or drawing an audio meter.
                const knotAngle = particle.phase + time * .14 + Math.sin(particle.angle * 4 + time * .3) * .22;
                const knotRadius = scale * (.115 + Math.sin(particle.angle * 3 + time * .35) * .035) * Math.pow(particle.radius, 1.6);
                const knotX = cx + Math.cos(knotAngle) * knotRadius * 1.18;
                const knotY = cy + Math.sin(knotAngle) * knotRadius * .86;
                const grain = Math.max(.24, scale * .00075 * particle.size);
                context.globalAlpha = active * (isLight ? .33 : .4) * (.45 + particle.brightness * .55);
                context.beginPath();
                context.arc(knotX, knotY, grain, 0, TAU);
                context.arc(knotX + Math.cos(particle.angle) * grain * 4, knotY + Math.sin(particle.phase) * grain * 5, grain * .8, 0, TAU);
                context.arc(knotX - Math.sin(particle.angle) * grain * 3, knotY - Math.cos(particle.phase) * grain * 6, grain * .7, 0, TAU);
                context.fill();
            }
        }
        context.globalAlpha = 1;
        // Idle intersecting orbital ribbons fade out as the core becomes a living
        // cloud of branching wisps while audio is genuinely being played.
        const orbitCount = compact ? 3 : 6, samples = compact ? 40 : hero ? 116 : 64;
        for (let orbit = 0; orbit < orbitCount; orbit++) {
            const points = [], angle = orbit * Math.PI / orbitCount + time * (orbit % 2 ? -.055 : .04) + record.pointerX * .05;
            const radius = scale * (.275 + (orbit % 3) * .028);
            const flatten = .5 + (orbit % 3) * .14 + record.pointerY * .025;
            for (let i = 0; i <= samples; i++) {
                const a = i / samples * TAU, wave = Math.sin(a * 3 + time * .42 + orbit) * .025;
                const x = Math.cos(a) * radius * (1 + wave), y = Math.sin(a) * radius * flatten;
                points.push([cx + x * Math.cos(angle) - y * Math.sin(angle), cy + x * Math.sin(angle) + y * Math.cos(angle)]);
            }
            trace(context, points, orbit === 0 ? amber : orbit % 2 ? white : purple,
                Math.max(.6, scale * .0024), (.57 + (orbit % 2) * .14) * (1 - active), compact ? 2 : scale * .02);
        }
        const ringRadius = scale * .193 * pulse;
        context.globalAlpha = .82 * (1 - active); context.strokeStyle = amber;
        context.lineWidth = Math.max(1, scale * .006); context.shadowColor = amber; context.shadowBlur = scale * .025;
        context.beginPath(); context.arc(cx, cy, ringRadius, 0, TAU); context.stroke();
        context.shadowBlur = 0; context.globalAlpha = 1;
        if (active > .025) {
            const tendrils = compact ? 8 : hero ? (record.mobile ? 24 : 78) : 22;
            for (let branch = 0; branch < tendrils; branch++) {
                const points = [], phase = branch * 2.399963229728653;
                const variation = (Math.sin(branch * 13.17) + 1) / 2;
                const clusterX = Math.cos(phase * .47 + time * .14) * scale * .055 * variation;
                const clusterY = Math.sin(phase * .62 + time * .16) * scale * .048 * variation;
                const length = compact ? 28 : hero && !record.mobile ? 66 : 42;
                for (let i = 0; i < length; i++) {
                    const u = i / (length - 1), envelope = Math.pow(Math.sin(u * Math.PI), .7);
                    const fold = Math.sin(u * 8 + phase + time * .42) * .2 + Math.sin(u * 18 - time * .7 + phase) * .055;
                    const r = scale * (.022 + envelope * (.17 + variation * .15) * (.64 + .36 * Math.sin(u * 9 + phase + time * .23)));
                    const a = phase + u * TAU * (.72 + variation * .68) + time * (.12 + variation * .09) + fold;
                    // Neighboring fibers braid into transient folds and a few
                    // wisps trail outward; no radial spokes or perfect hoops.
                    const tail = branch % 7 === 0 ? Math.pow(u, 5) * scale * .15 : 0;
                    points.push([cx + clusterX + Math.cos(a) * (r + tail) * (1 + Math.sin(u * 5 + phase + time * .25) * .16),
                        cy + clusterY + Math.sin(a) * (r + tail) * (.67 + variation * .16) + Math.sin(u * 13 + time * .32 + phase) * scale * .013]);
                }
                const color = branch % 31 === 0 ? amber : branch % 5 === 0 ? white : branch % 2 ? purple : violet;
                // Five bounded spans taper strand ends without a separate
                // shader, offscreen renderer or unbounded trail buffer.
                for (let span = 0; span < 5; span++) {
                    const begin = Math.floor(span / 5 * (length - 1)), end = Math.ceil((span + 1) / 5 * (length - 1));
                    const alpha = [.18, .58, .84, .52, .12][span] * active * (.34 + variation * .35);
                    trace(context, points.slice(begin, end + 1), color, Math.max(.3, scale * .00095 * (.55 + variation)), alpha,
                        compact ? .5 : scale * .0025);
                }
            }
        }
        glow(context, cx, cy, scale * (.108 + active * .025), [[0, isLight ? '#7d36b36b' : `rgba(240,201,255,${.51 - active * .41})`],
            [.35, isLight ? '#9660d340' : `rgba(193,128,255,${.27 - active * .21})`], [1, '#8544c200']]);
        glow(context, cx, cy, scale * .037 * (1 - active * .65), [[0, isLight ? '#713aaaea' : `rgba(255,255,255,${.98 - active * .7})`],
            [.35, isLight ? '#8f53cabf' : `rgba(255,245,255,${.87 - active * .68})`], [1, '#bd7cff00']]);
        context.globalCompositeOperation = 'source-over'; context.globalAlpha = 1;
        record.fallback.hidden = true; record.fallback.style.display = 'none'; record.dirty = false;
    }
    function schedule() { if (!raf && !disposed && !document.hidden) raf = window.requestAnimationFrame(tick); }
    function tick(now) {
        raf = 0;
        if (disposed || document.hidden) { lastFrame = 0; return; }
        if (lastFrame && now - lastFrame < 32) { schedule(); return; }
        const dt = lastFrame ? Math.min((now - lastFrame) / 1000, .06) : 1 / 30;
        lastFrame = now; let continuing = false;
        for (const record of records.values()) {
            if (!record.el.isConnected) { destroy(record); continue; }
            if (!record.visible || !record.width || !record.height || !record.context) continue;
            const moving = !reduced() && (record.variant !== 'thumb' || state() === 'speaking' || record.activity > .01);
            if (record.dirty || moving) render(record, dt);
            continuing ||= moving;
        }
        if (continuing) schedule(); else lastFrame = 0;
    }
    function destroy(record) {
        observer?.unobserve(record.el); record.resizeObserver?.disconnect(); record.listeners.forEach(remove => remove());
        record.canvas.remove(); record.fallback.remove(); records.delete(record.el);
        delete record.el.dataset.particlesReady; delete record.el.dataset.particlesRenderer;
    }
    function invalidate() { records.forEach(record => { record.dirty = true; record.el.dataset.coreState = state(); }); schedule(); }
    function init() {
        mount();
        const mutations = new window.MutationObserver(entries => {
            entries.forEach(entry => {
                if (entry.type === 'attributes') { refreshPreferences(); invalidate(); }
                else for (const node of entry.addedNodes) if (node.nodeType === 1) mount(node);
            });
            for (const record of records.values()) if (!record.el.isConnected) destroy(record);
        });
        mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
        mutations.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-color-mode'] });
        const onConversation = event => { conversation = event.detail?.value || 'idle'; invalidate(); };
        const onVoice = event => { voiceSpeaking = event.detail?.speaking === true || event.detail?.state === 'speaking'; invalidate(); };
        const onMotion = () => { refreshPreferences(); invalidate(); };
        const onStorage = event => { if (event.key === 'gunter_prefs' || event.key === null) onMotion(); };
        window.addEventListener('gunter-conversation-state', onConversation);
        window.addEventListener('gunter-voice-state', onVoice);
        window.addEventListener('storage', onStorage); motionQuery?.addEventListener?.('change', onMotion);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) { window.cancelAnimationFrame(raf); raf = 0; lastFrame = 0; }
            else invalidate();
        });
        window.addEventListener('pagehide', event => {
            window.cancelAnimationFrame(raf); raf = 0; lastFrame = 0;
            if (event.persisted) return;
            disposed = true; records.forEach(destroy); mutations.disconnect(); observer?.disconnect();
            window.removeEventListener('gunter-conversation-state', onConversation);
            window.removeEventListener('gunter-voice-state', onVoice);
            window.removeEventListener('storage', onStorage); motionQuery?.removeEventListener?.('change', onMotion);
        });
        window.addEventListener('pageshow', invalidate);
    }
    window.GunterParticles = { mount };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
