/* =============================================
   TUTOR — Build Index (Sage engine)
   -------------------------------------------------
   One-off script. Lee tutor-library/text/*.json →
   construye:
     - chunks.json       (array de párrafos semánticos)
     - postings.json     (índice invertido term → chunks)
     - stats.json        (N, avgLen, df por término)
     - concepts.json     (top TF-IDF por libro + summary auto)
     - cross-refs.json   (libros con conceptos compartidos)

   Uso: node server/tutor/build-index.js
   ============================================= */

const fs = require('fs');
const path = require('path');

const ROOT       = path.join(__dirname, '..', '..');
const TEXT_DIR   = path.join(ROOT, 'tutor-library', 'text');
const CAT_PATH   = path.join(ROOT, 'tutor-library', 'catalog', 'grinberg.json');
const INDEX_DIR  = path.join(ROOT, 'tutor-library', 'index');

// Stopwords español (~120 words comunes)
const STOP = new Set(('el la los las un una unos unas y o u pero si no es son ser estar era eran fue fueron sido esta estan estar estare ha he han hay hemos habia habian habra habran ese esa este esta eso esta esos esas para por con sin de del al a en que se su sus le les lo mi mis tu tus me te lo os ya muy mas menos tan tanto tan cual cuales cuando donde quien quienes hay hace hacer haciendo desde hasta sobre entre bajo tras todo toda todos todas cada esto eso aquello mismo misma mismos mismas otra otro otros otras porque asi tambien pues tal cual solo tras aun aun asi sin embargo aunque mientras cuanto pero tan bien mal tanto entonces luego despues ademas entonces incluso durante ademas ahora antes despues siempre nunca hoy ayer manana aqui ahi alli casi mucho poco algun alguna algunos algunas ningun ninguna ningunos ningunas nada algo alguien nadie alguno ninguno cualquier cualquiera').split(' '));

