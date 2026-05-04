/* =============================================
   GUNTER CONTROLLER - Today Shortcuts (Sprint G — cierre)
   -------------------------------------------------
   En el panel Hoy de day.html, inyecta:
     - Botones de atajo "Planificar mi día" /
       "Organizar semana" / "Más urgente" / "360"
       (cada uno activa su tab si está habilitado;
        si el flag está OFF, ofrece activarlo).
     - Mini-card "🔥 Prioridad de hoy" con top 3
       (visible si urgencyRanking ON).
     - Mini-card "🚨 Proyectos en riesgo" con top 3
       (visible si projectAutoFollowUp ON).

   Es la "puerta de entrada" a las premium intel
   features sin tener que descubrir los tabs.
   ============================================= */

(function () {
    let host = null;
    let mounted = false;

    function flag(k) { return !!(window.PremiumFeaturesService?.isEnabled?.(k)); }

    async function mount(selector = '#gday-today-shortcuts') {
        host = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!host) return;
        host.classList.add('gpi-panel');
        mounted = true;
        await render();
        window.addEventListener('gunterPremiumFeaturesChange', () => { if (mounted) render().catch(() => {}); });
    }

    async function render() {
        if (!host) return;
        host.innerHTML = `
            <div class="gpi-shortcuts">
                <div class="gpi-shortcuts__buttons">
                    ${shortcutButton('plan-day', 'dailyPlanner',  '🌅', 'Planificar mi día')}
                    ${shortcutButton('plan-week', 'weeklyPlanner', '📅', 'Organizar semana')}
                    ${shortcutButton('urgency', 'urgencyRanking',  '🔥', 'Más urgente')}
                    ${shortcutButton('project-360', 'project360',  '🛰️', 'Proyecto 360')}
                </div>
                <div class="gpi-shortcuts__cards" id="gpi-mini-cards"></div>
            </div>
        `;

        host.querySelectorAll('[data-shortcut-tab]').forEach(b => {
            b.addEventListener('click', () => onShortcutClick(b.dataset.shortcutTab, b.dataset.shortcutFlag));
        });

        // Mini-cards async
        const mini = host.querySelector('#gpi-mini-cards');
        const blocks = [];
        if (flag('urgencyRanking'))      blocks.push(loadUrgencyCard());
        if (flag('projectAutoFollowUp')) blocks.push(loadRiskCard());
        if (!blocks.length) return;

        const results = await Promise.allSettled(blocks);
        mini.innerHTML = results
            .filter(r => r.status === 'fulfilled' && r.value)
            .map(r => r.value)
            .join('');
    }

    function shortcutButton(tabId, flagKey, icon, label) {
        const enabled = flag(flagKey);
        return `
            <button class="gpi-shortcut ${enabled ? 'is-enabled' : 'is-disabled'}"
                    data-shortcut-tab="${tabId}"
                    data-shortcut-flag="${flagKey}"
                    title="${enabled ? 'Abrir ' + label : 'Activar y abrir ' + label}">
                <span class="gpi-shortcut__icon">${icon}</span>
                <span class="gpi-shortcut__label">${label}</span>
                ${enabled ? '' : '<span class="gpi-shortcut__lock">🔒</span>'}
            </button>
        `;
    }

    async function onShortcutClick(tabId, flagKey) {
        if (!flag(flagKey)) {
            const ok = window.confirm(
                `La función "${flagKey}" está desactivada.\n\n¿Quieres activarla ahora?`
            );
            if (!ok) return;
            try {
                window.PremiumFeaturesService?.set(flagKey, true);
            } catch (e) {
                toast('No pude activar la función.', 'error');
                return;
            }
            // Re-render para reflejar; pequeño delay para que day-tabs registre el cambio
            await new Promise(r => setTimeout(r, 200));
        }
        // Cambiar al tab correspondiente
        if (window.GunterDayTabs?.activate) {
            window.GunterDayTabs.activate(tabId);
        }
    }

    async function loadUrgencyCard() {
        try {
            const r = await window.GunterPremiumIntel?.getUrgencyRanking('today', { limit: 3 });
            if (!r?.success) return null;
            const ranked = r.data?.ranked?.slice(0, 3) || [];
            if (!ranked.length) {
                return miniCard('🔥 Prioridad de hoy', '<p class="gpi-mini__empty">🎉 Sin pendientes urgentes hoy.</p>', 'urgency');
            }
            const html = `
                <ol class="gpi-mini__list">
                    ${ranked.map(it => `
                        <li>
                            <span class="gpi-mini__title">${esc(it.title)}</span>
                            ${it.projectName ? `<span class="gpi-chip gpi-chip--mini">${esc(it.projectName)}</span>` : ''}
                            <span class="gpi-mini__score">${it.score}</span>
                        </li>
                    `).join('')}
                </ol>`;
            return miniCard('🔥 Prioridad de hoy', html, 'urgency');
        } catch { return null; }
    }

    async function loadRiskCard() {
        try {
            const r = await window.GunterPremiumIntel?.getProjectFollowUps({});
            if (!r?.success) return null;
            const inactive = (r.data?.inactiveProjects || []).slice(0, 3);
            const overdue  = (r.data?.overdueByProject || []).slice(0, 2);
            if (!inactive.length && !overdue.length) {
                return miniCard('🚨 Proyectos en riesgo', '<p class="gpi-mini__empty">✓ Todos los proyectos al día.</p>', 'project-360');
            }
            const lines = [
                ...inactive.map(p => `<li><span class="gpi-mini__title">${esc(p.projectName)}</span><span class="gpi-mini__hint">${p.daysSinceActivity}d sin actividad</span></li>`),
                ...overdue.map(p => `<li><span class="gpi-mini__title">${esc(p.projectName)}</span><span class="gpi-mini__hint gpi-mini__hint--warn">${p.count} vencidas</span></li>`)
            ];
            return miniCard('🚨 Proyectos en riesgo', `<ul class="gpi-mini__list-bare">${lines.join('')}</ul>`, 'project-360');
        } catch { return null; }
    }

    function miniCard(title, body, gotoTab) {
        return `
            <div class="gpi-mini-card" data-goto-tab="${gotoTab || ''}">
                <h4>${title}</h4>
                ${body}
                ${gotoTab ? `<button class="gpi-mini__more" onclick="window.GunterDayTabs?.activate('${gotoTab}')">Ver completo →</button>` : ''}
            </div>`;
    }

    function toast(msg, variant) {
        if (window.GunterNotificationsService?.showToast) {
            window.GunterNotificationsService.showToast(msg, {
                variant: variant === 'error' ? 'error' : 'success', duration: 2800, silent: true
            });
        }
    }
    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    window.GunterTodayShortcuts = { mount, render };
})();
