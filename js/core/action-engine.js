/* =============================================
   GUNTER CORE - Action Engine
   -------------------------------------------------
   Único lugar del pipeline con side effects reales.
   Despacha cada ActionStep a su service correspondiente.
   Devuelve ExecutionResult con la respuesta de UI
   que el controller renderizará.
   ============================================= */

(function () {
    const LOG_KEY = 'gunter_executions_log';

    function readLog() {
        try { return JSON.parse(localStorage.getItem(LOG_KEY) || '{}'); } catch { return {}; }
    }
    function writeLog(obj) {
        try { localStorage.setItem(LOG_KEY, JSON.stringify(obj)); } catch {}
    }

    async function execute(plan, confirmation, userContext) {
        const result = {
            executed: [],
            failed: [],
            pending: [],
            sideEffects: [],
            uiResponse: { speech: '', animation: 'default', panels: [] }
        };

        const hasEventSteps = plan.steps.some(step => isEventStep(step.type));
        // Las preferencias del plan nunca omiten la confirmación de eventos.
        if ((plan.needsConfirmation && !confirmation) ||
            (hasEventSteps && confirmation?.accepted !== true && confirmation?.accepted !== false)) {
            result.pending = plan.steps.map(s => s.id);
            result.uiResponse = {
                speech: plan.confirmationPrompt || '¿Confirmas?',
                animation: 'think',
                awaitingConfirmation: true,
                plan
            };
            return result;
        }
        // Usuario rechazó
        if ((plan.needsConfirmation || hasEventSteps) && confirmation?.accepted === false) {
            result.uiResponse = { speech: 'Vale, no lo hago.', animation: 'nod', panels: [] };
            return result;
        }

        const log = readLog();
        for (const step of plan.steps) {
            const startedAt = performance.now();
            try {
                const ownerId = isEventStep(step.type) ? eventOwnerId() : null;
                const logKey = ownerId ? `event:${encodeURIComponent(ownerId)}:${encodeURIComponent(step.id)}` : step.id;
                const cached = log[logKey];
                if (ownerId && !cached && Object.prototype.hasOwnProperty.call(log, step.id)) {
                    // Unscoped legacy records cannot establish which account
                    // approved this step. Do not expose or replay their payload.
                    throw new Error('Este paso tiene un registro previo sin cuenta verificada. Crea y confirma un nuevo plan.');
                }
                if (cached) {
                    if (ownerId && (cached.ownerId !== ownerId || cached.resultRef?.ownerId !== ownerId)) {
                        throw new Error('El registro de este paso no pertenece a tu cuenta. Crea y confirma un nuevo plan.');
                    }
                    result.executed.push({ stepId: step.id,
                        resultRef: ownerId ? cached.resultRef : cached, skipped: true });
                    continue;
                }
                const res = await dispatch(step, userContext, result);
                const durationMs = Math.round(performance.now() - startedAt);
                log[logKey] = { at: new Date().toISOString(), resultRef: res,
                    ...(ownerId ? { ownerId } : {}) };
                result.executed.push({ stepId: step.id, resultRef: res, durationMs });
            } catch (err) {
                result.failed.push({ stepId: step.id, error: err.message || String(err), retriable: true });
            }
        }
        writeLog(log);

        composeUiResponse(result, plan, userContext);
        return result;
    }

    function isEventStep(type) {
        return ['create_event', 'update_event', 'delete_event'].includes(type);
    }

    async function dispatch(step, userContext, accResult) {
        const p = step.payload || {};
        switch (step.type) {
            case 'create_task': {
                const s = window.GunterTasksService;
                if (!s) throw new Error('TasksService no disponible');
                const created = await s.create({ ...p, ownerId: userContext.userId });
                accResult.sideEffects.push({ kind: 'task_created', id: created.id });
                return created;
            }
            case 'create_payment_task': {
                if (!window.GunterTasksService) throw new Error('TasksService no disponible');
                const { taskPayload, reminderPayload, documentBlob, extracted } = p;

                // 1) Save original blob in documents DB if present
                let documentId = null;
                if (documentBlob && extracted && window.GunterDocumentService) {
                    const saved = await window.GunterDocumentService.saveOriginal(extracted, documentBlob);
                    documentId = saved.documentId;
                }
                // inject documentId into task.meta
                const toCreate = {
                    ...taskPayload,
                    ownerId: userContext.userId,
                    meta: { ...(taskPayload.meta || {}), documentId }
                };
                const task = await window.GunterTasksService.create(toCreate);
                accResult.sideEffects.push({ kind: 'task_created', id: task.id });

                // 2) Link back document → task
                if (documentId && window.GunterDocumentService) {
                    await window.GunterDocumentService.linkTask(documentId, task.id);
                }

                // 3) Schedule reminder one day before if applicable
                let reminderId = null;
                if (reminderPayload && reminderPayload.fireAt && window.GunterNotificationsService) {
                    const rem = await window.GunterNotificationsService.schedule({
                        title: reminderPayload.title,
                        fireAt: reminderPayload.fireAt,
                        priority: taskPayload.priority || 'normal',
                        meta: { taskId: task.id, documentId }
                    });
                    reminderId = rem.id;
                    accResult.sideEffects.push({ kind: 'reminder_scheduled', id: rem.id });
                }
                return { task, documentId, reminderId };
            }
            case 'update_task':
                return await window.GunterTasksService.update(p.id, p.patch);
            case 'delete_task':
                return await window.GunterTasksService.remove(p.id);
            case 'create_event': {
                const s = window.GunterEventsService;
                if (!s) throw new Error('EventsService no disponible');
                const ownerId = eventOwnerId();
                const created = await s.create({ ...p, ownerId });
                accResult.sideEffects.push({ kind: 'event_created', id: created.id });
                return created;
            }
            case 'update_event':
            case 'delete_event': {
                const ownerId = eventOwnerId();
                await mutableLocalEvent(p.id, ownerId, p.expected);
                const patch = step.type === 'delete_event'
                    ? { status: 'cancelled', cancelledAt: new Date().toISOString() }
                    : p.patch;
                return await window.GunterEventsService.update(p.id, patch, {
                    ownerId, statuses: ['scheduled'], expected: p.expected, skipSync: true
                });
            }
            case 'create_reminder': {
                const s = window.GunterNotificationsService;
                if (!s) throw new Error('NotificationsService no disponible');
                const created = await s.schedule({
                    title: p.title,
                    fireAt: p.fireAt,
                    priority: p.priority,
                    meta: { projectId: p.projectId, tags: p.tags, people: p.people }
                });
                accResult.sideEffects.push({ kind: 'reminder_scheduled', id: created.id });
                return created;
            }
            case 'generate_document': {
                if (!window.GunterAnalyses) throw new Error('Motor de análisis no disponible');
                const results = [];
                for (const type of p.analysisTypes || ['ideas']) {
                    const r = await window.GunterAnalyses.generate(type, {
                        projectInfo: { name: 'Conversación', market: 'N/A' },
                        transcription: p.text || '',
                        environment: userContext.currentProject?.environment || 'empresarial'
                    });
                    results.push(r);
                }
                return { analyses: results };
            }
            case 'ask_user':
                // No side effect — signal to UI
                return { question: p.question, missing: p.missing, ambiguity: p.ambiguity };
            case 'suggest':
                if (p.answerWithLlm && p.question && window.GunterNlpLlm) {
                    const answer = await window.GunterNlpLlm.answerQuery(p.question, userContext);
                    return { message: answer };
                }
                return { message: p.message || '' };
            default:
                throw new Error(`Tipo de step no soportado: ${step.type}`);
        }
    }

    function eventOwnerId() {
        const auth = window.GunterAuth;
        const trusted = auth?.canAccessLocalData?.() ?? auth?.isVerified?.();
        const ownerId = trusted && auth?.getUser?.()?.id;
        if (!ownerId) throw new Error('Verifica tu sesión para cambiar tu agenda.');
        return ownerId;
    }

    async function mutableLocalEvent(id, ownerId, expected) {
        if (!expected || typeof expected !== 'object' || Array.isArray(expected) ||
            !['title', 'startAt', 'endAt', 'status', 'updatedAt', 'rrule', 'externalIds']
                .every(key => Object.prototype.hasOwnProperty.call(expected, key))) {
            throw new Error('Selecciona el evento y confirma sus datos actuales antes de cambiarlo.');
        }
        const events = await window.GunterEventsService.list({ ownerId, includeCancelled: true });
        const event = events.find(item => item.id === id && item.ownerId === ownerId);
        if (!event || (event.status || 'scheduled') !== 'scheduled') {
            throw new Error('El evento ya no está disponible en tu agenda.');
        }
        if (event.rrule || event.kind === 'recurring' || Object.values(event.externalIds || {}).some(Boolean) ||
            (event.syncStatus && event.syncStatus !== 'local')) {
            throw new Error('Este flujo solo puede cambiar eventos locales sin recurrencia ni vínculos externos.');
        }
        return event;
    }

    function composeUiResponse(result, plan, userContext) {
        const parts = [];
        let animation = 'default';
        const panels = [];

        for (const ex of result.executed) {
            const step = plan.steps.find(s => s.id === ex.stepId);
            if (!step) continue;
            const p = step.payload || {};
            const r = ex.resultRef || {};

            switch (step.type) {
                case 'create_task':
                    parts.push(`✅ Tarea creada: "${p.title}"${p.dueAt ? ` · ${humanDate(p.dueAt)}` : ''}`);
                    animation = 'nod';
                    panels.push({ type: 'tasks-updated' });
                    break;
                case 'create_payment_task': {
                    const tp = p.taskPayload || {};
                    const parts2 = [`💳 Pago agendado: ${tp.title}`];
                    if (tp.dueAt) parts2.push(`vence ${humanDate(tp.dueAt)}`);
                    if (r?.reminderId) parts2.push('recordatorio listo 1 día antes');
                    parts.push(parts2.join(' · '));
                    animation = 'applaud';
                    panels.push({ type: 'tasks-updated' });
                    panels.push({ type: 'reminders-updated' });
                    panels.push({ type: 'documents-updated' });
                    break;
                }
                case 'create_event': {
                    const inGoogle = r?.externalIds?.google || r?.syncStatus === 'synced';
                    parts.push(`📅 Evento agendado: "${r.title || p.title}" · ${humanDate(r.startAt || p.startAt)}${inGoogle ? ' · sincronizado con Google Calendar' : (p.pushToGoogle ? ' · se sincroniza cuando reconectes' : '')}`);
                    animation = 'applaud';
                    panels.push({ type: 'events-updated' });
                    break;
                }
                case 'update_event':
                    parts.push(`📅 Evento actualizado: "${r.title || p.title || ''}" · ${humanDate(r.startAt)} · agenda local`);
                    animation = 'nod';
                    panels.push({ type: 'events-updated' });
                    break;
                case 'delete_event':
                    parts.push('📅 Evento cancelado en tu agenda local.');
                    animation = 'nod';
                    panels.push({ type: 'events-updated' });
                    break;
                case 'create_reminder':
                    parts.push(`⏰ Te recuerdo "${p.title}" el ${humanDate(p.fireAt)}`);
                    animation = 'nod';
                    panels.push({ type: 'reminders-updated' });
                    break;
                case 'generate_document':
                    parts.push(`🧠 Analicé el documento. ${r.analyses?.length || 0} análisis generados.`);
                    animation = 'idea';
                    break;
                case 'ask_user':
                    parts.push(r.question || '¿Puedes darme más detalles?');
                    animation = 'think';
                    break;
                case 'suggest':
                    parts.push(r.message || p.message || '');
                    if (/dato curioso|sab[ií]as que/i.test(r.message || '')) animation = 'idea';
                    break;
                case 'delete_task':
                    parts.push('🗑 Eliminado.');
                    animation = 'shake';
                    break;
            }
        }
        for (const f of result.failed) {
            parts.push(`⚠️ Falló: ${f.error}`);
            animation = 'alert';
        }

        result.uiResponse = {
            speech: parts.filter(Boolean).join(' · ') || 'Listo.',
            animation,
            panels
        };
    }

    function humanDate(iso) {
        if (!iso) return 'sin fecha';
        try {
            return new Date(iso).toLocaleString('es-MX', {
                weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
            });
        } catch { return iso; }
    }

    async function dryRun(plan) {
        return { preview: plan.steps.map(s => ({ id: s.id, type: s.type, payload: s.payload })) };
    }

    window.GunterActionEngine = { execute, dryRun };
})();
