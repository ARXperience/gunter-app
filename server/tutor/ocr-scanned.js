/* =============================================
   TUTOR — OCR pipeline for scanned PDFs
   -------------------------------------------------
   Objetivo: extraer texto de los libros escaneados
   (donde pdf-parse solo obtuvo metadata).
   Pipeline:
     1) pdfjs-dist renderiza cada página a canvas
     2) canvas → PNG buffer
     3) tesseract.js (spa) → texto
     4) escribe/actualiza tutor-library/text/<n>.json

   Uso: node server/tutor/ocr-scanned.js [workN]
   Sin argumentos → procesa los 10 escaneados
   Con workN     → procesa solo esa obra (útil para probar)

   Costo: $0. Solo tiempo de CPU/GPU local.
   ============================================= */

const fs   = require('fs');
const path = require('path');
const { createCanvas } = require('@napi-rs/canvas');
const tesseract = require('tesseract.js');
// pdfjs-dist v5 es ESM-only — cargamos con dynamic import
let pdfjsLib = null;
async function _loadPdfjs() {
    if (pdfjsLib) return pdfjsLib;
    pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    return pdfjsLib;
}

const ROOT     = path.join(__dirname, '..', '..');
const CAT_PATH = path.join(ROOT, 'tutor-library', 'catalog', 'grinberg.json');
const PDF_DIR  = path.join(ROOT, 'tutor-library', 'pdfs');
const TEXT_DIR = path.join(ROOT, 'tutor-library', 'text');

// Solo obras que pdf-parse dejó vacías/quasi-vacías (indicador de escaneo)
const MIN_WORDS_FOR_INDEXED = 5000;

// Tesseract config
const TESS_LANG = 'spa';
const RENDER_SCALE = 1.6;      // resolución de render (más alto = mejor OCR pero más lento)
const OCR_TIMEOUT_MS = 45000;  // por página

function log(...args) { console.log('[ocr]', ...args); }

function isScannedRecord(record) {
    const w = record.meta?.wordCount || 0;
    return w < MIN_WORDS_FOR_INDEXED;
}

// CanvasFactory que pdfjs v5 acepta explícitamente
class NodeCanvasFactory {
    create(width, height) {
        const canvas = createCanvas(width, height);
        const context = canvas.getContext('2d');
        return { canvas, context };
    }
    reset(canvasAndContext, width, height) {
        canvasAndContext.canvas.width = width;
        canvasAndContext.canvas.height = height;
    }
    destroy(canvasAndContext) {
        canvasAndContext.canvas.width = 0;
        canvasAndContext.canvas.height = 0;
        canvasAndContext.canvas = null;
        canvasAndContext.context = null;
    }
}

async function renderPageToPng(pdfDoc, pageNum, factory) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: RENDER_SCALE });
    const canvasAndContext = factory.create(viewport.width, viewport.height);
    await page.render({
        canvasContext: canvasAndContext.context,
        viewport,
        canvasFactory: factory
    }).promise;
    const buf = canvasAndContext.canvas.toBuffer('image/png');
    page.cleanup();
    return buf;
}

function withTimeout(promise, ms, msg) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(msg || 'timeout')), ms))
    ]);
}

