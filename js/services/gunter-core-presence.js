/* One visual identity, transported between Inicio and the existing chat button.
   This controller owns layout only; GunterParticles owns rendering and real audio. */
(function () {
    'use strict';
    if (window.GunterCorePresence) return;
    const DOCK_SIZE = 112, DURATION = 550;
    const removers = [];
    const motionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    let portal, art, anchor, bubble, home, mode = '', target, animation;
    let mutationObserver, resizeObserver, frame = 0, started = false, disposed = false, suspended = false;
    let originalClass = '', borrowed = false;

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
    function rect(node) {
        if (!node?.isConnected) return null;
        const box = node.getBoundingClientRect();
        return [box.left, box.top, box.width, box.height].every(Number.isFinite) && box.width > 0 && box.height > 0
            ? { left: box.left, top: box.top, width: box.width, height: box.height } : null;
    }
    function same(a, b) {
        return a && b && ['left', 'top', 'width', 'height'].every(key => Math.abs(a[key] - b[key]) < .5);
    }
    function peeking(event) {
        if (!portal || mode !== 'dock') return;
        const entering = event.type === 'pointerenter' || event.type === 'focusin';
        if (!entering && event.relatedTarget && bubble?.contains?.(event.relatedTarget)) return;
        portal.classList.toggle('is-peeking', entering);
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
            if (bubble) {
                resizeObserver?.unobserve?.(bubble);
                for (const type of ['pointerenter', 'pointerleave', 'focusin', 'focusout']) bubble.removeEventListener(type, peeking);
            }
            bubble = nextBubble;
            if (bubble) {
                resizeObserver?.observe?.(bubble);
                for (const type of ['pointerenter', 'pointerleave', 'focusin', 'focusout']) bubble.addEventListener(type, peeking);
            }
        }
        if (!art) {
            const hero = home?.querySelector('.gn-orbit-core[data-gunter-particles]');
            if (!hero && !bubble) return false;
            portal = document.createElement('div');
            portal.className = 'gn-core-presence';
            portal.setAttribute('aria-hidden', 'true');
            portal.style.pointerEvents = 'none';
            portal.style.transformOrigin = '0 0';
            if (hero) {
                originalClass = hero.className;
                anchor = document.createElement('div');
                anchor.className = 'gn-orbit-core gn-core-presence-anchor';
                anchor.setAttribute('aria-hidden', 'true');
                // Moving the *same connected host* preserves the renderer record, phase and canvas.
                hero.replaceWith(anchor);
                art = hero; borrowed = true;
                art.classList.remove('gn-orbit-core');
                resizeObserver?.observe?.(anchor);
            } else {
                art = document.createElement('div');
                art.dataset.gunterParticles = 'hero';
            }
            art.classList.add('gn-core-presence__art');
            portal.append(art);
            document.body.append(portal);
            document.body.classList.add('gunter-core-presence-active');
            window.GunterParticles?.mount?.(art);
        }
        return true;
    }
    function cancelAnimation() {
        if (!animation) return;
        animation.onfinish = null;
        animation.cancel(); animation = null;
    }
    function move(next, nextMode) {
        portal.hidden = false;
        if (same(target, next) && mode === nextMode) {
            if (reduced()) cancelAnimation();
            return;
        }
        // Read before cancellation so fast route changes continue from the visible position.
        const before = mode ? rect(portal) : null;
        cancelAnimation();
        Object.assign(portal.style, { left: `${next.left}px`, top: `${next.top}px`,
            width: `${next.width}px`, height: `${next.height}px` });
        portal.dataset.mode = nextMode;
        portal.classList.remove('is-peeking');
        mode = nextMode; target = next;
        if (!before || reduced() || typeof portal.animate !== 'function') return;
        const dx = before.left - next.left, dy = before.top - next.top;
        const sx = before.width / next.width, sy = before.height / next.height;
        animation = portal.animate([
            { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 1 },
            { transform: 'translate(0px, 0px) scale(1, 1)', opacity: 1 }
        ], { duration: DURATION, easing: 'cubic-bezier(.22,.8,.24,1)', fill: 'none' });
        const current = animation;
        animation.onfinish = () => { if (animation === current) animation = null; };
    }
    function sync() {
        if (disposed || suspended || !document.body || !findTargets()) return;
        const isHome = !!home && !home.hidden && document.body.classList.contains('gunter-orbit-home-active');
        let destination = isHome ? rect(anchor) : null;
        if (destination) move(destination, 'home');
        else {
            const companion = document.getElementById('gunter-companion');
            if (companion?.hidden || companion?.classList.contains('is-hidden')) {
                portal.hidden = true; portal.classList.remove('is-peeking');
                cancelAnimation(); target = null; return;
            }
            const circle = rect(bubble);
            if (circle) {
                destination = { left: circle.left + (circle.width - DOCK_SIZE) / 2,
                    top: circle.top + (circle.height - DOCK_SIZE) / 2, width: DOCK_SIZE, height: DOCK_SIZE };
                move(destination, 'dock');
            } else { portal.hidden = true; cancelAnimation(); target = null; }
        }
    }
    function queueSync() {
        if (disposed || suspended || frame) return;
        // One layout frame per change, never a second render/animation loop.
        frame = window.requestAnimationFrame(() => { frame = 0; sync(); });
    }
    function dispose() {
        if (disposed) return;
        disposed = true;
        if (frame) window.cancelAnimationFrame(frame);
        frame = 0; cancelAnimation();
        mutationObserver?.disconnect(); resizeObserver?.disconnect();
        removers.splice(0).forEach(remove => remove());
        if (bubble) for (const type of ['pointerenter', 'pointerleave', 'focusin', 'focusout']) bubble.removeEventListener(type, peeking);
        if (borrowed && anchor?.isConnected) {
            art.className = originalClass;
            anchor.replaceWith(art);
        }
        portal?.remove();
        document.body?.classList.remove('gunter-core-presence-active');
    }
    function init() {
        if (started || disposed || !document.body) return;
        started = true;
        if (window.ResizeObserver) resizeObserver = new window.ResizeObserver(queueSync);
        if (window.MutationObserver) {
            mutationObserver = new window.MutationObserver(entries => {
                if (entries.some(entry => !portal?.contains?.(entry.target))) queueSync();
            });
            mutationObserver.observe(document.body, { childList: true, subtree: true, attributes: true,
                attributeFilter: ['class', 'hidden', 'aria-selected'] });
            mutationObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        }
        for (const event of ['hashchange', 'gunter-open-tab', 'resize', 'orientationchange', 'gunter-core-config-changed'])
            listen(window, event, queueSync);
        listen(window, 'storage', event => { if (!event.key || event.key === 'gunter_prefs') queueSync(); });
        listen(window.visualViewport, 'resize', queueSync);
        if (motionQuery?.addEventListener) listen(motionQuery, 'change', queueSync);
        listen(window, 'pagehide', event => {
            suspended = true;
            if (frame) window.cancelAnimationFrame(frame);
            frame = 0; cancelAnimation();
            if (!event.persisted) dispose();
        });
        listen(window, 'pageshow', () => { suspended = false; sync(); });
        sync();
    }
    window.GunterCorePresence = { init, sync, dispose,
        getState: () => ({ initialized: started, disposed, mode, animating: !!animation, target: target ? { ...target } : null }) };
    if (document.readyState === 'loading') listen(document, 'DOMContentLoaded', init, { once: true });
    else init();
})();
