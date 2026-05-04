/* =============================================
   GUNTER CONTROLLER - Commitments Panel (v2 — F2)
   -------------------------------------------------
   UI tipo gpi-card que lista promesas detectadas:
     - Pendientes (top, con dueAt)
     - Vencidos (resaltados en rojo)
     - Cumplidos (collapsed)
   Acciones: marcar cumplido, cancelar, eliminar, agregar manual.
   Detección automática integrada con assistant + transcription.
   ============================================= */

(function () {
    let host = null;
    let allItems = [];
    let filterStatus = 'active'; // 'active' | 'all' | 'fulfilled'
    let filterOwner = 'all';     // 'all' | 'me' | 'others'

    function flagOn() { return !!(window.PremiumFeaturesService?.isEnabled?.('commitmentTracker')); }

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        }[c]));
    }

    function fmtDateShort(iso) {
        if (!iso) return '';
        try {
            const d = new Date(iso);
            return d.toLocaleString('es-MX', {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
            });
        } catch { return iso; }
    }

    function isMine(c) {
        const o = String(c.owner || '').toLowerCase();
        return o === 'yo' || o === 'me' || o === 'mí' || o === 'mi';
    }

    async function mount(selector) {
        host = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!host) return;
        host.classList.add('gpi-panel');
        renderShell();
        await refresh();
        window.addEventListener('gunterPremiumFeaturesChange', (e) => {
            if (e.detail?.key === 'commitmentTracker') {
                renderShell();
                refresh().catch(() => {});
            }
        });
        // Refresh cuando se detecten nuevos commitments
        window.addEventListener('gunter-commitments-changed', () => refresh().catch(() => {}));
    }

    function renderShell() {
        if (!host) return;
        host.innerHTML = `
            <div class="gpi-card gpi-commitments">
                <header class="gpi-card__head">
                    <div>
                        <h3>🤝 Compromisos</h3>
                        <p class="gpi-card__hint">Promesas detectadas en reuniones, chats y WhatsApp. Quién prometió qué, a quién, y para cuándo.</p>
                    </div>
                    <div class="gpi-card__actions">
                        <button id="gpi-cmt-add" class="gpi-btn">+ Agregar</button>
                        <button id="gpi-cmt-detect" class="gpi-btn gpi-btn--ghost" title="Analizar la última transcripción en busca de compromisos">🔍 Detectar</button>
                        <button id="gpi-cmt-refresh" class="gpi-btn gpi-btn--ghost">Refrescar</button>
                    </div>
                </header>
                <div class="gpi-cmt-filters" style="display:flex;gap:8px;margin:10px 0;flex-wrap:wrap;">
                    <select id="gpi-cmt-status" class="gpi-select">
                        <option value="active">Activos (pendientes + vencidos)</option>
                        <option value="all">Todos</option>
                        <option value="fulfilled">Solo cumplidos</option>
                    </select>
                    <select id="gpi-cmt-owner" class="gpi-select">
                        <option value="all">Todos los responsables</option>
                        <option value="me">Solo míos</option>
                        <option value="others">Solo de otros</option>
                    </select>
                </div>
                <div id="gpi-cmt-add-form" hidden style="margin:10px 0;padding:12px;border:1px dashed rgba(0,0,0,0.15);border-radius:8px;"></div>
                <div id="gpi-cmt-stats" style="margin:8px 0;font-size:12px;color:var(--text-muted);"></div>
                <div id="gpi-cmt-body"></div>
            </div>
        `;
        host.querySelector('#gpi-cmt-add').addEventListener('click', toggleAddForm);
        host.querySelector('#gpi-cmt-detect').addEventListener('click', detectFromTranscript);
        host.querySelector('#gpi-cmt-refresh').addEventListener('click', () => refresh());
        host.querySelector('#gpi-cmt-status').addEventListener('change', (e) => {
            filterStatus = e.target.value; renderList();
        });
        host.querySelector('#gpi-cmt-owner').addEventListener('change', (e) => {
            filterOwner = e.target.value; renderList();
        });
    }

    function $body() { return host?.querySelector('#gpi-cmt-body'); }

    function renderDisabled() {
        $body().innerHTML = `<div class="gpi-empty"><p>El <strong>Detector de compromisos</strong> está desactivado.</p><p>Actívalo en <em>Configuración → Premium → Funciones avanzadas</em>.</p></div>`;
    }
    function renderLoading() {
        $body().innerHTML = `<div class="gpi-loading"><div class="gpi-spinner"></div><span>Cargando compromisos…</span></div>`;
    }
    function renderError(m) {
        $body().innerHTML = `<div class="gpi-error">⚠ ${esc(m)}</div>`;
    }

    async function refresh() {
        if (!host) return;
        if (!flagOn()) { renderDisabled(); return; }
        renderLoading();
        try {
            const [items, st] = await Promise.all([
                window.GunterCommitmentsService.list({}),
                window.GunterCommitmentsService.stats()
            ]);
            allItems = items || [];
            renderStats(st);
            renderList();
        } catch (e) {
            renderError(e.message || String(e));
        }
    }

    function renderStats(st) {
        const el = host.querySelector('#gpi-cmt-stats');
        if (!el) return;
        const b = st?.byStatus || {};
        el.innerHTML = `Pendientes: <strong>${b.pending || 0}</strong> · Vencidos: <strong style="color:#c33;">${b.overdue || 0}</strong> · Cumplidos: <strong>${b.fulfilled || 0}</strong> · Cancelados: ${b.cancelled || 0}`;
    }

    function renderList() {
        const filtered = allItems.filter(c => {
            if (filterStatus === 'active'    && !(c.status === 'pending' || c.status === 'overdue')) return false;
            if (filterStatus === 'fulfilled' && c.status !== 'fulfilled') return false;
            if (filterOwner === 'me'     && !isMine(c)) return false;
            if (filterOwner === 'others' && isMine(c)) return false;
            return true;
        });

        if (filtered.length === 0) {
            $body().innerHTML = `
                <div class="gpi-empty">
                    <div class="gpi-empty__icon">🤝</div>
                    <h4>Sin compromisos por ahora</h4>
                    <p>Termina una reunión o conversa con Gunter sobre algo que prometiste. Yo lo detecto y lo guardo.</p>
                </div>`;
            return;
        }

        $body().innerHTML = `<ul class="gpi-cmt-list" style="list-style:none;padding:0;margin:0;">${filtered.map(renderItem).join('')}</ul>`;

        // Bind acciones
        $body().querySelectorAll('[data-act]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const id = btn.dataset.id;
                const act = btn.dataset.act;
                btn.disabled = true;
                try {
                    if (act === 'fulfill') {
                        await window.GunterCommitmentsService.markFulfilled(id, 'manual');
                    } else if (act === 'cancel') {
                        await window.GunterCommitmentsService.markCancelled(id, 'manual');
                    } else if (act === 'remove') {
                        if (!confirm('¿Eliminar este compromiso definitivamente?')) { btn.disabled = false; return; }
                        await window.GunterCommitmentsService.remove(id);
                    }
                    await refresh();
                } catch (err) {
                    alert('Error: ' + (err?.message || err));
                    btn.disabled = false;
                }
            });
        });
    }

    function renderItem(c) {
        const isOverdue = c.status === 'overdue';
        const isFulfilled = c.status === 'fulfilled';
        const isCancelled = c.status === 'cancelled';
        const bg = isOverdue ? 'rgba(204,51,51,0.06)' : (isFulfilled ? 'rgba(56,161,105,0.05)' : 'transparent');
        const decoration = isFulfilled || isCancelled ? 'opacity:0.7;' : '';
        return `
            <li class="gpi-cmt-item" style="display:flex;gap:10px;padding:10px;border:1px solid rgba(0,0,0,0.08);border-radius:8px;margin-bottom:6px;background:${bg};${decoration}">
                <span style="font-size:18px;line-height:1;">${isFulfilled ? '✅' : (isOverdue ? '⏰' : (isCancelled ? '✖️' : '🤝'))}</span>
                <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:600;line-height:1.3;">
                        <span style="color:var(--accent,#5b8def);">${esc(c.owner)}</span>
                        ${c.beneficiary && c.beneficiary !== 'unknown' ? `<span style="color:var(--text-muted);font-weight:400;">→ ${esc(c.beneficiary)}</span>` : ''}
                        : ${esc(c.action)}
                    </div>
                    ${c.context ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;font-style:italic;">"${esc(c.context.slice(0, 200))}"</div>` : ''}
                    <div style="display:flex;gap:6px;flex-wrap:wrap;font-size:11px;margin-top:6px;color:var(--text-muted);">
                        ${c.dueAt ? `<span style="color:${isOverdue ? '#c33' : 'inherit'};">⏱ ${fmtDateShort(c.dueAt)}</span>` : '<span>sin plazo</span>'}
                        ${c.source?.type ? `<span class="gpi-chip" style="padding:2px 6px;border-radius:10px;background:rgba(0,0,0,0.06);">${esc(c.source.type)}</span>` : ''}
                        <span>· detectado ${fmtDateShort(c.createdAt)}</span>
                    </div>
                    ${!isFulfilled && !isCancelled ? `
                        <div style="display:flex;gap:6px;margin-top:8px;">
                            <button class="gpi-btn gpi-btn--small" data-act="fulfill" data-id="${esc(c.id)}">✅ Cumplido</button>
                            <button class="gpi-btn gpi-btn--small gpi-btn--ghost" data-act="cancel" data-id="${esc(c.id)}">Cancelar</button>
                            <button class="gpi-btn gpi-btn--small gpi-btn--ghost" data-act="remove" data-id="${esc(c.id)}" title="Eliminar">🗑</button>
                        </div>
                    ` : `
                        <div style="margin-top:6px;">
                            <button class="gpi-btn gpi-btn--small gpi-btn--ghost" data-act="remove" data-id="${esc(c.id)}" title="Eliminar">🗑 Eliminar</button>
                        </div>
                    `}
                </div>
            </li>
        `;
    }

    function toggleAddForm() {
        const form = host.querySelector('#gpi-cmt-add-form');
        if (!form) return;
        if (!form.hidden) { form.hidden = true; form.innerHTML = ''; return; }
        form.hidden = false;
        form.innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <input id="cmt-form-owner" placeholder="Responsable (yo, María, equipo…)" class="gpi-input">
                <input id="cmt-form-beneficiary" placeholder="Para quién (cliente X, Pedro…)" class="gpi-input">
            </div>
            <input id="cmt-form-action" placeholder="Acción (enviar reporte, llamar, revisar…)" class="gpi-input" style="width:100%;margin-top:8px;">
            <input id="cmt-form-due" type="datetime-local" class="gpi-input" style="margin-top:8px;">
            <textarea id="cmt-form-context" placeholder="Contexto opcional (frase original, motivo)" class="gpi-input" rows="2" style="width:100%;margin-top:8px;"></textarea>
            <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:8px;">
                <button id="cmt-form-cancel" class="gpi-btn gpi-btn--ghost">Cancelar</button>
                <button id="cmt-form-save" class="gpi-btn">Guardar</button>
            </div>
        `;
        form.querySelector('#cmt-form-cancel').addEventListener('click', toggleAddForm);
        form.querySelector('#cmt-form-save').addEventListener('click', async () => {
            const owner = form.querySelector('#cmt-form-owner').value.trim() || 'yo';
            const beneficiary = form.querySelector('#cmt-form-beneficiary').value.trim() || 'unknown';
            const action = form.querySelector('#cmt-form-action').value.trim();
            const dueLocal = form.querySelector('#cmt-form-due').value;
            const dueAt = dueLocal ? new Date(dueLocal).toISOString() : null;
            const context = form.querySelector('#cmt-form-context').value.trim();
            if (!action) { alert('Falta la acción'); return; }
            try {
                await window.GunterCommitmentsService.addManual({
                    owner, beneficiary, action, dueAt, context, source: { type: 'manual', ts: new Date().toISOString() }
                });
                toggleAddForm();
                await refresh();
            } catch (e) { alert('Error: ' + e.message); }
        });
    }

    async function detectFromTranscript() {
        if (!flagOn()) return;
        const btn = host.querySelector('#gpi-cmt-detect');
        if (btn) { btn.disabled = true; btn.textContent = '🔍 Analizando…'; }
        try {
            // Buscar la transcripción más reciente (TranscriptStore o gunter_full_transcript)
            let text = '';
            let refId = 'unknown';
            if (window.GunterTranscriptStore?.getLatest) {
                const t = await window.GunterTranscriptStore.getLatest();
                text = t?.text || '';
                refId = t?.id || 'latest';
            } else {
                text = localStorage.getItem('gunter_full_transcript') || '';
                refId = 'localStorage';
            }
            if (!text || text.length < 30) {
                alert('No encontré una transcripción reciente para analizar.');
                return;
            }
            const r = await window.GunterCommitmentsService.ingestText({
                text,
                sourceType: 'meeting',
                sourceRefId: refId
            });
            (window.GunterNotificationsService?.showToast || alert)(
                `🤝 Detectados ${r.detected} compromisos · creados ${r.created.length}.`,
                { variant: r.created.length ? 'success' : 'info', duration: 4500 }
            );
            await refresh();
        } catch (e) {
            alert('Error analizando: ' + (e?.message || e));
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '🔍 Detectar'; }
        }
    }

    window.GunterCommitmentsPanel = { mount, refresh };
})();
