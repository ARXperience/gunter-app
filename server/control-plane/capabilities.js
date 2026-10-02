/* Canonical functional map: 44 product capabilities + four mandatory governance matrices. */
const flags = require('./feature-flags');
const entitlements = require('./entitlements');

const SURFACES = Object.freeze(['WEB', 'DESKTOP', 'ANDROID', 'IOS']);
const GOVERNANCE = Object.freeze([
    { id: 'F1', title: 'Matriz de riesgo, autonomía, confirmación y verificación' },
    { id: 'F2', title: 'Matriz de soporte Web / Desktop / Mobile' },
    { id: 'F3', title: 'Matriz de estados y respuesta esperada' },
    { id: 'F4', title: 'Flujos end-to-end con trazabilidad' }
]);

const DEFINITIONS = Object.freeze([
    cap('A1', 'Gunter Now / Centro de mando', 'gunter.now', 'active', ['WEB'], 'partial', 'day.html'),
    cap('A2', 'Chat contextual', 'gunter.chat', 'active', ['WEB'], 'partial', 'day.html#chat'),
    cap('A3', 'Voz continua y conversación natural', 'gunter.voice', 'active', ['WEB'], 'partial', 'index.html'),
    cap('A4', 'Tareas y recordatorios', 'gunter.tasks', 'active', ['WEB'], 'full', 'day.html#tasks'),
    cap('A5', 'Calendario y agenda', 'gunter.calendar', 'active', ['WEB'], 'partial', 'day.html#events'),
    cap('A6', 'Notificaciones y proactividad', 'automation.proactive', 'active', ['WEB'], 'partial', 'day.html'),
    cap('A7', 'Reuniones y Meeting Copilot', 'gunter.meetings', 'partial', ['WEB'], 'partial', 'dashboard.html', 'Falta transcripción de audio y diarización conectadas a un proveedor.'),
    cap('A8', 'Documentos, archivos y búsqueda personal', 'gunter.documents', 'partial', ['WEB'], 'partial', 'day.html#documents', 'La búsqueda web existe; los conectores y la indexación semántica son progresivos.'),
    cap('A9', 'Universal Inbox y comunicaciones', 'gunter.inbox', 'partial', ['WEB'], 'partial', 'day.html#conversations', 'Requiere adaptadores externos para correo y mensajería real.'),
    cap('A10', 'Configuración integrada', 'gunter.settings', 'active', ['WEB'], 'full', 'config.html'),

    cap('B1', 'Context Gateway', 'core.context', 'active', ['WEB'], 'partial', null),
    cap('B2', 'Brain Core / Orquestador', 'core.brain', 'active', ['WEB'], 'partial', null),
    cap('B3', 'Skill Registry', 'core.skills', 'active', ['WEB'], 'partial', null),
    cap('B4', 'Policy, permisos y autonomía', 'core.policy', 'active', ['WEB'], 'full', null),
    cap('B5', 'Execution + Verification Engine', 'core.verify', 'active', ['WEB'], 'partial', null),
    cap('B6', 'Model Router', 'ai.cloud.standard', 'active', ['WEB'], 'no', null),
    cap('B7', 'Cortex: memoria gobernada', 'cortex.basic', 'active', ['WEB'], 'full', null),
    cap('B8', 'Knowledge Graph y búsqueda transversal', 'cortex.graph', 'protected', ['WEB'], 'full', 'config.html', 'Implementado en modo protegido; debe habilitarse por flag y plan.'),
    cap('B9', 'Mission Engine', 'automation.missions', 'protected', ['WEB'], 'partial', 'day.html', 'Implementado en modo protegido; pendiente de despliegue gradual.'),
    cap('B10', 'Commitment Tracker', 'automation.commitments', 'active', ['WEB'], 'full', 'day.html'),
    cap('B11', 'Procedure Learning / Teach Gunter', 'automation.procedures', 'active', ['WEB', 'DESKTOP', 'ANDROID', 'IOS'], 'partial', 'config.html', 'Web y PC permiten observar objetivos semánticos, simular y aprobar rutas supervisadas; móvil requiere su runtime nativo y permisos del sistema.'),
    cap('B12', 'Attention Engine y briefings', 'automation.proactive', 'active', ['WEB'], 'partial', 'day.html'),
    cap('B13', 'Error Learning', 'cortex.learning', 'protected', ['WEB'], 'full', 'config.html', 'Registra candidatos gobernados; nunca modifica seguridad o políticas automáticamente.'),
    cap('B14', 'Evolution Engine / Skill Forge', 'evolution.skill_forge', 'protected', ['WEB'], 'no', 'admin.html', 'Solo propuestas, evaluación y canary; despliegue automático desactivado.'),

    cap('C1', 'Gunter Node para PC', 'desktop.node', 'partial', ['DESKTOP'], 'full', 'config.html', 'El acompañante local ya puede emparejarse, reportar salud y ejecutar capacidades permitidas; falta empaquetado firmado.'),
    cap('C2', 'Percepción de pantalla', 'desktop.screen', 'native_required', ['DESKTOP'], 'partial', null, 'Requiere runtime nativo, permiso visible y evidencia verificable.'),
    cap('C3', 'Control de apps, archivos e interacción en PC', 'desktop.apps', 'partial', ['DESKTOP'], 'partial', 'config.html', 'Puede abrir programas, controlar multimedia y capturar controles accesibles para crear, simular y ejecutar rutas supervisadas; las modificaciones requieren confirmación.'),
    cap('C4', 'Browser Agent', 'browser.agent', 'protected', ['WEB', 'DESKTOP'], 'no', null, 'Desactivado hasta disponer de sandbox, política y verificación visual.'),
    cap('C5', 'Gunter Mobile Runtime', 'mobile.node', 'native_required', ['ANDROID', 'IOS'], 'full', null, 'Requiere aplicaciones móviles nativas y emparejamiento seguro.'),
    cap('C6', 'Control multimedia móvil', 'mobile.media', 'native_required', ['ANDROID', 'IOS'], 'partial', null, 'Depende de APIs y permisos del sistema operativo móvil.'),
    cap('C7', 'Mensajería móvil', 'mobile.messaging', 'native_required', ['ANDROID', 'IOS'], 'no', null, 'Depende de APIs del sistema; enviar siempre requiere autorización.'),
    cap('C8', 'Sensores y acciones móviles', 'mobile.location', 'native_required', ['ANDROID', 'IOS'], 'no', null, 'Ubicación y cámara requieren permisos de sesión y runtime móvil.'),
    cap('C9', 'Connection Manager, offline y sincronización', 'core.connection', 'partial', ['WEB', 'DESKTOP', 'ANDROID', 'IOS'], 'full', null, 'Web monitoriza y reintenta; la sincronización nativa depende de cada runtime.'),
    cap('C10', 'Integraciones externas', 'integrations.core', 'partial', ['WEB', 'DESKTOP'], 'partial', 'config.html', 'WhatsApp usa su bridge; Instagram y Messenger personales pueden conectarse mediante Beeper Desktop y Gunter Node.'),

    cap('D1', 'Membresías, Billing y cobro mensual', 'billing.recurring', 'external_required', ['WEB'], 'no', 'admin.html', 'El dominio de billing existe; falta un proveedor de pago y webhooks firmados.'),
    cap('D2', 'Entitlement Engine y licencia offline', 'core.entitlements', 'active', ['WEB', 'DESKTOP', 'ANDROID', 'IOS'], 'full', 'admin.html'),
    cap('D3', 'Device Registry y sesiones', 'admin.devices', 'active', ['WEB', 'DESKTOP', 'ANDROID', 'IOS'], 'partial', 'admin.html'),
    cap('D4', 'Admin Accounts & Subscription Console', 'admin.accounts', 'active', ['WEB'], 'no', 'admin.html'),
    cap('D5', 'Admin Operations Center', 'admin.operations', 'active', ['WEB'], 'no', 'admin.html'),
    cap('D6', 'Logs, traces y auditoría', 'core.observability', 'active', ['WEB', 'DESKTOP', 'ANDROID', 'IOS'], 'partial', 'admin.html'),
    cap('D7', 'Incidentes, alertas y desconexiones', 'admin.operations', 'active', ['WEB'], 'no', 'admin.html'),
    cap('D8', 'Feature Flags, releases y rollback', 'admin.releases', 'partial', ['WEB'], 'no', 'admin.html', 'Flags y canary están activos; el pipeline de releases necesita integración CI/CD.'),

    cap('E1', 'Seguridad y privacidad transversal', 'security.core', 'active', SURFACES, 'full', null),
    cap('E2', 'QA, pruebas y Definition of Done', 'quality.gate', 'active', SURFACES, 'partial', null)
]);

