/* =============================================
   GUNTER DÍA - Dynamic Tabs
   -------------------------------------------------
   Muestra pestañas adicionales en Gunter Día
   a medida que el usuario activa funciones premium.
   Cada pestaña se activa solo si su flag está on.
   ============================================= */

(function () {
    const TABS = [
        { id: 'today',        label: 'Hoy',           icon: '🗓️', alwaysOn: true },
        // ===== Premium Intelligence (Sprint C) =====
        { id: 'plan-day',     label: 'Plan de hoy',   icon: '🌅', flag: 'dailyPlanner',       mounter: 'mountDailyPlanner' },
        { id: 'plan-week',    label: 'Mi semana',     icon: '📅', flag: 'weeklyPlanner',      mounter: 'mountWeeklyPlanner' },
        { id: 'urgency',      label: 'Urgencia',      icon: '🔥', flag: 'urgencyRanking',     mounter: 'mountUrgency' },
        { id: 'project-360',  label: 'Proyecto 360',  icon: '🛰️', flag: 'project360',         mounter: 'mountProject360' },
        { id: 'decisions',    label: 'Decisiones',    icon: '🧭', flag: 'decisionCenter',     mounter: 'mountDecisions' },
        { id: 'delegation',   label: 'Delegación',    icon: '🤝', flag: 'delegationMode',     mounter: 'mountDelegation' },
        { id: 'alerts-wa',    label: 'Alertas WA',    icon: '🔔', flag: 'smartWhatsappAlerts',mounter: 'mountSmartAlerts' },
        // ===== Existentes =====
        { id: 'productivity', label: 'Productividad', icon: '📊', flag: 'productivityPanel',  mounter: 'mountProductivity' },
        { id: 'memory',       label: 'Memoria',       icon: '🧠', flag: 'meetingMemory',      mounter: 'mountMemory' },
        { id: 'documents',    label: 'Documentos',    icon: '📄', flag: 'smartDocuments',     mounter: 'mountDocuments' },
        { id: 'whatsapp',     label: 'WhatsApp',      icon: '💬', flag: 'whatsappAssistant',  mounter: 'mountWhatsApp', badge: true },
        { id: 'voice',        label: 'Voz',           icon: '🗣️', flag: 'voiceEnabled',       mounter: 'mountVoice' },
        { id: 'wake',         label: 'Wake word',     icon: '🎙️', flag: 'wakeWordEnabled',    mounter: 'mountWake' },
        // ===== v2 — Funciones avanzadas =====
        { id: 'commitments',  label: 'Compromisos',   icon: '🤝', flag: 'commitmentTracker',  mounter: 'mountCommitments' },
        { id: 'proactive',    label: 'Pulso',         icon: '⚡', flag: 'proactivePulse',     mounter: 'mountProactive' },
        { id: 'forecast',     label: 'Forecast',      icon: '🔮', flag: 'projectForecast',    mounter: 'mountForecast' }
    ];

    let bar = null;
    let mountedTabs = new Set(['today']);
    let activeTab = 'today';

    function flag(key) {
        return !!(window.PremiumFeaturesService?.isEnabled?.(key));
    }

    function render() {
        bar = document.getElementById('gday-tabs');
        if (!bar) return;

        const visible = TABS.filter(t => t.alwaysOn || flag(t.flag));
        bar.innerHTML = visible.map(t => `
            <button class="gday__tab ${activeTab === t.id ? 'is-active' : ''}" role="tab"
                data-tab="${t.id}" aria-selected="${activeTab === t.id}">
                <span>${t.icon}</span>
                <span>${t.label}</span>
                ${t.badge ? '<span class="gday__tab-badge" data-tab-badge="' + t.id + '">0</span>' : ''}
            </button>
        `).join('');

        bar.querySelectorAll('[data-tab]').forEach(btn => {
            btn.addEventListener('click', () => activate(btn.dataset.tab));
        });

        // Ensure the active tab still exists; fall back to today otherwise
        if (!visible.find(t => t.id === activeTab)) activeTab = 'today';
        showPanel(activeTab);
    }

    function showPanel(id) {
        document.querySelectorAll('.gday__tab-panel').forEach(p => {
            p.hidden = p.dataset.tabPanel !== id;
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
        });
        showPanel(id);
    }

    // ---------- Per-tab mounters ----------
    const MOUNTERS = {
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
    window.addEventListener('whatsapp-status', () => updateWhatsAppBadge());
    window.addEventListener('whatsapp-sync', () => updateWhatsAppBadge());

    async function updateWhatsAppBadge() {
        const el = document.querySelector('[data-tab-badge="whatsapp"]');
        if (!el || !window.GunterWhatsApp) return;
        try {
            const msgs = await window.GunterWhatsApp.messages(20);
            const count = msgs.filter(m => m.direction === 'in').length;
            el.textContent = count > 0 ? String(count) : '';
            el.style.display = count > 0 ? '' : 'none';
        } catch {}
    }

    function init() {
        render();
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.GunterDayTabs = { render, activate };
})();
