/* Unified, user-scoped operational history for the Gunter Day surface. */
const workflows = require('./workflows');
const brain = require('./brain');
const nodes = require('./nodes');
const userContext = require('../user-context');

function list(userId, { limit = 60, state = null } = {}) {
    const maximum = Math.max(1, Math.min(Number(limit) || 60, 200));
    const items = [];

    for (const flow of workflows.list({ userId, limit: maximum })) {
        items.push({
            id: flow.workflowId, type: 'workflow', title: flow.title, detail: flow.objective,
            state: flow.status, updatedAt: flow.updatedAt, createdAt: flow.createdAt, traceId: flow.traceId,
            progress: { current: Math.min(flow.currentStepIndex + 1, flow.steps.length), total: flow.steps.length, verified: flow.steps.filter(step => step.state === 'VERIFIED').length },
            currentSkill: flow.steps[flow.currentStepIndex]?.skill || null,
            retryRequiresConfirmation: flow.steps[flow.currentStepIndex]?.state === 'OUTCOME_UNKNOWN',
            requiresConfirmation: flow.status === 'WAITING_CONFIRMATION',
            canPause: ['READY', 'RUNNING', 'WAITING_CONFIRMATION', 'BLOCKED'].includes(flow.status),
            canResume: flow.status === 'PAUSED', canCancel: !workflows.TERMINAL.has(flow.status),
            canRetry: flow.status === 'BLOCKED', evidenceCount: flow.evidence.length,
            steps: flow.steps.map(step => ({ stepId: step.stepId, skill: step.skill, state: step.state, attempts: step.attempts, verification: step.verification }))
        });
    }

    for (const run of brain.list({ userId, limit: maximum })) {
        items.push({
            id: run.taskId, type: 'brain', title: run.intent || run.skill || 'Acción de Gunter',
            detail: run.skill || 'Razonamiento', state: String(run.state || '').toUpperCase(),
            updatedAt: run.updatedAt, createdAt: run.createdAt, traceId: run.traceId,
            evidenceCount: run.evidence?.length || 0
        });
    }

    for (const command of nodes.commandList({ userId, limit: maximum })) {
        items.push({
            id: command.id, type: 'command', title: labelSkill(command.skill), detail: command.skill,
            state: command.state, updatedAt: command.completedAt || command.receivedAt || command.requestedAt,
            createdAt: command.requestedAt, traceId: command.traceId,
            evidenceCount: command.evidence ? 1 : 0, nodeId: command.nodeId
        });
    }

    try {
        const jobs = userContext.runAs(userId, () => require('../jobs').list({ limit: maximum }));
        for (const job of jobs) {
            items.push({
                id: job.id, type: 'job', title: job.title, detail: job.type === 'follow_up' ? 'Seguimiento programado' : 'Recordatorio programado',
                state: String(job.status || '').toUpperCase(), updatedAt: job.updatedAt || job.createdAt,
                createdAt: job.createdAt, scheduledAt: job.runAt, traceId: null,
                evidenceCount: job.result ? 1 : 0
            });
        }
    } catch { /* Jobs are optional during isolated module tests. */ }

    const filtered = state ? items.filter(item => item.state === String(state).toUpperCase()) : items;
    const sorted = filtered.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))).slice(0, maximum);
    return { items: sorted, stats: summarize(items) };
}

function summarize(items) {
    const activeStates = new Set(['READY', 'RUNNING', 'WAITING_CONFIRMATION', 'PAUSED', 'BLOCKED', 'SCHEDULED', 'RETRY_WAIT', 'STARTED', 'AUTHORIZED']);
    const failureStates = new Set(['FAILED', 'VERIFICATION_FAILED', 'OUTCOME_UNKNOWN', 'EXPIRED']);
    return {
        total: items.length,
        active: items.filter(item => activeStates.has(item.state)).length,
        needsAttention: items.filter(item => item.state === 'WAITING_CONFIRMATION' || item.state === 'BLOCKED' || failureStates.has(item.state)).length,
        verified: items.filter(item => item.state === 'VERIFIED' || item.state === 'COMPLETED').length
    };
}

function labelSkill(name) {
    return ({
        'agenda.list': 'Consultar agenda', 'tasks.create': 'Crear tarea', 'calendar.read': 'Consultar calendario',
        'calendar.create': 'Crear evento', 'calendar.update': 'Editar evento', 'calendar.cancel': 'Cancelar evento',
        'reminder.schedule': 'Programar recordatorio',
        'follow_up.schedule': 'Programar seguimiento', 'desktop.apps.open': 'Abrir aplicación',
        'procedure.execute': 'Ejecutar ruta aprendida',
        'desktop.files.open': 'Abrir archivo', 'desktop.files.list': 'Listar carpeta', 'desktop.files.search': 'Buscar archivos',
        'desktop.apps.discover': 'Descubrir programas', 'desktop.screen.inspect': 'Inspeccionar pantalla',
        'desktop.media.play_pause': 'Reproducir o pausar', 'desktop.media.next': 'Siguiente pista',
        'desktop.media.previous': 'Pista anterior', 'desktop.media.stop': 'Detener reproducción',
        'desktop.media.volume_up': 'Subir volumen', 'desktop.media.volume_down': 'Bajar volumen',
        'desktop.media.mute': 'Silenciar audio', 'desktop.ui.inspect': 'Revisar controles de una aplicación',
        'desktop.ui.capture_target': 'Capturar control señalado',
        'desktop.ui.focus': 'Enfocar aplicación', 'desktop.ui.click': 'Pulsar control de una aplicación',
        'desktop.ui.type': 'Escribir en una aplicación', 'desktop.ui.wait': 'Esperar un control de una aplicación',
        'desktop.ui.scroll': 'Desplazar una aplicación', 'desktop.ui.hotkey': 'Usar un atajo de teclado',
        'desktop.ui.select_file': 'Seleccionar un archivo en una aplicación',
        'mobile.media.next': 'Siguiente pista', 'mobile.media.play_pause': 'Controlar reproducción',
        'mobile.message.prepare': 'Preparar mensaje', 'mobile.message.send': 'Enviar mensaje',
        'mobile.open_app': 'Abrir app móvil', 'mobile.reminder': 'Crear recordatorio móvil'
    })[name] || name || 'Acción de Gunter';
}

module.exports = { list, summarize };
