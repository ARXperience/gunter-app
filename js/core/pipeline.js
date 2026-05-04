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
        const ctx = window.GunterContextProvider.build();
        window.GunterContextProvider.pushConversationTurn('user', text);
        const state = window.GunterCoreModels.newPipelineState(text, ctx);

        try {
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