async function ocrOne(work, opts = {}) {
    const pdfPath = path.join(PDF_DIR, work.file);
    const outPath = path.join(TEXT_DIR, work.n + '.json');
    if (!fs.existsSync(pdfPath)) {
        log(`SKIP #${work.n}: PDF ausente`);
        return { n: work.n, ok: false, reason: 'pdf-missing' };
    }

    // Skip si ya tiene texto (pdf-parse fue efectivo)
    if (fs.existsSync(outPath)) {
        try {
            const existing = JSON.parse(fs.readFileSync(outPath, 'utf8'));
            if (!isScannedRecord(existing)) {
                log(`SKIP #${work.n}: ya tiene ${existing.meta?.wordCount} palabras (no es escaneado)`);
                return { n: work.n, ok: true, cached: true };
            }
            // Si fue marcado como OCR previo y aún tiene contenido, skip
            if (existing.meta?.ocrSource && !opts.force) {
                log(`SKIP #${work.n}: ya tiene OCR previo (usar --force para rehacer)`);
                return { n: work.n, ok: true, cached: true };
            }
        } catch {}
    }

    log(`▶ OCR #${work.n} "${work.title}"…`);
    const t0 = Date.now();
    const pdfjs = await _loadPdfjs();
    const canvasFactory = new NodeCanvasFactory();
    const rawBuf = new Uint8Array(fs.readFileSync(pdfPath));
    const loadingTask = pdfjs.getDocument({ data: rawBuf, verbosity: 0, canvasFactory });
    const pdfDoc = await loadingTask.promise;
    const numPages = pdfDoc.numPages;
    log(`  ${numPages} páginas para OCR`);

    // Setup worker de tesseract (una vez por libro)
    const worker = await tesseract.createWorker(TESS_LANG, 1, {
        logger: () => {},   // silencioso
        errorHandler: (e) => console.error('[tess]', e.message)
    });

    const pages = [];
    let succeeded = 0, failed = 0;

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        try {
            const pngBuf = await renderPageToPng(pdfDoc, pageNum, canvasFactory);
            const result = await withTimeout(
                worker.recognize(pngBuf),
                OCR_TIMEOUT_MS,
                'ocr-timeout'
            );
            const text = (result?.data?.text || '').replace(/\r\n/g, '\n').trim();
            if (text.length > 20) {
                pages.push({ pageNum, text });
                succeeded++;
            } else {
                failed++;
            }
            if (pageNum % 10 === 0 || pageNum === numPages) {
                const pct = ((pageNum / numPages) * 100).toFixed(0);
                const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
                log(`  progreso #${work.n}: ${pct}% (${pageNum}/${numPages}) · ${elapsed}s · ${succeeded} ok, ${failed} vacías`);
            }
        } catch (e) {
            failed++;
            if (pageNum % 20 === 0) log(`  #${work.n} p.${pageNum} error: ${e.message.slice(0, 80)}`);
        }
    }

    await worker.terminate();
    await loadingTask.destroy?.().catch(() => {});

    const fullText = pages.map(p => p.text).join('\n\n');
    const wordCount = fullText.split(/\s+/).filter(Boolean).length;
    const record = {
        work_n: work.n,
        title: work.title,
        file: work.file,
        totalPagesReported: numPages,
        pages,
        meta: {
            author: 'Jacobo Grinberg-Zylberbaum',
            ocrSource: 'tesseract-spa',
            renderScale: RENDER_SCALE,
            extractedAt: new Date().toISOString(),
            wordCount,
            pagesSucceeded: succeeded,
            pagesFailed: failed,
            processingTimeSec: Math.round((Date.now() - t0) / 1000)
        }
    };
    fs.writeFileSync(outPath, JSON.stringify(record), 'utf8');
    log(`✓ #${work.n} listo: ${wordCount} palabras, ${succeeded}/${numPages} páginas útiles · ${record.meta.processingTimeSec}s`);
    return { n: work.n, ok: true, wordCount, pages: succeeded };
}

async function main() {
    if (!fs.existsSync(TEXT_DIR)) fs.mkdirSync(TEXT_DIR, { recursive: true });
    const catalog = JSON.parse(fs.readFileSync(CAT_PATH, 'utf8'));

    const argN = process.argv[2] && !process.argv[2].startsWith('--') ? String(process.argv[2]) : null;
    const force = process.argv.includes('--force');

    let targets;
    if (argN) {
        const w = catalog.works.find(x => x.n === argN);
        if (!w) { log(`Obra #${argN} no está en el catalog`); process.exit(1); }
        targets = [w];
    } else {
        // Auto: los que están vacíos según pdf-parse
        targets = [];
        for (const w of catalog.works) {
            const outPath = path.join(TEXT_DIR, w.n + '.json');
            if (!fs.existsSync(outPath)) { targets.push(w); continue; }
            try {
                const rec = JSON.parse(fs.readFileSync(outPath, 'utf8'));
                if (isScannedRecord(rec) && !rec.meta?.ocrSource) targets.push(w);
            } catch {}
        }
    }

    log(`Objetivos: ${targets.length} obra(s)`);
    for (const w of targets) log(`  · #${w.n} ${w.title}`);

    for (const w of targets) {
        try {
            await ocrOne(w, { force });
        } catch (e) {
            log(`❌ #${w.n} falló: ${e.message}`);
        }
    }
    log('OCR terminado.');
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });

module.exports = { ocrOne };
