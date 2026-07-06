/* =============================================
   TUTOR — Sage Engine (BM25 + concepts + cross-refs)
   -------------------------------------------------
   Motor de comprensión sabio. 100% local, cero costo.

   API:
     query(text, opts)      → top K chunks con BM25
     bookConcepts(workN)    → conceptos clave del libro
     crossRefs(workN)       → libros con conceptos compartidos
     conceptBookMap(term)   → qué libros hablan más de un término
     sage(text, opts)       → pipeline completo:
                              query + expandir con cross-refs +
                              concept map → contexto rico para LLM
   ============================================= */

const fs   = require('fs');
const path = require('path');
const { tokenize } = require('./build-index');

const INDEX_DIR = path.join(__dirname, '..', '..', 'tutor-library', 'index');

// ═════════════════════════════════════════════
// Lazy loading (una sola vez por proceso)
// ═════════════════════════════════════════════
let _chunks   = null;   // Array de chunks
let _chunkMap = null;   // Map id → chunk
let _postings = null;   // { term: { chunkId: freq } }
let _stats    = null;   // { N, avgLen, df: { term: docFreq } }
let _concepts = null;   // { workN: { topConcepts, ... } }
let _cross    = null;   // { workN: [{ workN, shared, score }] }
let _digests  = null;   // { workN: { toc, opening, signature_passages, ... } }
let _loadedAt = 0;

function loadIndex(force = false) {
    if (!force && _chunks) return true;
    try {
        _chunks   = JSON.parse(fs.readFileSync(path.join(INDEX_DIR, 'chunks.json'),    'utf8'));
        _postings = JSON.parse(fs.readFileSync(path.join(INDEX_DIR, 'postings.json'),  'utf8'));
        _stats    = JSON.parse(fs.readFileSync(path.join(INDEX_DIR, 'stats.json'),     'utf8'));
        _concepts = JSON.parse(fs.readFileSync(path.join(INDEX_DIR, 'concepts.json'),  'utf8'));
        _cross    = JSON.parse(fs.readFileSync(path.join(INDEX_DIR, 'cross-refs.json'),'utf8'));
        // digests son opcionales — pueden no existir si el usuario aún no corrió build-digests
        try { _digests = JSON.parse(fs.readFileSync(path.join(INDEX_DIR, 'digests.json'), 'utf8')); }
        catch { _digests = null; }
        _chunkMap = new Map(_chunks.map(c => [c.id, c]));
        _loadedAt = Date.now();
        return true;
    } catch (e) {
        console.error('[sage] load index failed:', e.message);
        return false;
    }
}

function indexStatus() {
    if (!loadIndex()) return { loaded: false };
    return {
        loaded: true,
        chunks: _chunks.length,
        vocab: Object.keys(_postings).length,
        avgLen: _stats.avgLen,
        builtAt: _stats.builtAt
    };
}

// ═════════════════════════════════════════════
// BM25 ranking
// ═════════════════════════════════════════════
const K1 = 1.5;
const B  = 0.75;

function bm25Score(queryTokens, chunk) {
    if (!chunk || chunk.len === 0) return 0;
    let score = 0;
    const N = _stats.N;
    const avgLen = _stats.avgLen;
    for (const t of queryTokens) {
        const df = _stats.df[t];
        if (!df) continue;
        const tf = _postings[t]?.[chunk.id] || 0;
        if (tf === 0) continue;
        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
        const denom = tf + K1 * (1 - B + B * chunk.len / avgLen);
        score += idf * (tf * (K1 + 1)) / denom;
    }
    return score;
}

/**
 * Consulta BM25 sobre todos los chunks. Returns top K con score.
 * opts: { limit, restrictWorks: [workN] }
 */
