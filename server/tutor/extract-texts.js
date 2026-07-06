/* =============================================
   TUTOR — Extract text from PDFs (Fase B)
   -------------------------------------------------
   Uso: node server/tutor/extract-texts.js
   Lee tutor-library/pdfs/ → escribe tutor-library/text/<n>.json
   con { work_n, title, pages: [{ pageNum, text }], meta }.
   Idempotente: skipea si el .json ya existe y el PDF no cambió.
   ============================================= */

const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const ROOT = path.join(__dirname, '..', '..');
const CATALOG_PATH = path.join(ROOT, 'tutor-library', 'catalog', 'grinberg.json');
const PDF_DIR = path.join(ROOT, 'tutor-library', 'pdfs');
const TEXT_DIR = path.join(ROOT, 'tutor-library', 'text');

function ensureDir(p) { try { fs.mkdirSync(p, { recursive: true }); } catch {} }

// Normaliza espacios raros de PDF + normaliza ligaduras
function cleanText(t) {
    if (!t) return '';
    return t
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/ /g, ' ')
        .replace(/-\n(\w)/g, '$1')   // corta guiones al final de línea
        .trim();
}

async function extractOne(work) {
    const pdfPath = path.join(PDF_DIR, work.file);
    const outPath = path.join(TEXT_DIR, work.n + '.json');

    if (!fs.existsSync(pdfPath)) {
        console.log(`  [SKIP] #${work.n} PDF ausente: ${work.file}`);
        return { n: work.n, ok: false, reason: 'pdf-missing' };
    }

    // Idempotencia: skipeamos si el .json es más nuevo que el PDF
    if (fs.existsSync(outPath)) {
        const outMt = fs.statSync(outPath).mtimeMs;
        const pdfMt = fs.statSync(pdfPath).mtimeMs;
        if (outMt >= pdfMt) {
            const existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
            console.log(`  [CACHE] #${work.n} ${work.title} (${existing.pages?.length || 0} páginas)`);
            return { n: work.n, ok: true, cached: true, pages: existing.pages?.length || 0 };
        }
    }

    const buf = fs.readFileSync(pdfPath);
    let result;
    try {
        const parser = new PDFParse({ data: buf });
        result = await parser.getText();
    } catch (e) {
        console.log(`  [ERR] #${work.n}: ${e.message}`);
        return { n: work.n, ok: false, reason: e.message };
    }

    // v2 API: result.pages = [{ text, num }, ...]; result.text = concatenado; result.info
    const pages = (result.pages || [])
        .map(p => ({ pageNum: p.num || 0, text: cleanText(p.text || '') }))
        .filter(p => p.text.length > 20);

    const totalPages = result.numPages || result.pages?.length || 0;
    const fullText = result.text || pages.map(p => p.text).join('\n\n');
    const wordCount = fullText.split(/\s+/).length;

    const record = {
        work_n: work.n,
        title: work.title,
        file: work.file,
        totalPagesReported: totalPages,
        pages,
        meta: {
            author: (result.info && (result.info.Author || result.info.author)) || 'Jacobo Grinberg-Zylberbaum',
            producer: (result.info && (result.info.Producer || result.info.producer)) || null,
            extractedAt: new Date().toISOString(),
            wordCount
        }
    };
    fs.writeFileSync(outPath, JSON.stringify(record), 'utf8');
    console.log(`  [DONE] #${work.n} ${work.title} (${pages.length}/${totalPages} páginas, ${(wordCount / 1000).toFixed(1)}k palabras)`);
    return { n: work.n, ok: true, pages: pages.length, words: wordCount };
}

async function main() {
    ensureDir(TEXT_DIR);
    const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
    const works = catalog.works || [];
    console.log(`Extrayendo texto de ${works.length} obras a ${TEXT_DIR}`);
    const results = [];
    for (const w of works) {
        results.push(await extractOne(w));
    }
    const ok = results.filter(r => r.ok).length;
    const cached = results.filter(r => r.cached).length;
    const totalWords = results.reduce((a, r) => a + (r.words || 0), 0);
    console.log('');
    console.log(`Terminado: ${ok}/${works.length} OK · ${cached} desde cache · ~${(totalWords / 1000).toFixed(0)}k palabras extraídas`);
}

if (require.main === module) {
    main().catch(e => { console.error(e); process.exit(1); });
}

module.exports = { extractOne };
