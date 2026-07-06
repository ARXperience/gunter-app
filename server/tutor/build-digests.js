/* =============================================
   TUTOR — Build Digests (per-book overview)
   -------------------------------------------------
   Genera un digest rico por cada obra indexada:
     - reading_time (minutos a 250 wpm)
     - opening (primera párrafo sustantivo)
     - closing (último párrafo sustantivo)
     - signature_passages: top-N por BM25 contra los conceptos del libro
     - toc: auto-detección de capítulos/secciones
     - concept_summary: top 12 conceptos + qué otros libros los tratan

   Uso: node server/tutor/build-digests.js
   ============================================= */

const fs   = require('fs');
const path = require('path');

const ROOT       = path.join(__dirname, '..', '..');
const TEXT_DIR   = path.join(ROOT, 'tutor-library', 'text');
const CAT_PATH   = path.join(ROOT, 'tutor-library', 'catalog', 'grinberg.json');
const INDEX_DIR  = path.join(ROOT, 'tutor-library', 'index');
const OUT_PATH   = path.join(INDEX_DIR, 'digests.json');

const { tokenize } = require('./build-index');

// ═════════════════════════════════════════════
// Cargar índice existente
// ═════════════════════════════════════════════
function loadIndex() {
    return {
        chunks:   JSON.parse(fs.readFileSync(path.join(INDEX_DIR, 'chunks.json'),   'utf8')),
        postings: JSON.parse(fs.readFileSync(path.join(INDEX_DIR, 'postings.json'), 'utf8')),
        stats:    JSON.parse(fs.readFileSync(path.join(INDEX_DIR, 'stats.json'),    'utf8')),
        concepts: JSON.parse(fs.readFileSync(path.join(INDEX_DIR, 'concepts.json'), 'utf8'))
    };
}