function query(text, opts = {}) {
    if (!loadIndex()) return { hits: [], reason: 'index-not-built' };
    const tokens = tokenize(text || '');
    if (tokens.length === 0) return { hits: [] };

    const limit = Math.min(Math.max(1, opts.limit || 8), 30);
    const restrict = opts.restrictWorks ? new Set(opts.restrictWorks.map(String)) : null;

    // Candidatos: chunks que tienen al menos un término del query
    const cand = new Map();  // chunkId → hits count
    for (const t of tokens) {
        const posts = _postings[t];
        if (!posts) continue;
        for (const chunkId of Object.keys(posts)) {
            cand.set(chunkId, (cand.get(chunkId) || 0) + 1);
        }
    }

    const scored = [];
    for (const chunkId of cand.keys()) {
        const c = _chunkMap.get(chunkId);
        if (!c) continue;
        if (restrict && !restrict.has(c.workN)) continue;
        const s = bm25Score(tokens, c);
        if (s > 0) scored.push({ chunk: c, score: s, matchedTerms: cand.get(chunkId) });
    }
    scored.sort((a, b) => b.score - a.score);

    return {
        queryTokens: tokens,
        candidatesCount: cand.size,
        hits: scored.slice(0, limit).map(h => ({
            id: h.chunk.id,
            workN: h.chunk.workN,
            workTitle: h.chunk.workTitle,
            pageStart: h.chunk.pageStart,
            pageEnd: h.chunk.pageEnd,
            score: Number(h.score.toFixed(3)),
            matchedTerms: h.matchedTerms,
            text: h.chunk.text,
            snippet: makeSnippet(h.chunk.text, tokens, 320)
        }))
    };
}

function makeSnippet(text, tokens, maxLen = 320) {
    if (!text) return '';
    // Buscar la primera aparición aproximada del primer término
    const normText = text.toLowerCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '');
    let pos = -1;
    for (const t of tokens) {
        const idx = normText.indexOf(t.slice(0, Math.min(t.length, 6)));
        if (idx >= 0 && (pos < 0 || idx < pos)) pos = idx;
    }
    if (pos < 0) pos = 0;
    const start = Math.max(0, pos - 80);
    let snippet = text.slice(start, start + maxLen);
    if (start > 0) snippet = '…' + snippet;
    if (start + maxLen < text.length) snippet = snippet + '…';
    return snippet.replace(/\s+/g, ' ').trim();
}

// ═════════════════════════════════════════════
// Concepts & cross-refs
// ═════════════════════════════════════════════
function bookConcepts(workN) {
    if (!loadIndex()) return null;
    return _concepts[String(workN)] || null;
}

function crossRefs(workN) {
    if (!loadIndex()) return [];
    return _cross[String(workN)] || [];
}

/**
 * Para un término, en qué libros aparece más (por TF-IDF ranking).
 * Útil para "qué libros hablan sobre X".
 */
function conceptBookMap(term) {
    if (!loadIndex()) return [];
    const { stem } = require('./build-index');
    const stemmed = stem(term.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''));
    const hits = [];
    for (const [workN, meta] of Object.entries(_concepts)) {
        const found = meta.topConcepts.find(c => c.term === stemmed || c.term.startsWith(stemmed));
        if (found) hits.push({
            workN, title: meta.title,
            tfidf: found.tfidf,
            count: found.count,
            rank: meta.topConcepts.indexOf(found) + 1
        });
    }
    hits.sort((a, b) => b.tfidf - a.tfidf);
    return hits;
}

// ═════════════════════════════════════════════
// SAGE — el motor completo
// -------------------------------------------
// Combina BM25 + concept map + cross-refs para
// entregar un contexto RICO al LLM.
// ═════════════════════════════════════════════
function sage(text, opts = {}) {
    if (!loadIndex()) return { ok: false, reason: 'index-not-built' };

    const primary = query(text, { limit: opts.limit || 6 });

    // Qué libros aparecen en los top hits
    const worksInHits = new Set(primary.hits.map(h => h.workN));

    // Cross-refs desde los primeros 3 libros → recomienda otros libros relacionados
    const relatedBooks = new Map(); // workN → { title, sharedConcepts, viaBooks }
    let count = 0;
    for (const h of primary.hits) {
        if (count++ >= 3) break;
        const refs = crossRefs(h.workN);
        for (const r of refs.slice(0, 3)) {
            if (worksInHits.has(r.workN)) continue;
            const existing = relatedBooks.get(r.workN) || { workN: r.workN, title: r.title, sharedConcepts: new Set(), viaBooks: [] };
            for (const t of r.shared) existing.sharedConcepts.add(t);
            existing.viaBooks.push(h.workN);
            relatedBooks.set(r.workN, existing);
        }
    }
    const related = Array.from(relatedBooks.values()).map(r => ({
        workN: r.workN,
        title: r.title,
        sharedConcepts: Array.from(r.sharedConcepts).slice(0, 8),
        viaBooks: r.viaBooks
    })).slice(0, 4);

    // Concept-book map: para los términos del query, qué libros son "expertos"
    const termExperts = {};
    for (const t of primary.queryTokens.slice(0, 3)) {
        const experts = conceptBookMap(t).slice(0, 3);
        if (experts.length) termExperts[t] = experts;
    }

    return {
        ok: true,
        query: text,
        queryTokens: primary.queryTokens,
        primaryHits: primary.hits,
        candidatesConsidered: primary.candidatesCount,
        relatedBooks: related,
        termExperts,
        stats: {
            chunksTotal: _chunks.length,
            vocab: Object.keys(_postings).length
        }
    };
}

