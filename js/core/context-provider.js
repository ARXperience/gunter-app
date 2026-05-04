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
            return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
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
            const raw = JSON.parse(localStorage.getItem('gunter_conversation') || '[]');
            return raw.slice(-limit);
        } catch { return []; }
    }

    function pushConversationTurn(role, content) {
        try {
            const raw = JSON.parse(localStorage.getItem('gunter_conversation') || '[]');
            raw.push({ role, content, timestamp: new Date().toISOString() });
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

    window.GunterContextProvider = { build, pushConversationTurn };
})();
