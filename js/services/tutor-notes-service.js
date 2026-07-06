/* =============================================
   GUNTER TUTOR — Notes, Bookmarks & Study Memory
   -------------------------------------------------
   Persistencia local (localStorage) de:
     • notes:     { workN, chapterIdx?, text, at, updatedAt }
     • bookmarks: { workN, pageStart, pageEnd, snippet, tag, at }
     • history:   { at, kind, workN, chapterIdx?, page?, query?, source }

   Sin gasto. Todo se guarda en la máquina del usuario.
   ============================================= */
(function () {
    if (window.GunterTutorNotes) return;

    const STORE_KEY = 'gunter_tutor_notes_v1';
    const MAX_HISTORY = 500;

    function _load() {
        try {
            const raw = localStorage.getItem(STORE_KEY);
            if (!raw) return { notes: [], bookmarks: [], history: [], updatedAt: null };
            return JSON.parse(raw);
        } catch { return { notes: [], bookmarks: [], history: [], updatedAt: null }; }
    }
    function _save(store) {
        store.updatedAt = new Date().toISOString();
        try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch {}
        // Backup server-side con debounce (definido más abajo; hoisting-safe via typeof)
        try { if (typeof _schedulePush === 'function') _schedulePush(); } catch {}
    }

    let _cache = _load();
    function _refresh() { _cache = _load(); return _cache; }

    // ═════════════════════════════════════════════
    // Server sync (v34) — backup en data/tutor-notes.json
    // Push con debounce 3s tras cada save; pull al arrancar
    // con merge por id (server complementa, local gana en conflicto).
    // ═════════════════════════════════════════════
    let _pushTimer = null;
    function _syncUrl() {
        const c = window.GUNTER_CONFIG || {};
        return (c.PROXY_BASE_URL || '') + '/api/tutor';
    }
    function _schedulePush() {
        clearTimeout(_pushTimer);
        _pushTimer = setTimeout(async () => {
            try {
                const store = _load();
                // Incluir tarjetas de repaso y reglas personales en el mismo backup
                store.repaso = window.GunterRepaso?.exportAll?.() || null;
                store.rules = window.GunterRules?.exportAll?.() || null;
                await fetch(_syncUrl(), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ op: 'notes-push', userId: 'default', data: store })
                });
            } catch { /* offline ok — reintenta en el próximo save */ }
        }, 3000);
    }
    async function pullFromServer() {
        try {
            const resp = await fetch(_syncUrl(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ op: 'notes-pull', userId: 'default' })
            });
            const json = await resp.json();
            const remote = json?.data;
            if (!remote) return { merged: 0 };

            const local = _load();
            const localNoteIds = new Set((local.notes || []).map(n => n.id));
            const localBmIds = new Set((local.bookmarks || []).map(b => b.id));
            let merged = 0;
            for (const n of (remote.notes || [])) {
                if (!localNoteIds.has(n.id)) { local.notes.push(n); merged++; }
            }
            for (const b of (remote.bookmarks || [])) {
                if (!localBmIds.has(b.id)) { local.bookmarks.push(b); merged++; }
            }
            if (merged > 0) { _save(local); _cache = local; }
            // Merge de tarjetas de repaso y reglas
            if (remote.repaso && window.GunterRepaso?.importMerge) {
                merged += window.GunterRepaso.importMerge(remote.repaso);
            }
            if (remote.rules && window.GunterRules?.importMerge) {
                merged += window.GunterRules.importMerge(remote.rules);
            }
            console.info('[tutor-notes] pull:', merged, 'items nuevos desde el server');
            return { merged };
        } catch (e) {
            console.warn('[tutor-notes] pull fail:', e.message);
            return { merged: 0, error: e.message };
        }
    }

    // ═════════════════════════════════════════════
    // Notes
    // ═════════════════════════════════════════════
    function listNotes({ workN = null, chapterIdx = null } = {}) {
        _refresh();
        let out = _cache.notes || [];
        if (workN !== null) out = out.filter(n => String(n.workN) === String(workN));
        if (chapterIdx !== null && chapterIdx !== undefined) {
            out = out.filter(n => n.chapterIdx === Number(chapterIdx));
        }
        return out.slice().sort((a, b) => new Date(b.updatedAt || b.at) - new Date(a.updatedAt || a.at));
    }

    function upsertNote({ workN, chapterIdx = null, text }) {
        if (!workN || !text?.trim()) return null;
        const s = _load();
        const existing = (s.notes || []).find(n =>
            String(n.workN) === String(workN) &&
            (n.chapterIdx ?? null) === (chapterIdx ?? null)
        );
        if (existing) {
            existing.text = text.trim();
            existing.updatedAt = new Date().toISOString();
            _save(s); _cache = s;
            return existing;
        }
        const now = new Date().toISOString();
        const note = { id: 'n_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
                       workN: String(workN), chapterIdx: chapterIdx === null ? null : Number(chapterIdx),
                       text: text.trim(), at: now, updatedAt: now };
        s.notes = s.notes || [];
        s.notes.push(note);
        _save(s); _cache = s;
        return note;
    }

    function deleteNote(id) {
        const s = _load();
        s.notes = (s.notes || []).filter(n => n.id !== id);
        _save(s); _cache = s;
    }

    // ═════════════════════════════════════════════
    // Bookmarks
    // ═════════════════════════════════════════════
    function listBookmarks({ workN = null } = {}) {
        _refresh();
        let out = _cache.bookmarks || [];
        if (workN !== null) out = out.filter(b => String(b.workN) === String(workN));
        return out.slice().sort((a, b) => new Date(b.at) - new Date(a.at));
    }

    function addBookmark({ workN, pageStart, pageEnd = null, snippet = '', tag = '' }) {
        if (!workN || pageStart === undefined || pageStart === null) return null;
        const s = _load();
        // dedup por (workN, pageStart)
        const already = (s.bookmarks || []).find(b =>
            String(b.workN) === String(workN) && b.pageStart === Number(pageStart)
        );
        if (already) return already;
        const b = {
            id: 'b_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            workN: String(workN),
            pageStart: Number(pageStart),
            pageEnd: pageEnd === null || pageEnd === undefined ? Number(pageStart) : Number(pageEnd),
            snippet: (snippet || '').slice(0, 400),
            tag: tag || '',
            at: new Date().toISOString()
        };
        s.bookmarks = s.bookmarks || [];
        s.bookmarks.push(b);
        _save(s); _cache = s;
        return b;
    }

    function removeBookmark(id) {
        const s = _load();
        s.bookmarks = (s.bookmarks || []).filter(b => b.id !== id);
        _save(s); _cache = s;
    }

    function hasBookmark(workN, pageStart) {
        _refresh();
        return (_cache.bookmarks || []).some(b =>
            String(b.workN) === String(workN) && b.pageStart === Number(pageStart)
        );
    }

    // ═════════════════════════════════════════════
    // History log
    // ═════════════════════════════════════════════
    function log(entry) {
        const s = _load();
        s.history = s.history || [];
        s.history.push({ at: new Date().toISOString(), ...entry });
        if (s.history.length > MAX_HISTORY) s.history = s.history.slice(-MAX_HISTORY);
        _save(s); _cache = s;
    }

    function recentHistory({ limit = 20, kind = null, workN = null } = {}) {
        _refresh();
        let out = (_cache.history || []).slice().reverse();
        if (kind) out = out.filter(h => h.kind === kind);
        if (workN !== null) out = out.filter(h => String(h.workN) === String(workN));
        return out.slice(0, limit);
    }

    // ═════════════════════════════════════════════
    // Stats
    // ═════════════════════════════════════════════
    // ═════════════════════════════════════════════
    // Query my notes — busca en las notas del usuario
    // Simple text search + concept cloud
    // ═════════════════════════════════════════════
    function queryNotes(query) {
        _refresh();
        const q = String(query || '').toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .trim();
        if (!q) return { hits: [], term: '' };
        const terms = q.split(/\s+/).filter(t => t.length > 2);
        if (!terms.length) return { hits: [], term: q };

        const hits = [];
        for (const n of (_cache.notes || [])) {
            const norm = String(n.text || '').toLowerCase()
                .normalize('NFD').replace(/[̀-ͯ]/g, '');
            let score = 0;
            const matched = [];
            for (const t of terms) {
                const re = new RegExp('\\b' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                const m = norm.match(re);
                if (m) { score += m.length; matched.push(t); }
            }
            if (score > 0) hits.push({ ...n, score, matched });
        }
        hits.sort((a, b) => b.score - a.score);
        return { hits: hits.slice(0, 20), term: q };
    }

    /**
     * Concept cloud a partir de las notas del usuario.
     * Simple frecuencia de términos (stop-words filtradas).
     */
    function conceptCloud() {
        _refresh();
        const STOP = new Set('el la los las un una y o de del al a en que se su sus le les lo por con sin para es son ser estar era eran fue fueron han hay hace muy mas menos como cuando donde este esta ese esa esto eso pero si no solo tambien tan tanto asi aun aunque desde hasta sobre entre mientras porque pero mi mis tu tus me te'.split(' '));
        const freq = new Map();
        for (const n of (_cache.notes || [])) {
            const words = String(n.text || '')
                .toLowerCase()
                .normalize('NFD').replace(/[̀-ͯ]/g, '')
                .replace(/[^\w\s]/g, ' ')
                .split(/\s+/)
                .filter(w => w.length >= 4 && !STOP.has(w));
            for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
        }
        return Array.from(freq.entries())
            .filter(([, c]) => c >= 2)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 40)
            .map(([term, count]) => ({ term, count }));
    }

    /**
     * Heatmap de actividad por día (últimos N días).
     */
    // Fecha LOCAL (no UTC) — actividad de las 20:00 en GMT-5 cuenta para ese día,
    // no para el siguiente.
    function _localDayKey(dateLike) {
        const d = new Date(dateLike);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function activityHeatmap(days = 30) {
        _refresh();
        const buckets = new Map();
        const now = Date.now();
        // Init últimos N días en clave local
        for (let i = 0; i < days; i++) {
            buckets.set(_localDayKey(now - i * 86400000), 0);
        }
        const bump = (dateLike) => {
            const key = _localDayKey(dateLike);
            if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
        };
        for (const h of (_cache.history || [])) bump(h.at);
        for (const n of (_cache.notes || [])) bump(n.updatedAt || n.at);
        for (const b of (_cache.bookmarks || [])) bump(b.at);
        return Array.from(buckets.entries())
            .map(([date, count]) => ({ date, count }))
            .reverse();   // más viejo primero
    }

    function bookContribution() {
        _refresh();
        const by = new Map();
        const bump = (workN, kind) => {
            if (!workN) return;
            const b = by.get(String(workN)) || { workN: String(workN), notes: 0, bookmarks: 0, actions: 0 };
            b[kind]++;
            by.set(String(workN), b);
        };
        for (const n of (_cache.notes || [])) bump(n.workN, 'notes');
        for (const b of (_cache.bookmarks || [])) bump(b.workN, 'bookmarks');
        for (const h of (_cache.history || [])) bump(h.workN, 'actions');
        return Array.from(by.values())
            .map(b => ({ ...b, total: b.notes * 3 + b.bookmarks * 2 + b.actions }))
            .sort((a, b) => b.total - a.total);
    }

    function stats() {
        _refresh();
        const notes = _cache.notes || [];
        const bookmarks = _cache.bookmarks || [];
        const history = _cache.history || [];
        const workSet = new Set([
            ...notes.map(n => n.workN),
            ...bookmarks.map(b => b.workN),
            ...history.map(h => h.workN).filter(Boolean)
        ]);
        return {
            notesCount: notes.length,
            bookmarksCount: bookmarks.length,
            historyCount: history.length,
            worksTouched: workSet.size,
            works: Array.from(workSet).sort((a, b) => Number(a) - Number(b))
        };
    }

    // ═════════════════════════════════════════════
    // Context builder para Gunter (inyecta al prompt)
    // ═════════════════════════════════════════════
    function contextBlock({ workN = null } = {}) {
        _refresh();
        const st = stats();
        if (st.notesCount === 0 && st.bookmarksCount === 0 && st.historyCount === 0) return null;

        const lines = [];
        lines.push('═══ TU HUELLA DE ESTUDIO (personal, no del corpus) ═══');
        lines.push(`Tenés ${st.notesCount} notas, ${st.bookmarksCount} marcadores, actividad en ${st.worksTouched} obras.`);

        // Notas relevantes al work en curso
        const workNotes = workN ? listNotes({ workN }) : listNotes().slice(0, 5);
        if (workNotes.length) {
            lines.push('');
            lines.push(workN ? `Tus notas de la obra #${workN}:` : 'Tus notas más recientes:');
            for (const n of workNotes.slice(0, 6)) {
                const cap = n.chapterIdx !== null && n.chapterIdx !== undefined ? ` (cap ${n.chapterIdx})` : '';
                lines.push(`  · #${n.workN}${cap} — "${n.text.slice(0, 220)}${n.text.length > 220 ? '…' : ''}"`);
            }
        }

        // Bookmarks relevantes
        const workBookmarks = workN ? listBookmarks({ workN }) : listBookmarks().slice(0, 6);
        if (workBookmarks.length) {
            lines.push('');
            lines.push(workN ? `Marcadores en #${workN}:` : 'Marcadores recientes:');
            for (const b of workBookmarks.slice(0, 8)) {
                lines.push(`  ✦ #${b.workN} p.${b.pageStart}${b.pageEnd !== b.pageStart ? '–'+b.pageEnd : ''}${b.tag ? ' · ['+b.tag+']' : ''}${b.snippet ? ' · "'+b.snippet.slice(0, 100)+'…"' : ''}`);
            }
        }

        // Actividad reciente
        const recent = recentHistory({ limit: 5 });
        if (recent.length) {
            lines.push('');
            lines.push('Últimas 5 acciones tuyas:');
            for (const h of recent) {
                const parts = [];
                if (h.workN) parts.push('#' + h.workN);
                if (h.chapterIdx !== undefined && h.chapterIdx !== null) parts.push('cap ' + h.chapterIdx);
                if (h.page) parts.push('p.' + h.page);
                if (h.query) parts.push('query: "' + h.query.slice(0, 40) + '"');
                lines.push(`  · [${h.kind}] ${parts.join(' · ')} — ${new Date(h.at).toLocaleString()}`);
            }
        }

        lines.push('');
        lines.push('USO: si es relevante, referí las notas/marcadores del usuario para conectar con lo que él ya subrayó. NO inventes notas que no aparezcan arriba.');
        lines.push('═══════════════════════════════════════');
        return lines.join('\n');
    }

    function exportAll() { return _load(); }
    function importAll(data) {
        if (!data || typeof data !== 'object') return false;
        const s = { notes: data.notes || [], bookmarks: data.bookmarks || [], history: data.history || [], updatedAt: new Date().toISOString() };
        _save(s); _cache = s;
        return true;
    }
    function clearAll() {
        _save({ notes: [], bookmarks: [], history: [], updatedAt: new Date().toISOString() });
        _cache = _load();
    }

    window.GunterTutorNotes = {
        // Notes
        listNotes, upsertNote, deleteNote,
        // Bookmarks
        listBookmarks, addBookmark, removeBookmark, hasBookmark,
        // History
        log, recentHistory,
        // Reflect analytics
        queryNotes, conceptCloud, activityHeatmap, bookContribution,
        // Stats + export
        stats, exportAll, importAll, clearAll,
        // Server sync
        pullFromServer,
        // Context for LLM
        contextBlock
    };

    // Pull inicial: recuperar notas del server (útil tras limpiar navegador
    // o al abrir desde otro dispositivo). No bloquea el arranque.
    setTimeout(() => { pullFromServer().catch(() => {}); }, 2500);
})();