function cap(id, title, featureKey, implementation, surfaces, offline, route, blockedReason = null) {
    return { id, group: id[0], title, featureKey, implementation, surfaces, offline, route, blockedReason };
}

function catalog(userId, actor = {}) {
    const snapshot = entitlements.snapshot(userId);
    const items = DEFINITIONS.map(definition => {
        const flag = flags.evaluate(definition.featureKey, actor);
        const entitlement = snapshot.features[definition.featureKey] || { allowed: false, reason: 'not_in_plan' };
        const structuralBlock = ['native_required', 'external_required'].includes(definition.implementation);
        const enabled = !structuralBlock && flag.enabled && entitlement.allowed;
        let status = definition.implementation;
        if (!structuralBlock && !flag.enabled) status = 'protected';
        else if (!structuralBlock && !entitlement.allowed) status = 'plan_required';
        else if (enabled && definition.implementation === 'protected') status = 'active';
        return {
            ...definition,
            flagState: flag.state || 'off',
            entitled: entitlement.allowed,
            enabled,
            status,
            reason: definition.blockedReason || (!flag.enabled ? flag.reason : !entitlement.allowed ? entitlement.reason : null),
            support: Object.fromEntries(SURFACES.map(surface => [surface, definition.surfaces.includes(surface)]))
        };
    });
    const groups = Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map(group => [group, items.filter(item => item.group === group)]));
    return {
        version: '1.0.0', generatedAt: new Date().toISOString(), items, groups, governance: GOVERNANCE,
        stats: {
            total: items.length,
            enabled: items.filter(item => item.enabled).length,
            active: items.filter(item => item.status === 'active').length,
            partial: items.filter(item => item.status === 'partial').length,
            protected: items.filter(item => item.status === 'protected').length,
            nativeRequired: items.filter(item => item.status === 'native_required').length,
            externalRequired: items.filter(item => item.status === 'external_required').length,
            planRequired: items.filter(item => item.status === 'plan_required').length
        }
    };
}

module.exports = { SURFACES, GOVERNANCE, DEFINITIONS, catalog };
