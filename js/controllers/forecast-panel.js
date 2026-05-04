/* =============================================
   GUNTER CONTROLLER - Forecast Panel (v2 — F6)
   ============================================= */

(function () {
    let host = null;
    let lastResults = null;

    function flagOn() { return !!(window.PremiumFeaturesService?.isEnabled?.('projectForecast')); }

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        }[c]));
    }

    function fmtDate(iso) {
        if (!iso) return '—';
        try { return new Date(iso).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }); }
        catch { return iso; }
    }

    function probColor(p) {
        if (p == null) return '#90a4ae';
        if (p >= 0.75) return '#43a047';
        if (p >= 0.5)  return '#fb8c00';
        return '#e53935';
    }

    async function mount(selector) {
        host = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!host) return;
        host.classList.add('gpi-panel');
        renderShell();
        await refresh();
        window.addEventListener('gunterPremiumFeaturesChange', (e) => {
            if (e.detail?.key === 'projectForecast') {
                renderShell();
                refresh().catch(() => {});
            }
        });
    }

    function renderShell() {
        if (!host) return;
        host.innerHTML = `
            <div class="gpi-card">
                <header class="gpi-card__head">
                    <div>
                        <h3>🔮 Forecast probabilístico</h3>
                        <p class="gpi-card__hint">Predicción Monte Carlo de tiempos de entrega y probabilidad de cumplir deadlines, basada en velocity histórica + bloqueadores + compromisos vencidos.</p>
                    </div>
                    <div class="gpi-card__actions">
                        <button id="gpi-fc-refresh" class="gpi-btn">🔄 Recalcular todo</button>
                    </div>
                </header>
                <div id="gpi-fc-body"></div>
            </div>
        `;
        host.querySelector('#gpi-fc-refresh').addEventListener('click', () => refresh(true));
    }

    function $body() { return host?.querySelector('#gpi-fc-body'); }

    async function refresh(force = false) {
        if (!host) return;
        if (!flagOn()) {
            $body().innerHTML = `<div class="gpi-empty"><p>El <strong>Forecast probabilístico</strong> está desactivado.</p><p>Actívalo en <em>Configuración → Premium → Funciones avanzadas</em>.</p></div>`;
            return;
        }
        if (lastResults && !force) {
            renderList(lastResults);
            return;
        }
        $body().innerHTML = `<div class="gpi-loading"><div class="gpi-spinner"></div><span>Simulando 1000 escenarios por proyecto…</span></div>`;
        try {
            const r = await window.GunterForecastService.forecastAll(15);
            lastResults = r;
            renderList(r);
        } catch (e) {
            $body().innerHTML = `<div class="gpi-error">⚠ ${esc(e?.message || e)}</div>`;
        }
    }

    function renderList(r) {
        const items = r?.items || [];
        if (!items.length) {
            $body().innerHTML = `
                <div class="gpi-empty">
                    <div class="gpi-empty__icon">🔮</div>
                    <h4>Aún no hay proyectos con tareas suficientes</h4>
                    <p>Agrega tareas y compromisos a tus proyectos. El forecast se afina con cada acción.</p>
                </div>`;
            return;
        }
        $body().innerHTML = `
            <p style="font-size:11px;color:var(--text-muted);margin:0 0 8px 0;">Evaluados: ${r.totalEvaluated} · Mostrando ${items.length}. Ordenados por riesgo (probabilidad más baja primero).</p>
            <ul style="list-style:none;padding:0;margin:0;display:grid;gap:8px;">
                ${items.map(renderItem).join('')}
            </ul>
        `;
    }

    function renderItem(it) {
        const p = it.probabilityHitDeadline;
        const color = probColor(p);
        const prob = p != null ? Math.round(p * 100) + '%' : '—';
        const conf = it.confidence;
        const f = it.features || {};
        const drag = [];
        if (f.daysIdle > 14) drag.push(`inactivo ${Math.round(f.daysIdle)}d`);
        if (f.overdueCommitments > 0) drag.push(`${f.overdueCommitments} compromiso${f.overdueCommitments>1?'s':''} vencido${f.overdueCommitments>1?'s':''}`);
        if (f.blockers > 0) drag.push(`${f.blockers} bloqueador${f.blockers>1?'es':''}`);
        return `
            <li style="border:1px solid rgba(0,0,0,0.08);border-left:3px solid ${color};border-radius:8px;padding:10px;">
                <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;">
                    <strong style="font-size:13px;">${esc(it.projectName || '(sin nombre)')}</strong>
                    <span style="font-size:11px;color:var(--text-muted);">confianza: ${esc(conf)}</span>
                </div>
                <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:8px;font-size:11px;text-align:center;">
                    <div><div style="opacity:0.6;">P50</div><strong>${it.estimateDays.p50}d</strong><div style="opacity:0.5;">${fmtDate(it.etaP50)}</div></div>
                    <div><div style="opacity:0.6;">P80</div><strong>${it.estimateDays.p80}d</strong><div style="opacity:0.5;">${fmtDate(it.etaP80)}</div></div>
                    <div><div style="opacity:0.6;">P95</div><strong>${it.estimateDays.p95}d</strong><div style="opacity:0.5;">${fmtDate(it.etaP95)}</div></div>
                    <div><div style="opacity:0.6;">P(deadline)</div><strong style="color:${color};">${prob}</strong><div style="opacity:0.5;">${f.deadline ? fmtDate(f.deadline) : 'sin deadline'}</div></div>
                </div>
                <div style="margin-top:8px;font-size:11px;color:var(--text-muted);">
                    ${f.openTasks} abiertas · ${f.closedTasks} cerradas · velocity ${f.velocityPerWeek?.toFixed?.(1) || 0}/sem
                    ${drag.length ? ' · drag: ' + drag.join(', ') : ''}
                </div>
            </li>
        `;
    }

    window.GunterForecastPanel = { mount, refresh };
})();
