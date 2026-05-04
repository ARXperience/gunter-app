/* =============================================
   GUNTER CONTROLLER - Urgency Ranking Panel (Sprint C)
   -------------------------------------------------
   Lista priorizada con score explicable.
   Toggle de scope: Hoy / Semana / Todo.
   ============================================= */

(function () {
    let host = null;
    let scope = 'today';

    function flagOn() { return !!(window.PremiumFeaturesService?.isEnabled?.('urgencyRanking')); }

    async function mount(selector) {
        host = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!host) return;
        host.classList.add('gpi-panel');
        renderShell();
        await refresh();
        window.addEventListener('gunterPremiumFeaturesChange', (e) => {
            if (!host) return;
            const k = e.detail?.key;
            if (!k || k === 'urgencyRanking' || (k && k.startsWith('urgencyRanking'))) {
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
            const r = await window.GunterPremiumIntel.getUrgencyRanking(scope);
            renderResult(r);
        } catch (e) {
            renderError(e.message || String(e));
        }
    }

    function renderShell() {
        if (!host) return;
        host.innerHTML = `
            <div class="gpi-card gpi-urgency">
                <header class="gpi-card__head">
                    <div>
                        <h3>🔥 Ranking de urgencia</h3>
                        <p class="gpi-card__hint">Tareas y pagos ordenados por vencimiento, prioridad y dinero.</p>
                    </div>
                    <div class="gpi-card__actions">
                        <div class="gpi-scope" role="tablist">
                            <button data-scope="today" class="${scope==='today'?'is-active':''}">Hoy</button>
                            <button data-scope="week"  class="${scope==='week' ?'is-active':''}">Semana</button>
                            <button data-scope="all"   class="${scope==='all'  ?'is-active':''}">Todo</button>
                        </div>
                        <button id="gpi-urg-refresh" class="gpi-btn">Refrescar</button>
                    </div>
                </header>
                <div id="gpi-urg-body"></div>
            </div>
        `;
        host.querySelectorAll('[data-scope]').forEach(b => {
            b.addEventListener('click', () => {
                scope = b.dataset.scope;
                renderShell();
                refresh().catch(() => {});
            });
        });
        host.querySelector('#gpi-urg-refresh').addEventListener('click', () => refresh());
    }

    function $body() { return host?.querySelector('#gpi-urg-body'); }

    function renderDisabled() {
        $body().innerHTML = `<div class="gpi-empty">
            <p>El <strong>Ranking de urgencia</strong> está desactivado.</p>
            <p>Actívalo en <em>Configuración → Premium → Ranking de urgencia</em>.</p>
        </div>`;
    }
    function renderLoading() {
        $body().innerHTML = `<div class="gpi-loading"><div class="gpi-spinner"></div><span>Ordenando tus pendientes por vencimiento, impacto y dinero…</span></div>`;
    }
    function renderError(m) { $body().innerHTML = `<div class="gpi-error">⚠ ${esc(m)}</div>`; }

    function renderResult(r) {
        if (!r.success) {
            $body().innerHTML = `<div class="gpi-empty"><p>${esc(r.naturalResponse || 'Sin pendientes urgentes.')}</p></div>`;
            return;
        }
        const ranked = r.data?.ranked || [];
        if (!ranked.length) {
            $body().innerHTML = `
                <div class="gpi-empty gpi-empty--good">
                    <div class="gpi-empty__icon">🎉</div>
                    <h4>Todo bajo control</h4>
                    <p>No detecté pendientes urgentes en este rango.</p>
                    <p class="gpi-empty__hint">Crea una tarea con la captura rápida de la pestaña Hoy para que aparezca aquí cuando se acerque su vencimiento.</p>
                </div>`;
            return;
        }

        $body().innerHTML = `
            <div class="gpi-summary">
                <div class="gpi-summary__icon">🐧</div>
                <div><p class="gpi-summary__text">${esc(r.naturalResponse || r.summary)}</p></div>
            </div>

            <ol class="gpi-rank">
                ${ranked.map((it, i) => `
                    <li class="gpi-rank__item gpi-rank__item--${it.type}">
                        <div class="gpi-rank__pos">${i + 1}</div>
                        <div class="gpi-rank__main">
                            <div class="gpi-rank__title">
                                ${iconFor(it.type)} ${esc(it.title)}
                                ${it.projectName ? `<span class="gpi-chip">${esc(it.projectName)}</span>` : ''}
                            </div>
                            <div class="gpi-rank__reason">${esc(it.reason || '')}</div>
                            ${it.dueAt ? `<div class="gpi-rank__due">${formatDue(it.dueAt)}</div>` : ''}
                        </div>
                        <div class="gpi-rank__score" title="Score de urgencia">${it.score}</div>
                    </li>
                `).join('')}
            </ol>

            <footer class="gpi-footer">
                <span>${ranked.length} de ${r.data.total} pendientes</span>
                <span>${formatGenerated(r.generatedAt)}</span>
            </footer>
        `;
    }

    function iconFor(type) {
        if (type === 'payment') return '💸';
        if (type === 'task') return '✅';
        return '•';
    }
    function formatDue(iso) {
        try {
            const d = new Date(iso);
            const diffH = (d - Date.now()) / 3_600_000;
            if (diffH < 0)        return `Vencido hace ${Math.abs(Math.round(diffH))}h`;
            if (diffH < 24)       return `Vence en ${Math.round(diffH)}h`;
            const diffD = Math.round(diffH / 24);
            return `Vence en ${diffD} día${diffD === 1 ? '' : 's'}`;
        } catch { return iso; }
    }
    function formatGenerated(iso) {
        try { return 'Actualizado ' + new Date(iso).toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' }); }
        catch { return ''; }
    }
    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    window.GunterUrgencyPanel = { mount, refresh };
})();