// ═════════════════════════════════════════════
// Utilities
// ═════════════════════════════════════════════
function normalize(s) {
    return String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Sufijos que arrancamos para acercarnos a la raíz (stem ligero)
const SUFFIXES = ['aciones', 'aciones', 'iciones', 'aciones', 'amiento', 'imiento',
                  'acion', 'ación', 'icion', 'ición', 'ando', 'endo',
                  'ados', 'idos', 'adas', 'idas', 'mente',
                  'ado', 'ido', 'ada', 'ida', 'oso', 'osa', 'osos', 'osas',
                  'ivo', 'iva', 'ivos', 'ivas', 'able', 'ible',
                  'eron', 'aron', 'aban', 'ieron', 'aria', 'ería', 'aria',
                  'es', 'os', 'as'];

function stem(word) {
    if (word.length <= 4) return word;
    for (const suf of SUFFIXES) {
        if (word.endsWith(suf) && word.length - suf.length >= 4) {
            return word.slice(0, word.length - suf.length);
        }
    }
    // Plural minimo
    if (word.length > 4 && word.endsWith('s')) return word.slice(0, -1);
    return word;
}

function tokenize(text) {
    const norm = normalize(text);
    return norm.split(/\s+/)
        .filter(w => w.length >= 3 && !STOP.has(w))
        .map(stem);
}

// ═════════════════════════════════════════════
// Chunking: agrupa párrafos hasta ~600 tokens
// ═════════════════════════════════════════════
const TARGET_CHUNK_TOKENS = 500;
const MAX_CHUNK_TOKENS    = 700;

function chunkBookText(pages) {
    const chunks = [];
    let buffer = { workN: null, pageStart: null, pageEnd: null, text: '', tokenCount: 0 };

    function flush() {
        if (buffer.text.trim().length < 50) return;
        chunks.push({
            id: chunks.length,
            pageStart: buffer.pageStart,
            pageEnd:   buffer.pageEnd,
            text: buffer.text.trim()
        });
        buffer = { workN: null, pageStart: null, pageEnd: null, text: '', tokenCount: 0 };
    }

    for (const p of pages) {
        const paragraphs = (p.text || '').split(/\n\s*\n+/);
        for (const para of paragraphs) {
            const t = para.trim();
            if (!t) continue;
            const tokens = tokenize(t);
            if (tokens.length === 0) continue;

            if (buffer.pageStart === null) buffer.pageStart = p.pageNum;
            buffer.pageEnd = p.pageNum;

            if (buffer.tokenCount + tokens.length > MAX_CHUNK_TOKENS) {
                flush();
                buffer.pageStart = p.pageNum;
                buffer.pageEnd   = p.pageNum;
            }
            buffer.text += (buffer.text ? '\n\n' : '') + t;
            buffer.tokenCount += tokens.length;

            if (buffer.tokenCount >= TARGET_CHUNK_TOKENS) flush();
        }
    }
    flush();
    return chunks;
}

// ═════════════════════════════════════════════
// Main
// ═════════════════════════════════════════════
async function main() {
    try { fs.mkdirSync(INDEX_DIR, { recursive: true }); } catch {}

    const catalog = JSON.parse(fs.readFileSync(CAT_PATH, 'utf8'));
    const works   = catalog.works || [];

    // 1) Cargar textos + chunkar
    console.log(`\n[1/5] Chunking ${works.length} obras…`);
    const allChunks = [];
    const chunksByBook = {};
    for (const w of works) {
        const textPath = path.join(TEXT_DIR, w.n + '.json');
        if (!fs.existsSync(textPath)) {
            console.log(`  [SKIP] #${w.n} no tiene text/`);
            continue;
        }
        const record = JSON.parse(fs.readFileSync(textPath, 'utf8'));
        const bookChunks = chunkBookText(record.pages || []);
        if (bookChunks.length === 0) {
            console.log(`  [SKIP] #${w.n} sin texto útil (¿escaneado?)`);
            continue;
        }
        for (const c of bookChunks) {
            c.id = `${w.n}-${c.id}`;
            c.workN = w.n;
            c.workTitle = w.title;
            allChunks.push(c);
        }
        chunksByBook[w.n] = bookChunks.length;
        console.log(`  #${w.n} ${w.title}: ${bookChunks.length} chunks`);
    }
    console.log(`\n  Total: ${allChunks.length} chunks para índice`);

    // 2) Tokenizar + construir postings + df
    console.log(`\n[2/5] Tokenizando + construyendo índice invertido…`);
    const postings = new Map(); // token → { chunkId → freq }
    const df       = new Map(); // token → docFreq (# chunks que lo contienen)
    let totalLen = 0;

    for (const c of allChunks) {
        const tokens = tokenize(c.text);
        c.len = tokens.length;
        totalLen += tokens.length;

        // freq por token en este chunk
        const freq = new Map();
        for (const t of tokens) freq.set(t, (freq.get(t) || 0) + 1);

        for (const [t, f] of freq.entries()) {
            if (!postings.has(t)) postings.set(t, {});
            postings.get(t)[c.id] = f;
            df.set(t, (df.get(t) || 0) + 1);
        }
    }
    const N = allChunks.length;
    const avgLen = totalLen / N;
    console.log(`  Vocabulario único (tras stem): ${postings.size} términos`);
    console.log(`  Longitud media de chunk: ${avgLen.toFixed(1)} tokens`);

    // 3) TF-IDF por libro → key concepts
    console.log(`\n[3/5] Extrayendo conceptos clave por libro (TF-IDF)…`);
    const bookConcepts = {};
    for (const w of works) {
        const bookChunks = allChunks.filter(c => c.workN === w.n);
        if (bookChunks.length === 0) continue;
        const termCount = new Map();
        let bookTotal = 0;
        for (const c of bookChunks) {
            for (const t of tokenize(c.text)) {
                termCount.set(t, (termCount.get(t) || 0) + 1);
                bookTotal++;
            }
        }
        const scored = [];
        for (const [t, count] of termCount.entries()) {
            if (count < 3) continue;    // muy raro dentro del libro
            const tf  = count / bookTotal;
            const idf = Math.log((N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5) + 1);
            scored.push({ term: t, tfidf: tf * idf, count });
        }
        scored.sort((a, b) => b.tfidf - a.tfidf);
        bookConcepts[w.n] = {
            n: w.n,
            title: w.title,
            chunks: bookChunks.length,
            topConcepts: scored.slice(0, 30)
        };
        console.log(`  #${w.n}: ${scored.slice(0, 6).map(s => s.term).join(', ')}…`);
    }

    // 4) Cross-references entre libros por conceptos compartidos
    console.log(`\n[4/5] Detectando referencias cruzadas…`);
    const crossRefs = {}; // workN → [{ workN, sharedTerms, score }]
    const bookIds = Object.keys(bookConcepts);
    for (const a of bookIds) {
        const aSet = new Set(bookConcepts[a].topConcepts.slice(0, 20).map(t => t.term));
        const links = [];
        for (const b of bookIds) {
            if (a === b) continue;
            const bTop = bookConcepts[b].topConcepts.slice(0, 20);
            const shared = bTop.filter(t => aSet.has(t.term)).map(t => t.term);
            if (shared.length >= 2) {
                links.push({ workN: b, title: bookConcepts[b].title, shared, score: shared.length });
            }
        }
        links.sort((x, y) => y.score - x.score);
        crossRefs[a] = links.slice(0, 6);
    }

    // 5) Guardar todo
    console.log(`\n[5/5] Escribiendo índice a ${INDEX_DIR}…`);

    // chunks.json — solo lo esencial para no inflar
    fs.writeFileSync(path.join(INDEX_DIR, 'chunks.json'), JSON.stringify(
        allChunks.map(c => ({ id: c.id, workN: c.workN, workTitle: c.workTitle,
                              pageStart: c.pageStart, pageEnd: c.pageEnd,
                              text: c.text, len: c.len }))
    ));

    // postings.json — { term: { chunkId: freq, ... }, ... }
    const postingsObj = {};
    for (const [t, chunks] of postings.entries()) postingsObj[t] = chunks;
    fs.writeFileSync(path.join(INDEX_DIR, 'postings.json'), JSON.stringify(postingsObj));

    // stats.json
    const dfObj = {};
    for (const [t, count] of df.entries()) dfObj[t] = count;
    fs.writeFileSync(path.join(INDEX_DIR, 'stats.json'), JSON.stringify({
        N, avgLen, totalTokens: totalLen, vocabSize: postings.size,
        builtAt: new Date().toISOString(),
        df: dfObj
    }));

    fs.writeFileSync(path.join(INDEX_DIR, 'concepts.json'), JSON.stringify(bookConcepts, null, 2));
    fs.writeFileSync(path.join(INDEX_DIR, 'cross-refs.json'), JSON.stringify(crossRefs, null, 2));

    const sizeChunks   = (fs.statSync(path.join(INDEX_DIR, 'chunks.json')).size / 1024 / 1024).toFixed(2);
    const sizePostings = (fs.statSync(path.join(INDEX_DIR, 'postings.json')).size / 1024 / 1024).toFixed(2);
    const sizeStats    = (fs.statSync(path.join(INDEX_DIR, 'stats.json')).size / 1024 / 1024).toFixed(2);
    const sizeConcepts = (fs.statSync(path.join(INDEX_DIR, 'concepts.json')).size / 1024).toFixed(1);
    const sizeCross    = (fs.statSync(path.join(INDEX_DIR, 'cross-refs.json')).size / 1024).toFixed(1);

    console.log(`\n✓ Índice construido.`);
    console.log(`  chunks.json:    ${sizeChunks} MB (${allChunks.length} chunks)`);
    console.log(`  postings.json:  ${sizePostings} MB (${postings.size} términos)`);
    console.log(`  stats.json:     ${sizeStats} MB`);
    console.log(`  concepts.json:  ${sizeConcepts} KB (top-30 conceptos por libro)`);
    console.log(`  cross-refs.json:${sizeCross} KB`);
}

if (require.main === module) {
    main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { normalize, stem, tokenize };
