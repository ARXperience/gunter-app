/* Visual-only entrance. Existing pages, tabs, chat and permission gates stay in charge. */
(function () {
    'use strict';
    if (window.GunterOrbitHome) return;
    const routes = [
        ['Agenda', 'day.html#events', 31, 17, 'cyan', 'calendar'],
        ['Reuniones', 'dashboard.html', 18, 31, 'cyan', 'users'],
        ['Tareas', 'day.html#tasks', 19, 51, 'cyan', 'task'],
        ['Recordatorios', 'day.html#reminders', 27, 73, 'amber', 'reminder'],
        ['Captura rápida', 'day.html#capture', 41, 85, 'amber', 'capture'],
        ['Conversaciones', 'day.html#conversations', 70, 20, 'cyan', 'message'],
        ['Modo sabio', 'day.html#tutor', 80, 39, 'violet', 'brain', 'tutorMode'],
        ['Resultados', 'results.html', 79, 62, 'amber', 'chart'],
        ['Conexiones', 'config.html#connections', 66, 79, 'amber', 'link'],
        ['Actividad', 'day.html#activity', 56, 89, 'violet', 'activity']
    ];
    const homeHashes = new Set(['', '#home', '#today', '#main-content']);
    let home, syncPending = false, disposed = false, clockTimer, mutationObserver, resizeObserver;
    function routeAvailable(route) {
        if (!route[6]) return true;
        if (route[6] === 'tutorMode' && window.GunterAuth && !window.GunterAuth.canTutor?.()) return false;
        return window.PremiumFeaturesService?.isEnabled?.(route[6]) === true;
    }
    function syncTools() {
        if (!home || disposed) return;
        home.querySelectorAll('[data-orbit-feature]').forEach(node => {
            const route = routes.find(item => item[6] === node.dataset.orbitFeature);
            node.hidden = !route || !routeAvailable(route);
        });
        layoutWires();
    }
    function layoutWires() {
        if (!home || home.hidden || disposed) return;
        const scene = home.querySelector('.gn-orbit-scene')?.getBoundingClientRect?.();
        if (!scene?.width || !scene.height) return;
        const core = home.querySelector('.gn-orbit-core').getBoundingClientRect();
        const cx = (core.left + core.width / 2 - scene.left) / scene.width * 1000;
        const cy = (core.top + core.height / 2 - scene.top) / scene.height * 1000;
        const wires = home.querySelectorAll('.gn-orbit-wire');
        home.querySelectorAll('.gn-orbit-node__point').forEach((point, index) => {
            if (point.closest?.('[hidden]')) return;
            const box = point.getBoundingClientRect();
            const x = (box.left + box.width / 2 - scene.left) / scene.width * 1000;
            const y = (box.top + box.height / 2 - scene.top) / scene.height * 1000;
            wires[index]?.setAttribute('d', `M${cx} ${cy} Q${cx + (x - cx) * .3} ${cy + (y - cy) * .9} ${x} ${y}`);
        });
    }
    function escape(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
    function icon(name) {
        return window.GunterIconSystem?.markup?.(name)
            || `<svg data-gunter-icon="${escape(name)}" viewBox="0 0 24 24" aria-hidden="true"></svg>`;
    }
    function currentTab() { return document.querySelector('.gday__tab[aria-selected="true"]')?.dataset.tab || 'today'; }
    function syncRoute(reset = false) {
        if (!home || disposed) return;
        if (reset && homeHashes.has(location.hash)) window.GunterDayTabs?.activate?.('today');
        const isHome = homeHashes.has(location.hash) && currentTab() === 'today';
        home.hidden = !isHome;
        document.body.classList.toggle('gunter-orbit-home-active', isHome);
        document.documentElement.classList.toggle('gunter-orbit-home-active', isHome);
        home.dataset.scVerifyHold = String(isHome);
        if (isHome) { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); window.GunterParticles?.mount?.(home); layoutWires(); }
    }
    function queueSync() {
        if (syncPending || disposed) return;
        syncPending = true;
        queueMicrotask(() => {
            syncPending = false;
            if (disposed) return;
            // Programmatic tab changes must remain visible even with a persisted empty hash.
            if (homeHashes.has(location.hash) && currentTab() !== 'today')
                history.replaceState(history.state, '', `#${currentTab()}`);
            syncRoute();
        });
    }
    function openChat() {
        const chat = window.GunterCompanion;
        if (chat?.expand) { chat.show?.(); chat.expand(); }
        else location.hash = 'chat';
    }
    function voiceAction() {
        // Click the existing user-gesture handler, never request permission here.
        const control = document.querySelector('[data-gunter-voice-toggle]');
        if (control) control.click();
        else openChat();
    }
    function syncState() {
        if (!home || disposed) return;
        const conversation = window.GunterConversationState?.getState?.()?.value || 'idle';
        const playback = window.GunterVoice?.getPlaybackState?.();
        const ptt = window.GunterSTT?.pushToTalk?.getState?.();
        const wake = window.GunterWakeWord?.getState?.();
        const capture = ptt?.phase === 'recording' || (wake?.active === true && ['wake', 'query'].includes(wake.mode));
        const labels = { idle: 'En reposo', thinking: 'Procesando', speaking: 'Hablando',
            awaiting_confirmation: 'Espera tu confirmación', error: 'Revisa el estado del asistente' };
        const state = playback?.speaking === true ? 'speaking' : conversation === 'speaking' ? 'thinking'
            : ptt?.phase === 'recording' && conversation === 'idle' ? 'listening_query' : conversation;
        const label = state === 'listening_query' ? (capture ? 'Escuchando tu consulta' : 'Micrófono pendiente')
            : state === 'listening_wake' ? (capture ? 'Escucha de activación' : 'En reposo')
                : labels[state] || 'En reposo';
        home.dataset.coreState = state;
        home.dataset.scVerifyState = state;
        home.querySelector('[data-orbit-status]').textContent = label;
        const voice = home.querySelector('[data-orbit-voice]');
        voice.setAttribute('aria-pressed', String(capture));
        voice.setAttribute('aria-label', capture ? 'Detener escucha de voz' : 'Hablar con Gunter');
        home.querySelector('[data-orbit-voice-label]').textContent = capture ? 'Detener escucha' : 'Hablar con Gunter';
    }
    function updateClock() {
        if (!home || disposed) return;
        const now = new Date(), clock = home.querySelector('time');
        clock.dateTime = now.toISOString();
        clock.textContent = new Intl.DateTimeFormat('es-CO', { hour: '2-digit', minute: '2-digit',
            timeZone: window.GunterPresence?.timezone?.() || Intl.DateTimeFormat().resolvedOptions().timeZone }).format(now);
    }
    function init() {
        if (!/\/day\.html$/i.test(location.pathname)) return;
        home = document.getElementById('gunter-orbit-home');
        if (home) return;
        home = document.createElement('section'); home.id = 'gunter-orbit-home'; home.className = 'gn-orbit-home';
        home.setAttribute('aria-label', 'Inicio de Gunter');
        const links = routes.map((route, index) => {
            const [label, href, x, y, color, symbol, feature] = route;
            return `<a class="gn-orbit-node gn-orbit-node--${color}"
            href="${href}" style="--node-x:${x}%;--node-y:${y}%;--node-i:${index}" data-orbit-route="${href}"${feature ? ` data-orbit-feature="${feature}"${routeAvailable(route) ? '' : ' hidden'}` : ''}>
            <span class="gn-orbit-node__point" aria-hidden="true">${icon(symbol)}</span><span class="gn-orbit-node__label">${escape(label)}</span></a>`;
        }).join('');
        const wires = routes.map(route => {
            const [, , x, y, color, , feature] = route;
            return `<path class="gn-orbit-wire gn-orbit-wire--${color}"${feature ? ` data-orbit-feature="${feature}"${routeAvailable(route) ? '' : ' hidden'}` : ''} d="M500 490 Q${500 + (x - 50) * 3} ${490 + (y - 49) * 8} ${x * 10} ${y * 10}"/>`;
        }).join('');
        home.innerHTML = `<header class="gn-orbit-header"><a href="day.html" class="gn-orbit-brand" aria-label="Inicio Gunter">
            <img src="assets/gunter/gunter-core.svg?v173-material-navigation" width="30" height="30" alt=""><h1>GUNTER</h1></a>
            <span class="gn-orbit-header__subtitle">Tu asistente personal</span>
            <div class="gn-orbit-header__actions"><time aria-label="Hora local"></time>
            <button type="button" data-orbit-theme aria-label="Cambiar tema claro u oscuro" title="Cambiar tema">${icon('sun')}</button>
            <a href="config.html#account" aria-label="Abrir mi cuenta" title="Mi cuenta">${icon('user')}</a>
            <a href="config.html#preferences" class="gn-orbit-settings">Configuración</a></div></header>
            <div class="gn-orbit-scene">
                <svg class="gn-orbit-circuits" viewBox="0 0 1000 1000" preserveAspectRatio="none" fill="none" aria-hidden="true">
                    <g class="gn-orbit-traces"><path d="M0 210h80l25 25h220M0 365h70l20-20h185M0 585h130l30 30h110M0 790h90l20-20h220M1000 260H930l-35 35H790M1000 440H890l-25-25H780M1000 710H950l-40-40H790M1000 860H895l-20-20H730"/></g>
                    <g class="gn-orbit-wires">${wires}</g>
                </svg>
                <div class="gn-orbit-core" data-gunter-particles="hero" role="img" aria-label="Núcleo visual de Gunter"></div>
                <nav class="gn-orbit-map" aria-label="Herramientas de Gunter">${links}</nav>
            </div>
            <footer class="gn-orbit-footer"><div class="gn-orbit-status" role="status" aria-live="polite"><span aria-hidden="true"></span><span data-orbit-status>En reposo</span></div>
                <button type="button" class="gn-orbit-talk" data-orbit-voice aria-pressed="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"/></svg><span data-orbit-voice-label>Hablar con Gunter</span></button>
                <button type="button" class="gn-orbit-write" data-orbit-chat>Escribir</button>
            </footer>`;
        document.body.append(home);
        if ('ResizeObserver' in window) {
            resizeObserver = new ResizeObserver(layoutWires);
            resizeObserver.observe(home.querySelector('.gn-orbit-scene'));
        }
        window.addEventListener('resize', layoutWires);
        home.querySelector('[data-orbit-chat]').addEventListener('click', openChat);
        home.querySelector('[data-orbit-voice]').addEventListener('click', voiceAction);
        home.querySelector('[data-orbit-theme]').addEventListener('click', () => window.GunterThemeToggle?.apply?.(
            document.body.classList.contains('at-light') ? 'dark' : 'light'));
        const tabs = document.getElementById('gday-tabs');
        if (tabs && 'MutationObserver' in window) {
            mutationObserver = new MutationObserver(queueSync);
            mutationObserver.observe(tabs, { attributes: true, subtree: true, childList: true, attributeFilter: ['aria-selected'] });
        }
        window.addEventListener('hashchange', () => syncRoute(true));
        window.addEventListener('gunter-open-tab', queueSync);
        window.addEventListener('gunterPremiumFeaturesChange', syncTools);
        document.addEventListener('gunter-auth-ready', syncTools);
        document.addEventListener('gunter-auth-profile-changed', syncTools);
        for (const event of ['gunter-conversation-state', 'gunter-voice-state', 'gunter-push-to-talk-state', 'wake-word-state'])
            window.addEventListener(event, syncState);
        updateClock(); clockTimer = window.setInterval(updateClock, 30000);
        syncRoute(true); syncState(); syncTools(); window.GunterParticles?.mount?.(home);
        window.addEventListener('pagehide', event => {
            if (event.persisted) return;
            disposed = true; mutationObserver?.disconnect(); resizeObserver?.disconnect(); window.clearInterval(clockTimer);
        });
        window.addEventListener('pageshow', () => { if (!disposed) { syncRoute(true); syncTools(); } });
    }
    window.GunterOrbitHome = { init, syncRoute,
        get routes() { return routes.filter(routeAvailable).map(([label, href]) => ({ label, href })); } };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
