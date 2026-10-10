/* =============================================
   GUNTER APP - Config Settings Controller
   Maneja: tabs, papelera, preferencias, datos.
   ============================================= */

(function () {
    const TABS = ['account', 'premium', 'voice', 'conversations', 'actions', 'connections', 'preferences', 'data', 'diagnostics'];
    const ADVANCED_TABS = new Set(['premium', 'voice', 'conversations', 'actions', 'connections']);
    const TITLES = {
        account: { t: 'Mi cuenta', s: 'Tu identidad y cómo quieres que Gunter te llame.' },
        premium: { t: 'Asistente e IA', s: 'Personalidad, conocimiento y decisiones con controles claros.' },
        voice: { t: 'Voz y escucha', s: 'Micrófono, activación y dictado local con estados verificables.' },
        conversations: { t: 'Conversaciones y memoria', s: 'Tus recuerdos e historial bajo tu control.' },
        actions: { t: 'Acciones y permisos', s: 'Herramientas, automatizaciones y autorizaciones.' },
        connections: { t: 'Conexiones y dispositivos', s: 'Servicios externos y capacidades de tus dispositivos.' },
        preferences: { t: 'Apariencia y accesibilidad', s: 'Ambiente visual y ajustes de comodidad.' },
        data: { t: 'Datos y privacidad', s: 'Respaldos, almacenamiento y eliminación segura.' },
        diagnostics: { t: 'Diagnóstico', s: 'Comprobaciones reales, sin revelar registros privados.' }
    };

    function activateTab(name) {
        if (name === 'trash') name = 'data';
        if (!TABS.includes(name)) name = 'premium';

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

        // URL hash so navigation from sidebar can deep-link
        try { history.replaceState(null, '', '#' + name); } catch {}

        // Lazy-load the panel data
        if (name === 'data') renderTrash();
        if (['premium', 'voice', 'preferences'].includes(name)) loadPreferences();
        if (name === 'connections') loadDataStatus();
        if (ADVANCED_TABS.has(name)) { mountPremium(); window.GunterAdvancedSettings?.setCategory?.(name); }
        if (name === 'voice') updateVoiceDependencies();
    }

    let premiumMounted = false;
    function mountPremium() {
        if (premiumMounted) return;
        if (window.GunterAdvancedSettings?.mount) {
            window.GunterAdvancedSettings.mount('#premium-panel');
            premiumMounted = true;
            window.GunterControlPlaneSettings?.mount?.('#premium-panel');
            const plane = document.querySelector('#premium-panel > .cp-settings');
            if (plane) plane.hidden = !['premium'].includes((location.hash || '#premium').slice(1));
        } else {
            const el = document.getElementById('premium-panel');
            if (el) el.innerHTML = '<p class="settings-empty">Cargando módulo premium…</p>';
        }
    }

    function initTabs() {
        const tabs = [...document.querySelectorAll('.config-tab')];
        tabs.forEach((btn, index) => {
            btn.addEventListener('click', () => activateTab(btn.dataset.tab));
            btn.addEventListener('keydown', event => {
                const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
                    : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
                    : event.key === 'Home' ? 0
                    : event.key === 'End' ? tabs.length - 1 : -1;
                if (next < 0) return;
                event.preventDefault();
                activateTab(tabs[next].dataset.tab);
                tabs[next].focus();
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
        move('#pref-language', 'voice');
        move('#push-settings-card', 'actions');
        move('#status-openai', 'connections', true);
        move('#social-settings-panel', 'connections');
        move('#personal-memory-card', 'conversations', true);
        move('#conv-memory-card', 'conversations', true);
        const trashCard = document.querySelector('#trash-list')?.closest('.settings-card');
        const dangerHeading = document.querySelector('#config-panel-data .data-section-title--danger');
        if (trashCard && dangerHeading) dangerHeading.before(trashCard);
        const intro = document.querySelector('#config-panel-data .data-section-intro p');
        if (intro) intro.innerHTML = 'Aquí gestionas respaldos, almacenamiento y privacidad. <strong>Las acciones de borrado requieren confirmación.</strong>';
    }

    function updateVoiceDependencies() {
        const el = document.getElementById('voice-test-dependency');
        if (!el) return;
        const runtime = window.GunterRuntimeState?.getState?.() || {};
        const capture = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
        el.textContent = window.PremiumFeaturesService?.isEnabled?.('dictationEnabled') === false ? 'Dictado desactivado por el usuario.'
            : !capture ? 'Este navegador no permite capturar audio. Usa el chat de texto.'
            : runtime.loaded !== true ? 'Comprobando el estado de Moonshine y del servidor…'
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
            const names = { off: 'Desactivado', permission_pending: 'Permiso pendiente', recording: 'Grabando', transcribing: 'Transcribiendo', review: 'Texto reconocido: revisa el chat', error: 'Error' };
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
        arrangeExistingControls();
        initTabs();
        initAccount();
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
