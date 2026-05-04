/* =============================================
   GUNTER CONTROLLER - Proactive Pulse Panel (v2 — F3)
   -------------------------------------------------
   Bandeja de intervenciones del agente proactivo.
   ============================================= */

(function () {
    let host = null;
    let allItems = [];
    let filterStatus = 'queued';

    function flagOn() { return !!(window.PremiumFeaturesService?.isEnabled?.('proactivePulse')); }

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        }[c]));
    }

    function fmtTime(iso) {
        if (!iso) return '';
        try {
            const d = new Date(iso);
            const diffH = (Date.now() - d.getTime()) / 3600000;
            if (diffH < 1) return 'hace ' + Math.max(1, Math.round(diffH * 60)) + ' min';
            if (diffH < 24) return 'hace ' + Math.round(diffH) + ' h';
            return d.toLocaleDateString('es-MX', { day:'numeric', month:'short' });
        } catch { return iso; }
    }

    function sevColor(sev) {
        return { high: '#c33', mid: '#d4861f', low: '#5b8def' }[sev] || '#5b8def';
    }
    function sevIcon(sev) {
        return { high: '🚨', mid: '⚡', low: '💡' }[sev] || '💡';
    }

    async function mount(selector) {
        host = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!host) return;
        host.classList.add('gpi-panel');
        renderShell();
        await refresh();
        window.addEventListener('gunter-proactive-changed', () => refresh().catch(() => {}));
        window.addEventListener('gunterPremiumFeaturesChange', (e) => {
            if (e.detail?.key === 'proactivePulse' || e.detail?.key === 'proactivePulseAggression') {
                renderShell(); refresh().catch(() => {});
            }
        });
    }

    function renderShell() {
        if (!host) return;
        const aggr = window.PremiumFeaturesService?.get?.('proactivePulseAggression') || 'normal';
        host.innerHTML = `
            <div class="gpi-card">
                <header class="gpi-card__head">
                    <div>
                        <h3>⚡ Pulso proactivo</h3>
                        <p class="gpi-card__hint">Gunter detecta situaciones que merecen atención y propone acciones. Nivel: <strong>${esc(aggr)}</strong>.</p>
                    </div>
                    <div class="gpi-card__actions">
                        <button id="gpi-pulse-tick" class="gpi-btn">🔄 Evaluar ahora</button>
                        <button id="gpi-pulse-clear" class="gpi-btn gpi-btn--ghost" title="Limpiar TODA la bandeja">🧹 Limpiar</button>
                    </div>
                </header>
                <div style="display:flex;gap:8px;margin:10px 0;">
                    <select id="gpi-pulse-filter" class="gpi-select">
                        <option value="queued">Activas</option>
                        <option value="snoozed">Pospuestas</option>
                        <option value="acted">Atendidas</option>
                        <option value="dismissed">Descartadas</option>
                        <option value="">Todas</option>
                    </select>
                </div>
                <div id="gpi-pulse-stats" style="margin:8px 0;font-size:12px;color:var(--text-muted);"></div>
                <div id="gpi-pulse-body"></div>
            </div>
        `;
        host.querySelector('#gpi-pulse-tick').addEventListener('click', async () => {
            const btn = host.querySelector('#gpi-pulse-tick');
            btn.disabled = true; btn.textContent = '🔄 Evaluando…';
            try {
                const r = await window.GunterProactiveService.tick(true);
                await refresh();
                if (r) {
                    (window.GunterNotificationsService?.showToast || (() => {}))(
                        `Evaluadas ${r.evaluated || 0} señales · ${r.generated} nueva${r.generated !== 1 ? 's' : ''}.`,
                        { variant: 'info', duration: 3500 }
                    );
                }
            } finally {
                btn.disabled = false; btn.textContent = '🔄 Evaluar ahora';
            }
        });
        host.querySelector('#gpi-pulse-clear').addEventListener('click', async () => {
            if (!confirm('¿Limpiar TODA la bandeja del pulso (incluyendo activas)?')) return;
            await window.GunterProactiveService.clear();
            await refresh();
        });
        host.querySelector('#gpi-pulse-filter').addEventListener('change', (e) => {
            filterStatus = e.target.value;
            renderList();
        });
    }

    function $body() { return host?.querySelector('#gpi-pulse-body'); }

    async function refresh() {
        if (!host) return;
        if (!flagOn()) {
            $body().innerHTML = `<div class="gpi-empty"><p>El <strong>Pulso proactivo</strong> está desactivado.</p><p>Actívalo en <em>Configuración → Premium → Funciones avanzadas</em>.</p></div>`;
            return;
        }
        $body().innerHTML = `<div class="gpi-loading"><div class="gpi-spinner"></div><span>Cargando bandeja…</span></div>`;
        try {
            const r = await window.GunterProactiveService.getQueue(null); // todos
            allItems = r.items || [];
            renderStats(r.stats || {});
            renderList();
        } catch (e) {
            $body().innerHTML = `<div class="gpi-error">⚠ ${esc(e?.message || e)}</div>`;
        }
    }

    function renderStats(st) {
        const el = host.querySelector('#gpi-pulse-stats');
        if (!el) return;
        const b = st.byStatus || {};
        el.innerHTML = `Activas: <strong>${b.queued || 0}</strong> · Pospuestas: ${b.snoozed || 0} · Atendidas: ${b.acted || 0} · Descartadas: ${b.dismissed || 0}`;
    }

    function renderList() {
        const filtered = filterStatus
            ? allItems.filter(i => i.status === filterStatus)
            : allItems;

        if (!filtered.length) {
            $body().innerHTML = `
                <div class="gpi-empty">
                    <div class="gpi-empty__icon">🌿</div>
                    <h4>Sin alertas activas</h4>
                    <p>Todo en orden. Gunter te avisará cuando detecte algo relevante.</p>
                </div>`;
            return;
        }

        $body().innerHTML = `<ul style="list-style:none;padding:0;margin:0;">${filtered.map(renderItem).join('')}</ul>`;

        $body().querySelectorAll('[data-pulse-act]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.id;
                const op = btn.dataset.pulseAct;
                btn.disabled = true;
                try {
                    if (op === 'dismiss') await window.GunterProactiveService.dismiss(id);
                    else if (op === 'snooze') await window.GunterProactiveService.snooze(id, 24);
                    else if (op === 'act') {
                        const action = JSON.parse(btn.dataset.action || '{}');
                        await window.GunterProactiveService.act(id, action);
                        // si la acción es open_tab, cambiar a esa pestaña
                        if (action.action === 'open_tab' && action.payload?.tab) {
                            window.dispatchEvent(new CustomEvent('gunter-open-tab', { detail: { tab: action.payload.tab } }));
                        }
                    }
                    await refresh();
                } catch (e) {
                    alert('Error: ' + (e?.message || e));
                    btn.disabled = false;
                }
            });
        });
    }

    function renderItem(i) {
        const color = sevColor(i.severity);
        const actionsHtml = (i.suggestedActions || []).map(a => `
            <button class="gpi-btn gpi-btn--small" data-pulse-act="act" data-id="${esc(i.id)}" data-action='${esc(JSON.stringify(a))}'>${esc(a.label)}</button>
        `).join('');
        return `
            <li style="display:flex;gap:10px;padding:10px;border:1px solid rgba(0,0,0,0.08);border-left:3px solid ${color};border-radius:8px;margin-bottom:6px;">
                <span style="font-size:18px;line-height:1;">${sevIcon(i.severity)}</span>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:600;color:${color};">${esc(i.title)}</div>
                    <div style="font-size:12px;color:var(--text-primary);margin-top:4px;">${esc(i.message)}</div>
                    <div style="font-size:11px;color:var(--text-muted);margin-top:6px;">
                        ${esc(i.type)} · ${fmtTime(i.createdAt)} · estado: ${esc(i.status)}${i.snoozedUntil ? ' (hasta ' + fmtTime(i.snoozedUntil) + ')' : ''}
                    </div>
                    ${i.status === 'queued' ? `
                        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">
                            ${actionsHtml}
                            <button class="gpi-btn gpi-btn--small gpi-btn--ghost" data-pulse-act="snooze" data-id="${esc(i.id)}">⏰ Posponer 24h</button>
                            <button class="gpi-btn gpi-btn--small gpi-btn--ghost" data-pulse-act="dismiss" data-id="${esc(i.id)}">✖ Descartar</button>
                        </div>
                    ` : ''}
                </div>
            </li>`;
    }

    window.GunterProactivePanel = { mount, refresh };
})();
