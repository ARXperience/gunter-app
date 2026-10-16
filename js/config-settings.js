/* =============================================
   GUNTER APP - Config Settings Controller
   Maneja: tabs, papelera, preferencias, datos.
   ============================================= */

(function () {
    const TABS = ['account', 'schedule', 'premium', 'voice', 'conversations', 'actions', 'connections', 'preferences', 'data', 'diagnostics'];
    const ADVANCED_TABS = new Set(['premium', 'voice', 'conversations', 'actions', 'connections']);
    const TITLES = {
        account: { t: 'Mi cuenta', s: 'Tu identidad y cómo quieres que Gunter te llame.' },
        schedule: { t: 'Agenda y ubicación', s: 'Tu jornada, margen entre reuniones y zona horaria, en un solo lugar.' },
        premium: { t: 'Asistente e IA', s: 'Personalidad, conocimiento y decisiones con controles claros.' },
        voice: { t: 'Voz y escucha', s: 'Micrófono, activación y dictado local con estados verificables.' },
        conversations: { t: 'Conversaciones y memoria', s: 'Tus recuerdos e historial bajo tu control.' },
        actions: { t: 'Acciones y permisos', s: 'Herramientas, automatizaciones y autorizaciones.' },
        connections: { t: 'Conexiones y dispositivos', s: 'Servicios externos y capacidades de tus dispositivos.' },
        preferences: { t: 'Apariencia y accesibilidad', s: 'Ambiente visual y ajustes de comodidad.' },
        data: { t: 'Datos y privacidad', s: 'Respaldos, almacenamiento y eliminación segura.' },
        diagnostics: { t: 'Diagnóstico', s: 'Comprobaciones reales, sin revelar registros privados.' }
    };
    const SECTION_HINTS = {
        account: 'Cambiar tu nombre preferido no modifica el usuario de acceso ni tus credenciales.',
        schedule: 'La jornada orienta las sugerencias. Gunter no mueve compromisos ni confirma cambios por ti.',
        premium: 'Personalidad y recomendaciones no conceden permiso para ejecutar acciones externas.',
        voice: 'Responder con voz y capturar el micrófono son decisiones independientes. La escucha necesita permiso.',
        conversations: 'Solo tu cuenta puede consultar sus recuerdos. Los respaldos se administran en Datos y privacidad.',
        actions: 'Activar una herramienta no elimina sus confirmaciones ni los permisos del dispositivo.',
        connections: 'Una función activada puede necesitar una cuenta conectada o un dispositivo autorizado.',
        preferences: 'Los colores, el tamaño y el movimiento del núcleo se previsualizan sin modificar sus funciones.',
        data: 'Los respaldos pueden contener información personal. La eliminación siempre requiere confirmación.',
        diagnostics: 'Los estados se comprueban en este entorno. No se deducen errores de registros que no estén disponibles.'
    };
    const SEARCH_TERMS = {
        account: 'nombre perfil usuario registro identidad apodo',
        schedule: 'agenda calendario jornada horarios días margen ciudad ubicación hora zona horaria planificación',
        premium: 'personalidad humor estilo inteligencia cerebro modelo razonamiento bienvenida proactivo',
        voice: 'voz audio micrófono escucha dictado hablar silencio hi gunter activación idioma transcripción',
        conversations: 'memoria recuerdos historial conversación preferencias personales',
        actions: 'herramientas permisos automatizaciones notificaciones recordatorios alertas',
        connections: 'conexiones dispositivos redes whatsapp instagram messenger google calendar api',
        preferences: 'apariencia accesibilidad tema claro oscuro colores núcleo partículas animaciones tamaño',
        data: 'datos privacidad exportar importar respaldo papelera borrar almacenamiento limpieza',
        diagnostics: 'diagnóstico errores logs registros motores local moonshine ministral supertonic runtime servidor'
    };

    function activateTab(name) {
        if (name === 'trash') name = 'data';
        if (['calendar', 'agenda'].includes(name)) name = 'schedule';
        if (!TABS.includes(name)) name = 'premium';
        const previousSection = document.getElementById('main-content')?.dataset.configSection;

        document.querySelectorAll('.config-tab').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.tab === name);
            const active = btn.dataset.tab === name;
            btn.setAttribute('aria-selected', String(active));
            btn.tabIndex = active ? 0 : -1;
        });
        document.querySelectorAll('.config-tab-panel').forEach(p => {
            p.hidden = p.dataset.panel !== name;
        });
        // El catálogo avanzado es un único componente compartido: se mueve al
        // panel activo para evitar dos tabpanels visibles y controles duplicados.
        if (ADVANCED_TABS.has(name)) {
            const section = document.getElementById(`config-panel-${name}`);
            const catalog = document.getElementById('premium-panel');
            if (section && catalog && catalog.parentElement !== section) section.prepend(catalog);
        }
        const assistantOnly = document.querySelector('#config-panel-premium > .settings-card');
        if (assistantOnly) assistantOnly.hidden = name !== 'premium';

        const titleEl = document.getElementById('config-header-title');
        const subEl = document.getElementById('config-header-subtitle');
        if (titleEl) titleEl.textContent = TITLES[name].t;
        if (subEl) subEl.textContent = TITLES[name].s;
        const pathEl = document.getElementById('config-section-path');
        if (pathEl) pathEl.textContent = `Configuración / ${TITLES[name].t}`;
        const contextTitle = document.getElementById('config-context-title');
        const contextDescription = document.getElementById('config-context-description');
        const contextHint = document.getElementById('config-context-hint');
        if (contextTitle) contextTitle.textContent = TITLES[name].t;
        if (contextDescription) contextDescription.textContent = TITLES[name].s;
        if (contextHint) contextHint.textContent = SECTION_HINTS[name];
        document.getElementById('main-content')?.setAttribute('data-config-section', name);

        // URL hash so navigation from sidebar can deep-link
        try { history.replaceState(null, '', '#' + name); } catch {}

        // Lazy-load the panel data
        if (name === 'data') renderTrash();
        if (['premium', 'schedule', 'voice', 'preferences'].includes(name)) loadPreferences();
        if (name === 'connections') loadDataStatus();
        if (ADVANCED_TABS.has(name)) { mountPremium(); window.GunterAdvancedSettings?.setCategory?.(name); }
        if (name === 'voice') updateVoiceDependencies();
        if (name === 'diagnostics') mountRuntimeControls();
        updatePanelIndex(name);
        // Switching a long panel must not land midway through the next one.
        // Keep the user's scroll untouched when the section heading is visible.
        if (previousSection && previousSection !== name) {
            const header = document.querySelector('.config-header');
            const navigation = document.querySelector('.gunter-command-nav');
            const navBottom = navigation?.getBoundingClientRect?.().bottom || 157;
            const headerTop = header?.getBoundingClientRect?.().top;
            if (Number.isFinite(headerTop) && headerTop < navBottom + 12) {
                header.scrollIntoView?.({ block: 'start', behavior: 'auto' });
            }
        }
    }

    let premiumMounted = false;
    function mountPremium() {
        if (premiumMounted) return;
        if (window.GunterAdvancedSettings?.mount) {
            window.GunterAdvancedSettings.mount('#premium-panel');
            premiumMounted = true;
        } else {
            const el = document.getElementById('premium-panel');
            if (el) el.innerHTML = '<p class="settings-empty">Cargando módulo premium…</p>';
        }
    }
    function mountRuntimeControls() {
        window.GunterControlPlaneSettings?.mount?.('#config-runtime-content');
    }

    function initContextState() {
        const label = document.getElementById('config-context-state');
        const orbit = document.getElementById('config-context-orbit');
        if (!label || !orbit) return;
        const update = () => {
            const voice = window.GunterVoice?.getPlaybackState?.() || {};
            const wake = window.GunterWakeWord?.getState?.() || {};
            const dictation = window.GunterSTT?.pushToTalk?.getState?.() || {};
            const speaking = voice.speaking === true || voice.state === 'speaking';
            const preparing = voice.pending === true;
            const listening = wake.active === true || dictation.phase === 'recording';
            orbit.dataset.state = speaking ? 'speaking' : preparing ? 'processing' : listening ? 'listening' : 'idle';
            label.textContent = speaking ? 'Reproduciendo voz' : preparing ? 'Preparando audio' : listening ? 'Captura de micrófono activa' : 'Sin captura ni reproducción activa';
        };
        ['gunter-voice-state', 'wake-word-state', 'gunter-push-to-talk-state'].forEach(name => window.addEventListener(name, update));
        update();
    }

    function updatePanelIndex(name) {
        const panel = document.getElementById(`config-panel-${name}`);
        const index = document.getElementById('config-panel-index');
        if (!panel || !index) return;
        index.replaceChildren();
        const headings = [...panel.querySelectorAll('.gps-card__title h4, .settings-card h3, .config-advanced > summary > span')];
        headings.forEach((heading, position) => {
            const target = heading.closest('.gps-card, .settings-card, .config-advanced');
            if (!target) return;
            if (!target.id) target.id = `config-option-${name}-${position}`;
            const link = document.createElement('button');
            link.type = 'button';
            link.textContent = heading.textContent.replace(/^[^\p{L}\p{N}]+/u, '').trim();
            link.addEventListener('click', () => {
                if (target.tagName === 'DETAILS') target.open = true;
                target.scrollIntoView({ block: 'start', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
                target.setAttribute('tabindex', '-1');
                target.focus({ preventScroll: true });
            });
            index.appendChild(link);
        });
    }

    function initSectionSearch() {
        const input = document.getElementById('config-section-search');
        const status = document.getElementById('config-search-status');
        if (!input || !status) return;
        const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
        input.addEventListener('input', () => {
            const query = normalize(input.value);
            const tabs = [...document.querySelectorAll('.config-tab')];
            let matches = 0;
            tabs.forEach(tab => {
                const searchable = normalize(`${tab.textContent} ${SEARCH_TERMS[tab.dataset.tab] || ''}`);
                tab.hidden = Boolean(query && !query.split(/\s+/).every(word => searchable.includes(word)));
                if (!tab.hidden) matches++;
            });
            document.querySelectorAll('.config-nav-group').forEach(group => { group.hidden = Boolean(query); });
            status.hidden = !query;
            status.textContent = matches ? `${matches} ${matches === 1 ? 'sección encontrada' : 'secciones encontradas'}` : 'Sin coincidencias. Prueba con voz, memoria, agenda o datos.';
        });
        input.addEventListener('keydown', event => {
            if (event.key === 'Escape') { input.value = ''; input.dispatchEvent(new Event('input')); }
            if (event.key === 'Enter') {
                const first = [...document.querySelectorAll('.config-tab')].find(tab => !tab.hidden);
                if (first) { event.preventDefault(); activateTab(first.dataset.tab); first.focus(); }
            }
        });
    }

    function initTabs() {
        const tabs = [...document.querySelectorAll('.config-tab')];
        tabs.forEach((btn, index) => {
            btn.addEventListener('click', () => activateTab(btn.dataset.tab));
            btn.addEventListener('keydown', event => {
                const next = ['ArrowRight', 'ArrowDown'].includes(event.key) ? (index + 1) % tabs.length
                    : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? (index + tabs.length - 1) % tabs.length
                    : event.key === 'Home' ? 0
                    : event.key === 'End' ? tabs.length - 1 : -1;
                if (next < 0) return;
                event.preventDefault();
                const direction = ['ArrowLeft', 'ArrowUp', 'End'].includes(event.key) ? -1 : 1;
                let visibleNext = next;
                while (tabs[visibleNext]?.hidden && visibleNext !== index) visibleNext = (visibleNext + direction + tabs.length) % tabs.length;
                activateTab(tabs[visibleNext].dataset.tab);
                tabs[visibleNext].focus();
            });
        });
        const initial = (location.hash || '').replace('#', '') || 'premium';
        activateTab(initial);
        // Los enlaces globales usan hashes para aterrizar en una sección concreta.
        // Al navegar entre hashes de la misma página no hay recarga, así que
        // sincronizamos panel, pestaña y URL también en ese caso.
        window.addEventListener('hashchange', () => {
            activateTab((location.hash || '').replace(/^#/, '') || 'premium');
        });
    }

    function arrangeExistingControls() {
        const move = (selector, panel, heading = false) => {
            const node = document.querySelector(selector);
            const destination = document.getElementById(`config-panel-${panel}`);
            if (!node || !destination) return;
            const card = node.closest('.settings-card') || node;
            if (heading && card.previousElementSibling?.matches('h4.data-section-title')) destination.appendChild(card.previousElementSibling);
            destination.appendChild(card);
        };
        move('#pref-entry-greeting', 'premium');
        move('#calendar-planning-form', 'schedule');
        move('#pref-city', 'schedule');
        move('#pref-language', 'voice');
        move('#push-settings-card', 'actions');
        move('#status-openai', 'connections', true);
        move('#social-settings-panel', 'connections');
        move('#personal-memory-card', 'conversations', true);
        move('#conv-memory-card', 'conversations', true);
        const memoryBackup = document.querySelector('.personal-memory-backup');
        const storageHeading = document.querySelector('#storage-card')?.previousElementSibling;
        if (memoryBackup && storageHeading) {
            memoryBackup.classList.add('settings-card');
            const heading = memoryBackup.querySelector('h4');
            if (heading) { const title = document.createElement('h3'); title.textContent = heading.textContent; heading.replaceWith(title); }
            storageHeading.before(memoryBackup);
        }
        const connectionIntro = document.querySelector('#status-openai')?.closest('.settings-card');
        if (connectionIntro) {
            const advanced = document.createElement('details');
            advanced.className = 'config-advanced';
            const summary = document.createElement('summary'); summary.textContent = 'Proveedores y claves del servidor';
            connectionIntro.before(advanced); advanced.append(summary, connectionIntro);
        }
        const trashCard = document.querySelector('#trash-list')?.closest('.settings-card');
        const dangerHeading = document.querySelector('#config-panel-data .data-section-title--danger');
        if (trashCard && dangerHeading) dangerHeading.before(trashCard);
        const intro = document.querySelector('#config-panel-data .data-section-intro p');
        if (intro) intro.innerHTML = 'Aquí gestionas respaldos, almacenamiento y privacidad. <strong>Las acciones de borrado requieren confirmación.</strong>';
        document.querySelector('#conv-memory-card .settings-card__hint:last-child')?.replaceChildren(document.createTextNode('El historial se guarda solo cuando Memoria conversacional está activada en esta sección.'));
    }

    function updateVoiceDependencies() {
        const el = document.getElementById('voice-test-dependency');
        if (!el) return;
        const runtime = window.GunterRuntimeState?.getState?.() || {};
        const capture = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
        el.textContent = window.PremiumFeaturesService?.isEnabled?.('dictationEnabled') === false ? 'Dictado desactivado por el usuario.'
            : !capture ? 'Este navegador no permite capturar audio. Usa el chat de texto.'
            : runtime.loaded !== true ? 'Comprobando el estado de Moonshine y del servidor…'
                : runtime.flags?.['stt.local'] === false ? 'El motor Moonshine está desactivado. Activa STT local en Configuración → Diagnóstico → Motores locales.'
                : runtime.localSTTAvailable ? 'Moonshine local listo. La grabación queda en este dispositivo hasta el envío al servidor local.'
                    : 'Moonshine no está listo. En LOCAL_ONLY la transcripción no usará cloud; revisa el modelo y runtime local.';
    }

    function initVoiceTest() {
        const button = document.getElementById('voice-test-button');
        const label = document.getElementById('voice-test-state');
        const max = document.getElementById('voice-max-seconds');
        const silence = document.getElementById('voice-silence-seconds');
        if (!button || !label) return;
        const refreshDictation = () => {
            const enabled = window.PremiumFeaturesService?.isEnabled?.('dictationEnabled') !== false;
            button.disabled = !enabled;
            if (!enabled) label.textContent = 'Desactivada por el usuario';
            else if (label.textContent === 'Desactivada por el usuario') label.textContent = 'Activada, pendiente de permiso';
            updateVoiceDependencies();
        };
        refreshDictation();
        window.addEventListener('gunterPremiumFeaturesChange', refreshDictation);
        const prefs = readPrefs();
        max.value = prefs.voiceDictationMaxSeconds || 90;
        silence.value = prefs.voiceDictationSilenceSeconds || 12;
        for (const [input, key, min, maxValue] of [[max, 'voiceDictationMaxSeconds', 30, 120], [silence, 'voiceDictationSilenceSeconds', 5, 30]]) {
            input.addEventListener('change', () => {
                const value = Math.min(maxValue, Math.max(min, Number(input.value) || (key === 'voiceDictationMaxSeconds' ? 90 : 12)));
                input.value = value;
                writePrefs({ [key]: value });
            });
        }
        button.addEventListener('click', async () => {
            try {
                if (window.GunterSTT?.pushToTalk?.isActive?.()) window.GunterSTT.pushToTalk.stop();
                else await window.GunterSTT.pushToTalk.start();
            } catch (error) {
                label.textContent = `Error: ${error.code || error.name || 'captura no disponible'}`;
            }
        });
        window.addEventListener('gunter-push-to-talk-state', event => {
            const state = event.detail || {};
            const names = { off: 'Sin captura activa', permission_pending: 'Permiso pendiente', recording: 'Grabando', transcribing: 'Transcribiendo', review: 'Texto reconocido: revisa el chat', error: 'Error' };
            label.textContent = `${names[state.phase] || state.phase}${state.phase === 'recording' ? ` · ${state.elapsedSeconds || 0} s` : ''}`;
            button.textContent = state.active ? 'Finalizar prueba' : 'Iniciar prueba';
        });
        window.addEventListener('gunter-hybrid-state', updateVoiceDependencies);
        updateVoiceDependencies();
    }

    function initDiagnostics() {
        const toggle = document.getElementById('config-diagnostics-toggle');
        const status = document.getElementById('config-diagnostics-state');
        const run = document.getElementById('config-diagnostics-run');
        const refresh = () => {
            const enabled = window.PremiumFeaturesService?.isEnabled?.('diagnosticsEnabled') !== false;
            toggle?.setAttribute('aria-checked', String(enabled));
            if (status) status.textContent = enabled ? 'Activada y disponible' : 'Desactivada por el usuario';
            if (run) run.disabled = !enabled;
        };
        toggle?.addEventListener('click', () => window.PremiumFeaturesService?.set?.('diagnosticsEnabled', toggle.getAttribute('aria-checked') !== 'true'));
        window.addEventListener('gunterPremiumFeaturesChange', refresh);
        refresh();
        document.getElementById('config-diagnostics-run')?.addEventListener('click', async () => {
            const result = document.getElementById('config-diagnostics-result');
            result.textContent = 'Comprobando…';
            result.textContent = await window.GunterDiagnostics?.answer?.('Revisa tus errores') || 'Diagnóstico no disponible en esta página.';
        });
    }

    // ---------- Trash ----------
    function renderTrash() {
        const list = document.getElementById('trash-list');
        if (!list || !window.gunterData) return;
        const trashed = window.gunterData.getTrashedProjects ? window.gunterData.getTrashedProjects() : [];
        if (trashed.length === 0) {
            list.innerHTML = '<p class="settings-empty">La papelera está vacía.</p>';
            return;
        }
        list.innerHTML = trashed.map(p => {
            const deleted = p.deletedAt ? new Date(p.deletedAt).toLocaleString() : '—';
            const env = p.environment || 'empresarial';
            const icon = { empresarial: '🏢', artistico: '🎨', podcast: '🎙️', zen: '☯️' }[env] || '📁';
            return `
                <div class="trash-item" data-pid="${escapeAttr(p.id)}">
                    <div class="trash-item__info">
                        <p class="trash-item__name">${icon} ${escapeHtml(p.name || 'Sin nombre')}</p>
                        <div class="trash-item__meta">Eliminado: ${escapeHtml(deleted)} · Mercado: ${escapeHtml(p.market || '—')}</div>
                    </div>
                    <div class="trash-item__actions">
                        <button type="button" class="restore" data-action="restore">Restaurar</button>
                        <button type="button" class="purge" data-action="purge">Eliminar ⚠</button>
                    </div>
                </div>`;
        }).join('');

        list.querySelectorAll('.trash-item').forEach(row => {
            const pid = row.dataset.pid;
            row.querySelector('[data-action="restore"]').addEventListener('click', () => {
                window.gunterData.restoreProject(pid);
                renderTrash();
            });
            row.querySelector('[data-action="purge"]').addEventListener('click', () => {
                if (confirm('¿Eliminar permanentemente este proyecto? Esta acción no se puede deshacer.')) {
                    window.gunterData.purgeProject(pid);
                    renderTrash();
                }
            });
        });
    }

    function initTrash() {
        const emptyBtn = document.getElementById('empty-trash-btn');
        if (emptyBtn) {
            emptyBtn.addEventListener('click', () => {
                if (confirm('¿Vaciar toda la papelera? Los proyectos no podrán recuperarse.')) {
                    const n = window.gunterData.emptyTrash();
                    alert(`${n} proyecto(s) eliminados.`);
                    renderTrash();
                }
            });
        }
    }

    // ---------- Preferences ----------
    const PREF_KEY = 'gunter_prefs';
    function readPrefs() {
        try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); } catch { return {}; }
    }
    function writePrefs(p) { localStorage.setItem(PREF_KEY, JSON.stringify({ ...readPrefs(), ...p })); }

    function initCoreVisualSettings() {
        const section = document.getElementById('core-visual-settings');
        const core = window.GunterParticles;
        if (!section || !core?.configure) return;
        const fields = { particleColor: 'core-color', shadowColor: 'core-shadow-color', energyColor: 'core-energy-color', glowColor: 'core-glow-color', brightness: 'core-brightness',
            density: 'core-density', speed: 'core-speed', size: 'core-size' };
        const colorKeys = ['particleColor', 'shadowColor', 'energyColor', 'glowColor'];
        const labels = { particleColor: 'Partículas', shadowColor: 'Materia', energyColor: 'Energía', glowColor: 'Emisión' };
        const layerButtons = [...section.querySelectorAll('[data-core-layer]')];
        const adaptive = document.getElementById('core-theme-adaptive');
        const plane = document.getElementById('core-color-plane');
        const hue = document.getElementById('core-color-hue');
        const saturation = document.getElementById('core-color-saturation');
        const light = document.getElementById('core-color-light');
        const status = document.getElementById('core-visual-status');
        let selected = 'particleColor';
        let hsv = [0, 0, 1];
        function toHsv(hex) {
            const [r, g, b] = [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255);
            const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
            const h = !delta ? 0 : max === r ? ((g - b) / delta + 6) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
            return [h * 60, max ? delta / max : 0, max];
        }
        function toHex([h, s, v]) {
            const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
            const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
            return '#' + rgb.map(channel => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('');
        }
        function syncColorEditor(config) {
            const next = toHsv(config[selected]);
            hsv = [next[1] ? next[0] : hsv[0], next[2] ? next[1] : hsv[1], next[2]];
            hue.value = String(Math.round(hsv[0])); saturation.value = String(Math.round(hsv[1] * 100)); light.value = String(Math.round(hsv[2] * 100));
            plane.style.setProperty('--core-hue', hsv[0]);
            plane.style.setProperty('--core-saturation', hsv[1] * 100 + '%');
            plane.style.setProperty('--core-value', (1 - hsv[2]) * 100 + '%');
            plane.setAttribute('aria-label', `Color de ${labels[selected].toLowerCase()}. Usa las flechas para ajustar saturación y luminosidad.`);
            document.getElementById('core-color-layer-title').textContent = labels[selected];
            const palette = core.getPalette?.() || config;
            for (const button of layerButtons) {
                const key = button.dataset.coreLayer, active = key === selected;
                button.setAttribute('aria-pressed', String(active));
                button.style.setProperty('--layer-color', palette[key] || config[key]);
                document.getElementById(fields[key] + '-panel').hidden = !active;
                const value = button.querySelector('[data-core-layer-value]');
                if (value) value.textContent = config[key].toUpperCase();
            }
            document.getElementById('core-theme-state').textContent = config.themeAdaptive
                ? `Paleta adaptada al tema ${palette.theme === 'light' ? 'claro' : 'oscuro'}. Los HEX originales se conservan.`
                : 'Colores exactos. Se usan los mismos HEX en ambos temas.';
        }
        function validateColor(id, valid) {
            const hex = document.getElementById(id + '-hex');
            const error = document.getElementById(id + '-error');
            const message = valid ? '' : 'Escribe un color HEX de seis dígitos, por ejemplo #b8bec9.';
            hex.setCustomValidity(message);
            hex.setAttribute('aria-invalid', String(!valid));
            error.textContent = message;
            error.hidden = valid;
            if (!valid) status.textContent = message;
        }
        function sync() {
            const config = core.getConfig();
            for (const [key, id] of Object.entries(fields)) {
                const input = document.getElementById(id);
                input.value = String(config[key]);
                if (colorKeys.includes(key)) {
                    document.getElementById(id + '-hex').value = input.value;
                    validateColor(id, true);
                }
                const output = document.getElementById(id + '-value');
                if (output) {
                    const valueText = key === 'speed' ? config[key].toFixed(2).replace('.', ',') + ' ×'
                        : Math.round(config[key] * 100) + ' %';
                    output.textContent = valueText;
                    input.setAttribute('aria-valuetext', valueText);
                }
            }
            adaptive.checked = config.themeAdaptive !== false;
            syncColorEditor(config);
        }
        function save(patch) {
            try { core.configure(patch, { persist: true }); sync(); status.textContent = 'Apariencia del núcleo guardada en este dispositivo.'; }
            catch { status.textContent = 'No pude guardar la apariencia. Revisa si el navegador permite almacenamiento local.'; sync(); }
        }
        for (const [key, id] of Object.entries(fields)) {
            document.getElementById(id).addEventListener('input', event => {
                save({ [key]: colorKeys.includes(key) ? event.target.value : Number(event.target.value) });
            });
            if (colorKeys.includes(key)) document.getElementById(id + '-hex').addEventListener('input', event => {
                const value = event.target.value.toLowerCase();
                const valid = /^#[0-9a-f]{6}$/.test(value);
                validateColor(id, valid);
                if (valid) save({ [key]: value });
            });
        }
        layerButtons.forEach(button => button.addEventListener('click', () => {
            selected = button.dataset.coreLayer; sync();
        }));
        adaptive.addEventListener('change', () => save({ themeAdaptive: adaptive.checked }));
        for (const [input, index, divisor] of [[hue, 0, 1], [saturation, 1, 100], [light, 2, 100]]) {
            input.addEventListener('input', () => { hsv[index] = Number(input.value) / divisor; save({ [selected]: toHex(hsv) }); });
        }
        function setPlane(event) {
            const box = plane.getBoundingClientRect();
            if (!box.width || !box.height) return;
            hsv[1] = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
            hsv[2] = 1 - Math.max(0, Math.min(1, (event.clientY - box.top) / box.height));
            save({ [selected]: toHex(hsv) });
        }
        let pointerId = null;
        plane.addEventListener('pointerdown', event => {
            if (event.button !== 0 && event.pointerType !== 'touch') return;
            pointerId = event.pointerId; plane.setPointerCapture?.(pointerId); setPlane(event);
        });
        plane.addEventListener('pointermove', event => { if (pointerId === event.pointerId) setPlane(event); });
        for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) plane.addEventListener(type, () => { pointerId = null; });
        plane.addEventListener('keydown', event => {
            const step = event.shiftKey ? .1 : .01;
            if (event.key === 'ArrowRight') hsv[1] = Math.min(1, hsv[1] + step);
            else if (event.key === 'ArrowLeft') hsv[1] = Math.max(0, hsv[1] - step);
            else if (event.key === 'ArrowUp') hsv[2] = Math.min(1, hsv[2] + step);
            else if (event.key === 'ArrowDown') hsv[2] = Math.max(0, hsv[2] - step);
            else return;
            event.preventDefault(); save({ [selected]: toHex(hsv) });
        });
        document.getElementById('core-visual-reset').addEventListener('click', () => {
            const defaults = core.getDefaults();
            save(Object.fromEntries([...Object.keys(fields), 'themeAdaptive'].map(key => [key, defaults[key]])));
        });
        window.addEventListener('gunter-core-config-changed', sync);
        window.addEventListener('gunter-theme-changed', sync);
        window.addEventListener('storage', event => { if (event.key === PREF_KEY || event.key === null) sync(); });
        sync();
    }

    function loadPreferences() {
        const prefs = readPrefs();

        // Theme chooser
        const currentTheme = localStorage.getItem('gunter_env') || 'empresarial';
        document.querySelectorAll('#theme-chooser button').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.themeValue === currentTheme);
            btn.onclick = () => {
                const t = btn.dataset.themeValue;
                if (window.GunterTheme?.setTheme) window.GunterTheme.setTheme(t);
                else {
                    localStorage.setItem('gunter_env', t);
                    localStorage.setItem('gunter_theme', t);
                    location.reload();
                }
                document.querySelectorAll('#theme-chooser button').forEach(b =>
                    b.classList.toggle('is-active', b === btn));
            };
        });

        // Language
        const lang = document.getElementById('pref-language');
        if (lang) {
            lang.value = prefs.language || 'es-MX';
            lang.onchange = () => { prefs.language = lang.value; writePrefs({ language: prefs.language }); };
        }

        // Reduce motion
        const rm = document.getElementById('pref-reduce-motion');
        if (rm) {
            rm.checked = !!prefs.reduceMotion;
            rm.onchange = () => {
                prefs.reduceMotion = rm.checked;
                writePrefs({ reduceMotion: prefs.reduceMotion });
                document.documentElement.classList.toggle('reduce-motion', rm.checked);
            };
            if (rm.checked) document.documentElement.classList.add('reduce-motion');
        }

        // Click FX
        const fx = document.getElementById('pref-click-fx');
        if (fx) {
            fx.checked = prefs.clickFx !== false;
            fx.onchange = () => { prefs.clickFx = fx.checked; writePrefs({ clickFx: prefs.clickFx }); };
        }
    }

    function initAccount() {
        const form = document.getElementById('account-profile-form');
        if (!form) return;
        const name = document.getElementById('account-registration-name');
        const preferred = document.getElementById('account-preferred-name');
        const save = document.getElementById('account-profile-save');
        const status = document.getElementById('account-profile-status');
        const show = () => {
            const user = window.GunterAuth?.isVerified?.() && window.GunterAuth.getUser();
            if (!user) return;
            name.value = user.displayName || ''; preferred.value = user.preferredName || '';
            document.getElementById('account-login-name').textContent = '@' + user.username;
            name.disabled = preferred.disabled = save.disabled = false;
            status.textContent = 'Perfil autenticado listo.';
        };
        document.addEventListener('gunter-auth-ready', show);
        document.addEventListener('gunter-auth-profile-changed', show);
        show();
        form.addEventListener('submit', async event => {
            event.preventDefault(); save.disabled = true; status.textContent = 'Guardando tu perfil…';
            try {
                await window.GunterAuth.updateProfile({ displayName: name.value.trim(), preferredName: preferred.value.trim() });
                show(); status.textContent = 'Nombres guardados. Gunter usará tu nombre preferido.';
            } catch (error) { status.textContent = error.message || 'No pude guardar el perfil. Revisa la conexión.'; }
            finally { save.disabled = !window.GunterAuth?.isVerified?.(); }
        });
    }

    function initCalendarPlanning() {
        const form = document.getElementById('calendar-planning-form');
        if (!form) return;
        const respect = document.getElementById('calendar-working-hours');
        const start = document.getElementById('calendar-work-start');
        const end = document.getElementById('calendar-work-end');
        const buffer = document.getElementById('calendar-buffer-minutes');
        const days = [...form.querySelectorAll('[name="calendar-working-day"]')];
        const save = document.getElementById('calendar-planning-save');
        const reload = document.getElementById('calendar-planning-reload');
        const status = document.getElementById('calendar-planning-status');
        const timezone = document.getElementById('calendar-planning-timezone');
        const controls = [respect, start, end, buffer, ...days, save, reload];
        let shownOwner = null, dirty = false, readVersion = 0, savingOwner = null, baseline = null;

        const actor = () => {
            const auth = window.GunterAuth;
            const trusted = typeof auth?.canAccessLocalData === 'function'
                ? auth.canAccessLocalData() : auth?.isVerified?.();
            const id = trusted && auth?.getUser?.()?.id;
            return typeof id === 'string' && id && id !== 'local-user' ? id : null;
        };
        const enable = available => controls.forEach(control => { control.disabled = !available; });
        const reset = () => {
            respect.checked = false; start.value = '09:00'; end.value = '18:00'; buffer.value = '0';
            days.forEach(day => { day.checked = Number(day.value) >= 1 && Number(day.value) <= 5; });
            dirty = false; baseline = null;
        };
        const showTimezone = () => {
            const zone = window.GunterPresence?.timezone?.()
                || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
            timezone.textContent = `Zona horaria: ${zone}. Se usa la misma que en Hora y ubicación. La jornada debe terminar el mismo día.`;
        };
        const errorMessage = error => {
            const code = error?.code || error?.message;
            if (code === 'EVENT_PLANNING_INVALID') return 'Revisa los días, la jornada y el margen (0–120 minutos). No se guardó ningún cambio.';
            if (code === 'EVENT_PLANNING_CORRUPT') return 'Los ajustes de agenda guardados no se pueden leer. No se sobrescribieron; revisa Datos y privacidad.';
            if (code === 'EVENT_PLANNING_STORAGE') return 'No pude guardar la planificación en este dispositivo. Tus ajustes anteriores se conservan.';
            if (code === 'EVENT_PLANNING_CHANGED') return 'Los ajustes guardados cambiaron en otra pestaña. No se sobrescribieron. Recarga y descarta este borrador antes de volver a editar.';
            return 'La planificación de agenda no está disponible. No se guardó ningún cambio.';
        };
        const refresh = async () => {
            const ownerId = actor();
            if (ownerId !== shownOwner) {
                shownOwner = ownerId; reset(); savingOwner = null; ++readVersion;
            }
            if (!ownerId) {
                reset(); enable(false);
                timezone.textContent = 'La zona horaria se mostrará al verificar tu cuenta.';
                status.textContent = 'Inicia sesión con una cuenta verificada para configurar tu agenda local.';
                return;
            }
            showTimezone();
            const service = window.GunterEventsService;
            if (!service?.getPlanningPreferences || !service?.updatePlanningPreferences) {
                enable(false); status.textContent = 'El servicio de agenda local no está disponible.'; return;
            }
            // Other preference events must not overwrite this account's unsaved draft.
            if (savingOwner === ownerId) return;
            if (dirty) { enable(true); return; }
            const version = ++readVersion;
            enable(false); status.textContent = 'Cargando planificación de tu cuenta…';
            try {
                const prefs = await service.getPlanningPreferences(ownerId);
                if (ownerId !== actor() || ownerId !== shownOwner) { void refresh(); return; }
                if (version !== readVersion || dirty) return;
                baseline = JSON.parse(JSON.stringify(prefs));
                respect.checked = prefs.respectWorkingHours === true;
                start.value = prefs.workStart; end.value = prefs.workEnd; buffer.value = String(prefs.bufferMinutes);
                days.forEach(day => { day.checked = prefs.workingDays.includes(Number(day.value)); });
                enable(true); status.textContent = 'Planificación de tu cuenta lista. Solo se guarda al pulsar Guardar planificación.';
            } catch (error) {
                if (ownerId !== actor() || ownerId !== shownOwner) { void refresh(); return; }
                if (version !== readVersion) return;
                enable(false); status.textContent = errorMessage(error);
            }
        };
        const markDirty = () => {
            if (actor() !== shownOwner) { void refresh(); return; }
            dirty = true; status.textContent = 'Cambios sin guardar.';
        };
        for (const control of [respect, start, end, buffer, ...days]) {
            control.addEventListener('input', markDirty);
            control.addEventListener('change', markDirty);
        }
        form.addEventListener('submit', async event => {
            event.preventDefault();
            const ownerId = actor();
            if (!ownerId || ownerId !== shownOwner) { void refresh(); return; }
            if (savingOwner || save.disabled || !window.GunterEventsService?.updatePlanningPreferences) return;
            const patch = {
                respectWorkingHours: respect.checked,
                workingDays: days.filter(day => day.checked).map(day => Number(day.value)),
                workStart: start.value, workEnd: end.value,
                bufferMinutes: Number(buffer.value)
            };
            if (!patch.workingDays.length || !/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.workStart)
                || !/^([01]\d|2[0-3]):[0-5]\d$/.test(patch.workEnd) || patch.workEnd <= patch.workStart
                || !buffer.value.trim() || !Number.isInteger(patch.bufferMinutes)
                || patch.bufferMinutes < 0 || patch.bufferMinutes > 120) {
                status.textContent = 'Selecciona al menos un día, una jornada que termine después del inicio en el mismo día y un margen entero de 0–120 minutos.';
                return;
            }
            const version = ++readVersion;
            savingOwner = ownerId; enable(false); status.textContent = 'Guardando planificación de tu cuenta…';
            try {
                const saved = await window.GunterEventsService.updatePlanningPreferences(patch, ownerId, { expected: baseline });
                if (ownerId !== actor() || ownerId !== shownOwner) { void refresh(); return; }
                if (version !== readVersion) return;
                baseline = JSON.parse(JSON.stringify(saved));
                dirty = false; enable(true); status.textContent = 'Planificación guardada. Gunter la usará en sus próximas advertencias y sugerencias.';
            } catch (error) {
                if (ownerId !== actor() || ownerId !== shownOwner) { void refresh(); return; }
                if (version !== readVersion) return;
                enable(true); status.textContent = errorMessage(error);
            } finally {
                if (savingOwner === ownerId && version === readVersion) savingOwner = null;
            }
        });
        reload.addEventListener('click', () => { if (!savingOwner) { dirty = false; void refresh(); } });
        document.addEventListener('gunter-auth-ready', refresh);
        document.addEventListener('gunter-auth-profile-changed', refresh);
        window.addEventListener('gunter-calendar-preferences-change', refresh);
        window.addEventListener('gunter-location-change', () => { if (actor()) showTimezone(); });
        window.addEventListener('storage', event => { if (event.key === PREF_KEY || event.key === null) void refresh(); });
        void refresh();
    }

    // ---------- Data & Privacy ----------
    function loadDataStatus() {
        const openaiEl = document.getElementById('status-openai');
        const geminiEl = document.getElementById('status-gemini');
        const googleEl = document.getElementById('status-google');
        const fcmEl = document.getElementById('status-fcm');
        const apnsEl = document.getElementById('status-apns');

        fetch('/api/health')
            .then(r => r.ok ? r.json() : Promise.reject(new Error('health_unavailable')))
            .then(d => {
                if (openaiEl) {
                    const fallback = Array.isArray(d.fallbackProviders) ? d.fallbackProviders : [];
                    openaiEl.innerHTML = d.services?.openai
                        ? '<span class="ok">✓ Activo</span>'
                        : fallback.length
                            ? `<span class="ok">OpenAI no configurado · alternativa activa (${fallback.map(escapeHtml).join(', ')})</span>`
                            : '<span class="missing">Falta OPENAI_API_KEY y no hay alternativa activa</span>';
                }
                if (fcmEl) fcmEl.innerHTML = d.mobileNotifications?.androidFcm
                    ? '<span class="ok">✓ Configurado</span>'
                    : '<span class="missing">Pendiente: cuenta de servicio FCM en el servidor</span>';
                if (apnsEl) apnsEl.innerHTML = d.mobileNotifications?.iosApns
                    ? '<span class="ok">✓ APNs configurado en el servidor</span>'
                    : '<span class="missing">Pendiente: clave APNs del equipo</span>';
            })
            .catch(() => {
                if (openaiEl) openaiEl.innerHTML = '<span class="missing">Servidor no responde</span>';
                if (fcmEl) fcmEl.innerHTML = '<span class="missing">Servidor no responde</span>';
                if (apnsEl) apnsEl.innerHTML = '<span class="missing">Servidor no responde</span>';
            });

        if (geminiEl) {
            fetch((window.GUNTER_CONFIG?.PROXY_GEMINI_STATUS_URL) || '/api/gemini-status')
                .then(r => r.ok ? r.json() : { available: false })
                .then(d => {
                    geminiEl.innerHTML = d.available
                        ? '<span class="ok">✓ Activo</span>'
                        : '<span class="missing">No configurado</span>';
                })
                .catch(() => geminiEl.innerHTML = '<span class="missing">Servidor no responde</span>');
        }

        if (googleEl) {
            fetch((window.GUNTER_CONFIG?.PROXY_GOOGLE_STATUS_URL) || '/api/google/status')
                .then(r => r.ok ? r.json() : { configured: false })
                .then(d => {
                    googleEl.innerHTML = d.configured
                        ? '<span class="ok">✓ Configurado</span>'
                        : '<span class="missing">Falta GOOGLE_CLIENT_ID en .env</span>';
                })
                .catch(() => googleEl.innerHTML = '<span class="missing">—</span>');
        }

        refreshGoogleCalendarCard();
    }

    async function refreshGoogleCalendarCard() {
        const statusEl = document.getElementById('google-cal-status');
        const emailEl = document.getElementById('google-cal-email');
        const connectBtn = document.getElementById('google-cal-connect');
        const disconnectBtn = document.getElementById('google-cal-disconnect');
        const helpEl = document.getElementById('google-cal-help');
        // Card was moved to Premium tab — skip silently if not present.
        if (!statusEl || !connectBtn) return;

        if (!window.GunterGoogleAuth) {
            statusEl.textContent = 'Servicio no cargado';
            statusEl.className = 'missing';
            connectBtn.disabled = true;
            return;
        }

        const s = await window.GunterGoogleAuth.status();
        if (!s.configured) {
            statusEl.textContent = 'No configurado';
            statusEl.className = 'missing';
            connectBtn.disabled = true;
            if (helpEl) helpEl.innerHTML = `Para activar Google Calendar:
                <ol style="margin-top:6px;">
                    <li>Crea un proyecto en <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console</a></li>
                    <li>Habilita la Calendar API</li>
                    <li>Genera un OAuth Client ID (Web application) con origen autorizado <code>http://localhost:3001</code></li>
                    <li>Añade al <code>.env</code>: <code>GOOGLE_CLIENT_ID=tu-id.apps.googleusercontent.com</code></li>
                    <li>Reinicia <code>npm run dev</code></li>
                </ol>`;
            return;
        }
        connectBtn.disabled = false;

        if (s.connected) {
            statusEl.textContent = '✓ Conectado';
            statusEl.className = 'ok';
            if (emailEl) emailEl.textContent = s.email || '(sin correo detectado)';
            connectBtn.style.display = 'none';
            if (disconnectBtn) disconnectBtn.style.display = 'inline-flex';
            if (helpEl) helpEl.textContent = '';
        } else {
            statusEl.textContent = 'Desconectado';
            statusEl.className = 'missing';
            if (emailEl) emailEl.textContent = '—';
            connectBtn.style.display = 'inline-flex';
            if (disconnectBtn) disconnectBtn.style.display = 'none';
            if (helpEl) helpEl.textContent = 'Pulsa "Conectar" para autorizar el acceso a tu Google Calendar. Los datos nunca pasan por nuestro servidor.';
        }
    }

    function initGoogleCalendar() {
        // The dedicated Google Calendar card was moved to Premium tab.
        // These elements may not exist anymore — guard each use.
        const connectBtn = document.getElementById('google-cal-connect');
        if (!connectBtn) return; // nothing to wire in this layout
        const disconnectBtn = document.getElementById('google-cal-disconnect');
        const flushBtn = document.getElementById('google-cal-flush');
        const autoToggle = document.getElementById('pref-auto-push-google');

        connectBtn.addEventListener('click', async () => {
            connectBtn.disabled = true;
            connectBtn.textContent = 'Abriendo Google…';
            try {
                await window.GunterGoogleAuth.connect();
                await refreshGoogleCalendarCard();
                if (window.GunterNotificationsService?.showToast) {
                    window.GunterNotificationsService.showToast('✅ Google Calendar conectado', { priority: 'normal' });
                }
            } catch (err) {
                alert('No se pudo conectar: ' + (err.message || err));
            } finally {
                connectBtn.disabled = false;
                connectBtn.textContent = 'Conectar Google Calendar';
            }
        });

        if (disconnectBtn) disconnectBtn.addEventListener('click', () => {
            window.GunterGoogleAuth.disconnect();
            refreshGoogleCalendarCard();
        });

        if (flushBtn) flushBtn.addEventListener('click', async () => {
            if (!window.GunterCalendarService?.flushQueue) return;
            const n = await window.GunterCalendarService.flushQueue();
            alert(n > 0 ? `${n} eventos enviados.` : 'Cola vacía.');
        });

        if (autoToggle) {
            const prefs = readPrefs();
            autoToggle.checked = !!prefs.autoPushToGoogle;
            autoToggle.addEventListener('change', () => {
                const p = readPrefs();
                p.autoPushToGoogle = autoToggle.checked;
                writePrefs(p);
            });
        }

        window.addEventListener('google-auth', refreshGoogleCalendarCard);
    }

    function initData() {
        const exportBtn = document.getElementById('export-data-btn');
        if (exportBtn) exportBtn.addEventListener('click', exportData);

        const importInput = document.getElementById('import-data-input');
        if (importInput) importInput.addEventListener('change', handleImport);
        const importButton = document.getElementById('import-data-select');
        if (importButton && importInput) importButton.addEventListener('click', () => importInput.click());

        const wipeBtn = document.getElementById('wipe-all-btn');
        if (wipeBtn) wipeBtn.addEventListener('click', wipeEverything);
    }

    function exportData() {
        const dump = {
            gunter_data: safeParse(localStorage.getItem('gunter_data')),
            gunter_generated_analyses: safeParse(localStorage.getItem('gunter_generated_analyses')),
            gunter_prefs: safeParse(localStorage.getItem('gunter_prefs')),
            exportedAt: new Date().toISOString(),
            version: 1
        };
        const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gunter-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function handleImport(e) {
        const file = e.target.files?.[0];
        const status = document.getElementById('import-data-status');
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result);
                if (!data || !data.gunter_data) throw new Error('Formato inválido.');
                localStorage.setItem('gunter_data', JSON.stringify(data.gunter_data));
                if (data.gunter_generated_analyses) {
                    localStorage.setItem('gunter_generated_analyses', JSON.stringify(data.gunter_generated_analyses));
                }
                if (data.gunter_prefs) {
                    localStorage.setItem('gunter_prefs', JSON.stringify(data.gunter_prefs));
                }
                if (status) status.textContent = '✓ Respaldo restaurado. Recarga el dashboard.';
            } catch (err) {
                if (status) status.textContent = '⚠ Archivo inválido: ' + err.message;
            }
        };
        reader.readAsText(file);
    }

    async function wipeEverything() {
        if (!confirm('¿Borrar TODOS los datos locales? Esta acción es irreversible.')) return;
        if (!confirm('Confirma una vez más — se eliminan proyectos, análisis, transcripciones y audios.')) return;

        // localStorage
        ['gunter_data', 'gunter_generated_analyses', 'gunter_prefs',
         'gunter_full_transcript', 'gunter_transcripts', 'gunter_project',
         'gunter_env', 'gunter_theme', 'gunter_project_id', 'gunter_market',
         'gunter_budget', 'gunter_timeline', 'gunter_analysis', 'gunter_speakers']
            .forEach(k => localStorage.removeItem(k));

        // IndexedDB stores
        await deleteIDB('gunter_audio_vault');
        await deleteIDB('gunter_transcription_db');

        alert('Todos los datos locales fueron eliminados.');
        location.href = 'dashboard.html';
    }

    function deleteIDB(name) {
        return new Promise(res => {
            const r = indexedDB.deleteDatabase(name);
            r.onsuccess = r.onerror = r.onblocked = () => res();
        });
    }

    // ---------- Helpers ----------
    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }
    function escapeAttr(s) { return escapeHtml(s); }
    function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

    // ---------- Boot ----------
    function boot() {
        document.getElementById('config-open-assistant')?.addEventListener('click', () => window.GunterCompanion?.expand?.());
        document.getElementById('config-context-ask')?.addEventListener('click', () => window.GunterCompanion?.expand?.());
        arrangeExistingControls();
        initTabs();
        initSectionSearch();
        initContextState();
        window.addEventListener('gunterPremiumFeaturesChange', () => updatePanelIndex((location.hash || '#premium').slice(1)));
        window.addEventListener('gunter-hybrid-state', () => updatePanelIndex((location.hash || '#premium').slice(1)));
        initAccount();
        initCoreVisualSettings();
        initCalendarPlanning();
        initTrash();
        initData();
        initGoogleCalendar();
        initVoiceTest();
        initDiagnostics();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
