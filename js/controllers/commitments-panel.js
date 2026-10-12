/* =============================================
   GUNTER CONTROLLER - Commitments Panel (v2 — F2)
   -------------------------------------------------
   UI tipo gpi-card que lista promesas detectadas:
     - Pendientes (top, con dueAt)
     - Vencidos (resaltados en rojo)
     - Cumplidos (collapsed)
   Acciones confirmadas: tarea vinculada, cumplido, cancelación y eliminación.
   ============================================= */

(function () {
    let host = null;
    let allItems = [];
    let filterStatus = 'active'; // 'active' | 'all' | 'fulfilled'
    let filterOwner = 'all';     // 'all' | 'me' | 'others'
    let listenersReady = false, viewOwner = null, ownerEpoch = 0, renderId = 0, actionId = 0, busy = false;
    let proposal = null, taskLinks = new Map(), tasksAvailable = false;

    function currentOwner() { return window.GunterCommitmentsService?.currentOwner?.() || null; }
    function closeProposal() {
        actionId++;
        if (proposal?.fingerprint && JSON.stringify(window.GunterAssistantTools?.getPending?.()) === proposal.fingerprint)
            window.GunterAssistantTools?.clearPending?.();
        proposal = null;
        const detail = host?.querySelector('#gpi-cmt-confirm');
        if (detail) detail.hidden = true;
    }
    function syncOwner() {
        const ownerId = currentOwner();
        if (ownerId !== viewOwner) {
            ownerEpoch++; closeProposal(); renderId++; viewOwner = ownerId;
            allItems = []; taskLinks = new Map(); tasksAvailable = false;
            if ($body()) $body().innerHTML = '';
            const stats = host?.querySelector('#gpi-cmt-stats');
            if (stats) stats.textContent = '';
            const detailText = host?.querySelector('#gpi-cmt-confirm-text');
            if (detailText) detailText.textContent = '';
            notice('');
            const form = host?.querySelector('#gpi-cmt-add-form');
            if (form) { form.hidden = true; form.innerHTML = ''; }
        }
        return ownerId;
    }
    function notice(message) {
        const el = host?.querySelector('#gpi-cmt-notice');
        if (el) el.textContent = message;
    }

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
        const normalize = value => String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const owner = normalize(c.owner);
        const user = window.GunterAuth?.getUser?.();
        return ['yo', 'me', 'mi', user?.displayName, user?.preferredName].filter(Boolean).map(normalize).includes(owner);
    }

    async function mount(selector) {
        const target = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (target === host) { await refresh(); return; }
        closeProposal(); host = target;
        if (!host) return;
        host.classList.add('gpi-panel');
        renderShell();
        await refresh();
        if (listenersReady) return;
        listenersReady = true;
        window.addEventListener('gunterPremiumFeaturesChange', (e) => {
            if (e.detail?.key === 'commitmentTracker') {
                closeProposal();
                renderShell();
                refresh().catch(() => {});
            }
        });
        // Refresh cuando se detecten nuevos commitments
        window.addEventListener('gunter-commitments-changed', () => refresh().catch(() => {}));
        window.addEventListener('tasks-changed', () => refresh().catch(() => {}));
        const scopeChanged = () => { syncOwner(); refresh().catch(() => {}); };
        document.addEventListener('gunter-auth-ready', scopeChanged);
        window.addEventListener('storage', e => { if (!e.key || e.key === 'gunter_device_user') scopeChanged(); });
        window.addEventListener('focus', scopeChanged);
    }

    function renderShell() {
        if (!host) return;
        host.innerHTML = `
            <div class="gpi-card gpi-commitments">
                <header class="gpi-card__head">
                    <div>
                        <h3>Compromisos</h3>
                        <p class="gpi-card__hint">Revisa las promesas registradas y conviértelas en tareas de seguimiento. Crear o completar una tarea no demuestra que la promesa se haya cumplido.</p>
                    </div>
                    <div class="gpi-card__actions">
                        <button id="gpi-cmt-add" class="gpi-btn">+ Agregar</button>
                        <button id="gpi-cmt-detect" class="gpi-btn gpi-btn--ghost" title="Analizar la última transcripción en busca de compromisos">🔍 Detectar</button>
                        <button id="gpi-cmt-refresh" class="gpi-btn gpi-btn--ghost">Refrescar</button>
                    </div>
                </header>
                <div class="gpi-cmt-filters" style="display:flex;gap:8px;margin:10px 0;flex-wrap:wrap;">
                    <select id="gpi-cmt-status" class="gpi-select" aria-label="Estado de los compromisos">
                        <option value="active">Activos (pendientes + vencidos)</option>
                        <option value="all">Todos</option>
                        <option value="fulfilled">Solo cumplidos</option>
                    </select>
                    <select id="gpi-cmt-owner" class="gpi-select" aria-label="Responsable del compromiso">
                        <option value="all">Todos los responsables</option>
                        <option value="me">Solo míos</option>
                        <option value="others">Solo de otros</option>
                    </select>
                </div>
                <div id="gpi-cmt-add-form" hidden style="margin:10px 0;padding:12px;border:1px dashed rgba(0,0,0,0.15);border-radius:8px;"></div>
                <div id="gpi-cmt-stats" style="margin:8px 0;font-size:12px;color:var(--text-muted);"></div>
                <p id="gpi-cmt-notice" role="status" aria-live="polite"></p>
                <div id="gpi-cmt-confirm" class="gpi-cmt-confirm" tabindex="-1" hidden>
                    <p id="gpi-cmt-confirm-text"></p>
                    <div class="gpi-card__actions">
                        <button id="gpi-cmt-confirm-yes" type="button" class="gpi-btn">Confirmar</button>
                        <button id="gpi-cmt-confirm-no" type="button" class="gpi-btn gpi-btn--ghost">No hacer cambios</button>
                    </div>
                </div>
                <div id="gpi-cmt-body"></div>
            </div>
        `;
        host.querySelector('#gpi-cmt-add').addEventListener('click', toggleAddForm);
        host.querySelector('#gpi-cmt-detect').addEventListener('click', detectFromTranscript);
        host.querySelector('#gpi-cmt-refresh').addEventListener('click', () => refresh());
        host.querySelector('#gpi-cmt-confirm-yes').addEventListener('click', () => resolveProposal(true));
        host.querySelector('#gpi-cmt-confirm-no').addEventListener('click', () => resolveProposal(false));
        host.querySelector('#gpi-cmt-status').value = filterStatus;
        host.querySelector('#gpi-cmt-owner').value = filterOwner;
        host.querySelector('#gpi-cmt-status').addEventListener('change', (e) => {
            filterStatus = e.target.value; renderList();
        });
        host.querySelector('#gpi-cmt-owner').addEventListener('change', (e) => {
            filterOwner = e.target.value; renderList();
        });
    }

    function $body() { return host?.querySelector('#gpi-cmt-body'); }

    function renderDisabled() {
        $body().innerHTML = `<div class="gpi-empty"><p>El <strong>seguimiento de compromisos</strong> está desactivado.</p><p>Actívalo en <em>Configuración → Asistente e IA</em>.</p></div>`;
    }
    function renderLoading() {
        $body().innerHTML = `<div class="gpi-loading"><div class="gpi-spinner"></div><span>Cargando compromisos…</span></div>`;
    }
    function renderError(m) {
        $body().innerHTML = `<div class="gpi-error">⚠ ${esc(m)}</div>`;
    }

    async function refresh() {
        if (!host) return;
        const ownerId = syncOwner(), epoch = ownerEpoch, generation = ++renderId;
        if (!flagOn()) { closeProposal(); allItems = []; renderDisabled(); return; }
        if (!ownerId) { renderError('Verifica tu sesión para consultar los compromisos de tu cuenta.'); return; }
        renderLoading();
        try {
            const [items, st, taskResult] = await Promise.all([
                window.GunterCommitmentsService.list({}),
                window.GunterCommitmentsService.stats(),
                window.GunterTasksService?.list ? window.GunterTasksService.list().then(items => ({ items, available: true }))
                    .catch(() => ({ items: [], available: false })) : { items: [], available: false }
            ]);
            if (generation !== renderId || epoch !== ownerEpoch) return;
            if (currentOwner() !== ownerId) { syncOwner(); return; }
            if (!flagOn()) { closeProposal(); renderDisabled(); return; }
            allItems = items || [];
            tasksAvailable = taskResult.available;
            taskLinks = new Map(taskResult.items.filter(task => task.ownerId === ownerId && task.source === 'commitment'
                && task.meta?.commitmentId).map(task => [task.meta.commitmentId, task]));
            renderStats(st);
            renderList();
        } catch (e) {
            if (generation !== renderId || epoch !== ownerEpoch) return;
            allItems = []; taskLinks = new Map(); tasksAvailable = false;
            renderError(e.message || 'No pude consultar los compromisos.');
        }
    }

    function renderStats(st) {
        const el = host.querySelector('#gpi-cmt-stats');
        if (!el) return;
        const b = st?.byStatus || {};
        el.textContent = `Pendientes: ${Number(b.pending) || 0} · Vencidos: ${Number(b.overdue) || 0} · Cumplidos: ${Number(b.fulfilled) || 0} · Cancelados: ${Number(b.cancelled) || 0}.`
            + (allItems.length >= 200 ? ' Se alcanzó el límite de consulta: la lista puede estar incompleta.' : '')
            + (!tasksAvailable ? ' No pude consultar las tareas vinculadas.' : '');
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
                    <p>No hay registros en este filtro. Puedes agregar un compromiso manualmente; la detección automática depende del proveedor autorizado disponible.</p>
                </div>`;
            return;
        }

        $body().innerHTML = `<ul class="gpi-cmt-list" style="list-style:none;padding:0;margin:0;">${filtered.map(renderItem).join('')}</ul>`;

        // Bind acciones
        $body().querySelectorAll('[data-act]').forEach(btn => {
            btn.addEventListener('click', () => requestAction(btn.dataset.act, btn.dataset.id));
        });
    }

    function renderItem(c) {
        const isOverdue = c.status === 'overdue';
        const isFulfilled = c.status === 'fulfilled';
        const isCancelled = c.status === 'cancelled';
        const bg = isOverdue ? 'rgba(204,51,51,0.06)' : (isFulfilled ? 'rgba(56,161,105,0.05)' : 'transparent');
        const decoration = isFulfilled || isCancelled ? 'opacity:0.7;' : '';
        const task = taskLinks.get(c.id);
        const taskStatus = ({ pending: 'pendiente', doing: 'en curso', done: 'completada', cancelled: 'cancelada' })[task?.status] || 'estado no disponible';
        return `
            <li class="gpi-cmt-item" style="display:flex;gap:10px;padding:10px;border:1px solid rgba(0,0,0,0.08);border-radius:8px;margin-bottom:6px;background:${bg};${decoration}">
                <div style="flex:1;min-width:0;">
                    <div style="font-size:13px;font-weight:600;line-height:1.3;">
                        <span style="color:var(--accent,#5b8def);">${esc(c.owner)}</span>
                        ${c.beneficiary && c.beneficiary !== 'unknown' ? `<span style="color:var(--text-muted);font-weight:400;">→ ${esc(c.beneficiary)}</span>` : ''}
                        : ${esc(c.action)}
                    </div>
                    ${c.context ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;font-style:italic;">"${esc(c.context.slice(0, 200))}"</div>` : ''}
                    <div style="display:flex;gap:6px;flex-wrap:wrap;font-size:11px;margin-top:6px;color:var(--text-muted);">
                        ${c.dueAt ? `<span style="color:${isOverdue ? 'var(--gd-error,#c33)' : 'inherit'};">${esc(fmtDateShort(c.dueAt))}</span>` : '<span>sin plazo</span>'}
                        ${c.source?.type ? `<span class="gpi-chip" style="padding:2px 6px;border-radius:10px;background:rgba(0,0,0,0.06);">${esc(c.source.type)}</span>` : ''}
                        <span>· registrado ${esc(fmtDateShort(c.createdAt))}</span>
                        <span>${esc(c.id)}</span>
                    </div>
                    ${task ? `<p class="gpi-card__hint">Tarea vinculada: ${esc(task.title)} · ${esc(taskStatus)}. <a href="day.html#tasks">Ver tareas</a></p>` : ''}
                    ${!isFulfilled && !isCancelled ? `
                        <div class="gpi-card__actions" style="margin-top:8px;">
                            ${!task && tasksAvailable ? `<button class="gpi-btn gpi-btn--small" data-act="task" data-id="${esc(c.id)}">Crear tarea de seguimiento</button>` : ''}
                            <button class="gpi-btn gpi-btn--small" data-act="fulfill" data-id="${esc(c.id)}">Marcar cumplido</button>
                            <button class="gpi-btn gpi-btn--small gpi-btn--ghost" data-act="cancel" data-id="${esc(c.id)}">Cancelar</button>
                            <button class="gpi-btn gpi-btn--small gpi-btn--ghost" data-act="remove" data-id="${esc(c.id)}" aria-label="Eliminar compromiso ${esc(c.action)}">Eliminar</button>
                        </div>
                    ` : `
                        <div style="margin-top:6px;">
                            <button class="gpi-btn gpi-btn--small gpi-btn--ghost" data-act="remove" data-id="${esc(c.id)}">Eliminar</button>
                        </div>
                    `}
                </div>
            </li>
        `;
    }

    function showProposal(text, value) {
        proposal = { ...value, createdAt: Date.now() };
        const detail = host.querySelector('#gpi-cmt-confirm');
        host.querySelector('#gpi-cmt-confirm-text').textContent = text;
        detail.hidden = false; detail.focus?.();
    }
    async function requestAction(action, id) {
        if (busy || !['task', 'fulfill', 'cancel', 'remove'].includes(action)) return;
        const ownerId = syncOwner(), epoch = ownerEpoch;
        if (!ownerId || !flagOn() || !allItems.some(item => item.id === id && item.ownerId === ownerId)) return;
        const tools = window.GunterAssistantTools;
        if (tools?.getPending?.()) { notice('Hay una confirmación pendiente en Gunter. Resuélvela antes de solicitar otra acción.'); return; }
        closeProposal();
        const requestId = ++actionId, viewRequestId = `commitments:${epoch}:${requestId}`;
        busy = true;
        try {
            const service = window.GunterCommitmentsService;
            const item = await service.get(id);
            if (currentOwner() !== ownerId || epoch !== ownerEpoch || requestId !== actionId) { syncOwner(); return; }
            if (!flagOn() || !item || (action !== 'remove' && !['pending', 'overdue'].includes(item.status)))
                throw new Error('El compromiso cambió. Actualiza la lista antes de continuar.');
            if (action === 'task') {
                if (!tools?.dispatch) throw new Error('Recarga Gunter para activar las herramientas de seguimiento.');
                const result = await tools.dispatch(`Convierte el compromiso "${id}" en tarea`, { inputSource: 'text', viewRequestId });
                const pending = tools.getPending?.();
                if (currentOwner() !== ownerId || epoch !== ownerEpoch || requestId !== actionId) {
                    if (pending?.args?.viewRequestId === viewRequestId) tools.clearPending?.();
                    syncOwner(); return;
                }
                if (result.status === 'awaiting_confirmation' && pending?.toolId === 'commitments.task'
                    && pending.args.ownerId === ownerId && pending.args.targetId === id) {
                    showProposal(result.reply, { action, id, ownerId, epoch, fingerprint: JSON.stringify(pending) });
                } else notice(result.reply || 'No pude preparar una acción verificable. Actualiza la lista.');
            } else {
                const verbs = { fulfill: 'marcar como cumplido', cancel: 'cancelar', remove: 'eliminar definitivamente' };
                showProposal(`¿Confirmas ${verbs[action]} el compromiso de ${item.owner}: “${item.action}”?${action === 'remove'
                    ? ' No se puede deshacer desde este panel.' : ''} Esta acción no modifica ni elimina su tarea vinculada.`,
                    { action, id, ownerId, epoch, expected: service.snapshot(item) });
            }
        } catch (error) {
            if (currentOwner() === ownerId && epoch === ownerEpoch && requestId === actionId) notice(error.message);
            else syncOwner();
        } finally { busy = false; }
    }
    async function resolveProposal(accepted) {
        if (busy) return;
        const active = proposal;
        if (!active) return;
        if (currentOwner() !== active.ownerId || ownerEpoch !== active.epoch || !flagOn()
            || Date.now() - active.createdAt > 300000
            || (active.fingerprint && JSON.stringify(window.GunterAssistantTools?.getPending?.()) !== active.fingerprint)) {
            closeProposal(); syncOwner(); notice('La confirmación ya no corresponde a esta acción. No autoricé cambios; actualiza la lista.'); return;
        }
        if (!accepted) { closeProposal(); notice('Cancelado. No hice cambios.'); return; }
        busy = true;
        host.querySelector('#gpi-cmt-confirm').hidden = true;
        try {
            let message;
            if (active.action === 'task') {
                const result = await window.GunterAssistantTools.dispatch('confirmo', { inputSource: 'text' });
                message = result.reply || 'Consulta las tareas antes de repetir la operación.';
            } else {
                const service = window.GunterCommitmentsService;
                const guard = { ownerId: active.ownerId, expected: active.expected, confirmed: true };
                if (active.action === 'fulfill') await service.markFulfilled(active.id, 'Confirmado por el usuario', guard);
                else if (active.action === 'cancel') await service.markCancelled(active.id, 'Confirmado por el usuario', guard);
                else await service.remove(active.id, guard);
                message = active.action === 'remove' ? 'Compromiso eliminado. La tarea vinculada se conserva.'
                    : 'Estado del compromiso actualizado. La tarea vinculada no se modificó.';
            }
            if (currentOwner() === active.ownerId && ownerEpoch === active.epoch) { notice(message); await refresh(); }
            else syncOwner();
        } catch (error) {
            if (currentOwner() === active.ownerId && ownerEpoch === active.epoch) notice(error.message);
            else syncOwner();
        } finally { proposal = null; busy = false; }
    }

    function toggleAddForm() {
        if (!flagOn() || !syncOwner()) { notice('Activa el seguimiento y verifica tu sesión para agregar compromisos.'); return; }
        const formOwner = currentOwner(), formEpoch = ownerEpoch;
        const form = host.querySelector('#gpi-cmt-add-form');
        if (!form) return;
        if (!form.hidden) { form.hidden = true; form.innerHTML = ''; return; }
        form.hidden = false;
        form.innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <input id="cmt-form-owner" aria-label="Responsable del compromiso" maxlength="120" placeholder="Responsable (yo, María, equipo…)" class="gpi-input">
                <input id="cmt-form-beneficiary" aria-label="Beneficiario del compromiso" maxlength="120" placeholder="Para quién (cliente X, Pedro…)" class="gpi-input">
            </div>
            <input id="cmt-form-action" aria-label="Acción acordada" maxlength="180" placeholder="Acción (enviar reporte, llamar, revisar…)" class="gpi-input" style="width:100%;margin-top:8px;">
            <input id="cmt-form-due" type="datetime-local" aria-label="Plazo opcional en tu hora local" class="gpi-input" style="margin-top:8px;">
            <textarea id="cmt-form-context" aria-label="Contexto opcional" maxlength="600" placeholder="Contexto opcional (frase original, motivo)" class="gpi-input" rows="2" style="width:100%;margin-top:8px;"></textarea>
            <div style="display:flex;gap:6px;justify-content:flex-end;margin-top:8px;">
                <button id="cmt-form-cancel" class="gpi-btn gpi-btn--ghost">Cancelar</button>
                <button id="cmt-form-save" class="gpi-btn">Guardar</button>
            </div>
        `;
        form.querySelector('#cmt-form-cancel').addEventListener('click', toggleAddForm);
        form.querySelector('#cmt-form-save').addEventListener('click', async () => {
            if (busy || !flagOn() || currentOwner() !== formOwner || ownerEpoch !== formEpoch) { syncOwner(); return; }
            const owner = form.querySelector('#cmt-form-owner').value.trim() || 'yo';
            const beneficiary = form.querySelector('#cmt-form-beneficiary').value.trim() || 'unknown';
            const action = form.querySelector('#cmt-form-action').value.trim();
            const dueLocal = form.querySelector('#cmt-form-due').value;
            if (dueLocal && !Number.isFinite(Date.parse(dueLocal))) { notice('El plazo no es válido.'); return; }
            const dueAt = dueLocal ? new Date(dueLocal).toISOString() : null;
            const context = form.querySelector('#cmt-form-context').value.trim();
            if (action.length < 2 || action.length > 180) { notice('La acción debe tener entre 2 y 180 caracteres.'); return; }
            busy = true;
            try {
                await window.GunterCommitmentsService.addManual({
                    owner, beneficiary, action, dueAt, context, source: { type: 'manual', ts: new Date().toISOString() }
                });
                toggleAddForm();
                await refresh();
                notice('Compromiso guardado. Revísalo antes de convertirlo en tarea.');
            } catch (e) { if (currentOwner() === formOwner && ownerEpoch === formEpoch) notice(e.message); else syncOwner(); }
            finally { busy = false; }
        });
    }

    async function detectFromTranscript() {
        if (!flagOn()) return;
        const btn = host.querySelector('#gpi-cmt-detect');
        if (btn) { btn.disabled = true; btn.textContent = '🔍 Analizando…'; }
        try {
            const ownerId = syncOwner(), epoch = ownerEpoch;
            // Never send an unowned legacy/global transcript as this user's text.
            if (!window.GunterTranscriptStore?.getLatest) {
                notice('No hay una transcripción reciente con propietario verificable en este panel. Analiza la reunión desde Reuniones o agrega el compromiso manualmente.'); return;
            }
            const t = await window.GunterTranscriptStore.getLatest();
            if (currentOwner() !== ownerId || epoch !== ownerEpoch) { syncOwner(); return; }
            if (!ownerId || t?.ownerId !== ownerId) { notice('No puedo atribuir esta transcripción a tu cuenta. Analízala desde su reunión.'); return; }
            const text = t?.text || '', refId = t?.id;
            if (!text || text.length < 30) {
                notice('No encontré una transcripción reciente para analizar.');
                return;
            }
            const r = await window.GunterCommitmentsService.ingestText({
                text,
                sourceType: 'meeting',
                sourceRefId: refId
            });
            if (currentOwner() !== ownerId || epoch !== ownerEpoch) { syncOwner(); return; }
            notice(`Detectados ${r.detected} compromisos · registros devueltos ${r.created.length}. Revísalos antes de actuar.`);
            await refresh();
        } catch (e) {
            notice(e?.message || 'No pude analizar la transcripción.');
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = '🔍 Detectar'; }
        }
    }

    window.GunterCommitmentsPanel = { mount, refresh };
})();
