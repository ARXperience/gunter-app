/* =============================================
   GUNTER CONTROLLER - Project 360 Panel (Sprint D)
   -------------------------------------------------
   Selector de proyecto + vista consolidada con
   sub-bloques (tareas, eventos, reuniones, decisiones,
   documentos, riesgos, próximos pasos).
   ============================================= */

(function () {
    let host = null;
    let currentId = null;

    function flagOn() { return !!(window.PremiumFeaturesService?.isEnabled?.('project360')); }
    function subOn(k)  { return !!(window.PremiumFeaturesService?.isEnabled?.(k)); }

    async function mount(selector, opts = {}) {
        host = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!host) return;
        host.classList.add('gpi-panel');
        renderShell();
        if (opts.projectId) currentId = opts.projectId;
        await populateSelector();
        if (currentId) await load(currentId);
        window.addEventListener('gunterPremiumFeaturesChange', (e) => {
            if (!host) return;
            const k = e.detail?.key;
            if (!k || k === 'project360' || (k && k.startsWith('project360'))) {
                renderShell();
                populateSelector().then(() => currentId && load(currentId)).catch(() => {});
            }
        });
    }

    function renderShell() {
        if (!host) return;
        host.innerHTML = `
            <div class="gpi-card gpi-360">
                <header class="gpi-card__head">
                    <div>
                        <h3>🛰️ Proyecto 360</h3>
                        <p class="gpi-card__hint">Vista consolidada: tareas, reuniones, documentos, decisiones, pagos y riesgos.</p>
                    </div>
                    <div class="gpi-card__actions">
                        <select id="gpi-360-select" class="gpi-select">
                            <option value="">— Elige proyecto —</option>
                        </select>
                        <button id="gpi-360-refresh" class="gpi-btn">Refrescar</button>
                    </div>
                </header>
                <div id="gpi-360-body"></div>
            </div>
        `;
        host.querySelector('#gpi-360-select').addEventListener('change', (e) => {
            currentId = e.target.value || null;
            if (currentId) load(currentId);
        });
        host.querySelector('#gpi-360-refresh').addEventListener('click', () => currentId && load(currentId));
    }

    async function populateSelector() {
        if (!flagOn()) { renderDisabled(); return; }
        const sel = host.querySelector('#gpi-360-select');
        if (!sel) return;
        try {
            const resp = await fetch('/api/knowledge/projects');
            const data = await resp.json();
            const projects = data?.projects || [];
            sel.innerHTML = '<option value="">— Elige proyecto —</option>' +
                projects.map(p => `<option value="${esc(p.id)}" ${p.id === currentId ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
            if (!currentId && projects.length === 1) {
                currentId = projects[0].id;
                sel.value = currentId;
            }
            if (!projects.length) {
                renderEmpty('Todavía no tienes proyectos sincronizados. Crea uno desde Configuración → 🚀 Nuevo Proyecto, o abre Gunter Día para que la memoria se sincronice.');
            }
        } catch {
            renderError('No pude cargar la lista de proyectos.');
        }
    }

    async function load(projectId) {
        if (!flagOn()) { renderDisabled(); return; }
        renderLoading();
        try {
            const r = await window.GunterPremiumIntel.getProject360(projectId);
            renderResult(r);
        } catch (e) {
            renderError(e.message || String(e));
        }
    }

    function $body() { return host?.querySelector('#gpi-360-body'); }

    function renderDisabled() {
        $body().innerHTML = `<div class="gpi-empty"><p>El <strong>Proyecto 360</strong> está desactivado.</p><p>Actívalo en <em>Configuración → Premium → Cliente / Proyecto 360</em>.</p></div>`;
    }
    function renderEmpty(m) { $body().innerHTML = `<div class="gpi-empty"><p>${esc(m)}</p></div>`; }
    function renderLoading() { $body().innerHTML = `<div class="gpi-loading"><div class="gpi-spinner"></div><span>Conectando reuniones, tareas, decisiones y documentos del proyecto…</span></div>`; }
    function renderError(m) { $body().innerHTML = `<div class="gpi-error">⚠ ${esc(m)}</div>`; }

    function renderResult(r) {
        if (!r.success) { $body().innerHTML = `<div class="gpi-empty"><p>${esc(r.naturalResponse || 'Sin datos.')}</p></div>`; return; }
        const d = r.data;
        $body().innerHTML = `
            <div class="gpi-summary">
                <div class="gpi-summary__icon">🛰️</div>
                <div>
                    <p class="gpi-summary__text"><strong>${esc(d.projectName)}</strong> · ${esc(d.market || '—')} · ${esc(d.environment || '—')}</p>
                    <p class="gpi-summary__rec">${esc(d.summary || r.naturalResponse || '')}</p>
                </div>
            </div>

            <div class="gpi-360-grid">
                ${subOn('project360Tasks') ? renderTasksBlock(d) : ''}
                ${subOn('project360Calendar') ? renderEventsBlock(d) : ''}
                ${subOn('project360Meetings') ? renderMeetingsBlock(d) : ''}
                ${subOn('project360Decisions') ? renderDecisionsBlock(d) : ''}
                ${subOn('project360Documents') ? renderDocumentsBlock(d) : ''}
                ${renderRisksBlock(d)}
                ${renderNextStepsBlock(d)}
            </div>

            <footer class="gpi-footer">
                <span>Última actividad: ${formatRel(d.lastActivityAt)}</span>
                <span>${formatGenerated(r.generatedAt)}</span>
            </footer>
        `;
    }

    function renderTasksBlock(d) {
        const t = d.tasks || { active: [], overdue: [], total: 0 };
        return `
            <div class="gpi-360-block">
                <h4>✅ Tareas <span class="gpi-360-count">${t.total}</span></h4>
                ${t.overdue.length ? `<div class="gpi-360-warn">⚠️ ${t.overdue.length} vencida${t.overdue.length === 1 ? '' : 's'}</div>` : ''}
                <ul class="gpi-list">
                    ${t.active.slice(0, 6).map(x => `
                        <li class="gpi-item ${t.overdue.find(o => o.id === x.id) ? 'gpi-item--overdue' : ''}">
                            <span class="gpi-item__icon">${x.priority === 'urgent' ? '🔴' : x.priority === 'high' ? '🟡' : '⚪'}</span>
                            <div class="gpi-item__body">
                                <strong>${esc(x.title)}</strong>
                                ${x.dueAt ? `<span class="gpi-item__reason">Vence ${formatDateShort(x.dueAt)}</span>` : ''}
                            </div>
                        </li>`).join('') || '<li class="gpi-360-none">— sin tareas activas</li>'}
                </ul>
            </div>`;
    }
    function renderEventsBlock(d) {
        const ev = d.events || { upcoming: [], total: 0 };
        return `
            <div class="gpi-360-block">
                <h4>📅 Próximos eventos <span class="gpi-360-count">${ev.total}</span></h4>
                <ul class="gpi-list">
                    ${ev.upcoming.slice(0, 5).map(e => `
                        <li class="gpi-item">
                            <span class="gpi-item__icon">📅</span>
                            <div class="gpi-item__body">
                                <strong>${esc(e.title)}</strong>
                                <span class="gpi-item__reason">${formatDateTime(e.startAt)}</span>
                            </div>
                        </li>`).join('') || '<li class="gpi-360-none">— sin eventos próximos</li>'}
                </ul>
            </div>`;
    }
    function renderMeetingsBlock(d) {
        const m = d.meetings || { recent: [], total: 0 };
        return `
            <div class="gpi-360-block">
                <h4>🗣️ Reuniones recientes <span class="gpi-360-count">${m.total}</span></h4>
                <ul class="gpi-list">
                    ${m.recent.slice(0, 3).map(x => `
                        <li class="gpi-item">
                            <span class="gpi-item__icon">🗣️</span>
                            <div class="gpi-item__body">
                                <strong>${formatDateShort(x.timestamp)}</strong>
                                ${x.transcriptionExcerpt ? `<span class="gpi-item__reason">"${esc(x.transcriptionExcerpt.slice(0, 110))}…"</span>` : ''}
                            </div>
                        </li>`).join('') || '<li class="gpi-360-none">— sin reuniones</li>'}
                </ul>
            </div>`;
    }
    function renderDecisionsBlock(d) {
        const dec = d.decisions || { latest: [], total: 0 };
        return `
            <div class="gpi-360-block">
                <h4>🧭 Decisiones <span class="gpi-360-count">${dec.total}</span></h4>
                <ul class="gpi-list">
                    ${dec.latest.slice(0, 4).map(x => `
                        <li class="gpi-item">
                            <span class="gpi-item__icon">🧭</span>
                            <div class="gpi-item__body">
                                <strong>${esc(x.text.slice(0, 110))}</strong>
                                ${x.at ? `<span class="gpi-item__reason">${formatDateShort(x.at)}</span>` : ''}
                            </div>
                        </li>`).join('') || '<li class="gpi-360-none">— sin decisiones registradas</li>'}
                </ul>
            </div>`;
    }
    function renderDocumentsBlock(d) {
        const doc = d.documents || { all: [], payments: [], total: 0 };
        return `
            <div class="gpi-360-block">
                <h4>📄 Documentos <span class="gpi-360-count">${doc.total}</span></h4>
                ${doc.payments.length ? `<div class="gpi-360-warn">💸 ${doc.payments.length} pago${doc.payments.length === 1 ? '' : 's'} pendiente${doc.payments.length === 1 ? '' : 's'}</div>` : ''}
                <ul class="gpi-list">
                    ${doc.all.slice(0, 4).map(x => `
                        <li class="gpi-item">
                            <span class="gpi-item__icon">${x.tipo === 'recibo' || x.tipo === 'factura' ? '💸' : '📄'}</span>
                            <div class="gpi-item__body">
                                <strong>${esc(x.title || x.empresa || 'Documento')}</strong>
                                ${x.valor ? `<span class="gpi-chip">${esc(x.valor)} ${esc(x.moneda || '')}</span>` : ''}
                            </div>
                        </li>`).join('') || '<li class="gpi-360-none">— sin documentos</li>'}
                </ul>
            </div>`;
    }
    function renderRisksBlock(d) {
        if (!d.risks?.length) return '';
        return `
            <div class="gpi-360-block gpi-360-block--risk">
                <h4>🚨 Riesgos</h4>
                <ul class="gpi-list-bare">
                    ${d.risks.map(r => `<li>${esc(r)}</li>`).join('')}
                </ul>
            </div>`;
    }
    function renderNextStepsBlock(d) {
        if (!d.nextSteps?.length) return '';
        return `
            <div class="gpi-360-block gpi-360-block--next">
                <h4>👉 Próximos pasos</h4>
                <ul class="gpi-list-bare">
                    ${d.nextSteps.map(s => `<li>${esc(s)}</li>`).join('')}
                </ul>
            </div>`;
    }

    function formatDateShort(iso) {
        try { return new Date(iso).toLocaleDateString('es-MX', { day:'numeric', month:'short' }); } catch { return iso || '—'; }
    }
    function formatDateTime(iso) {
        try { return new Date(iso).toLocaleString('es-MX', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }); } catch { return iso || '—'; }
    }
    function formatRel(iso) {
        if (!iso) return '—';
        try {
            const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
            if (days === 0) return 'hoy';
            if (days === 1) return 'ayer';
            if (days < 7) return `hace ${days} días`;
            return formatDateShort(iso);
        } catch { return iso; }
    }
    function formatGenerated(iso) {
        try { return 'Actualizado ' + new Date(iso).toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' }); } catch { return ''; }
    }
    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    window.GunterProject360Panel = { mount, load };
})();
