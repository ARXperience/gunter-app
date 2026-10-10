/* =============================================
   GUNTER CORE - Pipeline Orchestrator
   -------------------------------------------------
   Une los 5 motores + logging. API pública:
     handleUserInput(text)
     handleConfirmation(pendingState, answer)
   ============================================= */

(function () {
    const { startStage, endStage, recordError, persist } = window.GunterTraceLogger;

    async function handleUserInput(text) {
        // Handle explicit memory commands before the context envelope/network,
        // trace logger and conversation history see the personal content.
        if (window.GunterPersonalMemory?.parseCommand?.(text)) {
            const state = window.GunterCoreModels.newPipelineState('[comando de memoria personal]', window.GunterContextProvider.build());
            const result = await window.GunterPersonalMemory.handleCommand(text);
            state.intent = { primary: { type: 'personal_memory', confidence: 1 },
                alternatives: [], multiIntent: false, method: 'explicit-personal-memory' };
            state.execution = { executed: [], failed: [], pending: [], sideEffects: [],
                uiResponse: { speech: result.reply, animation: 'nod', panels: [] } };
            return { state, awaitingConfirmation: false, response: state.execution.uiResponse };
        }
        const ctx = window.GunterContextProvider.enrich
            ? await window.GunterContextProvider.enrich(text, { channel: 'pipeline' })
            : window.GunterContextProvider.build();
        window.GunterContextProvider.pushConversationTurn('user', text);
        const state = window.GunterCoreModels.newPipelineState(text, ctx);

        try {
            if (window.GunterDiagnostics?.recognizes?.(text)) {
                const diagnostic = window.PremiumFeaturesService?.isEnabled?.('diagnosticsEnabled') === false
                    ? 'El diagnóstico está desactivado. Puedes habilitarlo en Configuración → Diagnóstico.'
                    : await window.GunterDiagnostics.answer(text);
                state.intent = { primary: { type: 'diagnostic', confidence: 1 }, alternatives: [], multiIntent: false, method: 'read-only-local' };
                state.execution = { executed: [], failed: [], pending: [], sideEffects: [],
                    uiResponse: { speech: diagnostic, animation: 'think', panels: [] } };
                window.GunterContextProvider.pushConversationTurn('assistant', diagnostic);
                return { state, awaitingConfirmation: false, response: state.execution.uiResponse };
            }
            // Los cambios/consultas de configuración deben funcionar por voz
            // igual que en el chat del companion, sin pasar por el clasificador.
            if (window.GunterActions?.dispatch) {
                const action = await window.GunterActions.dispatch(text);
                if (action?.reply) {
                    state.intent = {
                        primary: { type: 'settings', confidence: 1 }, alternatives: [],
                        multiIntent: false, method: 'settings-action-vocabulary'
                    };
                    state.execution = {
                        executed: action.intent === 'applied' ? [{ feature: action.feature, value: action.value }] : [],
                        failed: [], pending: [], sideEffects: [],
                        uiResponse: { speech: action.reply, animation: action.intent === 'applied' ? 'nod' : 'think', panels: [] }
                    };
                    window.GunterContextProvider.pushConversationTurn('assistant', action.reply);
                    persist(state);
                    return { state, awaitingConfirmation: !!action.requiresConfirmation, response: state.execution.uiResponse, action };
                }
            }

            // Los planes multipaso pasan primero por el coordinador durable.
            // Una propuesta no ejecuta efectos hasta que el usuario aprueba la secuencia completa.
            if (window.GunterWorkflowOrchestrator?.dispatch) {
                const workflowResult = await window.GunterWorkflowOrchestrator.dispatch(text);
                if (workflowResult?.handled) {
                    state.intent = {
                        primary: { type: 'workflow', confidence: 1 }, alternatives: [],
                        multiIntent: true, method: 'allowlist-workflow'
                    };
                    state.workflowId = workflowResult.workflowId || null;
                    state.plan = workflowResult.plan ? { type: 'workflow', workflowId: state.workflowId, steps: workflowResult.plan } : null;
                    state.execution = {
                        executed: workflowResult.status === 'complete' ? (workflowResult.workflow?.steps || []).map(step => ({ stepId: step.stepId })) : [],
                        failed: ['error', 'blocked'].includes(workflowResult.status) ? [{ reason: workflowResult.status }] : [],
                        pending: workflowResult.status === 'awaiting_confirmation' ? (workflowResult.plan || []).map(step => step.index) : [],
                        sideEffects: [],
                        uiResponse: {
                            speech: workflowResult.reply,
                            animation: workflowResult.status === 'complete' ? 'applaud' : workflowResult.status === 'awaiting_confirmation' ? 'think' : 'alert',
                            panels: [{ type: 'activity-updated' }],
                            awaitingConfirmation: workflowResult.status === 'awaiting_confirmation',
                            workflowId: state.workflowId
                        }
                    };
                    window.GunterContextProvider.pushConversationTurn('assistant', workflowResult.reply);
                    persist(state);
                    return { state, awaitingConfirmation: workflowResult.status === 'awaiting_confirmation', response: state.execution.uiResponse, workflow: workflowResult };
                }
            }

            // The main command bar uses the same verified tools as the floating chat.
            const tool = await window.GunterAssistantTools?.dispatch?.(text);
            const clarification = !tool?.handled ? window.GunterAssistantTools?.clarifyRequest?.(text) : null;
            if (tool?.handled || clarification) {
                const result = tool?.handled ? tool : clarification;
                state.assistantPending = result.requiresConfirmation ? window.GunterAssistantTools.getPending() : null;
                state.execution = {
                    executed: result.status === 'complete' ? [{ toolId: result.intent }] : [], failed: result.status === 'error' ? [{ reason: result.reply }] : [], pending: [], sideEffects: [],
                    uiResponse: { speech: result.reply, animation: result.status === 'complete' ? 'nod' : 'think', panels: [{ type: 'activity-updated' }], awaitingConfirmation: !!result.requiresConfirmation }
                };
                window.GunterContextProvider.pushConversationTurn('assistant', result.reply);
                persist(state);
                return { state, awaitingConfirmation: !!result.requiresConfirmation, response: state.execution.uiResponse };
            }

            // El reloj del dispositivo es la única fuente para fecha/hora actual.
            // Esta ruta es determinista, instantánea y no consume el LLM.
            const temporal = window.GunterTemporalContext?.answer?.(text, {
                now: ctx.now,
                timezone: ctx.timezone,
                locale: navigator.language || 'es-CO'
            });
            if (temporal) {
                state.intent = {
                    primary: { type: 'query', confidence: 1 },
                    alternatives: [], multiIntent: false, method: 'device-clock'
                };
                state.execution = {
                    executed: [], failed: [], pending: [], sideEffects: [],
                    uiResponse: { speech: temporal.reply, animation: 'nod', panels: [] },
                    temporal
                };
                window.GunterContextProvider.pushConversationTurn('assistant', temporal.reply);
                persist(state);
                return { state, awaitingConfirmation: false, response: state.execution.uiResponse };
            }

            // 1) Intent
            startStage(state, 'intent');
            state.intent = await window.GunterIntentEngine.classifyIntent(text, ctx);
            endStage(state, { intent: state.intent.primary, multi: state.intent.multiIntent });

            // 2) Entities
            startStage(state, 'entities');
            state.entities = await window.GunterEntityExtractor.extractEntities(text, state.intent, ctx);
            endStage(state, {
                hasTitle: !!state.entities.title,
                datetimes: state.entities.datetimeExpr?.length || 0,
                people: state.entities.people?.length || 0,
                missing: state.entities.missing || []
            });

            // 3) Time parsing
            startStage(state, 'time');
            state.resolvedTimes = await window.GunterTimeParser.parseMany(
                state.entities.datetimeExpr, ctx
            );
            endStage(state, { resolved: state.resolvedTimes.length });

            // 3.5) Premium intent shortcut (Sprint C)
            // Si el intent primario es uno de los premium del INTENT_MAP,
            // delegamos a GunterPremiumIntel y saltamos decision/action.
            // Las acciones premium responden con naturalResponse y NO modifican
            // tareas/eventos directamente — son consultas/análisis.
            const PREMIUM_INTENTS = window.GunterPremiumIntel?.INTENT_MAP || {};
            if (PREMIUM_INTENTS[state.intent.primary]) {
                startStage(state, 'premium_intel');
                const piResult = await window.GunterPremiumIntel.handlePremiumIntent(
                    state.intent.primary,
                    {
                        ...state.entities,
                        text: text,
                        // intentar resolver projectId desde entities.projectName si existe
                        projectName: state.entities.projectName || null
                    },
                    ctx
                );
                endStage(state, { success: piResult.success, action: PREMIUM_INTENTS[state.intent.primary].action });

                // Construir uiResponse compatible con el resto del pipeline
                state.execution = {
                    executed: [],
                    failed: piResult.success ? [] : [{ reason: piResult.warnings?.join(',') }],
                    pending: [],
                    sideEffects: [],
                    uiResponse: {
                        speech: piResult.naturalResponse || piResult.summary || 'Listo.',
                        animation: piResult.success ? 'nod' : 'thinking',
                        panels: piResult.data ? [{ kind: 'premium-intel', data: piResult.data }] : [],
                        awaitingConfirmation: !!piResult.requiresConfirmation,
                        confirmationQuestion: piResult.confirmationQuestion
                    }
                };

                const reply = state.execution.uiResponse.speech;
                if (reply) window.GunterContextProvider.pushConversationTurn('assistant', reply);
                persist(state);

                return {
                    state,
                    awaitingConfirmation: !!piResult.requiresConfirmation,
                    response: state.execution.uiResponse,
                    premium: { action: PREMIUM_INTENTS[state.intent.primary].action, raw: piResult }
                };
            }

            // 4) Decide
            startStage(state, 'decision');
            state.plan = window.GunterDecisionEngine.decide(state);
            endStage(state, {
                steps: state.plan.steps.length,
                needsConfirmation: state.plan.needsConfirmation
            });

            // 5) Execute (o pausar si confirmación)
            startStage(state, 'action');
            state.execution = await window.GunterActionEngine.execute(
                state.plan, null, ctx
            );
            endStage(state, {
                executed: state.execution.executed.length,
                failed: state.execution.failed.length,
                pending: state.execution.pending.length
            });

        } catch (err) {
            recordError(state, state._currentStage || 'unknown', err);
            state.execution = {
                executed: [], failed: [], pending: [], sideEffects: [],
                uiResponse: { speech: '⚠️ Algo falló al procesar tu mensaje.', animation: 'alert', panels: [] }
            };
        } finally {
            persist(state);
        }

        const reply = state.execution?.uiResponse?.speech;
        if (reply) window.GunterContextProvider.pushConversationTurn('assistant', reply);

        return {
            state,
            awaitingConfirmation: !!state.execution?.uiResponse?.awaitingConfirmation,
            response: state.execution?.uiResponse
        };
    }

    async function handleConfirmation(pendingState, answer) {
        if (pendingState?.assistantPending) {
            const current = window.GunterAssistantTools?.getPending?.();
            const expected = pendingState.assistantPending;
            const result = current?.toolId === expected.toolId && current?.createdAt === expected.createdAt
                ? await window.GunterAssistantTools.dispatch(answer?.accepted ? 'sí' : 'no')
                : { reply: 'Esa solicitud ya venció o cambió. Pídeme de nuevo la acción que deseas.' };
            const response = { speech: result.reply, animation: result.status === 'complete' ? 'nod' : 'think', panels: [{ type: 'activity-updated' }] };
            pendingState.execution = { executed: [], failed: [], pending: [], sideEffects: [], uiResponse: response };
            persist(pendingState);
            return { state: pendingState, response };
        }
        if (pendingState?.workflowId && window.GunterWorkflowOrchestrator?.confirm) {
            const result = await window.GunterWorkflowOrchestrator.confirm(pendingState.workflowId, answer?.accepted === true);
            pendingState.execution = {
                executed: result.status === 'complete' ? (result.workflow?.steps || []).map(step => ({ stepId: step.stepId })) : [],
                failed: ['error', 'blocked'].includes(result.status) ? [{ reason: result.status }] : [],
                pending: [], sideEffects: [],
                uiResponse: {
                    speech: result.reply,
                    animation: result.status === 'complete' ? 'applaud' : result.status === 'cancelled' ? 'nod' : 'alert',
                    panels: [{ type: 'activity-updated' }]
                }
            };
            persist(pendingState);
            return { state: pendingState, response: pendingState.execution.uiResponse, workflow: result };
        }
        if (!pendingState?.plan) return null;
        const ctx = pendingState.input.userContext;
        try {
            startStage(pendingState, 'action_retry');
            pendingState.execution = await window.GunterActionEngine.execute(
                pendingState.plan, answer, ctx
            );
            endStage(pendingState, { executed: pendingState.execution.executed.length });
        } catch (err) {
            recordError(pendingState, 'action_retry', err);
        } finally {
            persist(pendingState);
        }
        return {
            state: pendingState,
            response: pendingState.execution?.uiResponse
        };
    }

    window.GunterPipeline = { handleUserInput, handleConfirmation };
})();