function bookDigest(workN) {
    if (!loadIndex()) return null;
    if (!_digests) return null;
    return _digests[String(workN)] || null;
}

/**
 * SÍNTESIS CRUZADA: pipeline multi-query con expansión de términos.
 * Objetivo: para una pregunta transversal, recolectar pasajes de VARIOS libros
 * y armar una matriz de contribuciones por obra.
 */
function synthesize(query, opts = {}) {
    if (!loadIndex()) return { ok: false, reason: 'index-not-built' };
    const { tokenize } = require('./build-index');

    // 1. Primera pasada BM25 con la query original
    const initial = query.trim();
    const initialTokens = tokenize(initial);
    if (initialTokens.length === 0) return { ok: false, reason: 'empty-query' };

    const firstPass = _bm25(initialTokens, 15);
    if (firstPass.length === 0) {
        return { ok: true, query: initial, contributingBooks: [], expansionTerms: [], totalHits: 0, allHits: [] };
    }

    // 2. Expansión: extraer los términos más frecuentes de los top-8 chunks
    const expansionCandidates = new Map();
    const topChunks = firstPass.slice(0, 8);
    for (const { chunk } of topChunks) {
        const chunkTokens = tokenize(chunk.text);
        for (const t of chunkTokens) {
            if (initialTokens.includes(t)) continue;    // ya están en la query
            const df = _stats.df[t];
            if (!df || df > _stats.N * 0.4) continue;    // muy común, no aporta
            expansionCandidates.set(t, (expansionCandidates.get(t) || 0) + 1);
        }
    }
    // Top 4 términos de expansión, mínimo 2 apariciones en los top chunks
    const expansionTerms = Array.from(expansionCandidates.entries())
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([t]) => t);

    // 3. Segunda pasada BM25 con la query expandida
    const expandedTokens = [...initialTokens, ...expansionTerms];
    const secondPass = expansionTerms.length > 0 ? _bm25(expandedTokens, 20) : firstPass;

    // 4. Merge por chunk-id (dedup)
    const merged = new Map();
    for (const h of firstPass) merged.set(h.chunk.id, { ...h, source: 'initial' });
    for (const h of secondPass) {
        if (merged.has(h.chunk.id)) {
            const existing = merged.get(h.chunk.id);
            existing.score = Math.max(existing.score, h.score);
        } else {
            merged.set(h.chunk.id, { ...h, source: 'expanded' });
        }
    }
    const allHits = Array.from(merged.values()).sort((a, b) => b.score - a.score);

    // 5. Agrupar por libro: matriz de contribuciones
    const byBook = new Map();
    for (const { chunk, score, source } of allHits) {
        if (!byBook.has(chunk.workN)) {
            byBook.set(chunk.workN, {
                workN: chunk.workN,
                workTitle: chunk.workTitle,
                passageCount: 0,
                topScore: 0,
                totalScore: 0,
                topPages: new Set(),
                sourceMix: { initial: 0, expanded: 0 },
                topPassages: []
            });
        }
        const b = byBook.get(chunk.workN);
        b.passageCount++;
        b.totalScore += score;
        b.topScore = Math.max(b.topScore, score);
        b.topPages.add(chunk.pageStart);
        b.sourceMix[source]++;
        if (b.topPassages.length < 3) {
            b.topPassages.push({
                pageStart: chunk.pageStart,
                pageEnd: chunk.pageEnd,
                score: Number(score.toFixed(3)),
                snippet: chunk.text.slice(0, 320) + (chunk.text.length > 320 ? '…' : '')
            });
        }
    }

    const contributingBooks = Array.from(byBook.values())
        .map(b => ({
            ...b,
            topPages: Array.from(b.topPages).sort((a, b) => a - b).slice(0, 8),
            avgScore: Number((b.totalScore / b.passageCount).toFixed(3)),
            topScore: Number(b.topScore.toFixed(3))
        }))
        .sort((a, b) => b.totalScore - a.totalScore);

    return {
        ok: true,
        query: initial,
        queryTokens: initialTokens,
        expansionTerms,
        totalHits: allHits.length,
        contributingBooks,
        allHits: allHits.slice(0, opts.limit || 12).map(h => ({
            workN: h.chunk.workN,
            workTitle: h.chunk.workTitle,
            pageStart: h.chunk.pageStart,
            pageEnd: h.chunk.pageEnd,
            score: Number(h.score.toFixed(3)),
            snippet: h.chunk.text.slice(0, 320) + (h.chunk.text.length > 320 ? '…' : ''),
            source: h.source
        }))
    };
}

