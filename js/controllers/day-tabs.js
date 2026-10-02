/* =============================================
   GUNTER DÍA - Dynamic Tabs
   -------------------------------------------------
   Muestra pestañas adicionales en Gunter Día
   a medida que el usuario activa funciones premium.
   Cada pestaña se activa solo si su flag está on.
   ============================================= */

(function () {
    const TABS = [
        // 1. Enfoque inmediato: qué ocurre y qué requiere atención.
        { id: 'today',        label: 'Ahora',          icon: '◉',  group: 'focus', alwaysOn: true },
        { id: 'activity',     label: 'Actividad',      icon: '↻',  group: 'focus', alwaysOn: true, mounter: 'mountActivity' },
        { id: 'conversations',label: 'Conversaciones', icon: '◫',  group: 'focus', alwaysOn: true, mounter: 'mountConversations', badge: true },
        { id: 'plan-day',     label: 'Plan del día',   icon: '↗',  group: 'focus', flag: 'dailyPlanner',        mounter: 'mountDailyPlanner' },
        { id: 'urgency',      label: 'Prioridades',    icon: '!',  group: 'focus', flag: 'urgencyRanking',      mounter: 'mountUrgency' },
        { id: 'plan-week',    label: 'Semana',         icon: '▦',  group: 'focus', flag: 'weeklyPlanner',       mounter: 'mountWeeklyPlanner' },
        { id: 'proactive',    label: 'Pulso',          icon: '⌁',  group: 'focus', flag: 'proactivePulse',      mounter: 'mountProactive' },

        // 2. Inteligencia: decidir, proyectar y delegar.
        { id: 'project-360',  label: 'Proyectos',      icon: '◎',  group: 'intel', flag: 'project360',          mounter: 'mountProject360' },
        { id: 'decisions',    label: 'Decisiones',     icon: '◇',  group: 'intel', flag: 'decisionCenter',      mounter: 'mountDecisions' },
        { id: 'commitments',  label: 'Compromisos',    icon: '✓',  group: 'intel', flag: 'commitmentTracker',   mounter: 'mountCommitments' },
        { id: 'delegation',   label: 'Delegar',        icon: '⇄',  group: 'intel', flag: 'delegationMode',      mounter: 'mountDelegation' },
        { id: 'forecast',     label: 'Forecast',       icon: '⌁',  group: 'intel', flag: 'projectForecast',     mounter: 'mountForecast' },
        { id: 'productivity', label: 'Rendimiento',    icon: '▥',  group: 'intel', flag: 'productivityPanel',   mounter: 'mountProductivity' },

        // 3. Conocimiento: lo que Gunter recuerda y puede consultar.
        { id: 'memory',       label: 'Memoria',        icon: '◌',  group: 'knowledge', flag: 'meetingMemory',   mounter: 'mountMemory' },
        { id: 'documents',    label: 'Documentos',     icon: '▤',  group: 'knowledge', flag: 'smartDocuments',  mounter: 'mountDocuments' },
        { id: 'tutor',        label: 'Tutor',          icon: '⌘',  group: 'knowledge', flag: 'tutorMode',       mounter: 'mountTutor' },

        // 4. Canales: cómo se comunica y escucha el asistente.
        { id: 'voice',        label: 'Voz',            icon: '◖',  group: 'channels', flag: 'voiceEnabled',        mounter: 'mountVoice' },
        { id: 'wake',         label: 'Invocación',     icon: '◉',  group: 'channels', flag: 'wakeWordEnabled',     mounter: 'mountWake' },
        { id: 'alerts-wa',    label: 'Alertas',        icon: '!',  group: 'channels', flag: 'smartWhatsappAlerts', mounter: 'mountSmartAlerts' }
    ];

    const GROUPS = [
        { id: 'focus', label: 'Enfoque' },
        { id: 'intel', label: 'Inteligencia' },
        { id: 'knowledge', label: 'Conocimiento' },
        { id: 'channels', label: 'Canales' }
    ];

    let bar = null;
    let mountedTabs = new Set(['today']);
    let activeTab = 'today';

    function flag(key) {
        // Tutor 📚 (v50): además del flag, requiere permiso concedido por admin
        if (key === 'tutorMode' && window.GunterAuth && !window.GunterAuth.canTutor()) return false;
        return !!(window.PremiumFeaturesService?.isEnabled?.(key));
    }

    function render() {
        bar = document.getElementById('gday-tabs');
        if (!bar) return;

        const visible = TABS.filter(t => t.alwaysOn || flag(t.flag));
        if (!visible.some(t => t.id === activeTab)) activeTab = 'today';
        bar.innerHTML = GROUPS.map(group => {
            const items = visible.filter(t => t.group === group.id);
            if (!items.length) return '';
            return `
                <div class="gday__tab-group" data-tab-group="${group.id}">
                    <span class="gday__tab-group-label">${group.label}</span>
                    <div class="gday__tab-group-items">
                        ${items.map(t => `
                            <button class="gday__tab ${activeTab === t.id ? 'is-active' : ''}" role="tab"
                                data-tab="${t.id}" aria-selected="${activeTab === t.id}">
                                <span aria-hidden="true">${t.icon}</span>
                                <span>${t.label}</span>
                                ${t.badge ? '<span class="gday__tab-badge" data-tab-badge="' + t.id + '">0</span>' : ''}
                            </button>
                        `).join('')}
                    </div>
                </div>`;
        }).join('');

        bar.querySelectorAll('[data-tab]').forEach(btn => {
            btn.addEventListener('click', () => activate(btn.dataset.tab));
            const tabId = `gday-tab-${btn.dataset.tab}`;
            const panelId = `gday-panel-${btn.dataset.tab}`;
            btn.id = tabId;
            btn.setAttribute('aria-controls', panelId);
            btn.tabIndex = btn.dataset.tab === activeTab ? 0 : -1;
        });

        bar.onkeydown = event => {
            if (!event.target.matches('.gday__tab')) return;
            const tabs = [...bar.querySelectorAll('.gday__tab')];
            const index = tabs.indexOf(event.target);
            const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
                : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
                : event.key === 'Home' ? 0
                : event.key === 'End' ? tabs.length - 1 : -1;
            if (next < 0) return;
            event.preventDefault();
            activate(tabs[next].dataset.tab);
            tabs[next].focus();
        };

        showPanel(activeTab);
    }

    function showPanel(id) {
        document.querySelectorAll('.gday__tab-panel').forEach(p => {
            p.hidden = p.dataset.tabPanel !== id;
            const tabId = `gday-tab-${p.dataset.tabPanel}`;
            p.id = `gday-panel-${p.dataset.tabPanel}`;
            p.setAttribute('role', 'tabpanel');
            p.setAttribute('aria-labelledby', tabId);
            p.tabIndex = 0;
        });
        bar?.querySelectorAll('.gday__tab').forEach(tab => {
            const active = tab.dataset.tab === id;
            tab.setAttribute('aria-selected', String(active));
            tab.tabIndex = active ? 0 : -1;
        });
        // Next-up ribbon solo visible en Hoy
        const ribbon = document.getElementById('gday-next-ribbon');
        if (ribbon) ribbon.style.display = id === 'today' ? '' : 'none';

        // Lazy-mount content of the tab
        const def = TABS.find(t => t.id === id);
        if (def && def.mounter && !mountedTabs.has(id)) {
            mountedTabs.add(id);
            try { MOUNTERS[def.mounter]?.(); } catch (e) { console.warn('[tabs] mount error:', e); }
        }
    }

    function activate(id) {
        activeTab = id;
        bar.querySelectorAll('.gday__tab').forEach(b => {
            const on = b.dataset.tab === id;
            b.classList.toggle('is-active', on);
            b.setAttribute('aria-selected', String(on));
            b.tabIndex = on ? 0 : -1;
        });
        showPanel(id);
    }

    // ---------- Per-tab mounters ----------
    const MOUNTERS = {
        mountActivity: () => {
            if (window.GunterActivityPanel?.mount) {
                window.GunterActivityPanel.mount('#gday-activity');
            }
        },
        mountConversations: () => {
            if (window.GunterConversationsPanel?.mount) {
                window.GunterConversationsPanel.mount('#gday-conversations');
            }
        },
        mountDailyPlanner: () => {
            if (window.GunterDailyPlannerPanel?.mount) {
                window.GunterDailyPlannerPanel.mount('#gday-plan-day');
            }
        },
        mountWeeklyPlanner: () => {
            if (window.GunterWeeklyPlannerPanel?.mount) {
                window.GunterWeeklyPlannerPanel.mount('#gday-plan-week');
            }
        },
        mountUrgency: () => {
            if (window.GunterUrgencyPanel?.mount) {
                window.GunterUrgencyPanel.mount('#gday-urgency');
            }
        },
        mountProject360: () => {
            if (window.GunterProject360Panel?.mount) {
                window.GunterProject360Panel.mount('#gday-project-360');
            }
        },
        mountDecisions: () => {
            if (window.GunterDecisionsPanel?.mount) {
                window.GunterDecisionsPanel.mount('#gday-decisions');
            }
        },
        mountDelegation: () => {
            if (window.GunterDelegationPanel?.mount) {
                window.GunterDelegationPanel.mount('#gday-delegation');
            }
        },
        mountSmartAlerts: () => {
            if (window.GunterSmartAlertsPanel?.mount) {
                window.GunterSmartAlertsPanel.mount('#gday-alerts-wa');
            }
        },
        mountProductivity: () => {
            if (window.GunterProductivityPanel?.mount) {
                window.GunterProductivityPanel.mount('#gday-productivity');
            }
        },
        mountMemory: () => {
            if (window.GunterMeetingMemory?.mount) {
                window.GunterMeetingMemory.mount('#gday-meeting-memory');
            }
        },
        mountDocuments: () => {
            if (window.GunterDocumentsTab?.mount) {
                window.GunterDocumentsTab.mount('#gday-documents');
            }
        },
        mountWhatsApp: () => {
            if (window.GunterWhatsAppTab?.mount) {
                window.GunterWhatsAppTab.mount('#gday-whatsapp');
            }
        },
        mountVoice: () => {
            if (window.GunterVoiceTab?.mount) {
                window.GunterVoiceTab.mount('#gday-voice');
            }
        },
        mountWake: () => {
            if (window.GunterWakeTab?.mount) {
                window.GunterWakeTab.mount('#gday-wake');
            }
        },
        // ===== v2 — Funciones avanzadas =====
        mountCommitments: () => {
            if (window.GunterCommitmentsPanel?.mount) {
                window.GunterCommitmentsPanel.mount('#gday-commitments');
            }
        },
        mountProactive: () => {
            if (window.GunterProactivePanel?.mount) {
                window.GunterProactivePanel.mount('#gday-proactive');
            }
        },
        mountForecast: () => {
            if (window.GunterForecastPanel?.mount) {
                window.GunterForecastPanel.mount('#gday-forecast');
            }
        },
        mountTutor: () => {
            if (window.GunterTutorPanel?.mount) {
                window.GunterTutorPanel.mount('#gday-tutor');
            }
        }
    };

    // ---------- Listen to premium changes ----------
    window.addEventListener('gunterPremiumFeaturesChange', (e) => {
        const prevActive = activeTab;

        // Re-render tab bar (flags may have enabled/disabled tabs)
        render();

        // Re-mount the currently active tab so its contents reflect new config
        // (e.g., Voz tab showing the new style immediately)
        const def = TABS.find(t => t.id === prevActive);
        if (def && def.mounter && MOUNTERS[def.mounter]) {
            try { MOUNTERS[def.mounter](); } catch (err) { console.warn('[tabs] re-mount:', err); }
        }

        // If the active tab was disabled, fall back to Hoy
        const visible = TABS.filter(t => t.alwaysOn || flag(t.flag)).map(t => t.id);
        if (!visible.includes(prevActive)) activate('today');
    });
    // v2 — listener para que cualquier panel pueda pedir "abre la pestaña X"
    window.addEventListener('gunter-open-tab', (e) => {
        const id = e.detail?.tab;
        if (id && TABS.find(t => t.id === id)) activate(id);
    });

    // WhatsApp unread badge updater
    window.addEventListener('whatsapp-status', () => updateConversationBadge());
    window.addEventListener('whatsapp-sync', () => updateConversationBadge());
    window.addEventListener('gunter-conversations-updated', event => updateConversationBadge(event.detail));

    async function updateConversationBadge(stats) {
        const el = document.querySelector('[data-tab-badge="conversations"]');
        if (!el) return;
        try {
            const count = Number(stats?.unread ?? (await window.GunterControlPlane?.conversations?.({ limit: 100 }))?.stats?.unread ?? 0);
            el.textContent = count > 0 ? String(count) : '';
            el.style.display = count > 0 ? '' : 'none';
        } catch {}
    }

    function activateFromHash() {
        const requested = String(location.hash || '').replace(/^#/, '');
        const todayTargets = {
            capture: 'gday-quickbar-drop', tasks: 'tasks-card', events: 'events-card',
            reminders: 'reminders-card', chat: 'chat-card'
        };
        if (todayTargets[requested]) {
            activate('today');
            requestAnimationFrame(() => document.getElementById(todayTargets[requested])?.scrollIntoView({ block: 'center' }));
        } else if (requested && TABS.some(tab => tab.id === requested && (tab.alwaysOn || flag(tab.flag)))) activate(requested);
    }

    function init() {
        render();
        activateFromHash();
        // Los accesos globales pueden cambiar de panel sin recargar Día.
        window.addEventListener('hashchange', activateFromHash);
        updateConversationBadge();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.GunterDayTabs = { render, activate };
})();
