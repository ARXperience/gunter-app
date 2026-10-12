/* =============================================
   GUNTER DÍA - Page Controller
   -------------------------------------------------
   Orquesta la página day.html:
   - Header dinámico (saludo + fecha + stats)
   - Quick-add bar (captura rápida vía pipeline)
   - Cards de tareas, eventos y recordatorios
   - Chat embebido (reusa assistant-controller)
   - Próximo evento destacado ("next up")
   ============================================= */

(function () {
    let brandAvatar = null;
    let remindersViewReady = false, reminderRenderId = 0, reminderViewOwner = null;
    let reminderViewRows = [], reminderViewLimit = 25, reminderActionBusy = false, reminderProposal = null;
    let reminderOwnerEpoch = 0, reminderActionId = 0;

    function init() {
        mountAvatar();
        renderHeader();
        document.addEventListener('gunter-auth-ready', () => {
            renderHeader();
            renderEventsInto(document.getElementById('gday-events-mount'));
            renderNextUp();
            renderReminders();
        });
        window.addEventListener('gunter-location-change', renderHeader);
        wireQuickBar();
        wireNotifications();
        wireNav();
        wireChatControls();
        wireDocumentUpload();
        mountPremiumPanels();

        // Mount premium intel shortcuts in panel Hoy (Sprint G)
        if (window.GunterTodayShortcuts?.mount) {
            window.GunterTodayShortcuts.mount('#gday-today-shortcuts').catch(() => {});
        }

        // Mount reused widgets into the Día shell
        if (window.GunterTodayWidget) {
            // Separate mounts: tasks + events lists
            mountTodayWidget();
        }
        if (window.GunterAssistantController) {
            // Embed assistant chat inside the chat card
            window.GunterAssistantController.mount({
                container: document.getElementById('gday-chat-mount')
            });
        }

        initRemindersView();
        renderReminders();
        renderNextUp();

        // Refresh on any changes
        ['tasks-changed', 'events-changed', 'reminders-changed', 'gunter-jobs-changed'].forEach(ev => {
            window.addEventListener(ev, () => {
                refreshStats();
                renderReminders();
                renderNextUp();
            });
        });

        // Tick every minute so "next up" stays fresh
        setInterval(() => { renderNextUp(); refreshStats(); }, 60_000);
    }

    function mountAvatar() {
        if (window.GunterAvatar) {
            try {
                brandAvatar = new window.GunterAvatar('gday-brand-avatar', { size: 44 });
            } catch {}
        }
    }

    function renderHeader() {
        const ctx = window.GunterContextProvider.build();
        const now = new Date();
        const timezone = window.GunterPresence?.timezone?.() || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const h = Number(new Intl.DateTimeFormat('en', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' }).format(now));
        const greeting = h >= 5 && h < 12 ? 'Buenos días' : h >= 12 && h < 19 ? 'Buenas tardes' : 'Buenas noches';
        document.getElementById('gday-greeting').textContent = greeting;
        document.getElementById('gday-date').textContent = now.toLocaleDateString('es-MX', {
            weekday: 'long', day: 'numeric', month: 'long', timeZone: timezone
        });

        const account = window.GunterAuth?.isVerified?.() ? window.GunterAuth.getUser() : null;
        const user = account?.displayName || account?.username || '';
        const uEl = document.getElementById('gday-user-name');
        if (uEl) uEl.textContent = user || 'Tu cuenta';

        refreshStats();
    }

    async function refreshStats() {
        const ctx = window.GunterContextProvider.build();
        const [tasksToday, eventsToday, overdue] = await Promise.all([
            window.GunterTasksService.listForToday(ctx),
            window.GunterEventsService.listForToday(),
            window.GunterTasksService.listOverdue()
        ]);
        document.getElementById('stat-tasks').textContent = tasksToday.length;
        document.getElementById('stat-events').textContent = eventsToday.length;
        const overdueChip = document.getElementById('stat-overdue-chip');
        const overdueEl = document.getElementById('stat-overdue');
        if (overdueEl) overdueEl.textContent = overdue.length;
        if (overdueChip) overdueChip.style.display = overdue.length > 0 ? 'inline-flex' : 'none';

        // Subtitle
        const sub = document.getElementById('gday-subtitle');
        if (sub) {
            if (tasksToday.length === 0 && eventsToday.length === 0) {
                sub.textContent = 'Un día despejado. Usa la barra de captura para agregar algo.';
            } else {
                const parts = [];
                if (tasksToday.length) parts.push(`${tasksToday.length} tarea${tasksToday.length === 1 ? '' : 's'}`);
                if (eventsToday.length) parts.push(`${eventsToday.length} evento${eventsToday.length === 1 ? '' : 's'}`);
                if (overdue.length) parts.push(`${overdue.length} vencida${overdue.length === 1 ? '' : 's'}`);
                sub.textContent = `Esto es lo que tienes hoy: ${parts.join(' · ')}.`;
            }
        }
    }

    function mountTodayWidget() {
        // We render tasks and events separately inside their own cards.
        // today-widget is built for one mount; we call its internal render against two containers.
        const tasksMount = document.getElementById('gday-tasks-mount');
        const eventsMount = document.getElementById('gday-events-mount');
        renderTasksInto(tasksMount);
        renderEventsInto(eventsMount);

        ['tasks-changed'].forEach(ev =>
            window.addEventListener(ev, () => renderTasksInto(tasksMount)));
        ['events-changed'].forEach(ev =>
            window.addEventListener(ev, () => renderEventsInto(eventsMount)));
    }

    async function renderTasksInto(mount) {
        if (!mount) return;
        const ctx = window.GunterContextProvider.build();
        const tasks = await window.GunterTasksService.listForToday(ctx);
        const overdue = await window.GunterTasksService.listOverdue();

        if (tasks.length === 0 && overdue.length === 0) {
            mount.innerHTML = '<p class="gday__empty">Sin tareas hoy. Escribe arriba una captura rápida para crear una.</p>';
            return;
        }
        mount.innerHTML = tasks.map(renderTaskTile).join('');
        if (overdue.length) {
            mount.innerHTML += `
                <details style="margin-top:14px;" open>
                    <summary style="cursor:pointer; color: var(--gday-danger); font-size: 12px; padding: 6px 0;">
                        Vencidas (${overdue.length})
                    </summary>
                    ${overdue.map(renderTaskTile).join('')}
                </details>
            `;
        }
        wireTaskActions(mount);
    }

    async function renderEventsInto(mount) {
        if (!mount) return;
        const events = await window.GunterEventsService.listForToday();
        if (events.length === 0) {
            mount.innerHTML = '<p class="gday__empty">Sin eventos hoy.</p>';
            return;
        }
        mount.innerHTML = events.map(renderEventTile).join('');
        wireEventActions(mount);
    }

    function renderTaskTile(t) {
        const done = t.status === 'done';
        const overdue = t.dueAt && new Date(t.dueAt) < new Date() && !done;
        const time = t.dueAt ? fmtTime(t.dueAt) : '';
        return `
            <div class="gn-tile ${done ? 'is-done' : ''} ${overdue ? 'is-overdue' : ''}">
                <button data-task-toggle="${t.id}" data-done="${done}" class="gn-tile__check">${done ? '✓' : ''}</button>
                <div class="gn-tile__body">
                    <div class="gn-tile__title">${escapeHtml(t.title)}</div>
                    <div class="gn-tile__meta">
                        ${time ? `<span>🕐 ${time}</span>` : ''}
                        ${t.priority && t.priority !== 'normal'
                            ? `<span class="gn-prio gn-prio--${t.priority}">${t.priority}</span>` : ''}
                        ${t.projectName ? `<span>· ${escapeHtml(t.projectName)}</span>` : ''}
                        ${(t.tags || []).map(tg => `<span class="gn-tag">#${escapeHtml(tg)}</span>`).join('')}
                    </div>
                </div>
                <button data-task-remove="${t.id}" class="gn-tile__remove">✕</button>
            </div>`;
    }

    function renderEventTile(e) {
        return `
            <div class="gn-tile gn-tile--event">
                <div class="gn-tile__time">${fmtTime(e.startAt)}</div>
                <div class="gn-tile__body">
                    <div class="gn-tile__title">${escapeHtml(e.title)}</div>
                    <div class="gn-tile__meta">
                        ${e.endAt ? `<span>hasta ${fmtTime(e.endAt)}</span>` : ''}
                        ${e.location ? `<span>📍 ${escapeHtml(e.location)}</span>` : ''}
                        ${(e.attendees || []).length ? `<span>👥 ${e.attendees.join(', ')}</span>` : ''}
                    </div>
                </div>
                <button data-event-remove="${e.id}" class="gn-tile__remove">✕</button>
            </div>`;
    }

    function wireTaskActions(root) {
        root.querySelectorAll('[data-task-toggle]').forEach(b =>
            b.addEventListener('click', async () => {
                const id = b.dataset.taskToggle;
                if (b.dataset.done === 'true') await window.GunterTasksService.reopen(id);
                else await window.GunterTasksService.complete(id);
            }));
        root.querySelectorAll('[data-task-remove]').forEach(b =>
            b.addEventListener('click', async () => {
                await window.GunterTasksService.remove(b.dataset.taskRemove);
            }));
    }
    function wireEventActions(root) {
        root.querySelectorAll('[data-event-remove]').forEach(b =>
            b.addEventListener('click', async () => {
                await window.GunterEventsService.remove(b.dataset.eventRemove);
            }));
    }

    // ---------- Reminders ----------
    function reminderOwner() {
        try {
            const auth = window.GunterAuth;
            const trusted = auth?.canAccessLocalData?.() ?? auth?.isVerified?.();
            const id = trusted && auth.getUser?.()?.id;
            if (typeof id !== 'string' || !id || id === 'local-user') return null;
            const device = window.localStorage?.getItem('gunter_device_user');
            return device && device !== id ? null : id;
        } catch { return null; }
    }
    function reminderLinked(row) { return !!(row.meta?.eventLink || row.payload?.eventLink || row.payload?.meta?.eventLink); }
    function reminderState(status) {
        return ({ scheduled: 'Programado', retry_wait: 'Reintento automático pendiente', running: 'En ejecución',
            failed: 'Fallido', completed: 'Procesado · entrega no confirmada', fired: 'Disparado · lectura no confirmada', cancelled: 'Cancelado' })[status] || 'Estado no reconocido';
    }
    function reminderDate(value) {
        const date = new Date(value);
        if (!value || !Number.isFinite(date.getTime())) return 'Sin fecha válida';
        try { return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short',
            timeZone: window.GunterPresence?.timezone?.() || Intl.DateTimeFormat().resolvedOptions().timeZone }).format(date); }
        catch { return 'Sin fecha válida'; }
    }
    function reminderOrigin(row) {
        return reminderLinked(row) ? 'Vinculado a reunión · requiere Gunter abierto'
            : row.durable ? 'Persistente · requiere servidor local encendido' : 'En este navegador · requiere Gunter abierto';
    }
    function setReminderStatus(text) {
        const status = document.getElementById('gday-reminders-status');
        if (status) status.textContent = text;
    }
    function proposalIsCurrent(proposal = reminderProposal) {
        return !!proposal && reminderOwner() === proposal.ownerId
            && proposal.ownerEpoch === reminderOwnerEpoch
            && JSON.stringify(window.GunterAssistantTools?.getPending?.()) === proposal.fingerprint;
    }
    function closeReminderDetail() {
        reminderActionId++;
        if (reminderProposal && JSON.stringify(window.GunterAssistantTools?.getPending?.()) === reminderProposal.fingerprint)
            window.GunterAssistantTools?.clearPending?.();
        reminderProposal = null;
        const detail = document.getElementById('gday-reminder-detail');
        if (detail) detail.hidden = true;
        const actions = document.getElementById('gday-reminder-confirm-actions');
        if (actions) actions.hidden = true;
    }
    function syncReminderOwner() {
        const ownerId = reminderOwner();
        if (ownerId !== reminderViewOwner) {
            reminderOwnerEpoch++;
            closeReminderDetail(); reminderViewOwner = ownerId;
            reminderViewRows = []; reminderViewLimit = 25; reminderRenderId++;
            const mount = document.getElementById('gday-reminders-mount');
            if (mount) mount.innerHTML = '';
            const text = document.getElementById('gday-reminder-detail-text');
            if (text) text.textContent = '';
        }
        return ownerId;
    }
    function showReminderDetail(text, confirmation = false) {
        const detail = document.getElementById('gday-reminder-detail');
        const content = document.getElementById('gday-reminder-detail-text');
        const actions = document.getElementById('gday-reminder-confirm-actions');
        if (content) content.textContent = text;
        if (actions) actions.hidden = !confirmation;
        if (detail) { detail.hidden = false; detail.focus?.(); }
    }
    function initRemindersView() {
        const mount = document.getElementById('gday-reminders-mount');
        if (!mount || remindersViewReady) return;
        remindersViewReady = true;
        document.getElementById('gday-reminder-filter')?.addEventListener('change', () => {
            reminderViewLimit = 25; renderReminders();
        });
        document.getElementById('gday-refresh-reminders')?.addEventListener('click', () => renderReminders());
        document.getElementById('gday-reminder-close')?.addEventListener('click', closeReminderDetail);
        document.getElementById('gday-reminder-confirm')?.addEventListener('click', () => resolveReminderProposal(true));
        document.getElementById('gday-reminder-reject')?.addEventListener('click', () => resolveReminderProposal(false));
        mount.addEventListener('click', event => {
            const button = event.target.closest?.('[data-rem-action]');
            if (button) reminderAction(button.dataset.remAction, Number(button.dataset.remIndex));
            else if (event.target.closest?.('[data-rem-more]')) { reminderViewLimit += 25; renderReminders(); }
        });
        window.addEventListener('storage', event => {
            if (!event.key || event.key === 'gunter_device_user') { syncReminderOwner(); renderReminders(); }
        });
        window.addEventListener('focus', () => { syncReminderOwner(); renderReminders(); });
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) { syncReminderOwner(); renderReminders(); }
        });
        // Only this visible working surface polls. No microphone, permissions,
        // notifications, or cloud services are enabled by opening this view.
        setInterval(() => {
            syncReminderOwner();
            if (!document.hidden && mount.offsetParent !== null && !reminderActionBusy
                && !mount.contains?.(document.activeElement)) renderReminders();
        }, 30_000);
    }
    async function renderReminders() {
        const mount = document.getElementById('gday-reminders-mount');
        if (!mount) return;
        const ownerId = syncReminderOwner(), generation = ++reminderRenderId;
        if (!ownerId) { mount.innerHTML = ''; setReminderStatus('Verifica tu sesión para consultar los recordatorios de tu cuenta.'); return; }
        mount.setAttribute('aria-busy', 'true');
        setReminderStatus('Actualizando recordatorios…');
        try {
            const service = window.GunterNotificationsService;
            if (!service?.listSnapshot) throw new Error('REMINDER_VIEW_UNAVAILABLE');
            const filter = document.getElementById('gday-reminder-filter')?.value || 'active';
            const snapshot = await service.listSnapshot(filter === 'active' ? { statuses: ['scheduled', 'running', 'retry_wait'] }
                : filter === 'failed' ? { status: 'failed' } : filter === 'history' ? { statuses: ['completed', 'cancelled', 'fired'] } : {});
            if (generation !== reminderRenderId) return;
            if (reminderOwner() !== ownerId) { syncReminderOwner(); setReminderStatus('La cuenta cambió. Verifica tu sesión antes de consultar avisos.'); return; }
            if (snapshot.ownerId !== ownerId) throw new Error('REMINDER_VIEW_UNAVAILABLE');
            const all = snapshot.items.filter(row => row.ownerId === ownerId);
            const selected = all.filter(row => filter === 'all' || (filter === 'failed' ? row.status === 'failed'
                : filter === 'history' ? ['completed', 'fired', 'cancelled'].includes(row.status)
                : ['scheduled', 'running', 'retry_wait'].includes(row.status)));
            selected.sort((a, b) => (filter === 'history' ? -1 : 1) * (Date.parse(a.fireAt || a.runAt) - Date.parse(b.fireAt || b.runAt)) || String(a.id).localeCompare(String(b.id)));
            const focused = document.activeElement?.dataset;
            const focusedId = focused?.remAction ? reminderViewRows[Number(focused.remIndex)]?.id : null;
            reminderViewRows = selected.slice(0, reminderViewLimit);
            const warnings = [];
            if (!snapshot.sources.local.available) warnings.push('No pude consultar los avisos de este navegador.');
            if (!snapshot.sources.durable.available) warnings.push('No pude consultar los avisos persistentes; comprueba el servidor local.');
            if (snapshot.limited) warnings.push('El servidor devolvió el límite de 200 registros; esta vista puede estar incompleta.');
            const count = `Mostrando ${reminderViewRows.length} de ${selected.length} registros consultados. Actualizado: ${reminderDate(new Date().toISOString())}.`;
            setReminderStatus([count, ...warnings].join(' '));
            mount.innerHTML = reminderViewRows.length ? `<div class="gday__reminders">${reminderViewRows.map((row, index) => {
                const actions = [`<button type="button" class="gday__btn" data-rem-action="detail" data-rem-index="${index}" aria-label="Ver detalle de ${escapeHtml(row.title)}">Ver detalle</button>`];
                const linked = reminderLinked(row);
                if (linked) actions.push('<a class="gday__btn" href="day.html#events">Ir a Agenda</a>');
                else {
                    if (row.durable && row.type === 'reminder' && row.status === 'failed' && window.GunterJobs?.retryReminder)
                        actions.push(`<button type="button" class="gday__btn" data-rem-action="retry" data-rem-index="${index}">Reintentar</button>`);
                    if ((row.status === 'scheduled' || (row.durable && row.status === 'retry_wait')) && row.type !== 'follow_up'
                        && (!row.durable || window.GunterJobs?.cancelReminder))
                        actions.push(`<button type="button" class="gday__btn" data-rem-action="cancel" data-rem-index="${index}">Cancelar</button>`);
                }
                return `<div class="gday__reminder" data-rem-status="${escapeHtml(row.status)}"><div class="gday__reminder-content">
                    <strong class="gday__reminder-title">${escapeHtml(row.title)}</strong>
                    <span class="gday__reminder-time">${escapeHtml(reminderDate(row.status === 'retry_wait' ? row.nextAttemptAt : row.fireAt || row.runAt))}</span>
                    <span class="gday__reminder-status">${escapeHtml(reminderState(row.status))}</span>
                    <span class="gday__reminder-meta">${escapeHtml(reminderOrigin(row))}</span></div>
                    <div class="gday__reminder-actions">${actions.join('')}</div></div>`;
            }).join('')}</div>${selected.length > reminderViewRows.length ? '<button type="button" class="gday__btn" id="gday-reminder-more" data-rem-more>Mostrar más</button>' : ''}`
                : `<p class="gday__empty">${warnings.length ? 'No encontré registros en las fuentes consultadas. La consulta está incompleta.' : filter === 'failed' ? 'No hay avisos fallidos registrados.' : filter === 'history' ? 'No hay avisos procesados o cancelados registrados.' : filter === 'all' ? 'No tienes recordatorios registrados.' : 'No tienes recordatorios activos.'}</p>`;
            if (focusedId) {
                const index = reminderViewRows.findIndex(row => row.id === focusedId);
                const button = index >= 0 ? mount.querySelector(`[data-rem-action="${focused.remAction}"][data-rem-index="${index}"]`) : null;
                (button || document.getElementById('gday-refresh-reminders'))?.focus?.();
            }
        } catch {
            if (generation !== reminderRenderId) return;
            reminderViewRows = []; mount.innerHTML = '';
            if (reminderOwner() !== ownerId) syncReminderOwner();
            setReminderStatus('No pude consultar tus recordatorios. Verifica tu sesión, recarga Gunter y comprueba el almacenamiento y el servidor local.');
        } finally { if (generation === reminderRenderId) mount.setAttribute('aria-busy', 'false'); }
    }
    async function reminderAction(action, index) {
        if (reminderActionBusy) return;
        const ownerId = syncReminderOwner(), row = reminderViewRows[index];
        if (!ownerId || !row || row.ownerId !== ownerId || !['detail', 'retry', 'cancel'].includes(action)) return;
        const tools = window.GunterAssistantTools;
        if (tools?.getPending?.()) { showReminderDetail('Hay una confirmación pendiente en Gunter. Resuélvela antes de solicitar otra acción.'); return; }
        const ownerEpoch = reminderOwnerEpoch, actionId = ++reminderActionId;
        const viewRequestId = `${ownerEpoch}:${actionId}`;
        reminderActionBusy = true;
        try {
            const current = await window.GunterNotificationsService.get(row.id);
            if (reminderOwner() !== ownerId || reminderOwnerEpoch !== ownerEpoch || reminderActionId !== actionId) { syncReminderOwner(); return; }
            if (!current || current.ownerId !== ownerId || current.id !== row.id) throw new Error('REMINDER_CHANGED');
            if (action === 'detail' && !row.durable) {
                showReminderDetail(`“${current.title}” — ${reminderState(current.status)}.\n${reminderDate(current.fireAt)}.\n${reminderOrigin(current)}.\n${['fired', 'completed'].includes(current.status) ? 'Este estado no demuestra que hayas oído o leído el aviso.' : 'Solo se muestra el estado registrado; no hay entrega confirmada.'}`);
                return;
            }
            if ((action === 'retry' && (!current.durable || current.type !== 'reminder' || current.status !== 'failed' || reminderLinked(current)))
                || (action === 'cancel' && (reminderLinked(current) || !['scheduled', ...(current.durable ? ['retry_wait'] : [])].includes(current.status)))) throw new Error('REMINDER_CHANGED');
            if (!tools?.dispatch) throw new Error('REMINDER_VIEW_UNAVAILABLE');
            const id = String(row.id);
            if (/[“”"'\r\n]/.test(id)) throw new Error('REMINDER_CHANGED');
            const verb = ({ detail: 'Estado del', retry: 'Reintenta el', cancel: 'Cancela el' })[action];
            const result = await tools.dispatch(`${verb} recordatorio "${id}"`, { inputSource: 'text', requireReminderGuard: true, viewRequestId });
            const pending = tools.getPending?.();
            if (reminderOwner() !== ownerId || reminderOwnerEpoch !== ownerEpoch || reminderActionId !== actionId) {
                if (pending?.args?.viewRequestId === viewRequestId) tools.clearPending?.();
                syncReminderOwner(); return;
            }
            if (result.status === 'awaiting_confirmation' && pending?.args?.ownerId === ownerId && pending.args.targetId === id
                && pending.toolId === result.intent) {
                reminderProposal = { ownerId, ownerEpoch, fingerprint: JSON.stringify(pending) };
                showReminderDetail(result.reply, true);
            } else { reminderProposal = null; showReminderDetail(result.reply || 'No recibí un resultado verificable. Consulta el estado antes de repetir.'); }
        } catch { if (reminderOwner() === ownerId && reminderOwnerEpoch === ownerEpoch && reminderActionId === actionId) showReminderDetail('El aviso cambió o no pude verificar su estado. Actualiza la lista antes de repetir la acción; no mostraré datos sensibles del error.'); else syncReminderOwner(); }
        finally { reminderActionBusy = false; }
    }
    async function resolveReminderProposal(accepted) {
        if (reminderActionBusy) return;
        const proposal = reminderProposal;
        if (!proposalIsCurrent(proposal)) { reminderProposal = null; syncReminderOwner(); showReminderDetail('Esta confirmación ya no corresponde al aviso actual. No autoricé otra acción; consulta de nuevo su estado.'); return; }
        reminderActionBusy = true;
        const actions = document.getElementById('gday-reminder-confirm-actions');
        if (actions) actions.hidden = true;
        try {
            const result = await window.GunterAssistantTools.dispatch(accepted ? 'confirmo' : 'no', { inputSource: 'text' });
            reminderProposal = null;
            if (reminderOwner() !== proposal.ownerId || reminderOwnerEpoch !== proposal.ownerEpoch) { syncReminderOwner(); return; }
            showReminderDetail(result.reply || 'No pude verificar el resultado. Consulta el estado antes de repetir.');
            await renderReminders();
        } catch { reminderProposal = null; if (reminderOwner() === proposal.ownerId && reminderOwnerEpoch === proposal.ownerEpoch) showReminderDetail('No pude verificar la operación. Consulta el estado antes de repetir: podría haberse guardado.'); else syncReminderOwner(); }
        finally { reminderActionBusy = false; }
    }

    // ---------- Next up ribbon ----------
    async function renderNextUp() {
        const mount = document.getElementById('gday-next-ribbon');
        if (!mount) return;
        const now = Date.now();
        const [events, reminders, tasks] = await Promise.all([
            window.GunterEventsService.listUpcoming(5),
            window.GunterNotificationsService.list({ status: 'scheduled' }),
            window.GunterTasksService.list({ status: 'pending' })
        ]);

        const candidates = [
            ...events.map(e => ({ kind: 'event', when: new Date(e.startAt).getTime(), title: e.title, sub: fmtTime(e.startAt) })),
            ...reminders.filter(r => new Date(r.fireAt).getTime() > now).map(r => ({
                kind: 'reminder', when: new Date(r.fireAt).getTime(),
                title: r.title, sub: `Recordatorio · ${fmtTime(r.fireAt)}`
            })),
            ...tasks.filter(t => t.dueAt && new Date(t.dueAt).getTime() > now).map(t => ({
                kind: 'task', when: new Date(t.dueAt).getTime(),
                title: t.title, sub: `Tarea · ${fmtTime(t.dueAt)}`
            }))
        ].sort((a, b) => a.when - b.when);

        const next = candidates.find(c => c.when >= now);
        if (!next) { mount.innerHTML = ''; return; }

        const minsTo = Math.round((next.when - now) / 60000);
        const when = minsTo < 1 ? 'ahora' : minsTo < 60 ? `en ${minsTo} min` : `en ${Math.round(minsTo / 60)} h`;

        const icons = { event: '📅', reminder: '⏰', task: '📋' };
        mount.innerHTML = `
            <div class="gday__next">
                <div class="gday__next-icon">${icons[next.kind] || '🔔'}</div>
                <div class="gday__next-body">
                    <div class="gday__next-title">${escapeHtml(next.title)}</div>
                    <div class="gday__next-meta">${escapeHtml(next.sub)}</div>
                </div>
                <div class="gday__next-cta">${when}</div>
            </div>
        `;
    }

    // ---------- Quick-add ----------
    function wireQuickBar() {
        const form = document.getElementById('gday-quickbar-form');
        const input = document.getElementById('gday-quickbar-input');
        if (!form || !input) return;
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const text = input.value.trim();
            if (!text) return;
            input.disabled = true;
            form.querySelector('button').disabled = true;
            try {
                if (window.GunterAssistantController?.send) {
                    // One turn, one permission gate and one shared history.
                    // Replaying a pending command through the chat created a second proposal.
                    await window.GunterAssistantController.send(text);
                    input.value = '';
                    document.getElementById('gday-chat-mount')?.scrollIntoView?.({ block: 'nearest' });
                    return;
                }
                const { awaitingConfirmation, response } = await window.GunterPipeline.handleUserInput(text);
                if (response?.speech) {
                    window.GunterNotificationsService.showToast(response.speech, { priority: 'normal', duration: 4500 });
                }
                if (awaitingConfirmation) window.GunterNotificationsService.showToast('Gunter necesita confirmación en el chat.', { priority: 'high', duration: 6000 });
                input.value = '';
                if (brandAvatar && response?.animation && brandAvatar.playAnimation) {
                    brandAvatar.playAnimation(response.animation);
                }
            } catch (err) {
                if (window.GunterErrors) window.GunterErrors.toast(err);
                else window.GunterNotificationsService.showToast('⚠️ ' + (err.message || err), { priority: 'high' });
            } finally {
                input.disabled = false;
                form.querySelector('button').disabled = false;
                input.focus();
            }
        });
    }

    // ---------- Notifications permission ----------
    function wireNotifications() {
        const btn = document.getElementById('gday-enable-notifications');
        if (!btn) return;
        updateNotifBtn(btn);
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            const res = await window.GunterNotificationsService.requestPermission();
            await updateNotifBtn(btn);
            if (res === 'granted') {
                window.GunterNotificationsService.showToast('✅ Notificaciones activadas.', { priority: 'normal' });
            } else if (res === 'denied') {
                window.GunterNotificationsService.showToast('Permiso denegado. Actívalo en ajustes del navegador.', { priority: 'high' });
            }
        });
    }
    async function updateNotifBtn(btn) {
        if (!('Notification' in window)) {
            btn.textContent = '🔔 No soportado'; btn.disabled = true; return;
        }
        if (Notification.permission === 'granted') {
            const push = await window.GunterNotificationsService?.pushStatus?.().catch(() => null);
            btn.textContent = push?.subscribed ? '🔔 Alertas en segundo plano activas' : '🔔 Completar activación';
            btn.disabled = Boolean(push?.subscribed);
        } else if (Notification.permission === 'denied') {
            btn.textContent = '🔕 Bloqueadas en el navegador';
            btn.disabled = true;
        } else {
            btn.textContent = '🔔 Activar notificaciones';
        }
    }

    // ---------- Nav scroll ----------
    function wireNav() {
        document.querySelectorAll('[data-scroll-to]').forEach(a => {
            a.addEventListener('click', (e) => {
                const id = a.dataset.scrollTo;
                const target = document.getElementById(id);
                if (target) {
                    e.preventDefault();
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    document.querySelectorAll('.gday__nav-item').forEach(n => n.classList.remove('is-active'));
                    a.classList.add('is-active');
                }
            });
        });
    }

    // ---------- Chat controls ----------
    function wireChatControls() {
        const clearBtn = document.getElementById('gday-clear-chat');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                localStorage.removeItem('gunter_conversation');
                const log = document.querySelector('#gn-assistant-log');
                if (log) log.innerHTML = '';
                window.GunterNotificationsService.showToast('Historial de chat limpiado.', { duration: 2500 });
            });
        }
    }

    // ---------- Documents upload ----------
    let currentDoc = null; // { extracted, blob, mimeType }

    function wireDocumentUpload() {
        const btn = document.getElementById('gday-doc-btn');
        const fileInput = document.getElementById('gday-doc-file');
        const drop = document.getElementById('gday-quickbar-drop');
        if (!btn || !fileInput) return;

        btn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            const f = e.target.files?.[0];
            if (f) processDocumentFile(f);
            fileInput.value = '';
        });

        if (drop) {
            ['dragenter', 'dragover'].forEach(ev => {
                drop.addEventListener(ev, (e) => {
                    if (!e.dataTransfer?.types?.includes('Files')) return;
                    e.preventDefault();
                    drop.classList.add('is-dragover');
                });
            });
            ['dragleave', 'drop'].forEach(ev => {
                drop.addEventListener(ev, (e) => {
                    e.preventDefault();
                    drop.classList.remove('is-dragover');
                });
            });
            drop.addEventListener('drop', (e) => {
                const f = e.dataTransfer?.files?.[0];
                if (f) processDocumentFile(f);
            });
        }

        // Paste from clipboard anywhere on the page
        window.addEventListener('paste', (e) => {
            if (!e.clipboardData) return;
            for (const item of e.clipboardData.items) {
                if (item.kind === 'file') {
                    const f = item.getAsFile();
                    if (f) { processDocumentFile(f); break; }
                }
            }
        });
    }

    async function processDocumentFile(file) {
        const previewEl = document.getElementById('gday-doc-preview');
        if (!previewEl) return;

        // Show loading state immediately
        const objectUrl = URL.createObjectURL(file);
        previewEl.hidden = false;
        previewEl.innerHTML = `
            <div class="gday__doc-loading">
                <img src="${objectUrl}" alt="" class="gday__doc-thumb-loading">
                <div>
                    <strong>Gunter está leyendo el documento…</strong>
                    <p class="gday__doc-hint">Extrayendo empresa, valor, vencimiento y referencia con IA.</p>
                    <div class="gday__doc-skeleton"><span></span><span></span><span></span></div>
                </div>
            </div>
        `;
        if (brandAvatar?.playAnimation) brandAvatar.playAnimation('think');

        try {
            window.GunterDocumentService.validateFile(file);
            const extracted = await window.GunterDocumentService.extractFromFile(file, { hint: 'auto' });
            currentDoc = {
                extracted,
                blob: extracted.__originalBlob || file,
                mimeType: extracted.__originalMime || file.type,
                thumbUrl: objectUrl
            };
            renderDocumentPreview(previewEl, currentDoc);
            if (brandAvatar?.playAnimation) brandAvatar.playAnimation('idea');
        } catch (err) {
            URL.revokeObjectURL(objectUrl);
            previewEl.innerHTML = `
                <div class="gday__doc-error">
                    <strong>⚠️ No se pudo procesar el documento</strong>
                    <p>${escapeHtml(err.message || String(err))}</p>
                    <button class="gday__btn" onclick="document.getElementById('gday-doc-preview').hidden=true">Cerrar</button>
                </div>
            `;
            if (brandAvatar?.playAnimation) brandAvatar.playAnimation('shake');
        }
    }

    function renderDocumentPreview(mount, doc) {
        const ext = doc.extracted;
        const empresa = ext.empresa?.nombre || '(sin detectar)';
        const totalFmt = ext.valor?.total != null
            ? window.GunterDocumentService.fmtMoney(ext.valor.total, ext.valor.moneda)
            : '—';
        const due = ext.fecha_vencimiento
            ? new Date(ext.fecha_vencimiento + 'T00:00:00').toLocaleDateString('es-MX', {
                weekday: 'long', day: 'numeric', month: 'long'
            })
            : '(sin fecha)';
        const reference = ext.referencia?.numero_factura
            || ext.referencia?.codigo_pago
            || ext.referencia?.numero_cliente
            || '—';
        const conf = Math.round((ext.confidence?.overall || 0) * 100);
        const confClass = conf >= 85 ? 'ok' : conf >= 60 ? 'warn' : 'low';

        const suggested = window.GunterDocumentService.buildSuggestedTask(ext);

        const warningsHtml = (ext.warnings || []).length
            ? `<div class="gday__doc-warnings">⚠️ ${ext.warnings.map(escapeHtml).join(' · ')}</div>`
            : '';

        mount.innerHTML = `
            <div class="gday__doc-header">
                <span class="gday__doc-eyebrow">Documento detectado</span>
                <span class="gday__doc-conf gday__doc-conf--${confClass}" title="Confianza de la IA">${conf}% confianza</span>
                <button class="gday__doc-close" id="gday-doc-close" title="Descartar">✕</button>
            </div>
            <div class="gday__doc-body">
                <div class="gday__doc-thumb">
                    ${doc.mimeType === 'application/pdf'
                        ? `<div class="gday__doc-pdf">📄 PDF</div>`
                        : `<img src="${doc.thumbUrl}" alt="Documento">`}
                </div>
                <div class="gday__doc-fields">
                    <div class="gday__doc-row">
                        <label>Empresa</label>
                        <input type="text" data-field="empresa" value="${escapeAttr(empresa)}">
                    </div>
                    <div class="gday__doc-row gday__doc-row--split">
                        <div>
                            <label>Valor</label>
                            <input type="text" data-field="total" value="${escapeAttr(totalFmt)}">
                        </div>
                        <div>
                            <label>Moneda</label>
                            <input type="text" data-field="moneda" value="${escapeAttr(ext.valor?.moneda || '')}" maxlength="4">
                        </div>
                    </div>
                    <div class="gday__doc-row gday__doc-row--split">
                        <div>
                            <label>Tipo</label>
                            <select data-field="tipo">
                                <option ${ext.tipo === 'recibo' ? 'selected' : ''}>recibo</option>
                                <option ${ext.tipo === 'factura' ? 'selected' : ''}>factura</option>
                                <option ${ext.tipo === 'ticket' ? 'selected' : ''}>ticket</option>
                                <option ${ext.tipo === 'boleta' ? 'selected' : ''}>boleta</option>
                                <option ${ext.tipo === 'otro' ? 'selected' : ''}>otro</option>
                            </select>
                        </div>
                        <div>
                            <label>Vencimiento</label>
                            <input type="date" data-field="fecha_vencimiento" value="${escapeAttr(ext.fecha_vencimiento || '')}">
                        </div>
                    </div>
                    <div class="gday__doc-row">
                        <label>Referencia</label>
                        <input type="text" data-field="referencia" value="${escapeAttr(reference)}">
                    </div>
                    ${ext.resumen ? `<p class="gday__doc-summary">${escapeHtml(ext.resumen)}</p>` : ''}
                    ${warningsHtml}
                </div>
            </div>
            <div class="gday__doc-suggest">
                <div>
                    <strong>Tarea sugerida</strong>
                    <p>${escapeHtml(suggested.title)} · ${due}</p>
                </div>
                <div class="gday__doc-actions">
                    <button class="gday__btn" id="gday-doc-discard">Descartar</button>
                    <button class="gday__btn gday__btn--primary" id="gday-doc-confirm">✓ Crear tarea</button>
                </div>
            </div>
        `;

        // Wire close/discard
        mount.querySelector('#gday-doc-close').addEventListener('click', discardDocument);
        mount.querySelector('#gday-doc-discard').addEventListener('click', discardDocument);

        // Wire confirm
        mount.querySelector('#gday-doc-confirm').addEventListener('click', async () => {
            // Capture any edits from inputs
            const edits = captureEdits(mount);
            const mergedExtracted = applyEdits(ext, edits);
            await confirmDocumentTask(mergedExtracted, doc.blob);
        });

        // Re-build suggested task preview on input changes
        mount.querySelectorAll('[data-field]').forEach(inp => {
            inp.addEventListener('input', () => {
                const edits = captureEdits(mount);
                const merged = applyEdits(ext, edits);
                const s = window.GunterDocumentService.buildSuggestedTask(merged);
                const dueStr = s.dueAt
                    ? new Date(s.dueAt).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
                    : '(sin fecha)';
                mount.querySelector('.gday__doc-suggest p').textContent = `${s.title} · ${dueStr}`;
            });
        });
    }

    function captureEdits(mount) {
        const edits = {};
        mount.querySelectorAll('[data-field]').forEach(inp => {
            edits[inp.dataset.field] = inp.value.trim();
        });
        return edits;
    }

    function applyEdits(ext, e) {
        const clone = JSON.parse(JSON.stringify(ext));
        if (e.empresa) clone.empresa = { ...(clone.empresa || {}), nombre: e.empresa };
        if (e.moneda != null) clone.valor = { ...(clone.valor || {}), moneda: e.moneda.toUpperCase() || null };
        if (e.total != null) {
            const n = parseFloat(String(e.total).replace(/[^0-9.-]/g, ''));
            clone.valor = { ...(clone.valor || {}), total: isNaN(n) ? null : n };
        }
        if (e.tipo) clone.tipo = e.tipo;
        if (e.fecha_vencimiento != null) clone.fecha_vencimiento = e.fecha_vencimiento || null;
        if (e.referencia) clone.referencia = { ...(clone.referencia || {}), numero_factura: e.referencia };
        return clone;
    }

    function discardDocument() {
        const previewEl = document.getElementById('gday-doc-preview');
        if (currentDoc?.thumbUrl) URL.revokeObjectURL(currentDoc.thumbUrl);
        currentDoc = null;
        if (previewEl) { previewEl.hidden = true; previewEl.innerHTML = ''; }
    }

    async function confirmDocumentTask(extracted, blob) {
        try {
            const plan = window.GunterDecisionEngine.planFromDocument(extracted, blob);
            // Skip UI confirmation here — the preview WAS the confirmation
            const ctx = window.GunterContextProvider.build();
            const exec = await window.GunterActionEngine.execute(
                plan, { accepted: true, token: Date.now() }, ctx
            );
            if (exec?.uiResponse?.speech) {
                window.GunterNotificationsService.showToast(exec.uiResponse.speech, {
                    priority: 'normal', duration: 5500
                });
            }
            if (brandAvatar?.playAnimation && exec?.uiResponse?.animation) {
                brandAvatar.playAnimation(exec.uiResponse.animation);
            }
            discardDocument();
        } catch (err) {
            if (window.GunterErrors) window.GunterErrors.toast(err, { context: 'document' });
            else window.GunterNotificationsService.showToast('⚠️ ' + (err.message || err), { priority: 'high', duration: 5000 });
        }
    }

    function escapeAttr(s) {
        return String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    // ---------- Premium panels ----------
    // El montaje lo gestiona ahora day-tabs.js de forma lazy cuando el usuario
    // abre cada tab. Dejamos el método como no-op para no romper init().
    function mountPremiumPanels() { /* handled by day-tabs.js */ }

    // ---------- Helpers ----------
    function fmtTime(iso) {
        try { return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }); }
        catch { return iso; }
    }
    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.GunterDayController = { refreshStats, renderReminders, renderNextUp, initRemindersView };
})();
