/* =============================================
   GUNTER CORE - Decision Engine
   -------------------------------------------------
   Dado intent + entities + tiempos resueltos,
   construye un ActionPlan. Es función pura: no
   toca APIs ni storage.
   ============================================= */

(function () {
    const M = () => window.GunterCoreModels;

    function decide(state) {
        const intent = state.intent?.primary?.type || 'query';
        const plan = M().emptyActionPlan();
        const prefs = state.input.userContext.preferences || {};

        // Multi-intent: descomponer
        if (state.intent?.multiIntent && Array.isArray(state.intent.subIntents)) {
            plan.steps = state.intent.subIntents.flatMap((sub, i) => {
                const subState = { ...state, intent: sub };
                const subPlan = decide(subState);
                return subPlan.steps.map(s => ({ ...s, dependsOn: i > 0 ? [state.intent.subIntents[i - 1]?.primary?.type] : undefined }));
            });
            plan.needsConfirmation = plan.steps.some(s => s.type === 'ask_user') || prefs.confirmationMode === 'always';
            plan.confirmationPrompt = formatConfirmation(plan);
            return plan;
        }

        // Si faltan entidades obligatorias → ask_user
        if (state.entities?.missing?.length) {
            plan.steps.push({
                id: M().newId('step'),
                type: 'ask_user',
                reversible: true,
                payload: {
                    missing: state.entities.missing,
                    question: buildMissingQuestion(intent, state.entities.missing)
                }
            });
            plan.needsConfirmation = false; // la pregunta es la interacción
            return plan;
        }

        // Si alguno de los tiempos es ambiguo → ask_user
        const ambiguous = (state.resolvedTimes || []).find(t => t.ambiguity);
        if (ambiguous) {
            plan.steps.push({
                id: M().newId('step'),
                type: 'ask_user',
                reversible: true,
                payload: {
                    ambiguity: ambiguous.ambiguity,
                    question: `${ambiguous.ambiguity.reason} (${ambiguous.ambiguity.options.join(' · ')})`
                }
            });
            return plan;
        }

        // Construir steps según intent
        switch (intent) {
            case 'task':
                plan.steps.push(makeCreateTask(state));
                break;
            case 'reminder':
                plan.steps.push(makeCreateReminder(state));
                break;
            case 'meeting':
                plan.steps.push(makeCreateEvent(state));
                break;
            case 'note':
                plan.steps.push({
                    id: M().newId('step'),
                    type: 'create_task',
                    reversible: true,
                    payload: {
                        title: state.entities?.title?.value || state.input.text.slice(0, 60),
                        notes: state.input.text,
                        tags: state.entities?.tags || [],
                        priority: 'low',
                        source: 'note'
                    }
                });
                break;
            case 'document_analysis':
                plan.steps.push({
                    id: M().newId('step'),
                    type: 'generate_document',
                    reversible: true,
                    payload: {
                        source: 'chat',
                        text: state.input.text,
                        analysisTypes: ['ideas']
                    }
                });
                break;
            case 'cancel':
                plan.steps.push({
                    id: M().newId('step'),
                    type: 'suggest',
                    reversible: true,
                    payload: {
                        message: 'Para cancelar algo dime qué tarea o evento (puedes decir "cancela la reunión con Juan").',
                        needsMoreInfo: true
                    }
                });
                break;
            case 'modify':
                plan.steps.push({
                    id: M().newId('step'),
                    type: 'suggest',
                    reversible: true,
                    payload: {
                        message: 'Dime qué tarea o evento modificar y cómo. Ejemplo: "mueve la reunión con Juan al jueves".'
                    }
                });
                break;
            case 'greeting':
                plan.steps.push({
                    id: M().newId('step'),
                    type: 'suggest',
                    reversible: true,
                    payload: { message: greetingFor(state.input.userContext) }
                });
                break;
            case 'query':
            default:
                plan.steps.push({
                    id: M().newId('step'),
                    type: 'suggest',
                    reversible: true,
                    payload: { message: null, answerWithLlm: true, question: state.input.text }
                });
                break;
        }

        // Decidir confirmación
        const hasDestructive = plan.steps.some(s => M().isDestructive(s.type));
        if (prefs.confirmationMode === 'always') plan.needsConfirmation = true;
        else if (prefs.confirmationMode === 'never') plan.needsConfirmation = false;
        else plan.needsConfirmation = hasDestructive || state.intent.primary.confidence < 0.65;

        if (plan.needsConfirmation) {
            plan.confirmationPrompt = formatConfirmation(plan);
        }

        plan.estimatedSideEffects = plan.steps
            .filter(s => s.type.startsWith('create_') || s.type === 'send_to_calendar')
            .map(s => ({ kind: s.type, target: 'local' }));

        return plan;
    }

    // ---------- Step builders ----------
    function makeCreateTask(state) {
        const e = state.entities || {};
        const time = state.resolvedTimes?.[0];
        return {
            id: M().newId('step'),
            type: 'create_task',
            reversible: true,
            payload: {
                title: e.title?.value || 'Tarea sin título',
                notes: e.notes,
                dueAt: time?.iso || null,
                priority: e.priority || 'normal',
                projectId: e.projectRef?.matchedProjectId || state.input.userContext.currentProject?.id,
                projectName: e.projectRef?.name,
                people: (e.people || []).map(p => p.name),
                tags: e.tags || []
            }
        };
    }

    function makeCreateReminder(state) {
        const e = state.entities || {};
        const time = state.resolvedTimes?.[0];
        return {
            id: M().newId('step'),
            type: 'create_reminder',
            reversible: true,
            payload: {
                title: e.title?.value || 'Recordatorio',
                fireAt: time?.iso || null,
                priority: e.priority || 'normal',
                people: (e.people || []).map(p => p.name),
                projectId: e.projectRef?.matchedProjectId,
                tags: e.tags || []
            }
        };
    }

    function makeCreateEvent(state) {
        const e = state.entities || {};
        const time = state.resolvedTimes?.[0];
        const text = (state.input.text || '').toLowerCase();

        // Infer endAt if duration is mentioned ("por 1 hora", "de 30 min")
        let endAt = time?.end || null;
        if (!endAt && time?.iso && window.GunterDateService) {
            endAt = window.GunterDateService.inferEndAt(time.iso, { fromText: text });
        }

        // "en google", "en mi calendar", "agéndalo en calendar" → push to Google
        // Gated by premium flag googleCalendarSync + natural-language flag
        const hasNaturalLangFlag = !window.PremiumFeaturesService
            || window.PremiumFeaturesService.isEnabled('googleCalendarNaturalLanguage');
        const hasSyncFlag = !window.PremiumFeaturesService
            || window.PremiumFeaturesService.isEnabled('googleCalendarSync');
        const mentionsGoogle = /\b(google|calendar|mi agenda|calendario)\b/.test(text);
        const wantsGoogle = hasSyncFlag && (
            (hasNaturalLangFlag && mentionsGoogle)
            || state.input.userContext?.preferences?.autoPushToGoogle === true
        );

        return {
            id: M().newId('step'),
            type: 'create_event',
            reversible: true,
            payload: {
                title: e.title?.value || 'Reunión',
                startAt: time?.iso || null,
                endAt,
                kind: time?.kind || 'instant',
                rrule: time?.rrule || null,
                location: e.location?.value,
                attendees: (e.people || []).map(p => p.name),
                priority: e.priority || 'normal',
                projectId: e.projectRef?.matchedProjectId,
                tags: e.tags || [],
                pushToGoogle: wantsGoogle
            }
        };
    }

    // ---------- Helpers ----------
    function buildMissingQuestion(intent, missing) {
        const labels = { title: 'el título', datetimeExpr: 'una fecha/hora', people: 'las personas' };
        const listed = missing.map(m => labels[m] || m).join(' y ');
        return `Me falta ${listed} para crear ${intentLabel(intent)}.`;
    }

    function intentLabel(intent) {
        return ({
            task: 'la tarea',
            reminder: 'el recordatorio',
            meeting: 'la reunión',
            note: 'la nota'
        })[intent] || 'esto';
    }

    function formatConfirmation(plan) {
        const parts = plan.steps.map(s => {
            const p = s.payload || {};
            switch (s.type) {
                case 'create_task': return `crear tarea "${p.title}"${p.dueAt ? ` para ${humanDate(p.dueAt)}` : ''}`;
                case 'create_reminder': return `recordarte "${p.title}" el ${humanDate(p.fireAt)}`;
                case 'create_event': return `agendar "${p.title}" el ${humanDate(p.startAt)}`;
                case 'delete_task': return `eliminar la tarea "${p.title}"`;
                case 'delete_event': return `cancelar el evento "${p.title}"`;
                case 'generate_document': return 'analizar el documento';
                default: return s.type;
            }
        });
        return `¿Confirmas que quieres ${parts.join(' y ')}?`;
    }

    function humanDate(iso) {
        if (!iso) return 'una fecha sin definir';
        try {
            const d = new Date(iso);
            return d.toLocaleString('es-MX', { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        } catch { return iso; }
    }

    function greetingFor(ctx) {
        const h = new Date(ctx.now).getHours();
        const period = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
        return `${period}. ¿Qué quieres hacer hoy? Puedes pedirme crear tareas, recordatorios o agendar reuniones.`;
    }

    function explainDecision(plan) {
        if (plan.needsConfirmation) return 'Pide confirmación por ambigüedad o acción sensible.';
        if (plan.steps.some(s => s.type === 'ask_user')) return 'Faltan datos para ejecutar.';
        return 'Ejecución directa.';
    }

    /**
     * Build an ActionPlan from an extracted document (receipt/invoice).
     * Always asks confirmation (documents can have OCR errors).
     */
    function planFromDocument(extracted, documentBlob) {
        if (!window.GunterDocumentService) {
            throw new Error('DocumentService no disponible');
        }
        const suggested = window.GunterDocumentService.buildSuggestedTask(extracted);

        const lowConfidence = (extracted.confidence?.overall ?? 1) < 0.65
            || (extracted.warnings || []).length > 0;

        const plan = M().emptyActionPlan();
        plan.steps.push({
            id: M().newId('step'),
            type: 'create_payment_task',
            reversible: true,
            payload: {
                taskPayload: {
                    title: suggested.title,
                    notes: suggested.notes,
                    dueAt: suggested.dueAt,
                    priority: suggested.priority,
                    tags: suggested.tags,
                    people: suggested.people,
                    source: suggested.source,
                    meta: suggested.meta
                },
                reminderPayload: suggested.reminder,
                documentBlob,
                extracted
            }
        });
        plan.needsConfirmation = true;
        plan.confirmationPrompt = window.GunterDocumentService.formatConfirmation(extracted, suggested);
        plan.estimatedSideEffects = [
            { kind: 'task', target: 'local' },
            ...(suggested.reminder ? [{ kind: 'reminder', target: 'local' }] : []),
            { kind: 'document', target: 'local-idb' }
        ];
        if (lowConfidence) {
            plan.estimatedSideEffects.push({ kind: 'warning', detail: 'low_confidence' });
        }
        return plan;
    }

    window.GunterDecisionEngine = { decide, formatConfirmation, explainDecision, planFromDocument };
})();