// ═════════════════════════════════════════════
// Chapter detection: heurísticas para libros de Grinberg
// -------------------------------------------
// Patrones observados en la muestra:
//   "CAPÍTULO X" / "CAPÍTULO IX"
//   "Capítulo 3", "Capitulo 3"
//   "INDICE", "PRÓLOGO", "INTRODUCCIÓN", "EPÍLOGO"
//   Nombres de ejercicio en ALL-CAPS (línea sola)
// ═════════════════════════════════════════════
const CHAPTER_PATTERNS = [
    // Fuertes (título con "Capítulo")
    { re: /^(cap[íi]tulo\s+[ivxlc\d]+[.\s:–\-—]*)\s*(.*)$/i,      strength: 10 },
    // Secciones romanas al inicio de línea
    { re: /^(parte\s+[ivxlc]+[.\s:–\-—]*)\s*(.*)$/i,               strength: 9 },
    // Prólogo/intro
    { re: /^(pr[óo]logo|introducci[óo]n|pref[aá]cio|ep[íi]logo|conclusi[óo]n|apéndice|apendice)\s*[.:\s]*(.*)$/i, strength: 9 },
    // ALL-CAPS line (>= 8 chars, sin números iniciales)
    { re: /^([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s,.'\-]{6,})$/,                 strength: 6 }
];

function detectHeaders(pageText, pageNum) {
    const lines = pageText.split(/\n/);
    const found = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.length < 5 || line.length > 90) continue;
        // Ignorar líneas que parecen texto corriente (muchas palabras minúsculas)
        const lowerRatio = (line.match(/[a-záéíóúñ]/g) || []).length / Math.max(1, line.length);
        for (const pat of CHAPTER_PATTERNS) {
            const m = line.match(pat.re);
            if (!m) continue;
            // Filtros extra: ALL-CAPS heurística — la mayoría del texto de la línea debe ser caps
            if (pat.strength === 6 && lowerRatio > 0.15) continue;
            // Evitar falso positivo si es número de página o número aislado
            if (/^\d+$/.test(line)) continue;
            found.push({
                pageNum,
                lineIdx: i,
                text: line,
                strength: pat.strength,
                label: (m[1] + (m[2] ? ' ' + m[2] : '')).trim().slice(0, 80)
            });
            break;
        }
    }
    return found;
}

function buildToc(pages) {
    const all = [];
    for (const p of pages) {
        const hdrs = detectHeaders(p.text || '', p.pageNum);
        for (const h of hdrs) all.push(h);
    }
    // Deduplicar: si en la misma página hay múltiples ALL-CAPS, tomar solo el más fuerte
    const byPage = new Map();
    for (const h of all) {
        const key = h.pageNum;
        if (!byPage.has(key) || byPage.get(key).strength < h.strength) byPage.set(key, h);
    }
    const raw = Array.from(byPage.values()).sort((a, b) => a.pageNum - b.pageNum);

    // Filtrar: si hay muchísimos ALL-CAPS consecutivos son probablemente sub-secciones/ejercicios
    let strong = raw.filter(h => h.strength >= 9);
    let toc = strong.length >= 3 ? strong.slice(0, 40) : raw.slice(0, 40);

    const lastPage = pages.length > 0 ? Math.max(...pages.map(p => p.pageNum)) : 0;

    // FALLBACK (v35): si el heurístico detectó <4 secciones en un libro largo,
    // los capítulos no siguen el patrón "CAPÍTULO X" — dividimos en tramos
    // uniformes de ~25 páginas para que el chapter-analysis igual funcione.
    const SPARSE_MIN_PAGES = 60;
    if (toc.length < 4 && lastPage >= SPARSE_MIN_PAGES) {
        const SEGMENT = 25;
        const segments = [];
        // Respetar los headers reales detectados como anclas si existen
        const anchors = toc.map(h => h.pageNum).sort((a, b) => a - b);
        let start = 1;
        while (start <= lastPage) {
            const end = Math.min(start + SEGMENT - 1, lastPage);
            // ¿Hay un header real dentro de este tramo? Usarlo como label
            const anchor = raw.find(h => h.pageNum >= start && h.pageNum <= end);
            segments.push({
                pageNum: start,
                strength: 1,
                label: anchor ? anchor.label : `Tramo p.${start}–${end}`,
                synthetic: !anchor
            });
            start = end + 1;
        }
        toc = segments.slice(0, 40);
    }

    // Calcular pageEnd para cada sección: hasta la siguiente sección o hasta el fin del libro
    for (let i = 0; i < toc.length; i++) {
        toc[i].chapterIdx = i;
        toc[i].pageEnd = (i + 1 < toc.length) ? toc[i + 1].pageNum - 1 : lastPage;
        toc[i].pageStart = toc[i].pageNum;
    }
    return toc;
}

// ═════════════════════════════════════════════
// Análisis por capítulo (chapter-level TF-IDF + signature)
// ═════════════════════════════════════════════
function analyzeChapter(workN, toc, index) {
    const { chunks, postings, stats } = index;
    const bookChunks = chunks.filter(c => c.workN === workN);

    return toc.map(ch => {
        // Encontrar chunks cuyo rango de páginas cae dentro del capítulo
        const chunksInCh = bookChunks.filter(c =>
            c.pageStart >= ch.pageStart && c.pageStart <= ch.pageEnd
        );
        const totalWords = chunksInCh.reduce((a, c) => a + c.len, 0);
        if (chunksInCh.length === 0) {
            return { ...ch, chunkCount: 0, wordCount: 0, concepts: [], signaturePassage: null };
        }

        // TF por término dentro del capítulo
        const chapterTf = new Map();
        for (const c of chunksInCh) {
            const chunkPosts = Object.keys(postings).filter(t => postings[t][c.id]);
            for (const t of chunkPosts) {
                chapterTf.set(t, (chapterTf.get(t) || 0) + postings[t][c.id]);
            }
        }

        // Score TF-IDF por término (IDF global, TF del capítulo)
        const scored = [];
        for (const [t, tf] of chapterTf.entries()) {
            const df = stats.df[t];
            if (!df) continue;
            const idf = Math.log((stats.N - df + 0.5) / (df + 0.5) + 1);
            if (idf < 0.5) continue;    // muy común, no aporta
            scored.push({ term: t, tf, score: tf * idf });
        }
        scored.sort((a, b) => b.score - a.score);
        const concepts = scored.slice(0, 8).map(s => ({ term: s.term, count: s.tf }));

        // Signature passage del capítulo: chunk con mayor score contra los conceptos del capítulo
        const K1 = 1.5, B = 0.75;
        const queryTerms = scored.slice(0, 5).map(s => s.term);
        let bestChunk = null, bestScore = 0;
        for (const c of chunksInCh) {
            let sc = 0;
            for (const t of queryTerms) {
                const df = stats.df[t];
                if (!df) continue;
                const tfInChunk = postings[t]?.[c.id] || 0;
                if (tfInChunk === 0) continue;
                const idf = Math.log((stats.N - df + 0.5) / (df + 0.5) + 1);
                const denom = tfInChunk + K1 * (1 - B + B * c.len / stats.avgLen);
                sc += idf * (tfInChunk * (K1 + 1)) / denom;
            }
            if (sc > bestScore) { bestScore = sc; bestChunk = c; }
        }

        const signaturePassage = bestChunk ? {
            pageStart: bestChunk.pageStart,
            pageEnd: bestChunk.pageEnd,
            score: Number(bestScore.toFixed(3)),
            text: bestChunk.text.slice(0, 480) + (bestChunk.text.length > 480 ? '…' : '')
        } : null;

        return {
            ...ch,
            chunkCount: chunksInCh.length,
            wordCount: totalWords,
            readingTimeMin: Math.max(1, Math.round(totalWords / 250)),
            concepts,
            signaturePassage,
            chunkIds: chunksInCh.map(c => c.id).slice(0, 20)
        };
    });
}

// ═════════════════════════════════════════════
// Signature passages: top BM25 contra los propios conceptos
// ═════════════════════════════════════════════
function bookSignaturePassages(workN, index, topConcepts, N = 4) {
    const { chunks, postings, stats } = index;
    const bookChunks = chunks.filter(c => c.workN === workN);
    if (bookChunks.length === 0) return [];

    const K1 = 1.5, B = 0.75;
    const totalN = stats.N;
    const avgLen = stats.avgLen;

    const queryTerms = topConcepts.slice(0, 6).map(c => c.term);

    const scored = bookChunks.map(c => {
        let score = 0;
        for (const t of queryTerms) {
            const df = stats.df[t];
            if (!df) continue;
            const tf = postings[t]?.[c.id] || 0;
            if (tf === 0) continue;
            const idf = Math.log((totalN - df + 0.5) / (df + 0.5) + 1);
            const denom = tf + K1 * (1 - B + B * c.len / avgLen);
            score += idf * (tf * (K1 + 1)) / denom;
        }
        return { chunk: c, score };
    }).filter(s => s.score > 0);

    scored.sort((a, b) => b.score - a.score);

    // Distribuir en el libro: no queremos todos los signature passages del mismo capítulo.
    // Tomamos top-N asegurando gaps de páginas.
    const picked = [];
    const usedPages = new Set();
    for (const s of scored) {
        const range = s.chunk.pageStart;
        // Evitar chunks muy cercanos (misma página o adyacente)
        let tooClose = false;
        for (const used of usedPages) {
            if (Math.abs(used - range) < 5) { tooClose = true; break; }
        }
        if (tooClose) continue;
        picked.push({
            pageStart: s.chunk.pageStart,
            pageEnd: s.chunk.pageEnd,
            score: Number(s.score.toFixed(3)),
            text: s.chunk.text.slice(0, 500) + (s.chunk.text.length > 500 ? '…' : '')
        });
        usedPages.add(range);
        if (picked.length >= N) break;
    }
    return picked;
}

// ═════════════════════════════════════════════
// Concept experts map (compartido)
// ═════════════════════════════════════════════
function conceptExperts(concepts, term, excludeN) {
    const hits = [];
    for (const [workN, meta] of Object.entries(concepts)) {
        if (workN === excludeN) continue;
        const found = meta.topConcepts.find(c => c.term === term || c.term.startsWith(term));
        if (found) hits.push({ workN, title: meta.title, rank: meta.topConcepts.indexOf(found) + 1 });
    }
    hits.sort((a, b) => a.rank - b.rank);
    return hits.slice(0, 3);
}

// ═════════════════════════════════════════════
// Main
// ═════════════════════════════════════════════
async function main() {
    console.log('Cargando índice existente…');
    const index = loadIndex();
    const catalog = JSON.parse(fs.readFileSync(CAT_PATH, 'utf8'));

    const digests = {};
    console.log(`Generando digests para ${Object.keys(index.concepts).length} obras indexadas…\n`);

    for (const [workN, conceptMeta] of Object.entries(index.concepts)) {
        const w = catalog.works.find(x => x.n === workN);
        if (!w) continue;

        const textPath = path.join(TEXT_DIR, workN + '.json');
        if (!fs.existsSync(textPath)) continue;
        const record = JSON.parse(fs.readFileSync(textPath, 'utf8'));
        const pages = record.pages || [];

        // Reading time (250 wpm es estándar para lectura profunda)
        const wordCount = record.meta?.wordCount || 0;
        const readingTimeMin = Math.round(wordCount / 250);

        // TOC auto-detectado + análisis por capítulo
        const rawToc = buildToc(pages);
        const toc = analyzeChapter(workN, rawToc, index);

        // Opening & closing — filtra páginas con basura (portadas OCR, tablas de contenido)
        // Requiere: ≥300 chars, ratio letras alfabéticas ≥65%, no todo caps
        function _isCleanPage(text) {
            if (!text || text.length < 300) return false;
            const alphaCount = (text.match(/[a-záéíóúñüA-ZÁÉÍÓÚÑÜ]/g) || []).length;
            const alphaRatio = alphaCount / text.length;
            if (alphaRatio < 0.65) return false;
            // Detectar páginas con muchas líneas de 1-3 palabras (tablas de contenido, índices)
            const lines = text.split(/\n/).filter(l => l.trim().length > 0);
            const shortLines = lines.filter(l => l.trim().split(/\s+/).length <= 3).length;
            if (lines.length > 8 && shortLines / lines.length > 0.5) return false;
            return true;
        }
        const substantivePages = pages.filter(p => _isCleanPage(p.text));
        const openingRaw = substantivePages[0]?.text || pages.find(p => (p.text||'').length > 300)?.text || '';
        const opening = openingRaw.replace(/\s+/g, ' ').trim().slice(0, 550);
        const closingRaw = substantivePages[substantivePages.length - 1]?.text || '';
        const closing = closingRaw.replace(/\s+/g, ' ').trim().slice(0, 400);

        // Signature passages (BM25 contra top conceptos del libro)
        const signaturePassages = bookSignaturePassages(workN, index, conceptMeta.topConcepts, 5);

        // Concept summary: top 12 con experts en otras obras
        const conceptSummary = conceptMeta.topConcepts.slice(0, 12).map(c => ({
            term: c.term,
            count: c.count,
            experts: conceptExperts(index.concepts, c.term, workN)
        }));

        digests[workN] = {
            workN,
            title: w.title,
            author: catalog.author?.name,
            difficulty: w.difficulty,
            themes: w.themes,
            prerequisites: w.prerequisites,

            stats: {
                totalPages: record.totalPagesReported,
                textPages: pages.length,
                wordCount,
                readingTimeMin,
                chunks: conceptMeta.chunks
            },

            opening,
            closing,
            toc,
            signature_passages: signaturePassages,
            concept_summary: conceptSummary,

            generated_at: new Date().toISOString()
        };

        console.log(`  #${workN} "${w.title.slice(0, 40)}" — ${wordCount}w, ${readingTimeMin}m, ${toc.length} secciones, ${signaturePassages.length} signature`);
    }

    fs.writeFileSync(OUT_PATH, JSON.stringify(digests, null, 2), 'utf8');
    const size = (fs.statSync(OUT_PATH).size / 1024).toFixed(1);
    console.log(`\n✓ ${Object.keys(digests).length} digests generados. Tamaño: ${size} KB → ${OUT_PATH}`);
}

if (require.main === module) {
    main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { main };
