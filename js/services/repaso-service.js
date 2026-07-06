/* =============================================
   GUNTER — Repaso Espaciado (SM-2 simplificado)
   -------------------------------------------------
   Convierte tu huella de estudio en tarjetas de repaso
   con intervalos crecientes estilo Anki:
     · bookmarks → "¿qué decía el pasaje que marcaste?"
     · conceptos explorados → "explicá <término>"

   Calificación: again(0) · hard(3) · good(4) · easy(5)
   Intervalos: 10min → 1d → 3d → interval×ease

   Persistencia: localStorage + sync via tutor-notes push.
   Costo: $0.
   ============================================= */
(function () {
    if (window.GunterRepaso) return;

    const KEY = 'gunter_repaso_v1';

    function _load() {
        try {
            const raw = localStorage.getItem(KEY);
            return raw ? JSON.parse(raw) : { cards: [], stats: { reviews: 0, correct: 0 }, updatedAt: null };
        } catch { return { cards: [], stats: { reviews: 0, correct: 0 }, updatedAt: null }; }
    }
    function _save(s) {
        s.updatedAt = new Date().toISOString();
        try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
    }

    // ═════════════════════════════════════════════
    // Generación de tarjetas desde la huella
    // ═════════════════════════════════════════════
    async function generateCards() {
        const notes = window.GunterTutorNotes;
        if (!notes) return { created: 0 };
        const s = _load();
        const existing = new Set(s.cards.map(c => c.sourceId));
        let created = 0;

        // 1) Bookmarks → tarjeta de pasaje
        for (const b of notes.listBookmarks()) {
            const sourceId = 'bm:' + b.id;
            if (existing.has(sourceId)) continue;
            s.cards.push(_newCard({
                sourceId,
                type: 'bookmark',
                workN: b.workN,
                front: `Marcaste un pasaje en #${b.workN} p.${b.pageStart}. ¿Recordás qué decía y por qué te importó?`,
                back: b.snippet || '(sin snippet guardado — abrí la obra p.' + b.pageStart + ')'
            }));
            created++;
        }

        // 2) Conceptos explorados (history kind ask-term / explore-chapter con concepts)
        const termsSeen = new Set();
        for (const h of notes.recentHistory({ limit: 200 })) {
            if (h.kind !== 'ask-term' && h.kind !== 'explore-chapter') continue;
            const term = h.term || null;
            if (!term || termsSeen.has(term)) continue;
            termsSeen.add(term);
            const sourceId = 'term:' + term;
            if (existing.has(sourceId)) continue;

            // Back: el mejor pasaje BM25 para el término (cacheado en la tarjeta)
            let back = 'Verificá tu respuesta preguntándole al sabio.';
            try {
                const res = await window.GunterTutor?.sageBm25?.(term, { limit: 1 });
                const hit = res?.hits?.[0];
                if (hit) back = `#${hit.workN} "${hit.workTitle}" p.${hit.pageStart}: "${hit.snippet.slice(0, 300)}"`;
            } catch {}

            s.cards.push(_newCard({
                sourceId,
                type: 'concept',
                workN: h.workN || null,
                front: `Explicá el concepto: "${term}" (en la obra de Grinberg)`,
                back
            }));
            created++;
        }

        if (created > 0) _save(s);
        return { created, total: s.cards.length };
    }

    function _newCard({ sourceId, type, workN, front, back }) {
        return {
            id: 'c_' + Date.now() + '_' + Math.floor(Math.random() * 10000),
            sourceId, type, workN, front, back,
            ease: 2.5,
            interval: 0,        // días; 0 = nueva
            reps: 0,
            lapses: 0,
            dueAt: new Date().toISOString(),   // nueva = due ya
            createdAt: new Date().toISOString(),
            lastReviewAt: null
        };
    }

    // ═════════════════════════════════════════════
    // SM-2 simplificado
    // quality: 0=again · 3=hard · 4=good · 5=easy
    // ═════════════════════════════════════════════
    function answer(cardId, quality) {
        const s = _load();
        const c = s.cards.find(x => x.id === cardId);
        if (!c) return null;

        s.stats.reviews++;
        const now = Date.now();

        if (quality < 3) {
            // Lapse: reiniciar, re-ver en 10 minutos
            c.reps = 0;
            c.lapses++;
            c.interval = 0;
            c.dueAt = new Date(now + 10 * 60 * 1000).toISOString();
            c.ease = Math.max(1.3, c.ease - 0.2);
        } else {
            s.stats.correct++;
            c.reps++;
            if (c.reps === 1)      c.interval = 1;
            else if (c.reps === 2) c.interval = 3;
            else                   c.interval = Math.round(c.interval * c.ease);
            // Ajuste de ease (fórmula SM-2)
            c.ease = Math.max(1.3, c.ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
            c.dueAt = new Date(now + c.interval * 86400000).toISOString();
        }
        c.lastReviewAt = new Date(now).toISOString();
        _save(s);
        return c;
    }

    function getDue(limit = 20) {
        const s = _load();
        const now = Date.now();
        return s.cards
            .filter(c => new Date(c.dueAt).getTime() <= now)
            .sort((a, b) => new Date(a.dueAt) - new Date(b.dueAt))
            .slice(0, limit);
    }

    function stats() {
        const s = _load();
        const now = Date.now();
        const due = s.cards.filter(c => new Date(c.dueAt).getTime() <= now).length;
        const learning = s.cards.filter(c => c.reps > 0 && c.interval < 21).length;
        const mature = s.cards.filter(c => c.interval >= 21).length;
        return {
            total: s.cards.length,
            due, learning, mature,
            reviews: s.stats.reviews,
            accuracy: s.stats.reviews ? Math.round((s.stats.correct / s.stats.reviews) * 100) : null
        };
    }

    function removeCard(id) {
        const s = _load();
        s.cards = s.cards.filter(c => c.id !== id);
        _save(s);
    }

    // Sync helpers (integrados al push/pull de tutor-notes)
    function exportAll() { return _load(); }
    function importMerge(remote) {
        if (!remote?.cards) return 0;
        const s = _load();
        const ids = new Set(s.cards.map(c => c.id));
        let merged = 0;
        for (const c of remote.cards) {
            if (!ids.has(c.id)) { s.cards.push(c); merged++; }
        }
        if (merged) _save(s);
        return merged;
    }

    window.GunterRepaso = { generateCards, getDue, answer, stats, removeCard, exportAll, importMerge };
})();
