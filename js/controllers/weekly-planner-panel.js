/* =============================================
   GUNTER CONTROLLER - Weekly Planner Panel (Sprint C)
   -------------------------------------------------
   Vista de los 7 días con focus, conteos, eventos
   y carga por proyecto.
   ============================================= */

(function () {
    let host = null;

    function flagOn() { return !!(window.PremiumFeaturesService?.isEnabled?.('weeklyPlanner')); }

    async function mount(selector) {
        host = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!host) return;
        host.classList.add('gpi-panel');
        renderShell();
        await refresh();
        window.addEventListener('gunterPremiumFeaturesChange', (e) => {
            if (!host) return;
            const k = e.detail?.key;
            if (!k || k === 'weeklyPlanner' || (k && k.startsWith('weeklyPlanner'))) {
                renderShell();
                refresh().catch(() => {});
            }
        });
    }

    async function refresh() {
        if (!host) return;
        if (!flagOn()) { renderDisabled(); return; }
        renderLoading();
        try {
            const r = await window.GunterPremiumIntel.getWeeklyPlan({});
            renderResult(r);
        } catch (e) {
            renderError(e.message || String(e));
        }
    }

    function renderShell() {
        if (!host) return;
        host.innerHTML = `
            <div class="gpi-card gpi-weekly">
                <header class="gpi-card__head">
                    <div>
                        <h3>📅 Mi semana</h3>
                        <p class="gpi-card__hint">Plan de los próximos 7 días, balanceado por proyecto.</p>
                    </div>
                    <div class="gpi-card__actions">
                        <button id="gpi-weekly-refresh" class="gpi-btn">Refrescar</button>
                    </div>
                </header>
                <div id="gpi-weekly-body"></div>
            </div>
        `;
        host.querySelector('#gpi-weekly-refresh').addEventListener('click', () => refresh());
    }

    function $body() { return host?.querySelector('#gpi-weekly-body'); }

    function renderDisabled() {
        $body().innerHTML = `<div class="gpi-empty">
            <p>El <strong>Planificador semanal</strong> está desactivado.</p>
            <p>Actívalo en <em>Configuración → Premium → Organiza mi semana</em>.</p>
        </div>`;
    }
    function renderLoading() {
        $body().innerHTML = `<div class="gpi-loading"><div class="gpi-spinner"></div><span>Distribuyendo tareas y reuniones en los próximos 7 días…</span></div>`;
    }
    function renderError(m) {
        $body().innerHTML = `<div class="gpi-error">⚠ ${esc(m)}</div>`;
    }

    function renderResult(r) {
        if (!r.success) {
            $body().innerHTML = `<div class="gpi-empty"><p>${esc(r.naturalResponse || 'Sin plan disponible.')}</p></div>`;
            return;
        }
        const d = r.data || {};
        const days = d.days || [];
        const projectLoad = d.projectLoad || {};

        $body().innerHTML = `
            <div class="gpi-summary">
                <div class="gpi-summary__icon">🐧</div>
                <div><p class="gpi-summary__text">${esc(r.naturalResponse || r.summary)}</p></div>
            </div>

            <section class="gpi-section">
                <h4>Semana del ${esc(d.weekStart)} al ${esc(d.weekEnd)}</h4>
                <div class="gpi-week-grid">
                    ${days.map(day => `
                        <div class="gpi-day">
                            <div class="gpi-day__head">
                                <span class="gpi-day__date">${formatDayShort(day.date)}</span>
                                <span class="gpi-day__count">${day.taskCount}t · ${day.eventCount}e</span>
                            </div>
                            <div class="gpi-day__focus" title="${esc(day.focus)}">${esc(day.focus.slice(0, 60))}</div>
                            ${day.events && day.events.length ? `
                                <ul class="gpi-day__events">
                                    ${day.events.slice(0, 2).map(e => `<li>${esc(e.title.slice(0, 28))}${esc(e.title.length > 28 ? '…' : '')}</li>`).join('')}
                                </ul>` : ''}
                        </div>
                    `).join('')}
                </div>
            </section>

            ${Object.keys(projectLoad).length ? `
                <section class="gpi-section">
                    <h4>Carga por proyecto</h4>
                    <ul class="gpi-load">
                        ${Object.entries(projectLoad).sort((a,b) => b[1]-a[1]).map(([p, c]) => `
                            <li>
                                <span>${esc(p)}</span>
                                <div class="gpi-load__bar"><span style="width:${Math.min(100, c * 12)}%"></span></div>
                                <span class="gpi-load__count">${c}</span>
                            </li>
                        `).join('')}
                    </ul>
                </section>` : ''}

            ${(d.risks || []).length ? `
                <section class="gpi-section gpi-section--risk">
                    <h4>🚨 Riesgos de la semana</h4>
                    <ul class="gpi-list-bare">
                        ${d.risks.map(r => `<li>${esc(r)}</li>`).join('')}
                    </ul>
                </section>` : ''}

            <footer class="gpi-footer">
                <span>Generado ${new Date(r.generatedAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
            </footer>
        `;
    }

    function formatDayShort(dateStr) {
        try {
            const d = new Date(dateStr + 'T12:00:00');
            return d.toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
        } catch { return dateStr; }
    }
    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    window.GunterWeeklyPlannerPanel = { mount, refresh };
})();
