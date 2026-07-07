/* =============================================
   GUNTER SERVICE — Tutor (Fase A)
   -------------------------------------------------
   Client thin sobre /api/tutor.
   Ops: catalog, work, curricula, session, progress, suggest.
   Cache en memoria del catalog (raramente cambia).
   ============================================= */
(function () {
    if (window.GunterTutor) return;

    let _catalogCache = null;
    let _catalogAt = 0;
    const CATALOG_TTL_MS = 5 * 60 * 1000;

    function url() {
        const c = window.GUNTER_CONFIG || {};
        return (c.PROXY_BASE_URL || '') + '/api/tutor';
    }

    async function call(op, params = {}) {
        try {
            const resp = await fetch(url(), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ op, ...params })
            });
            if (!resp.ok) throw new Error('tutor HTTP ' + resp.status);
            const json = await resp.json();
            if (!json.success) throw new Error(json.error || 'tutor failed');
            return json.data;
        } catch (e) {
            console.warn('[tutor]', op, 'fail:', e.message);
            return null;
        }
    }

    async function catalog(force = false) {
        if (!force && _catalogCache && (Date.now() - _catalogAt) < CATALOG_TTL_MS) {
            return _catalogCache;
        }
        const data = await call('catalog');
        if (data) { _catalogCache = data; _catalogAt = Date.now(); }
        return data;
    }

    async function work(n)          { return call('work', { n: String(n) }); }
    async function curricula()      { return call('curricula'); }
    async function session(userId = 'default') { return call('session', { userId }); }
    async function progress(params) { return call('progress', params); }
    async function suggest(params)  { return call('suggest', params); }
    async function search(query, params = {}) { return call('search', { query, ...params }); }

    // ═════════════════════════════════════════════
    // Sage — BM25 + concepts + cross-refs
    // ═════════════════════════════════════════════
    async function sageStatus()                  { return call('sage-status'); }
    async function sageQuery(query, params = {}) { return call('sage-query', { query, ...params }); }
    async function sageBm25(query, params = {})  { return call('sage-bm25',  { query, ...params }); }
    async function sageConcepts(n) {
        const cached = _warm?.conceptsByWork?.get?.(String(n));
        if (cached) return cached;
        return call('sage-concepts', { n: String(n) });
    }
    async function sageCrossRefs(n) {
        const cached = _warm?.crossRefsByWork?.get?.(String(n));
        if (cached) return cached;
        return call('sage-crossrefs', { n: String(n) });
    }
    async function sageExperts(term)             { return call('sage-experts', { term }); }
    async function sageDigest(n) {
        const cached = _warm?.digestsByWork?.get?.(String(n));
        if (cached) return cached;
        return call('sage-digest', { n: String(n) });
    }
    async function sageChapter(n, chapterIdx)    { return call('sage-chapter', { n: String(n), chapterIdx }); }
    async function sageInventory() {
        if (_warm?.inventory) return _warm.inventory;
        return call('sage-inventory');
    }
    async function sageSynthesize(query, params = {}) { return call('sage-synthesize', { query, ...params }); }

    // ═════════════════════════════════════════════
    // Cache warming — precarga todo al activar tutor
    // Objetivo: respuestas <20ms tras el warm-up
    // ═════════════════════════════════════════════
    const _warm = {
        catalog: null, inventory: null, sageStatus: null,
        digestsByWork: new Map(),
        conceptsByWork: new Map(),
        crossRefsByWork: new Map(),
        warmedAt: 0
    };

    async function warmup(force = false) {
        if (!force && _warm.warmedAt && (Date.now() - _warm.warmedAt) < 60 * 1000) return _warm;
        const t0 = Date.now();
        try {
            // v35: 1 solo request bulk en vez de ~65 paralelos
            const [cat, status, bulk] = await Promise.all([
                catalog(true), sageStatus(), call('sage-bulk')
            ]);
            _warm.catalog = cat;
            _warm.sageStatus = status;
            if (bulk) {
                _warm.inventory = bulk.inventory;
                for (const [n, d] of Object.entries(bulk.digests || {}))   _warm.digestsByWork.set(n, d);
                for (const [n, c] of Object.entries(bulk.concepts || {}))  _warm.conceptsByWork.set(n, c);
                for (const [n, r] of Object.entries(bulk.crossRefs || {})) _warm.crossRefsByWork.set(n, { workN: n, refs: r });
            }
            _warm.warmedAt = Date.now();
            console.info('[tutor] warmup ok (bulk):', {
                books: _warm.inventory?.indexed?.length || 0,
                digests: _warm.digestsByWork.size,
                took: (Date.now() - t0) + 'ms'
            });
        } catch (e) {
            console.warn('[tutor] warmup fail:', e.message);
        }
        return _warm;
    }

    function warmedGet(kind, n) {
        if (kind === 'digest')   return _warm.digestsByWork.get(String(n)) || null;
        if (kind === 'concepts') return _warm.conceptsByWork.get(String(n)) || null;
        if (kind === 'crossRefs')return _warm.crossRefsByWork.get(String(n)) || null;
        return null;
    }

    // Marcador temporal para inyectar contenido de capítulo al siguiente prompt
    // Se setea desde el UI cuando el user pide "Hablar de esta sección"
    let _chapterFocus = null;
    function setChapterFocus(focus) { _chapterFocus = focus; }
    function clearChapterFocus() { _chapterFocus = null; }
    function getChapterFocus() { return _chapterFocus; }

    function isEnabled() {
        // v50: además del flag, requiere permiso concedido por el admin
        if (window.GunterAuth && !window.GunterAuth.canTutor()) return false;
        return !!(window.PremiumFeaturesService?.isEnabled?.('tutorMode'));
    }

    /**
     * Prompt system para el LLM cuando modo tutor está ON.
     * v34 (Diet): contexto condicional — catálogo/rutas solo cuando la query
     * lo amerita; inventario comprimido; digest compacto. ~3k tokens vs ~10k.
     */
    async function buildTutorContext(userQuery = null) {
        const cat = await catalog();
        if (!cat) return null;
        const sess = await session();
        // Warm-up (idempotente, cached)
        await warmup().catch(() => {});
        const inv = _warm.inventory;
        const q = (userQuery || '').toLowerCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '');

        // ¿La query pide info del catálogo/rutas? Solo ahí inyectamos la lista completa.
        const wantsCatalog = /\b(biblioteca|catalogo|libros|obras|que (tenes|hay|libros)|lista|rutas?|curriculum|curricul|por donde (empiezo|arranco)|que leo)\b/.test(q);

        const lines = [];
        lines.push(`MODO SABIO ACTIVO. Biblioteca: obra completa de ${cat.author?.name || 'autor'} (${cat.totalWorks} obras).`);

        // Inventario comprimido — ya está TODO indexado, no hace falta listar
        if (inv) {
            const weak = inv.indexed.filter(w => w.chunks < 3).map(w => '#' + w.workN);
            lines.push(`Corpus indexado: ${inv.indexed.length}/${cat.totalWorks} obras · ${inv.chunksTotal} pasajes · ${(inv.vocabSize/1000).toFixed(0)}k términos.`);
            if (weak.length) lines.push(`Obras con texto casi nulo (evitá citarlas): ${weak.join(', ')}.`);
        }
        lines.push('Si necesitás el catálogo completo o las rutas de estudio y no están abajo, decile al usuario que te lo pida ("mostrame la biblioteca").');

        // Chapter focus: si el usuario clickeó "Hablar de esta sección",
        // inyectamos el contenido completo del capítulo como contexto primario.
        if (_chapterFocus) {
            lines.push('');
            lines.push('═══ FOCO ESTA CONVERSACIÓN: UN CAPÍTULO ESPECÍFICO ═══');
            lines.push(`Obra #${_chapterFocus.workN} · Capítulo ${_chapterFocus.chapterIdx + 1}: "${_chapterFocus.label}"`);
            lines.push(`Páginas ${_chapterFocus.pageStart}–${_chapterFocus.pageEnd} · ${_chapterFocus.wordCount} palabras · ${_chapterFocus.readingTimeMin} min de lectura.`);
            if (_chapterFocus.concepts?.length) {
                lines.push(`Conceptos clave de este capítulo: ${_chapterFocus.concepts.slice(0,6).map(c => c.term).join(', ')}.`);
            }
            if (_chapterFocus.signaturePassage) {
                lines.push('');
                lines.push('Pasaje signature del capítulo:');
                lines.push(`"${_chapterFocus.signaturePassage.text.slice(0, 400)}..."`);
            }
            if (_chapterFocus.content) {
                lines.push('');
                lines.push('CONTENIDO DEL CAPÍTULO (texto completo hasta 5000 chars):');
                lines.push(_chapterFocus.content);
            }
            lines.push('═══════════════════════════════════════');
            lines.push('IMPORTANTE: la conversación está enfocada en ESTE capítulo. Cuando expliques, citá páginas de ESTE rango. Si el usuario pregunta algo fuera del capítulo, orientalo pero no te salgás del foco a menos que él lo pida explícitamente.');
        }

        // Digest COMPACTO de la obra en curso (solo si hay sesión activa)
        if (sess?.currentWorkMeta) {
            try {
                const dig = await sageDigest(sess.currentWorkMeta.n);
                if (dig) {
                    lines.push('');
                    lines.push(`OBRA EN CURSO: #${sess.currentWorkMeta.n} "${dig.title}" — ${dig.stats.readingTimeMin} min · ${dig.stats.textPages} pág.`);
                    if (dig.concept_summary?.length) {
                        lines.push(`Conceptos: ${dig.concept_summary.slice(0, 8).map(c => c.term).join(', ')}.`);
                    }
                    if (dig.toc?.length) {
                        lines.push(`Estructura: ${dig.toc.slice(0, 8).map(h => `p.${h.pageNum} ${h.label.slice(0, 30)}`).join(' · ')}${dig.toc.length > 8 ? ` (+${dig.toc.length - 8} más)` : ''}.`);
                    }
                    if (dig.signature_passages?.length) {
                        const p = dig.signature_passages[0];
                        lines.push(`Pasaje signature (p.${p.pageStart}): "${p.text.slice(0, 200)}…"`);
                    }
                }
            } catch { /* digest opcional */ }
        }

        // Catálogo + rutas — SOLO si la query lo pide
        if (wantsCatalog) {
            lines.push('');
            lines.push('CATÁLOGO (ID · título · temas · dificultad):');
            for (const w of (cat.works || [])) {
                lines.push(`  #${w.n} · ${w.title} — ${(w.themes||[]).join('/')} · ${w.difficulty}`);
            }
            lines.push('RUTAS DE ESTUDIO:');
            for (const c of (cat.curricula || [])) {
                lines.push(`  · ${c.label}: ${c.path.join(' → ')}`);
            }
        }

        // ═════════════════════════════════════════
        // SAGE RAG (BM25 + cross-refs + concept map)
        // ═════════════════════════════════════════
        if (userQuery && userQuery.length >= 4) {
            try {
                const sageRes = await sageQuery(userQuery, { limit: 5 });
                if (sageRes?.ok && sageRes.primaryHits?.length) {
                    lines.push('');
                    lines.push(`═══ SAGE — pasajes relevantes a "${userQuery}" (BM25) ═══`);
                    for (const h of sageRes.primaryHits) {
                        lines.push(`▸ #${h.workN} "${h.workTitle}" p.${h.pageStart}${h.pageEnd !== h.pageStart ? '–'+h.pageEnd : ''} (score ${h.score}): "${h.snippet}"`);
                    }
                    if (sageRes.relatedBooks?.length) {
                        lines.push(`Relacionados: ${sageRes.relatedBooks.slice(0, 3).map(r => `#${r.workN} (${r.sharedConcepts.slice(0,3).join(',')})`).join(' · ')}`);
                    }
                    if (sageRes.termExperts && Object.keys(sageRes.termExperts).length) {
                        lines.push(`Expertos por término: ${Object.entries(sageRes.termExperts).map(([t, ex]) => `"${t}"→${ex.slice(0,2).map(e => '#'+e.workN).join(',')}`).join(' · ')}`);
                    }
                    lines.push('═══════════════════════════════');
                }
            } catch (e) { /* sage opcional */ }
        }

        lines.push('');
        lines.push(`# ROL — SABIO/TUTOR de la obra completa de Grinberg
Profesor querido de la UNAM: paciente, claro, cadencia latina. Un concepto por vez. Cuando el tema atraviesa varios libros, hilá las fuentes. Pregunta socrática ocasional (no siempre). Tu mordacidad Gunter aparece como picante puntual, no domina la clase.

# ANTI-INVENTO (reglas duras)
1. Fuente de verdad: SOLO las secciones SAGE / OBRA EN CURSO / FOCO CAPÍTULO de arriba. Nada más es citable.
2. Cita textual únicamente si aparece literal arriba. Formato: En #<n> "<título>", p.<pág>: '<cita>'.
3. Sin evidencia → decilo y ofrecé: (a) buscar con otras palabras, (b) sugerir el libro probable, (c) tu lectura general SIN citar.
4. Paráfrasis siempre marcada: "desde mi lectura de #X".
5. Conexiones entre libros solo si aparecen en "Relacionados".
Check final: ¿cada dato factual viene del contexto de arriba? ¿cada cita es literal? Si no, reformulá.`);
        return lines.join('\n');
    }

    window.GunterTutor = {
        catalog, work, curricula, session, progress, suggest, search,
        sageStatus, sageQuery, sageBm25, sageConcepts, sageCrossRefs, sageExperts, sageDigest,
        sageChapter, sageInventory, sageSynthesize,
        warmup, warmedGet,
        setChapterFocus, clearChapterFocus, getChapterFocus,
        isEnabled, buildTutorContext
    };

    // Auto-warm cuando tutorMode se activa
    if (window.PremiumFeaturesService?.subscribe) {
        window.PremiumFeaturesService.subscribe((key, value) => {
            if ((key === 'tutorMode' || key === null) && window.PremiumFeaturesService.isEnabled('tutorMode')) {
                warmup().catch(() => {});
            }
        });
    }
    // Warm inmediato si ya está on
    if (window.PremiumFeaturesService?.isEnabled?.('tutorMode')) {
        warmup().catch(() => {});
    }
})();
