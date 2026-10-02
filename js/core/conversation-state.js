/* =============================================
   GUNTER CORE - Conversation State
   -------------------------------------------------
   Fuente única de verdad para la conversación por voz.
   Mantiene transiciones explícitas y emite snapshots
   consumibles por UI, wake word y herramientas.
   ============================================= */

(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.GunterConversationState = api.create();
})(typeof window !== 'undefined' ? window : null, function (root) {
    const STATES = Object.freeze({
        IDLE: 'idle',
        LISTENING_WAKE: 'listening_wake',
        LISTENING_QUERY: 'listening_query',
        THINKING: 'thinking',
        SPEAKING: 'speaking',
        AWAITING_CONFIRMATION: 'awaiting_confirmation',
        ERROR: 'error'
    });

    const ALLOWED = {
        idle: new Set(['listening_wake', 'listening_query', 'thinking', 'speaking', 'awaiting_confirmation', 'error']),
        listening_wake: new Set(['idle', 'listening_query', 'thinking', 'speaking', 'awaiting_confirmation', 'error']),
        listening_query: new Set(['idle', 'listening_wake', 'thinking', 'speaking', 'awaiting_confirmation', 'error']),
        thinking: new Set(['idle', 'listening_wake', 'listening_query', 'speaking', 'awaiting_confirmation', 'error']),
        speaking: new Set(['idle', 'listening_wake', 'listening_query', 'thinking', 'awaiting_confirmation', 'error']),
        awaiting_confirmation: new Set(['idle', 'listening_wake', 'listening_query', 'thinking', 'speaking', 'error']),
        error: new Set(['idle', 'listening_wake', 'listening_query', 'thinking'])
    };

    function create(options = {}) {
        const listeners = new Set();
        let seq = 0;
        let current = {
            value: STATES.IDLE,
            previous: null,
            reason: 'boot',
            meta: {},
            sequence: seq,
            changedAt: new Date().toISOString()
        };

        function snapshot() {
            return { ...current, meta: { ...current.meta } };
        }

        function emit() {
            const value = snapshot();
            listeners.forEach(fn => {
                try { fn(value); } catch { /* listener aislado */ }
            });
            if (root?.dispatchEvent && root.CustomEvent) {
                try {
                    root.dispatchEvent(new root.CustomEvent('gunter-conversation-state', { detail: value }));
                } catch { /* entorno sin DOM completo */ }
            }
        }

        function transition(next, meta = {}) {
            if (!Object.values(STATES).includes(next)) {
                return { ok: false, reason: 'unknown-state', state: snapshot() };
            }
            if (next === current.value) {
                current = { ...current, reason: meta.reason || current.reason, meta: { ...current.meta, ...meta } };
                emit();
                return { ok: true, unchanged: true, state: snapshot() };
            }
            if (!ALLOWED[current.value]?.has(next) && !meta.force) {
                return { ok: false, reason: 'invalid-transition', from: current.value, to: next, state: snapshot() };
            }
            const previous = current.value;
            current = {
                value: next,
                previous,
                reason: meta.reason || 'transition',
                meta: { ...meta, force: undefined },
                sequence: ++seq,
                changedAt: new Date().toISOString()
            };
            emit();
            return { ok: true, from: previous, to: next, state: snapshot() };
        }

        function onChange(listener) {
            if (typeof listener !== 'function') return () => {};
            listeners.add(listener);
            return () => listeners.delete(listener);
        }

        function reset(reason = 'reset') {
            return transition(STATES.IDLE, { reason, force: true });
        }

        if (root?.addEventListener && options.bindBrowserEvents !== false) {
            root.addEventListener('gunter-voice-state', event => {
                const detail = event.detail || {};
                if (detail.state === 'speaking') transition(STATES.SPEAKING, { reason: 'voice-start', text: detail.text || '' });
                if (detail.state === 'idle' && current.value === STATES.SPEAKING) {
                    if (root.GunterAssistantTools?.getPending?.()) {
                        transition(STATES.AWAITING_CONFIRMATION, { reason: 'voice-end-pending-confirmation' });
                        return;
                    }
                    const wake = root.GunterWakeWord?.getState?.();
                    transition(wake?.active ? STATES.LISTENING_WAKE : STATES.IDLE, { reason: detail.reason || 'voice-end' });
                }
            });
            root.addEventListener('wake-word-state', event => {
                const detail = event.detail || {};
                if (detail.mode === 'error') transition(STATES.ERROR, { reason: detail.error || 'wake-error' });
                else if (detail.mode === 'query') transition(STATES.LISTENING_QUERY, { reason: 'wake-invoked' });
                else if (detail.mode === 'wake' && current.value !== STATES.SPEAKING && current.value !== STATES.THINKING && current.value !== STATES.AWAITING_CONFIRMATION) {
                    transition(STATES.LISTENING_WAKE, { reason: 'wake-listening' });
                } else if (detail.mode === 'off' && current.value !== STATES.SPEAKING && current.value !== STATES.THINKING && current.value !== STATES.AWAITING_CONFIRMATION) {
                    transition(STATES.IDLE, { reason: 'wake-off' });
                }
            });
            root.addEventListener('gunter-barge-in', event => {
                transition(STATES.LISTENING_QUERY, { reason: 'barge-in', transcript: event.detail?.transcript || '', force: true });
            });
            root.addEventListener('gunter-vad-state', event => {
                if (current.value === STATES.LISTENING_QUERY && event.detail?.activity === 'speech') {
                    transition(STATES.LISTENING_QUERY, {
                        reason: 'voice-activity',
                        level: event.detail.rms,
                        threshold: event.detail.threshold
                    });
                }
            });
        }

        return { STATES, getState: snapshot, transition, onChange, reset };
    }

    return { STATES, create };
});
