/* Gunter Day — compact operational history with progressive disclosure. */
(function (root) {
    const STATE = {
        READY: 'Listo', RUNNING: 'En curso', WAITING_CONFIRMATION: 'Requiere confirmación',
        PAUSED: 'Pausado', BLOCKED: 'Necesita atención', COMPLETED: 'Completado',
        VERIFIED: 'Verificado', FAILED: 'Falló', VERIFICATION_FAILED: 'Sin verificar', OUTCOME_UNKNOWN: 'Resultado incierto',
        CANCELLED: 'Cancelado', SCHEDULED: 'Programado', RETRY_WAIT: 'Reintentando',
        STARTED: 'En curso', AUTHORIZED: 'Autorizado', RESULT_RECEIVED: 'Resultado recibido'
    };
    const TYPE = { workflow: 'Flujo', brain: 'Acción', command: 'Dispositivo', job: 'Programación' };
    const mounted = new Set();
    let filter = 'all';

    function mount(selector) {
        const host = document.querySelector(selector);
        if (!host) return;
        if (!mounted.has(host)) {
            host.innerHTML = shell();
            bind(host);
            mounted.add(host);
        }
        refresh(host);
    }

    function shell() {
        return `
            <div class="gactivity">
                <header class="gactivity__header">
                    <div>
                        <span class="gactivity__eyebrow">Registro verificable</span>
                        <h2>Actividad de Gunter</h2>
                        <p>Qué hizo, qué sigue y qué necesita de ti.</p>
                    </div>
                    <button class="gactivity__refresh" type="button" data-activity-refresh aria-label="Actualizar actividad">Actualizar</button>
                </header>
                <div class="gactivity__stats" data-activity-stats aria-label="Resumen de actividad"></div>
                <div class="gactivity__filters" role="group" aria-label="Filtrar actividad">
                    <button type="button" class="is-active" data-activity-filter="all">Todo</button>
                    <button type="button" data-activity-filter="active">En curso</button>
                    <button type="button" data-activity-filter="attention">Requiere atención</button>
                </div>
                <div class="gactivity__notice" data-activity-notice role="status" aria-live="polite"></div>
                <div class="gactivity__list" data-activity-list aria-live="polite">
                    <p class="gactivity__empty">Consultando el registro operativo…</p>
                </div>
            </div>`;
    }

    function bind(host) {
        host.querySelector('[data-activity-refresh]')?.addEventListener('click', () => refresh(host));
        host.querySelectorAll('[data-activity-filter]').forEach(button => button.addEventListener('click', () => {
            filter = button.dataset.activityFilter;
            host.querySelectorAll('[data-activity-filter]').forEach(item => item.classList.toggle('is-active', item === button));
            renderList(host, host.__gunterActivityItems || []);
        }));
        host.addEventListener('click', async event => {
            const button = event.target.closest('[data-workflow-action]');
            if (!button) return;
            const action = button.dataset.workflowAction;
            const workflowId = button.dataset.workflowId;
            if (action === 'authorize' && !root.confirm('¿Confirmas que Gunter puede ejecutar el siguiente paso indicado?')) return;
            if (action === 'cancel' && !root.confirm('¿Cancelar este flujo? Los pasos ya verificados conservarán su registro.')) return;
            if (action === 'retry' && !root.confirm(button.dataset.retryWarning === 'true'
                ? 'No pude determinar si la acción anterior llegó a completarse. Comprueba primero la aplicación o servicio de destino. Si ya se completó, no reintentes. Si confirmas, Gunter volverá a ejecutar el paso y podría duplicar el efecto. ¿Continuar?'
                : '¿Quieres reintentar el paso que falló?')) return;
            button.disabled = true;
            notice(host, 'Aplicando cambio…');
            try {
                await root.GunterControlPlane.workflowAction({
                    workflowId, action,
                    confirmed: action === 'authorize' || (action === 'retry' && button.dataset.retryWarning === 'true')
                });
                notice(host, action === 'authorize' ? 'Paso autorizado.' : 'Flujo actualizado.');
                await refresh(host, false);
            } catch (error) {
                notice(host, humanError(error), true);
            } finally {
                button.disabled = false;
            }
        });
    }

    async function refresh(host, announce = true) {
        const button = host.querySelector('[data-activity-refresh]');
        if (button) { button.disabled = true; button.textContent = 'Actualizando…'; }
        try {
            if (!root.GunterControlPlane?.activity) throw new Error('activity_unavailable');
            const data = await root.GunterControlPlane.activity({ limit: 80 });
            host.__gunterActivityItems = data.items || [];
            renderStats(host, data.stats || {});
            renderList(host, host.__gunterActivityItems);
            if (announce) notice(host, `Actualizado ${timeOnly(new Date().toISOString())}.`);
        } catch (error) {
            renderError(host, error);
        } finally {
            if (button) { button.disabled = false; button.textContent = 'Actualizar'; }
        }
    }

    function renderStats(host, stats) {
        const el = host.querySelector('[data-activity-stats]');
        if (!el) return;
        el.innerHTML = `
            <div><strong>${number(stats.active)}</strong><span>en curso</span></div>
            <div><strong>${number(stats.needsAttention)}</strong><span>requieren atención</span></div>
            <div><strong>${number(stats.verified)}</strong><span>verificados</span></div>`;
    }

    function renderList(host, items) {
        const list = host.querySelector('[data-activity-list]');
        if (!list) return;
        const visible = items.filter(item => {
            if (filter === 'active') return ['READY', 'RUNNING', 'PAUSED', 'SCHEDULED', 'RETRY_WAIT', 'STARTED', 'AUTHORIZED'].includes(item.state);
            if (filter === 'attention') return ['WAITING_CONFIRMATION', 'BLOCKED', 'FAILED', 'VERIFICATION_FAILED', 'EXPIRED'].includes(item.state);
            return true;
        });
        if (!visible.length) {
            list.innerHTML = `<div class="gactivity__empty"><strong>${filter === 'all' ? 'Aún no hay actividad.' : 'Nada en este filtro.'}</strong><span>Las acciones verificadas y los flujos de Gunter aparecerán aquí.</span></div>`;
            return;
        }
        list.innerHTML = visible.map(renderItem).join('');
    }

    function renderItem(item) {
        const tone = stateTone(item.state);
        const progress = item.progress ? `<span>${number(item.progress.verified)} de ${number(item.progress.total)} pasos verificados</span>` : '';
        const scheduled = item.scheduledAt ? `<span>Programado: ${dateTime(item.scheduledAt)}</span>` : '';
        const evidence = item.evidenceCount ? `<span>${number(item.evidenceCount)} evidencia${item.evidenceCount === 1 ? '' : 's'}</span>` : '';
        return `
            <article class="gactivity__item" data-tone="${tone}">
                <div class="gactivity__rail" aria-hidden="true"><span></span></div>
                <div class="gactivity__body">
                    <div class="gactivity__item-head">
                        <div>
                            <span class="gactivity__kind">${escapeHtml(TYPE[item.type] || 'Actividad')}</span>
                            <h3>${escapeHtml(item.title || 'Acción de Gunter')}</h3>
                        </div>
                        <div class="gactivity__state"><i aria-hidden="true"></i>${escapeHtml(STATE[item.state] || readable(item.state))}</div>
                    </div>
                    ${item.detail ? `<p>${escapeHtml(item.detail)}</p>` : ''}
                    <div class="gactivity__meta">
                        <time datetime="${escapeHtml(item.updatedAt || '')}">${dateTime(item.updatedAt)}</time>
                        ${progress}${scheduled}${evidence}
                    </div>
                    ${item.type === 'workflow' ? renderWorkflow(item) : ''}
                </div>
            </article>`;
    }

    function renderWorkflow(item) {
        const controls = [];
        if (item.requiresConfirmation) controls.push(actionButton(item.id, 'authorize', 'Confirmar paso', true));
        if (item.canPause) controls.push(actionButton(item.id, 'pause', 'Pausar'));
        if (item.canResume) controls.push(actionButton(item.id, 'resume', 'Reanudar', true));
        if (item.canRetry) controls.push(actionButton(item.id, 'retry', item.retryRequiresConfirmation ? 'Revisar y confirmar reintento' : 'Reintentar', true, item.retryRequiresConfirmation));
        if (item.canCancel) controls.push(actionButton(item.id, 'cancel', 'Cancelar'));
        const steps = (item.steps || []).map((step, index) => `
            <li data-state="${escapeHtml(step.state)}">
                <span>${index + 1}</span>
                <div><strong>${escapeHtml(skillLabel(step.skill))}</strong><small>${escapeHtml(STATE[step.state] || readable(step.state))}${step.attempts ? ` · ${step.attempts} intento${step.attempts === 1 ? '' : 's'}` : ''}</small></div>
            </li>`).join('');
        return `
            <details class="gactivity__details">
                <summary>Ver secuencia y evidencia</summary>
                <ol>${steps}</ol>
                ${controls.length ? `<div class="gactivity__actions">${controls.join('')}</div>` : ''}
                ${item.traceId ? `<code title="Identificador de trazabilidad">${escapeHtml(item.traceId)}</code>` : ''}
            </details>`;
    }

    function actionButton(id, action, label, primary = false, retryWarning = false) {
        return `<button type="button" ${primary ? 'class="is-primary"' : ''} data-workflow-action="${action}" data-workflow-id="${escapeHtml(id)}" data-retry-warning="${retryWarning ? 'true' : 'false'}">${label}</button>`;
    }

    function renderError(host, error) {
        const list = host.querySelector('[data-activity-list]');
        if (list) list.innerHTML = `<div class="gactivity__empty gactivity__empty--error"><strong>No pude consultar la actividad.</strong><span>${escapeHtml(humanError(error))}</span></div>`;
    }
    function notice(host, text, error = false) {
        const el = host.querySelector('[data-activity-notice]');
        if (!el) return; el.textContent = text; el.classList.toggle('is-error', error);
    }
    function stateTone(state) {
        if (['COMPLETED', 'VERIFIED'].includes(state)) return 'success';
        if (['WAITING_CONFIRMATION', 'PAUSED', 'BLOCKED', 'RETRY_WAIT'].includes(state)) return 'warning';
        if (['FAILED', 'VERIFICATION_FAILED', 'EXPIRED', 'CANCELLED'].includes(state)) return 'danger';
        return 'active';
    }
    function skillLabel(name) {
        return ({
            'agenda.list': 'Consultar agenda', 'tasks.create': 'Crear tarea',
            'tasks.complete': 'Completar tarea', 'tasks.reopen': 'Reactivar tarea', 'tasks.cancel': 'Cancelar tarea',
            'tasks.update': 'Editar tarea', 'calendar.read': 'Consultar calendario',
            'calendar.create': 'Crear evento', 'calendar.update': 'Editar evento', 'calendar.cancel': 'Cancelar evento',
            'reminder.schedule': 'Programar recordatorio',
            'follow_up.schedule': 'Programar seguimiento', 'desktop.apps.open': 'Abrir aplicación',
            'desktop.files.open': 'Abrir archivo', 'desktop.screen.inspect': 'Inspeccionar pantalla',
            'mobile.media.next': 'Cambiar pista', 'mobile.media.play_pause': 'Controlar reproducción',
            'mobile.message.prepare': 'Preparar mensaje', 'mobile.message.send': 'Enviar mensaje',
            'mobile.open_app': 'Abrir aplicación móvil', 'mobile.reminder': 'Crear recordatorio móvil'
        })[name] || readable(name);
    }
    function humanError(error) {
        return ({ confirmation_required: 'Este paso requiere tu confirmación.', retry_confirmation_required: 'Revisa el posible efecto duplicado y confirma el reintento.', workflow_paused: 'El flujo está pausado.', activity_unavailable: 'El servicio no está disponible.' })[error?.code || error?.message] || 'Intenta actualizar de nuevo.';
    }
    function dateTime(value) {
        if (!value) return 'Sin fecha'; const date = new Date(value); if (Number.isNaN(date.getTime())) return 'Sin fecha';
        return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(date);
    }
    function timeOnly(value) { return new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }
    function number(value) { return Number(value) || 0; }
    function readable(value) { return String(value || '').replace(/[._-]+/g, ' ').replace(/^\w/, char => char.toUpperCase()); }
    function escapeHtml(value) { const div = document.createElement('div'); div.textContent = String(value ?? ''); return div.innerHTML; }

    root.GunterActivityPanel = { mount, refresh: () => { const host = document.querySelector('#gday-activity'); if (host) refresh(host); } };
})(window);
