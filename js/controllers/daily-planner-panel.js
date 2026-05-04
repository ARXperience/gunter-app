/* =============================================
   GUNTER CONTROLLER - Daily Planner Panel (Sprint C)
   -------------------------------------------------
   Tab "Plan de hoy". Muestra el plan generado por
   GunterPremiumIntel.getDailyPlan() con:
     - resumen + recomendación natural
     - top prioridades
     - bloques de tiempo sugeridos
     - eventos del día
     - tareas vencidas
     - pagos hoy
     - riesgos
     - botón "Copiar para WhatsApp"
   ============================================= */

(function () {
    let host = null;
    let lastPlan = null;
    let loading = false;

    function flagOn() {
        return !!(window.PremiumFeaturesService?.isEnabled?.('dailyPlanner'));
    }

    async function mount(selector) {
        host = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!host) return;
        host.classList.add('gpi-panel');
        renderShell();
        await refresh();
        // Re-render on premium changes
        window.addEventListener('gunterPremiumFeaturesChange', (e) => {
            if (!host) return;
            const k = e.detail?.key;
            if (!k || k === 'dailyPlanner' || (k && k.startsWith('dailyPlanner'))) {
                renderShell();
                refresh().catch(() => {});
            }
        });
    }

    async function refresh() {
        if (loading || !host) return;
        loading = true;
        if (!flagOn()) {
            renderDisabled();
            loading = false;
            return;
        }
        renderLoading();
        try {
            const result = await window.GunterPremiumIntel.getDailyPlan({ force: false });
            lastPlan = result;
            renderResult(result);
        } catch (err) {
            renderError(err.message || String(err));
        } finally {
            loading = false;
        }
    }

    function renderShell() {
        if (!host) return;
        host.innerHTML = `
            <div class="gpi-card gpi-daily">
                <header class="gpi-card__head">
                    <div>
                        <h3>🌅 Plan de hoy</h3>
                        <p class="gpi-card__hint">Tu día priorizado por Gunter — tareas, reuniones, pagos y riesgos.</p>
                    </div>
                    <div class="gpi-card__actions">
                        <button id="gpi-daily-refresh" class="gpi-btn">Refrescar</button>
                        <button id="gpi-daily-copy" class="gpi-btn gpi-btn--ghost" disabled>📋 Copiar para WhatsApp</button>
                    </div>
                </header>
                <div id="gpi-daily-body"></div>
            </div>
        `;
        host.querySelector('#gpi-daily-refresh').addEventListener('click', () => refresh());
        host.querySelector('#gpi-daily-copy').addEventListener('click', copyForWhatsApp);
    }

    function $body() { return host?.querySelector('#gpi-daily-body'); }
    function $copyBtn() { return host?.querySelector('#gpi-daily-copy'); }

    function renderDisabled() {
        const b = $body(); if (!b) return;
        b.innerHTML = `<div class="gpi-empty">
            <p>El <strong>Planificador del día</strong> está desactivado.</p>
            <p>Actívalo en <em>Configuración → Premium → Planificador del día</em>.</p>
        </div>`;
        $copyBtn().disabled = true;
    }

    function renderLoading() {
        const b = $body(); if (!b) return;
        b.innerHTML = `<div class="gpi-loading">
            <div class="gpi-spinner"></div>
            <span>Gunter está revisando tus tareas, eventos y prioridades de hoy…</span>
        </div>`;
    }

    function renderError(msg) {
        const b = $body(); if (!b) return;
        b.innerHTML = `<div class="gpi-error">⚠ ${esc(msg)}</div>`;
    }

    function renderResult(r) {
        const b = $body(); if (!b) return;
        if (!r.success) {
            b.innerHTML = `<div class="gpi-empty"><p>${esc(r.naturalResponse || 'No pude generar el plan.')}</p></div>`;
            $copyBtn().disabled = true;
            return;
        }
        const d = r.data || {};
        $copyBtn().disabled = !d.whatsappBrief;

        b.innerHTML = `
            <div class="gpi-summary">
                <div class="gpi-summary__icon">🐧</div>
                <div>
                    <p class="gpi-summary__text">${esc(r.naturalResponse || r.summary)}</p>
                    ${(d.recommendations || []).length
                        ? `<p class="gpi-summary__rec">💡 ${esc(d.recommendations[0])}</p>` : ''}
                </div>
            </div>

            ${(d.topPriorities || []).length ? `
                <section class="gpi-section">
                    <h4>🔥 Top prioridades</h4>
                    <ul class="gpi-list">
                        ${d.topPriorities.map(p => `
                            <li class="gpi-item gpi-item--${p.kind}">
                                <span class="gpi-item__icon">${iconFor(p.kind)}</span>
                                <div class="gpi-item__body">
                                    <strong>${esc(p.title)}</strong>
                                    ${p.project ? `<span class="gpi-chip">${esc(p.project)}</span>` : ''}
                                    <span class="gpi-item__reason">${esc(p.reason || '')}</span>
                                </div>
                                <span class="gpi-item__score" title="Score de urgencia">${p.score}</span>
                            </li>
                        `).join('')}
                    </ul>
                </section>` : ''}

            ${(d.timeBlocks || []).length ? `
                <section class="gpi-section">
                    <h4>⏱️ Bloques sugeridos</h4>
                    <div class="gpi-blocks">
                        ${d.timeBlocks.map(t => `
                            <div class="gpi-block">
                                <span class="gpi-block__time">${t.from}–${t.to}</span>
                                <span class="gpi-block__focus">${esc(t.focus)}</span>
                                ${t.project ? `<span class="gpi-chip gpi-chip--mini">${esc(t.project)}</span>` : ''}
                            </div>
                        `).join('')}
                    </div>
                </section>` : ''}

            ${(d.eventsToday || []).length ? `
                <section class="gpi-section">
                    <h4>📅 Reuniones de hoy</h4>
                    <ul class="gpi-list">
                        ${d.eventsToday.map(e => `
                            <li class="gpi-item">
                                <span class="gpi-item__icon">📅</span>
                                <div class="gpi-item__body">
                                    <strong>${esc(e.title)}</strong>
                                    ${e.projectName ? `<span class="gpi-chip">${esc(e.projectName)}</span>` : ''}
                                    <span class="gpi-item__reason">${formatTime(e.startAt)}</span>
                                </div>
                            </li>
                        `).join('')}
                    </ul>
                </section>` : ''}

            ${(d.tasksOverdue || []).length ? `
                <section class="gpi-section gpi-section--alert">
                    <h4>⚠️ Tareas vencidas</h4>
                    <ul class="gpi-list">
                        ${d.tasksOverdue.map(t => `
                            <li class="gpi-item gpi-item--overdue">
                                <span class="gpi-item__icon">⚠️</span>
                                <div class="gpi-item__body">
                                    <strong>${esc(t.title)}</strong>
                                    ${t.projectName ? `<span class="gpi-chip">${esc(t.projectName)}</span>` : ''}
                                </div>
                            </li>
                        `).join('')}
                    </ul>
                </section>` : ''}

            ${(d.paymentsToday || []).length ? `
                <section class="gpi-section">
                    <h4>💸 Pagos hoy</h4>
                    <ul class="gpi-list">
                        ${d.paymentsToday.map(p => `
                            <li class="gpi-item">
                                <span class="gpi-item__icon">💸</span>
                                <div class="gpi-item__body">
                                    <strong>${esc(p.title || p.empresa || 'Pago')}</strong>
                                    ${p.valor ? `<span class="gpi-chip">${esc(p.valor)} ${esc(p.moneda || '')}</span>` : ''}
                                </div>
                            </li>
                        `).join('')}
                    </ul>
                </section>` : ''}

            ${(d.risks || []).length ? `
                <section class="gpi-section gpi-section--risk">
                    <h4>🚨 Riesgos</h4>
                    <ul class="gpi-list-bare">
                        ${d.risks.map(r => `<li>${esc(r)}</li>`).join('')}
                    </ul>
                </section>` : ''}

            <footer class="gpi-footer">
                <span>Generado ${new Date(r.generatedAt).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })}</span>
                <span class="gpi-source">${(r.sources || []).join(', ') || '—'}</span>
            </footer>
        `;
    }

    async function copyForWhatsApp() {
        const text = lastPlan?.data?.whatsappBrief;
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            toast('📋 Brief copiado — listo para pegar en WhatsApp', 'success');
        } catch {
            toast('No pude acceder al portapapeles.', 'error');
        }
    }

    function toast(msg, variant) {
        if (window.GunterNotificationsService?.showToast) {
            window.GunterNotificationsService.showToast(msg, { variant: variant === 'error' ? 'error' : 'success', duration: 2800, silent: true });
        }
    }

    function iconFor(kind) {
        switch (kind) {
            case 'payment': return '💸';
            case 'task': return '✅';
            case 'event': return '📅';
            default: return '•';
        }
    }
    function formatTime(iso) {
        if (!iso) return '—';
        try { return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }); }
        catch { return iso; }
    }
    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    window.GunterDailyPlannerPanel = { mount, refresh };
})();