// Helper BM25 devuelve array de { chunk, score }
function _bm25(queryTokens, limit) {
    const K1 = 1.5, B = 0.75;
    const N = _stats.N;
    const avgLen = _stats.avgLen;

    const cand = new Map();
    for (const t of queryTokens) {
        const posts = _postings[t];
        if (!posts) continue;
        for (const chunkId of Object.keys(posts)) cand.set(chunkId, true);
    }
    const scored = [];
    for (const chunkId of cand.keys()) {
        const c = _chunkMap.get(chunkId);
        if (!c) continue;
        let score = 0;
        for (const t of queryTokens) {
            const df = _stats.df[t]; if (!df) continue;
            const tf = _postings[t]?.[chunkId] || 0; if (tf === 0) continue;
            const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
            const denom = tf + K1 * (1 - B + B * c.len / avgLen);
            score += idf * (tf * (K1 + 1)) / denom;
        }
        if (score > 0) scored.push({ chunk: c, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
}

/**
 * Devuelve un inventario COMPLETO de lo que el sabio tiene indexado.
 * Base para la regla "nunca inventes fuera de esto".
 */
function inventory() {
    if (!loadIndex()) return null;

    const byWork = new Map();
    for (const c of _chunks) {
        const w = byWork.get(c.workN) || { workN: c.workN, workTitle: c.workTitle, chunks: 0, chapters: 0, hasDigest: false, wordCount: 0 };
        w.chunks++;
        w.wordCount += c.len || 0;
        byWork.set(c.workN, w);
    }
    // Enrich with digest info
    for (const [workN, w] of byWork.entries()) {
        const dig = _digests?.[workN];
        if (dig) {
            w.hasDigest = true;
            w.chapters = dig.toc?.filter(t => t.chunkCount > 0).length || 0;
            w.readingTimeMin = dig.stats?.readingTimeMin || 0;
        }
    }

    const indexed = Array.from(byWork.values()).sort((a, b) => Number(a.workN) - Number(b.workN));

    return {
        chunksTotal: _chunks.length,
        vocabSize: Object.keys(_postings).length,
        digestsAvailable: !!_digests,
        digestsCount: _digests ? Object.keys(_digests).length : 0,
        indexed
    };
}

/**
 * Obtiene los chunks completos de un capítulo (por chapterIdx en el TOC).
 * Retorna el contenido literal para contexto RAG a nivel capítulo.
 */
function chapterContent(workN, chapterIdx) {
    if (!loadIndex() || !_digests) return null;
    const digest = _digests[String(workN)];
    if (!digest || !digest.toc) return null;
    const idx = Number(chapterIdx);
    const ch = digest.toc[idx];
    if (!ch) return null;
    // Traer todos los chunks del capítulo
    const chunkIds = ch.chunkIds || [];
    const chunks = chunkIds.map(id => _chunkMap.get(id)).filter(Boolean);
    return {
        workN, chapterIdx: idx,
        label: ch.label,
        pageStart: ch.pageStart,
        pageEnd: ch.pageEnd,
        chunkCount: chunks.length,
        wordCount: ch.wordCount,
        readingTimeMin: ch.readingTimeMin,
        concepts: ch.concepts,
        signaturePassage: ch.signaturePassage,
        // Contenido completo para RAG (hasta 5000 chars)
        content: chunks.map(c => c.text).join('\n\n').slice(0, 5000)
    };
}

function digestsAvailable() {
    loadIndex();
    return !!_digests;
}

module.exports = {
    loadIndex, indexStatus,
    query, sage,
    bookConcepts, crossRefs, conceptBookMap,
    bookDigest, digestsAvailable, chapterContent,
    inventory, synthesize
};
