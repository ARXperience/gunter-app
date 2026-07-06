/* =============================================
   GUNTER — Reglas personales persistentes
   -------------------------------------------------
   Cuando el usuario corrige a Gunter ("no me hables de X",
   "los viernes no me sugieras trabajo"), la corrección se
   guarda como regla PERMANENTE que se inyecta a cada
   conversación. Gunter se calibra con el uso.

   Comandos por chat (interceptados en el companion):
     "regla: <texto>"                    → agrega
     "recuerda que <texto>"              → agrega
     "a partir de ahora <texto>"         → agrega
     "mis reglas"                        → lista
     "borra la regla <n>"                → elimina
     "desactiva la regla <n>"            → toggle off

   Costo: $0. localStorage + sync via tutor-notes push.
   ============================================= */
(function () {
    if (window.GunterRules) return;

    const KEY = 'gunter_rules_v1';
    const MAX_RULES = 40;

    function _load() {
        try { return JSON.parse(localStorage.getItem(KEY)) || { rules: [] }; }
        catch { return { rules: [] }; }
    }
    function _save(s) {
        s.updatedAt = new Date().toISOString();
        try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
    }

    function addRule(text) {
        const t = String(text || '').trim();
        if (t.length < 4) return null;
        const s = _load();
        // dedup por texto normalizado
        const norm = t.toLowerCase();
        if (s.rules.some(r => r.text.toLowerCase() === norm)) return { dup: true };
        if (s.rules.length >= MAX_RULES) return { full: true };
        const rule = {
            id: 'r_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            text: t,
            active: true,
            createdAt: new Date().toISOString()
        };
        s.rules.push(rule);
        _save(s);
        return rule;
    }

    function listRules() { return _load().rules; }

    function removeRule(idxOrId) {
        const s = _load();
        if (typeof idxOrId === 'number' || /^\d+$/.test(idxOrId)) {
            const idx = Number(idxOrId) - 1;   // humanos cuentan desde 1
            if (idx < 0 || idx >= s.rules.length) return false;
            s.rules.splice(idx, 1);
        } else {
            s.rules = s.rules.filter(r => r.id !== idxOrId);
        }
        _save(s);
        return true;
    }

    function toggleRule(idx1based, active = null) {
        const s = _load();
        const r = s.rules[Number(idx1based) - 1];
        if (!r) return false;
        r.active = active === null ? !r.active : !!active;
        _save(s);
        return r.active;
    }

    /**
     * Bloque para el system prompt. Solo reglas activas.
     */
    function promptBlock() {
        const rules = listRules().filter(r => r.active);
        if (!rules.length) return '';
        return '# REGLAS PERSONALES DEL USUARIO (permanentes — respetalas SIEMPRE)\n' +
            rules.map((r, i) => `${i + 1}. ${r.text}`).join('\n');
    }

    function formatList() {
        const rules = listRules();
        if (!rules.length) return 'No tenés reglas guardadas. Creá una con: "regla: los viernes no me sugieras trabajo".';
        return '📏 Tus reglas:\n' + rules.map((r, i) =>
            `${i + 1}. ${r.active ? '✅' : '⚪'} ${r.text}`
        ).join('\n') + '\n\nGestión: "borra la regla N" · "desactiva la regla N".';
    }

    // Sync (viaja en el push de tutor-notes)
    function exportAll() { return _load(); }
    function importMerge(remote) {
        if (!remote?.rules) return 0;
        const s = _load();
        const ids = new Set(s.rules.map(r => r.id));
        let merged = 0;
        for (const r of remote.rules) {
            if (!ids.has(r.id)) { s.rules.push(r); merged++; }
        }
        if (merged) _save(s);
        return merged;
    }

    window.GunterRules = { addRule, listRules, removeRule, toggleRule, promptBlock, formatList, exportAll, importMerge };
})();
