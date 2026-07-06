/* =============================================
   TUTOR — OCR v2: direct image extraction
   -------------------------------------------------
   Para PDFs escaneados donde pdfjs render falla.
   Approach: cada página tiene 1 image XObject
   (JPEG/DCTDecode). Lo extraemos raw de pdf-lib
   y lo pasamos directo a tesseract.js.

   Uso: node server/tutor/ocr-direct.js [workN]
   ============================================= */

const fs   = require('fs');
const path = require('path');
const tesseract = require('tesseract.js');
const { PDFDocument, PDFRawStream, PDFArray, PDFName, PDFRef } = require('pdf-lib');

const ROOT     = path.join(__dirname, '..', '..');
const CAT_PATH = path.join(ROOT, 'tutor-library', 'catalog', 'grinberg.json');
const PDF_DIR  = path.join(ROOT, 'tutor-library', 'pdfs');
const TEXT_DIR = path.join(ROOT, 'tutor-library', 'text');

const TESS_LANG = 'spa';
const OCR_TIMEOUT_MS = 45000;

// Los 5 que fallaron con render pdfjs
const STUBBORN_BOOKS = ['17', '18', '25', '26', '31'];

function log(...args) { console.log('[ocr-v2]', ...args); }

function withTimeout(promise, ms, msg) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(msg || 'timeout')), ms))
    ]);
}

/**
 * Extrae los image XObjects de un PDF y devuelve un array de buffers JPEG/PNG,
 * uno por página (asumiendo el patrón "una imagen por página" típico de escaneos).
 */
async function extractPageImages(pdfPath) {
    const bytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const numPages = pdfDoc.getPageCount();
    const results = [];

    for (let i = 0; i < numPages; i++) {
        const page = pdfDoc.getPage(i);
        const resources = page.node.Resources();
        if (!resources) { results.push(null); continue; }
        const xobjects = resources.lookup(PDFName.of('XObject'));
        if (!xobjects) { results.push(null); continue; }

        // xobjects es un PDFDict; iteramos por sus entradas
        let bestImage = null;
        let bestSize = 0;

        // pdf-lib expone entries via .entries() en PDFDict
        const entries = xobjects.entries ? xobjects.entries() : [];
        for (const [name, ref] of entries) {
            const obj = pdfDoc.context.lookup(ref);
            if (!obj || !(obj instanceof PDFRawStream)) continue;
            const dict = obj.dict;
            if (!dict) continue;
            const subtype = dict.get(PDFName.of('Subtype'));
            if (String(subtype) !== '/Image') continue;
            const filter = dict.get(PDFName.of('Filter'));
            const filterStr = String(filter);
            // Aceptamos DCTDecode (JPEG), CCITTFaxDecode (TIFF Fax), FlateDecode (PNG-like)
            const contents = obj.contents;
            if (!contents || contents.length === 0) continue;
            // Elegir la imagen más grande del page (la de mayor resolución)
            if (contents.length > bestSize) {
                bestSize = contents.length;
                bestImage = { buffer: Buffer.from(contents), filter: filterStr };
            }
        }
        results.push(bestImage);
    }
    return { numPages, images: results };
}

async function ocrOne(work, opts = {}) {
    const pdfPath = path.join(PDF_DIR, work.file);
    const outPath = path.join(TEXT_DIR, work.n + '.json');
    if (!fs.existsSync(pdfPath)) {
        log(`SKIP #${work.n}: PDF ausente`);
        return { n: work.n, ok: false, reason: 'pdf-missing' };
    }
    // Skip si ya tiene OCR previo con contenido
    if (fs.existsSync(outPath) && !opts.force) {
        try {
            const rec = JSON.parse(fs.readFileSync(outPath, 'utf8'));
            if (rec.meta?.wordCount > 500 && rec.meta?.ocrSource) {
                log(`SKIP #${work.n}: ya tiene ${rec.meta.wordCount} palabras`);
                return { n: work.n, ok: true, cached: true };
            }
        } catch {}
    }

    log(`▶ OCR-v2 #${work.n} "${work.title}"`);
    const t0 = Date.now();

    let extracted;
    try {
        extracted = await extractPageImages(pdfPath);
    } catch (e) {
        log(`❌ #${work.n} pdf-lib load fail: ${e.message}`);
        return { n: work.n, ok: false, reason: 'pdf-lib-fail' };
    }
    log(`  ${extracted.numPages} páginas · imágenes utilizables: ${extracted.images.filter(Boolean).length}`);

    if (extracted.images.filter(Boolean).length === 0) {
        log(`❌ #${work.n} sin imágenes extraibles`);
        return { n: work.n, ok: false, reason: 'no-images' };
    }

    const worker = await tesseract.createWorker(TESS_LANG, 1, {
        logger: () => {},
        errorHandler: (e) => console.error('[tess]', e.message?.slice(0, 100))
    });

    const pages = [];
    let succeeded = 0, failed = 0;

    for (let i = 0; i < extracted.images.length; i++) {
        const pageNum = i + 1;
        const img = extracted.images[i];
        if (!img) { failed++; continue; }
        try {
            const result = await withTimeout(worker.recognize(img.buffer), OCR_TIMEOUT_MS, 'ocr-timeout');
            const text = (result?.data?.text || '').replace(/\r\n/g, '\n').trim();
            if (text.length > 20) {
                pages.push({ pageNum, text });
                succeeded++;
            } else {
                failed++;
            }
            if (pageNum % 10 === 0 || pageNum === extracted.numPages) {
                const pct = ((pageNum / extracted.numPages) * 100).toFixed(0);
                const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
                log(`  progreso #${work.n}: ${pct}% (${pageNum}/${extracted.numPages}) · ${elapsed}s · ${succeeded} ok, ${failed} vacías`);
            }
        } catch (e) {
            failed++;
        }
    }

    await worker.terminate();

    const fullText = pages.map(p => p.text).join('\n\n');
    const wordCount = fullText.split(/\s+/).filter(Boolean).length;
    const record = {
        work_n: work.n,
        title: work.title,
        file: work.file,
        totalPagesReported: extracted.numPages,
        pages,
        meta: {
            author: 'Jacobo Grinberg-Zylberbaum',
            ocrSource: 'tesseract-spa-direct',
            extractionMethod: 'pdf-lib-xobject',
            extractedAt: new Date().toISOString(),
            wordCount,
            pagesSucceeded: succeeded,
            pagesFailed: failed,
            processingTimeSec: Math.round((Date.now() - t0) / 1000)
        }
    };
    fs.writeFileSync(outPath, JSON.stringify(record), 'utf8');
    log(`✓ #${work.n} listo: ${wordCount} palabras, ${succeeded}/${extracted.numPages} páginas · ${record.meta.processingTimeSec}s`);
    return { n: work.n, ok: true, wordCount };
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
        // Los 5 stubborn por defecto
        targets = STUBBORN_BOOKS.map(n => catalog.works.find(w => w.n === n)).filter(Boolean);
    }

    log(`Objetivos: ${targets.length} obra(s)`);
    for (const w of targets) log(`  · #${w.n} ${w.title}`);

    for (const w of targets) {
        try { await ocrOne(w, { force }); }
        catch (e) { log(`❌ #${w.n} falló: ${e.message}`); }
    }
    log('OCR-v2 terminado.');
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });

module.exports = { ocrOne, extractPageImages };
