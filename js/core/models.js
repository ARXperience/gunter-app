/* =============================================
   GUNTER CORE - Models & Shapes
   -------------------------------------------------
   Contratos que viajan por el pipeline. Son la
   lingua franca entre intent/entity/time/decision/
   action. Documentados con JSDoc + helpers mínimos.
   ============================================= */

(function () {
    /**
     * @typedef {'task'|'meeting'|'reminder'|'document_analysis'|'query'|'note'|'modify'|'cancel'|'greeting'} IntentType
     */

    /**
     * @typedef {Object} UserContext
     * @property {string} userId
     * @property {string} timezone
     * @property {string} locale
     * @property {string} now               - ISO 8601
     * @property {Object} preferences
     * @property {Object|null} currentProject
     * @property {Object} recentEntities
     * @property {Array} conversationHistory
     */

    /**
     * @typedef {Object} IntentResult
     * @property {{type:IntentType, confidence:number}} primary
     * @property {Array<{type:IntentType,confidence:number}>} alternatives
     * @property {boolean} multiIntent
     * @property {IntentResult[]} [subIntents]
     * @property {'rules'|'llm'|'hybrid'} method
     */

    /**
     * @typedef {Object} EntityMap
     * @property {{value:string,span:[number,number],confidence:number}} [title]
     * @property {Array<{raw:string,span:[number,number],kind:string}>} [datetimeExpr]
     * @property {Array<{name:string,matchedContactId?:string,span:[number,number]}>} [people]
     * @property {{value:string,span:[number,number]}} [location]
     * @property {'low'|'normal'|'high'|'urgent'} [priority]
     * @property {{name:string,matchedProjectId?:string,span:[number,number]}} [projectRef]
     * @property {string[]} [tags]
     * @property {string} [notes]
     * @property {Array<{type:string,id:string}>} [references]
     * @property {string} rawText
     * @property {string[]} [missing]
     */

    /**
     * @typedef {Object} ResolvedTime
     * @property {string} raw
     * @property {string|null} iso
     * @property {'instant'|'allDay'|'range'|'recurring'} kind
     * @property {string} [end]
     * @property {string} [rrule]
     * @property {string} timezone
     * @property {{options:string[],reason:string}} [ambiguity]
     * @property {number} confidence
     * @property {'regex'|'lib'|'llm'} method
     */

    /**
     * @typedef {Object} ActionStep
     * @property {string} id
     * @property {string} type
     * @property {Object} payload
     * @property {string[]} [dependsOn]
     * @property {'google'|'none'} [requiresAuth]
     * @property {boolean} reversible
     */

    /**
     * @typedef {Object} ActionPlan
     * @property {ActionStep[]} steps
     * @property {boolean} needsConfirmation
     * @property {string} [confirmationPrompt]
     * @property {Array} estimatedSideEffects
     * @property {ActionPlan} [fallbackIfRejected]
     */

    // ---------- Helpers ----------
    function newId(prefix = 'id') {
        return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    function emptyEntityMap(rawText = '') {
        return { rawText, missing: [] };
    }

    function emptyIntentResult() {
        return {
            primary: { type: 'query', confidence: 0 },
            alternatives: [],
            multiIntent: false,
            method: 'rules'
        };
    }

    function emptyActionPlan() {
        return {
            steps: [],
            needsConfirmation: false,
            estimatedSideEffects: []
        };
    }

    function isDestructive(stepType) {
        return /delete|cancel|purge|remove/i.test(stepType);
    }

    function newPipelineState(text, userContext) {
        return {
            pipelineId: newId('ppl'),
            input: { text, source: 'text', timestamp: new Date().toISOString(), userContext },
            trace: [],
            errors: []
        };
    }

    window.GunterCoreModels = {
        newId,
        emptyEntityMap,
        emptyIntentResult,
        emptyActionPlan,
        isDestructive,
        newPipelineState,

        INTENTS: ['task', 'meeting', 'reminder', 'document_analysis', 'query', 'note', 'modify', 'cancel', 'greeting'],
        PRIORITIES: ['low', 'normal', 'high', 'urgent'],
        ACTION_TYPES: [
            'create_task', 'update_task', 'delete_task',
            'create_payment_task',
            'create_event', 'update_event', 'delete_event',
            'create_reminder',
            'send_to_calendar',
            'generate_document',
            'ask_user', 'suggest'
        ]
    };
})();
