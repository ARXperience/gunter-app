/* =============================================
   GUNTER — Cinematic Shell / Friendly Head Rig
   -------------------------------------------------
   Mantiene el cuerpo completamente estable y mueve
   sólo la cabeza con una respuesta suave al puntero.
   ============================================= */
(function () {
    'use strict';
    if (window.GunterCinematicShell) return;

    const MASCOT_SOURCE = 'assets/gunter/gunter-prism-nobg.png';
    const PAGE_MAP = [
        ['login.html', 'login'], ['dashboard.html', 'dashboard'], ['day.html', 'day'],
        ['config.html', 'config'], ['new-project.html', 'new-project'],
        ['meeting.html', 'meeting'], ['results.html', 'results'], ['admin.html', 'admin']
    ];

    let rigs = [];
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let raf = 0;
    let reducedMotion = false;

    function pageName() {
        const path = location.pathname.toLowerCase();
        const match = PAGE_MAP.find(([file]) => path.endsWith(file));
        return match ? match[1] : 'portal';
    }

    function createElement(tag, className, text = '') {
        const node = document.createElement(tag);
        node.className = className;
        if (text) node.textContent = text;
        return node;
    }

    function mascotImage(className, src, alt = '') {
        const image = createElement('img', className);
        image.src = src;
        image.alt = alt;
        image.decoding = 'async';
        image.draggable = false;
        return image;
    }

    function createHeadRig(src = MASCOT_SOURCE, alt = '', modifier = '') {
        const rig = createElement('div', `gunter-character-rig ${modifier}`.trim());
        if (alt) {
            rig.setAttribute('role', 'img');
            rig.setAttribute('aria-label', alt);
        } else {
            rig.setAttribute('aria-hidden', 'true');
        }

        const body = mascotImage('gunter-character-body', src);
        const head = createElement('div', 'gunter-character-head');
        head.append(mascotImage('gunter-character-head__image', src));
        rig.append(body, head);
        rigs.push(rig);
        return rig;
    }

    function enhanceHeroMascot() {
        const original = document.querySelector('.prism-hero__img-wrap > img');
        if (!original) return;
        enhanceMascot(original);
    }

    function enhanceMascot(original) {
        if (!original || original.closest('.gunter-character-rig')) return original?.closest('.gunter-character-rig') || null;
        const rig = createHeadRig(original.getAttribute('src') || MASCOT_SOURCE, original.alt || 'Gunter', 'gunter-character-rig--hero');
        original.replaceWith(rig);
        return rig;
    }

    function updateTarget(event) {
        if (!event || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return;
        targetX = Math.max(-1, Math.min(1, (event.clientX / Math.max(innerWidth, 1) - 0.5) * 2));
        targetY = Math.max(-1, Math.min(1, (event.clientY / Math.max(innerHeight, 1) - 0.5) * 2));
    }

    function centerGaze() {
        targetX = 0;
        targetY = 0;
        requestRender();
    }

    function render() {
        currentX += (targetX - currentX) * 0.09;
        currentY += (targetY - currentY) * 0.09;

        const x = currentX * 4.5;
        const y = currentY * 3.2;
        const yaw = currentX * 5.5;
        const pitch = currentY * -3.8;
        const roll = currentX * 2.2;

        rigs = rigs.filter(rig => rig.isConnected);
        rigs.forEach(rig => {
            rig.style.setProperty('--gunter-head-x', `${x.toFixed(2)}px`);
            rig.style.setProperty('--gunter-head-y', `${y.toFixed(2)}px`);
            rig.style.setProperty('--gunter-head-yaw', `${yaw.toFixed(2)}deg`);
            rig.style.setProperty('--gunter-head-pitch', `${pitch.toFixed(2)}deg`);
            rig.style.setProperty('--gunter-head-roll', `${roll.toFixed(2)}deg`);
        });

        const moving = Math.abs(targetX - currentX) > 0.001 || Math.abs(targetY - currentY) > 0.001;
        raf = moving ? requestAnimationFrame(render) : 0;
    }

    function requestRender() {
        if (!reducedMotion && !raf) raf = requestAnimationFrame(render);
    }

    function init() {
        if (!document.body || document.querySelector('.gunter-cinematic-bg')) return;
        const page = pageName();
        document.body.classList.add('gunter-cinematic', `gunter-page-${page}`);
        reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

        const preload = new Image();
        preload.decoding = 'async';
        preload.src = MASCOT_SOURCE;

        const backdrop = createElement('div', 'gunter-cinematic-bg');
        backdrop.setAttribute('aria-hidden', 'true');
        document.body.prepend(backdrop);
        enhanceHeroMascot();

        if (!reducedMotion && !matchMedia('(pointer: coarse)').matches) {
            addEventListener('pointermove', event => { updateTarget(event); requestRender(); }, { passive: true });
            document.documentElement.addEventListener('pointerleave', centerGaze, { passive: true });
            addEventListener('blur', centerGaze, { passive: true });
        }

        requestAnimationFrame(() => document.body.classList.add('gunter-cinematic-ready'));
    }

    window.GunterCinematicShell = { init, mascot: MASCOT_SOURCE, enhance: enhanceMascot };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
