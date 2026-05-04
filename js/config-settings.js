/* =============================================
   GUNTER APP - Config Settings Controller
   Maneja: tabs, papelera, preferencias, datos.
   ============================================= */

(function () {
    const TABS = ['premium', 'preferences', 'trash', 'data'];
    const TITLES = {
        'premium':     { t: 'Funciones Premium', s: 'Activa módulos avanzados de Gunter. Todo se guarda localmente.' },
        'preferences': { t: 'Preferencias',   s: 'Personaliza apariencia, idioma y accesibilidad.' },
        'trash':       { t: 'Papelera',       s: 'Proyectos eliminados. Restaura o elimina definitivamente.' },
        'data':        { t: 'Datos y Privacidad', s: 'Exporta, importa o borra tu información local.' }
    };

    function activateTab(name) {
        if (!TABS.includes(name)) name = 'premium';

        document.querySelectorAll('.config-tab').forEach(btn => {
            btn.classList.toggle('is-active', btn.dataset.tab === name);
        });
        document.querySelectorAll('.config-tab-panel').forEach(p => {
            p.hidden = p.dataset.panel !== name;
        });

        const titleEl = document.getElementById('config-header-title');
        const subEl = document.getElementById('config-header-subtitle');
        if (titleEl) titleEl.textContent = TITLES[name].t;
        if (subEl) subEl.textContent = TITLES[name].s;

        // URL hash so navigation from sidebar can deep-link
        try { history.replaceState(null, '', '#' + name); } catch {}

        // Lazy-load the panel data
        if (name === 'trash') renderTrash();
        if (name === 'preferences') loadPreferences();
        if (name === 'data') loadDataStatus();
        if (name === 'premium') mountPremium();
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

    function initTabs() {
        document.querySelectorAll('.config-tab').forEach(btn => {
            btn.addEventListener('click', () => activateTab(btn.dataset.tab));
        });
        const initial = (location.hash || '').replace('#', '') || 'premium';
        activateTab(initial);
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
    function writePrefs(p) { localStorage.setItem(PREF_KEY, JSON.stringify(p)); }

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
            lang.onchange = () => { prefs.language = lang.value; writePrefs(prefs); };
        }

        // Reduce motion
        const rm = document.getElementById('pref-reduce-motion');
        if (rm) {
            rm.checked = !!prefs.reduceMotion;
            rm.onchange = () => {
                prefs.reduceMotion = rm.checked;
                writePrefs(prefs);
                document.documentElement.classList.toggle('reduce-motion', rm.checked);
            };
            if (rm.checked) document.documentElement.classList.add('reduce-motion');
        }

        // Click FX
        const fx = document.getElementById('pref-click-fx');
        if (fx) {
            fx.checked = prefs.clickFx !== false;
            fx.onchange = () => { prefs.clickFx = fx.checked; writePrefs(prefs); };
        }
    }

    // ---------- Data & Privacy ----------
    function loadDataStatus() {
        const openaiEl = document.getElementById('status-openai');
        const geminiEl = document.getElementById('status-gemini');
        const googleEl = document.getElementById('status-google');

        if (openaiEl) openaiEl.innerHTML = '<span class="ok">Configurado vía .env</span>';

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
        initTabs();
        initTrash();
        initData();
        initGoogleCalendar();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
})();
