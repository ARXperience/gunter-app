/* =============================================
   GUNTER CORE - Context Provider
   -------------------------------------------------
   Construye el UserContext que viaja por todo el
   pipeline. Lee de localStorage + GunterDataService.
   ============================================= */

(function () {
    const DEFAULT_PREFS = {
        confirmationMode: 'smart',   // 'always' | 'smart' | 'never'
        autoExecute: false,
        workingHours: { start: 9, end: 18 },
        defaultReminderHour: 9
    };

    function readPrefs() {
        try {
            const raw = JSON.parse(localStorage.getItem('gunter_prefs') || '{}');
            return { ...DEFAULT_PREFS, ...raw };
        } catch {
            return DEFAULT_PREFS;
        }
    }

    function detectTimezone() {
        try {
            return window.GunterPresence?.timezone?.() || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        } catch { return 'UTC'; }
    }

    function detectLocale() {
        return (navigator.language || 'es-MX').startsWith('es') ? 'es' : 'en';
    }

    function recentEntities() {
        const out = { people: [], projects: [], tags: [] };
        try {
            if (window.gunterData && window.gunterData.getActiveProjects) {
                out.projects = window.gunterData.getActiveProjects()
                    .slice(0, 20)
                    .map(p => ({ name: p.name, id: p.id, environment: p.environment }));
            }
        } catch {}
        return out;
    }

    function currentProject() {
        const pid = localStorage.getItem('gunter_project_id');
        if (!pid) return null;
        try {
            const p = (window.gunterData?.getAllProjects?.() || []).find(x => x.id === pid);
            if (!p) return null;
            return { id: p.id, name: p.name, environment: p.environment };
        } catch {
            return null;
        }
    }

    function getConversationHistory(limit = 8) {
        try {
            const ownerId = window.GunterAuth?.canAccessLocalData?.() && window.GunterAuth?.getUser?.()?.id;
            if (!ownerId) return [];
            const raw = JSON.parse(localStorage.getItem('gunter_conversation') || '[]');
            return raw.filter(turn => turn?.ownerId === ownerId).slice(-limit);
        } catch { return []; }
    }

    function pushConversationTurn(role, content) {
        try {
            const ownerId = window.GunterAuth?.canAccessLocalData?.() && window.GunterAuth?.getUser?.()?.id;
            if (!ownerId || !['user', 'assistant'].includes(role) || !String(content || '').trim()) return;
            const raw = JSON.parse(localStorage.getItem('gunter_conversation') || '[]');
            raw.push({ role, content: String(content).slice(0, 4000), ownerId, timestamp: new Date().toISOString() });
            if (raw.length > 50) raw.splice(0, raw.length - 50);
            localStorage.setItem('gunter_conversation', JSON.stringify(raw));
        } catch {}
    }

    function build() {
        return {
            userId: localStorage.getItem('gunter_user') || 'local-user',
            timezone: detectTimezone(),
            locale: detectLocale(),
            now: new Date().toISOString(),
            preferences: readPrefs(),
            currentProject: currentProject(),
            recentEntities: recentEntities(),
            conversationHistory: getConversationHistory()
        };
    }

    function sessionId() {
        const key = 'gunter_context_session_id';
        try {
            let value = sessionStorage.getItem(key);
            if (!value) { value = `web_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`; sessionStorage.setItem(key, value); }
            return value;
        } catch { return 'web_session'; }
    }

    async function enrich(text, options = {}) {
        const local = build();
        const control = window.GunterControlPlane;
        if (!control?.contextEnvelope || navigator.onLine === false) return { ...local, contextState: 'DEGRADED', contextSource: 'local' };
        try {
            const result = await control.contextEnvelope({
                text,
                sessionId: sessionId(),
                channel: options.channel || 'web',
                timezone: local.timezone,
                locale: navigator.language || 'es-CO',
                current: {
                    project: local.currentProject?.name || undefined,
                    route: location.pathname.split('/').pop() || 'index.html'
                },
                sources: [{ type: 'browser_context', id: 'local_context_provider', confidence: 0.9 }]
            });
            const envelope = result?.envelope || null;
            return {
                ...local,
                now: envelope?.now || local.now,
                controlContext: envelope,
                resolvedReferences: envelope?.references || {},
                contextState: envelope ? 'ONLINE' : 'DEGRADED',
                contextSource: envelope ? 'control-plane' : 'local'
            };
        } catch (error) {
            return { ...local, contextState: 'DEGRADED', contextSource: 'local', contextError: error.code || error.message };
        }
    }

    window.GunterContextProvider = { build, enrich, pushConversationTurn };
})();
