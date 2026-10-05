/* =============================================
   GUNTER — Command Center IA
   -------------------------------------------------
   Unifica navegación, jerarquía y orden operativo.
   Día = actuar ahora. Reuniones = preparar y analizar.
   ============================================= */
(function () {
    'use strict';
    if (window.GunterCommandCenter) return;

    const PAGE = location.pathname.split('/').pop().toLowerCase() || 'index.html';
    const APP_PAGES = new Set([
        'day.html', 'dashboard.html', 'new-project.html', 'meeting.html',
        'results.html', 'config.html', 'admin.html'
    ]);

    const PAGE_META = {
        'day.html':         { active: 'day', crumbs: [{ label: 'Inicio' }] },
        'dashboard.html':   { active: 'meetings', crumbs: [{ label: 'Reuniones' }] },
        'new-project.html': { active: 'meetings', crumbs: [{ label: 'Reuniones', href: 'dashboard.html' }, { label: 'Preparar reunión' }] },
        'meeting.html':     { active: 'meetings', crumbs: [{ label: 'Reuniones', href: 'dashboard.html' }, { label: 'Sala de reunión' }] },
        'results.html':     { active: 'meetings', crumbs: [{ label: 'Reuniones', href: 'dashboard.html' }, { label: 'Resultados' }] },
        'config.html':      { active: 'config', crumbs: [{ label: 'Configuración' }] },
        'admin.html':       { active: 'config', crumbs: [{ label: 'Administración' }] }
    };

    const ICON_PATHS = {
        home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
        message: '<path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/>',
        calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
        organize: '<path d="M4 5h16M7 12h10m-7 7h4"/><circle cx="6" cy="5" r="1"/><circle cx="18" cy="12" r="1"/><circle cx="9" cy="19" r="1"/>',
        capture: '<path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="9"/>',
        task: '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="m8 11 2 2 5-5M8 17h8M9 2v4m6-4v4"/>',
        reminder: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2M5 3 3 5m16-2 2 2"/>',
        activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
        chart: '<path d="M4 19V5m0 14h17M8 15l4-4 3 2 6-7"/>',
        link: '<path d="M10 13a5 5 0 0 0 7.1 0l2-2A5 5 0 0 0 12 3.9l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.6 1.4 2.4-1.4 1.1a7 7 0 0 1-.1 1.9z" transform="translate(-1 -1)"/>',
        menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        assistant: '<path d="M12 3a7 7 0 0 0-7 7v3a7 7 0 0 0 14 0v-3a7 7 0 0 0-7-7Z"/><path d="M8.5 11h.01M15.5 11h.01M9 15c1.8 1.4 4.2 1.4 6 0M5 13H3m18 0h-2"/>',
        file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8"/>',
        brain: '<path d="M12 18V5a3 3 0 0 0-5.8-1A4 4 0 0 0 4 11a4 4 0 0 0 2 7h6ZM12 18V5a3 3 0 0 1 5.8-1A4 4 0 0 1 20 11a4 4 0 0 1-2 7h-6Z"/><path d="M8 8a2 2 0 0 0 0 4m8-5a2 2 0 0 1 0 4"/>',
        bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
        trash: '<path d="M3 6h18m-2 0-.9 14H5.9L5 6m4 0V4h6v2m-5 4v6m4-6v6"/>',
        building: '<path d="M3 21h18M5 21V5l7-3 7 3v16M9 9h1m4 0h1M9 13h1m4 0h1m-6 8v-4h4v4"/>',
        palette: '<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1.7-3.1 1 1 0 0 1 .8-1.5H18a3 3 0 0 0 3-3A10 10 0 0 0 12 3Z"/><path d="M7.5 10h.01M10 7.5h.01m5 0h.01m2.5 3h.01"/>',
        microphone: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5m-4 0h8"/>',
        music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
        warning: '<path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0ZM12 9v4m0 4h.01"/>',
        check: '<path d="m5 12 4 4L19 6"/>',
        search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
        cloud: '<path d="M20 16.2A4.5 4.5 0 0 0 18 7.5a6 6 0 0 0-11.5 1.7A4 4 0 0 0 7 17h12"/>',
        phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
        shield: '<path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/>',
        folder: '<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
        sparkle: '<path d="m12 3 1.9 5.8L20 11l-6.1 2.2L12 19l-1.9-5.8L4 11l6.1-2.2L12 3ZM19 14l1.2 2.8L23 18l-2.8 1.2L19 22l-1.2-2.8L15 18l2.8-1.2L19 14Z"/>',
        globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18m0-18a15 15 0 0 0 0 18"/>',
        arrows: '<path d="M7 7h14l-4-4m4 4-4 4M17 17H3l4 4m-4-4 4-4"/>',
        lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 1 1 8 0v3m-4 5v2"/>',
        help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.2 1.8c-1.1 1-1.7 1.4-1.7 3.2m0 3h.01"/>',
        penguin: '<ellipse cx="12" cy="13" rx="7" ry="9"/><path d="M8 11h.01M16 11h.01m-6.5 3.5h5L12 17zM8 21l-1 1m9-1 1 1"/>'
    };

    function icon(name) {
        return window.GunterIconSystem?.markup(name)
            || `<svg class="gunter-icon" data-gunter-icon="${name}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON_PATHS[name] || ICON_PATHS.sparkle}</svg>`;
    }

    function el(tag, className, html = '') {
        const node = document.createElement(tag);
        node.className = className;
        node.innerHTML = html;
        return node;
    }

    function mainContainer() {
        return document.querySelector(
            '.gday__main, .dashboard-main, .config-page, .meeting-page, .results-page, .gadm'
        );
    }

    function commandNav(meta) {
        const nav = el('nav', 'gunter-command-nav');
        nav.setAttribute('aria-label', 'Navegación principal de Gunter');
        nav.innerHTML = `
            <a class="gunter-command-nav__brand" href="day.html" aria-label="Gunter, inicio">
                <span class="gunter-particle-thumb" data-gunter-particles="thumb" aria-hidden="true"></span>
                <span>GUNTER</span><small>ASISTENTE PERSONAL</small>
            </a>
            <div class="gunter-command-nav__links">
                ${navLink('Inicio', 'day.html', meta.active === 'day')}
                ${navLink('Conversaciones', 'day.html#conversations', PAGE === 'day.html' && location.hash === '#conversations')}
                ${navLink('Reuniones', 'dashboard.html', meta.active === 'meetings')}
                <details class="gunter-command-nav__menu">
                    <summary>${icon('organize')}<span>Organizar</span><span class="gunter-command-nav__chevron" aria-hidden="true">⌄</span></summary>
                    <div class="gunter-command-nav__popover" aria-label="Herramientas para organizar">
                        ${navLink('Captura rápida', 'day.html#capture', false)}
                        ${navLink('Tareas', 'day.html#tasks', false)}
                        ${navLink('Agenda', 'day.html#events', false)}
                        ${navLink('Recordatorios', 'day.html#reminders', false)}
                        ${navLink('Actividad', 'day.html#activity', false)}
                    </div>
                </details>
                ${navLink('Resultados', 'results.html', PAGE === 'results.html')}
                ${navLink('Conexiones', 'config.html#data', PAGE === 'config.html' && location.hash === '#data')}
            </div>
            <a class="gunter-command-nav__action" href="new-project.html" aria-label="Preparar una nueva reunión">${icon('plus')}<span>Nueva reunión</span></a>
            <a class="gunter-command-nav__settings ${meta.active === 'config' ? 'is-active' : ''}" href="config.html#preferences" aria-label="Configuración" title="Configuración">${icon('settings')}</a>
            <details class="gunter-command-nav__mobile" id="gunter-mobile-menu">
                <summary aria-label="Abrir navegación">${icon('menu')}<span>Menú</span></summary>
                <div class="gunter-command-nav__mobile-panel">
                    ${navLink('Inicio', 'day.html', meta.active === 'day')}
                    ${navLink('Conversaciones', 'day.html#conversations', false)}
                    ${navLink('Reuniones', 'dashboard.html', meta.active === 'meetings')}
                    ${navLink('Captura rápida', 'day.html#capture', false)}
                    ${navLink('Tareas', 'day.html#tasks', false)}
                    ${navLink('Agenda', 'day.html#events', false)}
                    ${navLink('Recordatorios', 'day.html#reminders', false)}
                    ${navLink('Actividad', 'day.html#activity', false)}
                    ${navLink('Resultados', 'results.html', PAGE === 'results.html')}
                    ${navLink('Nueva reunión', 'new-project.html', false)}
                    ${navLink('Conexiones', 'config.html#data', false)}
                    ${navLink('Configuración', 'config.html#preferences', meta.active === 'config')}
                </div>
            </details>
            <div class="gunter-command-nav__dock" aria-label="Accesos principales en móvil">
                ${navLink('Inicio', 'day.html', meta.active === 'day')}
                ${navLink('Conversaciones', 'day.html#conversations', PAGE === 'day.html' && location.hash === '#conversations')}
                <button class="gunter-command-nav__voice" type="button" data-gunter-voice-toggle aria-label="Activar escucha de voz" aria-pressed="false" title="Activar escucha de voz">${icon('microphone')}<span>Hablar</span></button>
                ${navLink('Reuniones', 'dashboard.html', meta.active === 'meetings')}
                <button class="gunter-command-nav__dock-menu" type="button" data-open-mobile-menu aria-label="Más opciones" aria-controls="gunter-mobile-menu" aria-expanded="false">${icon('menu')}<span>Más</span></button>
            </div>`;
        nav.addEventListener('click', event => {
            const voiceToggle = event.target.closest('[data-gunter-voice-toggle]');
            if (voiceToggle) {
                event.preventDefault();
                const wakeWord = window.GunterWakeWord;
                if (!wakeWord) {
                    window.GunterNotificationsService?.showToast?.('La función de voz todavía no está disponible.', { variant: 'warn', duration: 4000, silent: true });
                    return;
                }
                if (wakeWord.isActive?.()) wakeWord.stop?.();
                else if (wakeWord.supported === false) {
                    window.GunterNotificationsService?.showToast?.(wakeWord.humanError?.('unsupported') || 'Este navegador no admite activación por voz.', { variant: 'warn', duration: 4500, silent: true });
                } else if (window.PremiumFeaturesService?.getWakeWordConfig && !window.PremiumFeaturesService.getWakeWordConfig().enabled) {
                    window.GunterNotificationsService?.showToast?.('Activa la escucha por voz en Configuración > Voz para usar este botón.', { variant: 'info', duration: 4500, silent: true });
                } else wakeWord.start?.(true);
            }
            if (event.target.closest('[data-open-mobile-menu]')) {
                event.preventDefault();
                const menu = nav.querySelector('.gunter-command-nav__mobile');
                if (menu) {
                    menu.open = !menu.open;
                    event.target.closest('[data-open-mobile-menu]')?.setAttribute('aria-expanded', String(menu.open));
                }
            }
            if (event.target.closest('.gunter-command-nav__dock a')) {
                const menu = nav.querySelector('.gunter-command-nav__mobile');
                if (menu) menu.open = false;
                nav.querySelector('[data-open-mobile-menu]')?.setAttribute('aria-expanded', 'false');
            }
        });
        nav.addEventListener('click', event => {
            const link = event.target.closest('a');
            const disclosure = link?.closest('details');
            if (disclosure) {
                disclosure.open = false;
                if (disclosure.classList.contains('gunter-command-nav__mobile')) {
                    nav.querySelector('[data-open-mobile-menu]')?.setAttribute('aria-expanded', 'false');
                }
            }
        });
        document.addEventListener('pointerdown', event => {
            if (event.target instanceof Node && !nav.contains(event.target)) {
                nav.querySelectorAll('details[open]').forEach(menu => { menu.open = false; });
                nav.querySelector('[data-open-mobile-menu]')?.setAttribute('aria-expanded', 'false');
            }
        }, { passive: true });
        document.addEventListener('keydown', event => {
            if (event.key !== 'Escape') return;
            nav.querySelectorAll('details[open]').forEach(menu => { menu.open = false; });
            nav.querySelector('[data-open-mobile-menu]')?.setAttribute('aria-expanded', 'false');
        });
        const syncVoice = state => {
            const active = !!(state?.active ?? window.GunterWakeWord?.isActive?.());
            nav.querySelectorAll('[data-gunter-voice-toggle]').forEach(button => {
                button.setAttribute('aria-pressed', String(active));
                button.setAttribute('aria-label', active ? 'Pausar escucha de voz' : 'Activar escucha de voz');
                button.title = active ? 'Pausar escucha de voz' : 'Activar escucha de voz';
                button.classList.toggle('is-listening', active);
                const label = button.querySelector('span');
                if (label) label.textContent = active ? 'Escuchando' : 'Hablar';
            });
        };
        window.addEventListener('wake-word-state', event => syncVoice(event.detail));
        syncVoice(window.GunterWakeWord?.getState?.());
        return nav;
    }

    function navLink(label, href, active) {
        const names = {
            'Inicio': 'home', 'Conversaciones': 'message', 'Reuniones': 'calendar', 'Captura rápida': 'capture',
            'Tareas': 'task', 'Agenda': 'calendar', 'Recordatorios': 'reminder', 'Actividad': 'activity',
            'Resultados': 'chart', 'Conexiones': 'link', 'Configuración': 'settings',
            'Preparar reunión': 'plus', 'Sala de reunión': 'calendar', 'Nueva reunión': 'plus'
        };
        return `<a href="${href}" class="${active ? 'is-active' : ''}"${active ? ' aria-current="page"' : ''}>${icon(names[label] || 'sparkle')}<span>${label}</span></a>`;
    }

    function breadcrumb(meta) {
        const strip = el('nav', 'gunter-breadcrumb');
        strip.setAttribute('aria-label', 'Ubicación actual');
        strip.innerHTML = `<ol>${meta.crumbs.map((crumb, index) => `
            <li>${crumb.href ? `<a href="${crumb.href}">${crumb.label}</a>` : `<span${index === meta.crumbs.length - 1 ? ' aria-current="page"' : ''}>${crumb.label}</span>`}</li>`).join('')}</ol>`;
        return strip;
    }

    function setupDay(container, nav, flow) {
        const header = container.querySelector('.gday__header');
        const ribbon = document.getElementById('gday-next-ribbon');
        const quickbar = document.getElementById('gday-quickbar-drop');
        const preview = document.getElementById('gday-doc-preview');
        const tabs = document.getElementById('gday-tabs');

        const home = el('section', 'gunter-console', `
            <header class="gunter-console__topbar">
                <h1 id="gunter-home-title">GUNTER <span>// ASISTENTE PERSONAL</span></h1>
                <div class="gunter-console__clock"><span id="gunter-home-city">HORA LOCAL</span><time id="gunter-home-clock" datetime="">--:--</time></div>
            </header>
            <div class="gunter-console__workspace">
                <aside class="gunter-console__panel gunter-console__day" aria-label="Resumen del día">
                    <h2>${icon('activity')} Tu día</h2>
                    <div class="gunter-console__intro"></div>
                    <a href="day.html#tasks" class="gunter-console__text-link">Ver mis prioridades ${icon('task')}</a>
                    <div class="gunter-console__voice-state"><span class="gunter-console__led" aria-hidden="true"></span><span data-console-voice>Voz en reposo</span></div>
                    <p>Activa el micrófono para hablar con Gunter.</p>
                </aside>
                <div class="gunter-console__core">
                    <div class="gunter-console__core-top"><span>GUNTER // NÚCLEO VISUAL</span><span>INTERACTIVO</span></div>
                    <div class="gunter-console__viewport">
                        <svg class="gunter-console__reticle" viewBox="0 0 400 400" fill="none" aria-hidden="true">
                            <g class="gunter-console__segments" stroke="currentColor">
                                <circle cx="200" cy="200" r="183" stroke-dasharray="2 12" opacity=".35"/>
                                <circle cx="200" cy="200" r="169" stroke-dasharray="28 18" opacity=".45"/>
                                <circle cx="200" cy="200" r="147" stroke-dasharray="100 20" opacity=".7"/>
                        </g>
                            <g class="gunter-console__segments-reverse">
                                <circle cx="200" cy="200" r="155" stroke-width="7" stroke-dasharray="19 25"/>
                                <circle cx="200" cy="200" r="132" stroke-width="1.5" stroke-dasharray="5 8"/>
                            </g>
                            <circle class="gunter-console__inner-ring" cx="200" cy="200" r="92" stroke="currentColor" stroke-dasharray="3 6"/>
                            <path d="M200 35v26m0 278v26M35 200h26m278 0h26" stroke="currentColor" opacity=".65"/>
                        </svg>
                        <div class="gunter-console__mascot" data-gunter-particles="hero" role="img" aria-label="Holograma interactivo de Gunter en partículas"></div>
                    </div>
                    <div class="gunter-console__core-bottom"><span class="gunter-console__led" aria-hidden="true"></span><span data-console-voice>Voz en reposo</span><button class="gunter-home__focus" type="button">${icon('message')} Escribir</button></div>
                </div>
                <aside class="gunter-console__panel gunter-console__tools" aria-label="Herramientas de Gunter">
                    <h2>${icon('organize')} Tus herramientas</h2>
                    <a href="day.html#conversations">${icon('message')}<span>Conversaciones<small>Tus canales en un lugar</small></span></a>
                    <a href="day.html#events">${icon('calendar')}<span>Agenda<small>Próximos compromisos</small></span></a>
                    <a href="config.html#data">${icon('link')}<span>Conexiones<small>Cuentas y dispositivos</small></span></a>
                    <a href="new-project.html" class="gunter-console__text-link">Preparar reunión ${icon('plus')}</a>
                </aside>
            </div>
            <div class="gunter-console__command" id="gunter-console-command">
                <div class="gunter-console__command-mount"></div>
                <div class="gunter-console__preview"></div>
            </div>`);
        home.setAttribute('aria-labelledby', 'gunter-home-title');

        container.prepend(flow);
        flow.after(home);
        if (header) home.querySelector('.gunter-console__intro').append(header);
        if (ribbon) home.querySelector('.gunter-console__intro').append(ribbon);
        if (quickbar) home.querySelector('.gunter-console__command-mount').append(quickbar);
        if (preview) home.querySelector('.gunter-console__preview').append(preview);
        if (tabs) home.after(tabs);

        const focusCommand = () => {
            home.hidden = false;
            home.classList.add('is-command-open');
            quickbar?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
            const input = quickbar?.querySelector('input[type="text"]');
            window.setTimeout(() => input?.focus({ preventScroll: true }), 180);
            home.classList.add('is-command-focused');
            window.setTimeout(() => home.classList.remove('is-command-focused'), 900);
        };
        home.querySelector('.gunter-home__focus')?.addEventListener('click', focusCommand);
        home.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
                home.classList.remove('is-command-open');
                home.querySelector('.gunter-home__focus')?.focus();
            }
        });
        const syncHome = () => {
            const tab = document.querySelector('.gday__tab[aria-selected="true"]')?.dataset.tab || 'today';
            const hash = location.hash.slice(1);
            home.hidden = tab !== 'today' || (!!hash && !['capture', 'main-content'].includes(hash));
            document.body.classList.toggle('gunter-console-visible', !home.hidden);
            if (hash === 'capture') focusCommand();
            nav.querySelectorAll('a[href="day.html"], a[href="day.html#conversations"]').forEach(link => {
                const active = link.getAttribute('href').endsWith('#conversations') ? tab === 'conversations' : !home.hidden;
                link.classList.toggle('is-active', active);
                if (active) link.setAttribute('aria-current', 'page');
                else link.removeAttribute('aria-current');
            });
        };
        if (tabs) new MutationObserver(syncHome).observe(tabs, { subtree: true, attributes: true, attributeFilter: ['aria-selected'], childList: true });
        window.addEventListener('hashchange', syncHome);
        syncHome();
        const syncConsoleVoice = event => {
            const active = !!(event?.detail?.active ?? window.GunterWakeWord?.isActive?.());
            home.querySelectorAll('[data-console-voice]').forEach(node => { node.textContent = active ? 'Escuchando' : 'Voz en reposo'; });
            home.classList.toggle('is-listening', active);
        };
        window.addEventListener('wake-word-state', syncConsoleVoice);
        syncConsoleVoice();
        const clock = home.querySelector('#gunter-home-clock');
        const updateClock = () => {
            if (!clock) return;
            const now = new Date();
            clock.dateTime = now.toISOString();
            clock.textContent = new Intl.DateTimeFormat('es-CO', {
                timeZone: window.GunterPresence?.timezone?.() || Intl.DateTimeFormat().resolvedOptions().timeZone, hour: '2-digit', minute: '2-digit', hour12: true
            }).format(now).toLocaleLowerCase('es-CO');
            const city = home.querySelector('#gunter-home-city');
            if (city) city.textContent = window.GunterPresence?.preferences?.().city || 'Hora local';
        };
        updateClock();
        window.addEventListener('gunter-location-change', updateClock);
        window.setInterval(updateClock, 30_000);
        window.GunterParticles?.mount?.(home);

        if (quickbar) {
            delete quickbar.dataset.commandOrder;
            quickbar.querySelector('.gday__quickbar-label').textContent = '¿Qué necesitas resolver hoy?';
            const input = quickbar.querySelector('input[type="text"]');
            if (input) input.placeholder = 'Escribe una instrucción para Gunter…';
            quickbar.querySelector('button[type="submit"]')?.setAttribute('aria-label', 'Enviar comando a Gunter');
        }

        const events = document.getElementById('events-card');
        const tasks = document.getElementById('tasks-card');
        if (events && tasks && events.parentElement === tasks.parentElement) {
            events.parentElement.insertBefore(events, tasks);
        }
        renameCard(events, 'Agenda inmediata');
        renameCard(tasks, 'Prioridades de hoy');
        renameCard(document.getElementById('reminders-card'), 'Seguimientos activos');
        renameCard(document.getElementById('chat-card'), 'Conversar con Gunter');

        // El trabajo real va antes que los atajos opcionales o bloqueados.
        const shortcuts = document.getElementById('gday-today-shortcuts');
        const firstWorkRow = events?.parentElement;
        if (shortcuts && firstWorkRow?.classList.contains('gday-today__row')) firstWorkRow.after(shortcuts);

        const sidebarNav = document.querySelector('.gday__nav');
        if (sidebarNav) reorderDayNav(sidebarNav, quickbar);
    }

    function renameCard(card, label) {
        const heading = card?.querySelector('h3');
        if (!heading) return;
        const icon = heading.querySelector('.gday__card-icon')?.outerHTML || '';
        heading.innerHTML = `${icon} ${label}`;
    }

    function reorderDayNav(sidebarNav, quickbar) {
        const items = Array.from(sidebarNav.querySelectorAll('.gday__nav-item'));
        const byTarget = id => items.find(item => item.dataset.scrollTo === id);
        const today = items.find(item => item.getAttribute('href') === 'day.html');
        const config = items.find(item => item.getAttribute('href')?.startsWith('config.html'));

        let capture = sidebarNav.querySelector('[data-scroll-to="gday-quickbar-drop"]');
        if (!capture) {
            capture = el('a', 'gday__nav-item', `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 5v14M5 12h14"/><circle cx="12" cy="12" r="9"/>
                </svg><span>Capturar</span>`);
            capture.href = 'day.html#capture';
            capture.dataset.scrollTo = 'gday-quickbar-drop';
            capture.addEventListener('click', event => {
                event.preventDefault();
                quickbar?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                setTimeout(() => quickbar?.querySelector('input[type="text"]')?.focus(), 420);
            });
        }

        [today, capture, byTarget('events-card'), byTarget('tasks-card'),
            byTarget('reminders-card'), byTarget('chat-card'), config]
            .filter(Boolean).forEach(item => sidebarNav.append(item));
    }

    function setupDashboard(container, nav, flow) {
        const legacySwitch = Array.from(container.children).find(node =>
            node !== nav && node.querySelector?.('a[href="day.html"]') && node.querySelector?.('a[href="dashboard.html"]')
        );
        legacySwitch?.classList.add('gunter-legacy-switch');

        const header = container.querySelector('.dashboard-header');
        const projects = document.getElementById('projects-grid')?.closest('section');
        const stats = container.querySelector('.stats-row');
        const hero = container.querySelector('.prism-hero');

        container.prepend(flow);
        if (header) flow.after(header);
        if (projects && header) header.after(projects);
        if (stats && projects) projects.after(stats);
        if (hero && stats) stats.after(hero);

        const applyHeaderCopy = () => {
            const title = header?.querySelector('.dashboard-header__title');
            const subtitle = header?.querySelector('.dashboard-header__subtitle');
            if (title) title.textContent = 'Centro de reuniones';
            if (subtitle) subtitle.textContent = 'Prepara, captura y convierte cada conversación en decisiones accionables.';
        };
        applyHeaderCopy();
        // Otros controladores hidratan el encabezado después del primer render.
        // Reaplicamos la jerarquía editorial en momentos acotados para evitar que
        // el texto heredado reaparezca sin observar el DOM de forma permanente.
        [0, 250, 1000].forEach(delay => setTimeout(applyHeaderCopy, delay));
        const sectionTitle = projects?.querySelector('.section-title');
        if (sectionTitle) sectionTitle.textContent = 'Reuniones recientes';

        const newCard = projects?.querySelector('.project-card--new');
        if (newCard) {
            newCard.href = 'new-project.html';
            const label = newCard.querySelector('.project-card--new__text');
            if (label) label.textContent = 'Preparar nueva reunión';
        }

        const labels = ['Reuniones', 'Analizadas', 'En curso', 'Horas capturadas'];
        container.querySelectorAll('.stat-card__label').forEach((node, index) => {
            if (labels[index]) node.textContent = labels[index];
        });
        const tag = hero?.querySelector('.prism-hero__tag');
        if (tag) tag.textContent = 'Núcleo de Gunter activo';
    }

    function setupResults(container, nav, flow) {
        const header = container.querySelector('.results-header');
        container.prepend(flow);
        if (header) flow.after(header);

        const content = document.getElementById('results-content');
        if (!content) return;
        const summary = content.querySelector('.gunter-insights')?.closest('.result-section');
        const analyses = document.getElementById('dynamic-analyses-section');
        const transcript = document.getElementById('transcription-section');
        [transcript, analyses, summary].filter(Boolean).forEach(section => content.prepend(section));

        const summaryTitle = summary?.querySelector('.gunter-insights__title');
        if (summaryTitle) summaryTitle.textContent = 'Brief ejecutivo de Gunter';
        const analysesTitle = analyses?.querySelector('.result-section__title');
        if (analysesTitle) analysesTitle.innerHTML = `${icon('brain')} Decisiones y análisis`;
        const transcriptTitle = transcript?.querySelector('.result-section__title');
        if (transcriptTitle) transcriptTitle.innerHTML = `${icon('file')} Evidencia y transcripción`;
    }

    function setupGeneric(container, nav, flow) {
        const header = container.querySelector(':scope > header');
        container.prepend(flow);
        if (header) flow.after(header);

        if (PAGE === 'new-project.html') {
            const title = container.querySelector('.config-header__title');
            const subtitle = container.querySelector('.config-header__subtitle');
            if (title) title.textContent = 'Preparar reunión';
            if (subtitle) subtitle.textContent = 'Dale contexto a Gunter antes de iniciar la captura.';
            const labels = ['Contexto', 'Objetivo', 'Captura'];
            container.querySelectorAll('.step__label').forEach((node, index) => {
                if (labels[index]) node.textContent = labels[index];
            });
        }

        if (PAGE === 'admin.html') {
            // Salud y contexto del sistema primero; gestión y diagnóstico después.
            ['adm-ops-card', 'adm-system-card', 'adm-pending-card', 'adm-users-card',
                'adm-memberships-card', 'adm-nodes-card', 'adm-incidents-card',
                'adm-logs-card', 'adm-flags-card']
                .map(id => document.getElementById(id)).filter(Boolean).forEach(section => container.append(section));
        }
    }

    function markRevealOrder(container) {
        const candidates = container.querySelectorAll(
            ':scope > .gunter-breadcrumb, :scope > header, :scope > section, :scope > .stats-row, :scope > .prism-hero, :scope > .results-content, :scope > .meeting-content, :scope > .config-tabs'
        );
        candidates.forEach((node, index) => {
            node.classList.add('gunter-reveal');
            node.style.setProperty('--gunter-order', index);
        });
    }

    function init() {
        if (!APP_PAGES.has(PAGE) || document.querySelector('.gunter-command-nav')) return;
        const container = mainContainer();
        const meta = PAGE_META[PAGE];
        if (!container || !meta) return;

        document.body.classList.add('gunter-command-center');
        if (PAGE === 'day.html') document.body.classList.add('gunter-page-day');
        const nav = commandNav(meta);
        const flow = breadcrumb(meta);
        // The global navigation lives outside page frames so fixed desktop/mobile
        // layouts are not clipped by legacy shell overflow rules.
        document.body.prepend(nav);

        if (PAGE === 'day.html') setupDay(container, nav, flow);
        else if (PAGE === 'dashboard.html') setupDashboard(container, nav, flow);
        else if (PAGE === 'results.html') setupResults(container, nav, flow);
        else setupGeneric(container, nav, flow);

        markRevealOrder(container);
        requestAnimationFrame(() => document.body.classList.add('gunter-command-ready'));
    }

    window.GunterCommandCenter = { init };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
