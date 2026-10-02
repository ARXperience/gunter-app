/* =============================================
   GUNTER CORE - Natural Workflow Orchestrator
   -------------------------------------------------
   Convierte únicamente órdenes multipaso detectables en un plan
   allowlist. El usuario aprueba el plan completo antes de que el
   navegador reclame y ejecute el primer paso.
   ============================================= */
(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.GunterWorkflowOrchestrator = api.create();
})(typeof window !== 'undefined' ? window : null, function (root) {
    const PENDING_KEY = 'gunter_pending_workflow_v1';
    const PENDING_TTL_MS = 10 * 60 * 1000;
    const MAX_STEPS = 6;
    const ALLOWED = new Set(['agenda.list', 'tasks.create', 'calendar.create', 'reminder.schedule', 'follow_up.schedule']);

    function create(options = {}) {
        const runtime = options.root || root || {};
        const tools = options.tools || runtime.GunterAssistantTools;
        const control = options.control || runtime.GunterControlPlane;
        const memory = new Map();
        const storage = options.storage || safeStorage(runtime.sessionStorage, memory);
        const now = options.now || (() => Date.now());

        function state(next, reason, meta = {}) {
            try { runtime.GunterConversationState?.transition?.(next, { reason, ...meta }); } catch { /* optional */ }
        }
        function notify(detail) {
            if (!runtime.dispatchEvent || !runtime.CustomEvent) return;
            try { runtime.dispatchEvent(new runtime.CustomEvent('gunter-workflow', { detail })); } catch { /* optional */ }
        }
        function savePending(value) {
            if (!value) storage.removeItem(PENDING_KEY);
            else storage.setItem(PENDING_KEY, JSON.stringify({ ...value, createdAt: now() }));
        }
        function getPending() {
            try {
                const raw = storage.getItem(PENDING_KEY);
                if (!raw) return null;
                const value = JSON.parse(raw);
                if (!value?.workflowId || now() - Number(value.createdAt || 0) > PENDING_TTL_MS) {
                    savePending(null); return null;
                }
                return value;
            } catch { savePending(null); return null; }
        }

        async function dispatch(text) {
            const normalized = normalize(text);
            const pending = getPending();
            if (pending && isAffirmative(normalized)) return confirm(pending.workflowId, true);
            if (pending && isNegative(normalized)) return confirm(pending.workflowId, false);
            if (!isReady()) return { handled: false };
            return propose(text);
        }

        async function propose(text) {
            const clauses = splitClauses(text);
            const matches = clauses.map(clause => ({ clause, detected: tools.detect(clause) }))
                .filter(item => item.detected && ALLOWED.has(item.detected.toolId));
            if (matches.length < 2) return { handled: false };
            if (matches.length > MAX_STEPS) {
                return { handled: true, status: 'needs_input', reply: `Puedo coordinar hasta ${MAX_STEPS} pasos por plan. Divide esta solicitud en dos partes.` };
            }

            const prepared = [];
            for (const item of matches) {
                const step = await tools.prepareMatch(item.detected);
                const validation = await tools.validatePrepared(step);
                if (!validation.ok) return { handled: true, status: 'needs_input', reply: validation.reply };
                prepared.push(step);
            }

            const objective = clean(text, 500);
            const idempotencyKey = `web-plan:${now().toString(36)}:${shortHash(normalize(text))}`;
            let created;
            try {
                created = await control.createWorkflow({
                    title: workflowTitle(prepared), objective, idempotencyKey,
                    steps: prepared.map(item => ({ skill: item.toolId, input: item.args, autonomy: 'L3' }))
                });
            } catch (error) {
                return { handled: true, status: 'error', reply: `No pude guardar el plan de forma segura: ${humanError(error)}. No ejecuté ningún paso.` };
            }
            const workflow = created?.workflow;
            if (!workflow?.workflowId) return { handled: true, status: 'error', reply: 'No pude crear el plan. No ejecuté ningún paso.' };
            try {
                const paused = await control.workflowAction({ workflowId: workflow.workflowId, action: 'pause', reason: 'Esperando aprobación del plan' });
                created.workflow = paused.workflow || workflow;
            } catch (error) {
                await control.workflowAction({ workflowId: workflow.workflowId, action: 'cancel', reason: 'No se pudo pausar antes de la aprobación' }).catch(() => {});
                return { handled: true, status: 'error', reply: `No pude inmovilizar el plan antes de pedirte permiso: ${humanError(error)}. Lo cancelé sin ejecutar acciones.` };
            }

            savePending({ workflowId: workflow.workflowId, steps: prepared.map(item => ({ skill: item.toolId, input: item.args })) });
            state('awaiting_confirmation', 'workflow-plan-proposed', { workflowId: workflow.workflowId, steps: prepared.length });
            notify({ phase: 'proposed', workflowId: workflow.workflowId, steps: prepared.length });
            return {
                handled: true, intent: 'workflow.plan', status: 'awaiting_confirmation',
                requiresConfirmation: true, workflowId: workflow.workflowId,
                plan: prepared.map((item, index) => ({ index: index + 1, skill: item.toolId, input: item.args })),
                reply: formatProposal(prepared)
            };
        }

        async function confirm(workflowId, accepted) {
            if (!workflowId) return { handled: false };
            if (!accepted) {
                try { await control.workflowAction({ workflowId, action: 'cancel', reason: 'Plan rechazado por el usuario' }); }
                catch { /* already terminal or offline; no local action ran */ }
                savePending(null);
                state('idle', 'workflow-plan-rejected', { workflowId });
                notify({ phase: 'cancelled', workflowId });
                return { handled: true, intent: 'workflow.plan', status: 'cancelled', reply: 'Plan cancelado. No ejecuté ningún paso.' };
            }
            savePending(null);
            state('thinking', 'workflow-plan-approved', { workflowId });
            notify({ phase: 'approved', workflowId });
            return execute(workflowId);
        }

        async function execute(workflowId) {
            const replies = [];
            let workflow;
            try {
                const resumed = await control.workflowAction({ workflowId, action: 'resume' });
                workflow = resumed.workflow;
                for (let guard = 0; guard < MAX_STEPS + 2; guard += 1) {
                    if (!workflow) throw new Error('workflow_state_missing');
                    if (workflow.status === 'COMPLETED') break;
                    if (workflow.status === 'WAITING_CONFIRMATION') {
                        const authorized = await control.workflowAction({ workflowId, action: 'authorize', confirmed: true });
                        workflow = authorized.workflow;
                    }
                    if (workflow.status === 'BLOCKED' || workflow.status === 'FAILED' || workflow.status === 'CANCELLED') break;
                    if (workflow.status !== 'READY' && workflow.status !== 'RUNNING') throw new Error(`workflow_not_ready:${workflow.status}`);
                    const claimed = await control.claimWorkflowStep({ workflowId, executorId: 'web-assistant', leaseMs: 120000 });
                    const step = claimed.step;
                    workflow = claimed.workflow;
                    let local;
                    try {
                        local = await tools.executeWorkflowStep(step);
                    } catch (error) {
                        const reported = await control.submitWorkflowResult({
                            workflowId, stepId: step.stepId, leaseId: step.lease?.leaseId,
                            error: clean(error.message || error, 180), result: {}, evidence: {}
                        });
                        workflow = reported.workflow;
                        replies.push(`El paso ${step.index + 1} quedó bloqueado: ${error.message}`);
                        break;
                    }
                    const submitted = await control.submitWorkflowResult({
                        workflowId, stepId: step.stepId, leaseId: step.lease?.leaseId,
                        result: local.result, evidence: local.evidence,
                        evidenceRef: `web:${step.stepId}`
                    });
                    workflow = submitted.workflow;
                    replies.push(local.reply);
                }
            } catch (error) {
                state('error', 'workflow-execution-error', { workflowId, error: error.message });
                notify({ phase: 'error', workflowId, error: error.message });
                return {
                    handled: true, intent: 'workflow.execute', status: 'error', workflowId,
                    reply: `${replies.join('\n')}${replies.length ? '\n' : ''}El flujo se detuvo: ${humanError(error)}. Puedes revisarlo en Día → Actividad.`
                };
            }

            const complete = workflow?.status === 'COMPLETED';
            state(complete ? 'idle' : 'error', complete ? 'workflow-complete' : 'workflow-blocked', { workflowId, status: workflow?.status });
            notify({ phase: complete ? 'complete' : 'blocked', workflowId, status: workflow?.status });
            return {
                handled: true, intent: 'workflow.execute', status: complete ? 'complete' : 'blocked',
                workflowId, verified: complete, workflow,
                reply: complete
                    ? `Plan completado y verificado.\n${replies.map((line, index) => `${index + 1}. ${line}`).join('\n')}`
                    : `${replies.join('\n')}${replies.length ? '\n' : ''}El flujo necesita atención. Revísalo en Día → Actividad.`
            };
        }

        function isReady() {
            return !!(tools?.detect && tools?.prepareMatch && tools?.validatePrepared && tools?.executeWorkflowStep &&
                control?.createWorkflow && control?.workflowAction && control?.claimWorkflowStep && control?.submitWorkflowResult);
        }

        return { dispatch, propose, confirm, execute, getPending, clearPending: () => savePending(null), splitClauses, isReady };
    }

    function splitClauses(text) {
        return String(text || '')
            .replace(/\b(?:y\s+)?(?:luego|despu[eé]s|adem[aá]s|tambi[eé]n)\b/gi, '|')
            .replace(/\s+y\s+(?=(?:consulta|revisa|muestra|dime|crea|crear|agenda|ag[eé]ndame|programa|progr[aá]mame|recu[eé]rdame|av[ií]same|haz)\b)/gi, '|')
            .replace(/,\s*(?=(?:consulta|revisa|muestra|dime|crea|crear|agenda|ag[eé]ndame|programa|progr[aá]mame|recu[eé]rdame|av[ií]same|haz)\b)/gi, '|')
            .split('|').map(part => part.trim()).filter(Boolean);
    }
    function formatProposal(steps) {
        const lines = ['Te propongo este plan:'];
        steps.forEach((step, index) => lines.push(`${index + 1}. ${stepLabel(step.toolId, step.args)}`));
        lines.push('¿Apruebas que ejecute exactamente estos pasos?');
        return lines.join('\n');
    }
    function stepLabel(skill, input = {}) {
        if (skill === 'agenda.list') return `Consultar tu agenda ${input.scope === 'tomorrow' ? 'de mañana' : input.scope === 'upcoming' ? 'próxima' : 'de hoy'}`;
        if (skill === 'tasks.create') return `Crear la tarea “${input.title}”${input.dueAt ? ` para ${formatDate(input.dueAt)}` : ''}`;
        if (skill === 'calendar.create') return `Agendar “${input.title}” para ${formatDate(input.startAt)}`;
        if (skill === 'reminder.schedule') return `Programar el recordatorio “${input.title}” para ${formatDate(input.runAt)}`;
        if (skill === 'follow_up.schedule') return `Programar el seguimiento “${input.title}” para ${formatDate(input.runAt)}`;
        return skill;
    }
    function workflowTitle(steps) {
        const labels = steps.slice(0, 2).map(step => stepLabel(step.toolId, step.args).replace(/[“”]/g, ''));
        return clean(labels.join(' → '), 100) || 'Plan multipaso de Gunter';
    }
    function formatDate(value) {
        if (!value) return 'una fecha por definir';
        const date = new Date(value); if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(date);
    }
    function normalize(value) {
        return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[¿?¡!.,;:]/g, ' ').replace(/\s+/g, ' ').trim();
    }
    function isAffirmative(value) { return /^(si|confirmo|confirmado|apruebo|aprobado|hazlo|adelante|de acuerdo|procede|dale|listo)$/.test(value); }
    function isNegative(value) { return /^(no|cancela|cancelar|rechazo|no lo apruebo|mejor no|dejalo|olvidalo)$/.test(value); }
    function humanError(error) {
        const code = error?.code || error?.message || '';
        return ({
            workflow_paused: 'el flujo sigue pausado', confirmation_required: 'falta confirmación',
            workflow_terminal: 'el flujo ya terminó', step_outcome_unknown: 'el paso pudo haberse completado, pero no recibí evidencia. Revisa la aplicación o servicio antes de intentar repetirlo.'
        })[code] || 'no pude continuar de forma segura';
    }
    function clean(value, max) { return String(value || '').trim().replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').slice(0, max); }
    function shortHash(value) { let hash = 2166136261; for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619); return (hash >>> 0).toString(36); }
    function safeStorage(candidate, memory) {
        if (candidate?.getItem && candidate?.setItem && candidate?.removeItem) return candidate;
        return { getItem: key => memory.has(key) ? memory.get(key) : null, setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key) };
    }

    return { create, splitClauses, ALLOWED: [...ALLOWED] };
});
