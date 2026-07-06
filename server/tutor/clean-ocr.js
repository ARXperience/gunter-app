/* =============================================
   TUTOR — OCR Cleanup Pass
   -------------------------------------------------
   Corrige errores sistemáticos de tesseract sobre
   los textos OCReados (meta.ocrSource). NO toca los
   extraídos con pdf-parse (ya limpios).

   Estrategia conservadora en 3 capas:
     1. Dígitos embebidos en palabras (aci6n → ación)
     2. Tokens funcionales frecuentes mal leídos (quc → que)
     3. Vocabulario del dominio Grinberg (lattlce → lattice)

   Uso: node server/tutor/clean-ocr.js [--dry]
   --dry muestra conteo de reemplazos sin escribir.
   ============================================= */

const fs   = require('fs');
const path = require('path');

const TEXT_DIR = path.join(__dirname, '..', '..', 'tutor-library', 'text');

// ── Capa 1: dígito embebido en palabra alfabética ──
// "aci6n" → "ación" · "c0nciencia" → "conciencia" · "rea1izar" → "realizar"
// Solo si el token tiene ≥2 letras a cada lado o es final -ci6n/-si6n.
const DIGIT_MAP = { '0': 'o', '1': 'l', '3': 'e', '5': 's', '6': 'ó', '8': 'a' };

function fixEmbeddedDigits(text) {
    let count = 0;
    // Token con letras y 1-2 dígitos en el medio (no números puros, no códigos tipo p.42)
    const out = text.replace(/\b([a-záéíóúñüA-ZÁÉÍÓÚÑÜ]{2,})(\d)([a-záéíóúñüA-ZÁÉÍÓÚÑÜ]{1,})\b/g,
        (m, pre, digit, post) => {
            const repl = DIGIT_MAP[digit];
            if (!repl) return m;
            count++;
            return pre + repl + post;
        });
    return { out, count };
}

// ── Capa 2: tokens funcionales frecuentes ──
// Solo como palabra completa (\b...\b), case-sensitive donde importa.
const TOKEN_MAP = [
    [/\bquc\b/g, 'que'],
    [/\bQuc\b/g, 'Que'],
    [/\bcl\b/g, 'el'],          // "cl" como token suelto — en español no es palabra
    [/\bCl\b/g, 'El'],
    [/\bdc\b/g, 'de'],
    [/\bDc\b/g, 'De'],
    [/\bcn\b/g, 'en'],
    [/\bEn cl\b/g, 'En el'],
    [/\bsc\b/g, 'se'],
    [/\bSc\b/g, 'Se'],
    [/\bcs\b/g, 'es'],
    [/\bnn\b/g, 'un'],
    [/\bcomo cl\b/g, 'como el'],
    [/\bpor cl\b/g, 'por el'],
    [/\bIa\b/g, 'la'],           // I mayúscula leída en vez de l
    [/\bIas\b/g, 'las'],
    [/\bIos\b/g, 'los'],
    [/\bEI\b/g, 'El'],
    [/\bcI\b/g, 'el'],
    [/\bAI\b/g, 'Al'],
    [/\bdcl\b/g, 'del'],
    [/\bpcro\b/g, 'pero'],
    [/\bcstc\b/g, 'este'],
    [/\bcsta\b/g, 'esta'],
    [/\bcsto\b/g, 'esto'],
    [/\bcntre\b/g, 'entre'],
    [/\btambien\b/g, 'también'],
    [/\bmas\b(?= (alla|allá))/g, 'más']
];

function fixTokens(text) {
    let count = 0;
    let out = text;
    for (const [re, repl] of TOKEN_MAP) {
        out = out.replace(re, (m) => { count++; return repl; });
    }
    return { out, count };
}

// ── Capa 3: vocabulario del dominio Grinberg ──
const DOMAIN_MAP = [
    [/\blluminaci(ó|o)n\b/gi, 'iluminación'],
    [/\blluminad(o|a)\b/gi, 'iluminad$1'],
    [/\blattlce\b/gi, 'lattice'],
    [/\bLattlce\b/g, 'Lattice'],
    [/\bslntergia\b/gi, 'sintergia'],
    [/\bsint(e|é)rgic(o|a)\b/gi, 'sintérgic$2'],
    [/\bneurona1\b/gi, 'neuronal'],
    [/\bch(a|á)man\b/gi, 'chamán'],
    [/\bchamanlsmo\b/gi, 'chamanismo'],
    [/\bconc(i|l)encia\b/gi, 'conciencia'],
    [/\bmeditaci(6|o)n\b/gi, 'meditación'],
    [/\bpsicof(i|l)siolog(í|i)a\b/gi, 'psicofisiología'],
    [/\bGrlnberg\b/g, 'Grinberg'],
    [/\bZylberbaum\b/g, 'Zylberbaum'],
    [/\bPachlta\b/g, 'Pachita'],
    [/\bcampo unlficado\b/gi, 'campo unificado'],
    [/\bcxperiencia\b/gi, 'experiencia'],
    [/\bcnergía\b/gi, 'energía'],
    [/\bcspacio\b/gi, 'espacio'],
    [/\bticmpo\b/gi, 'tiempo'],
    [/\bcerebr0\b/gi, 'cerebro'],
    [/\brea1idad\b/gi, 'realidad']
];

function fixDomain(text) {
    let count = 0;
    let out = text;
    for (const [re, repl] of DOMAIN_MAP) {
        out = out.replace(re, (m, ...groups) => {
            count++;
            // soporta $1/$2 en repl
            let r = repl;
            groups.slice(0, -2).forEach((g, i) => { r = r.replace('$' + (i + 1), g || ''); });
            return r;
        });
    }
    return { out, count };
}

// ── Pipeline por archivo ──
function cleanRecord(record) {
    let totalFixes = 0;
    for (const page of (record.pages || [])) {
        if (!page.text) continue;
        let t = page.text;
        const l1 = fixEmbeddedDigits(t); t = l1.out;
        const l2 = fixTokens(t);         t = l2.out;
        const l3 = fixDomain(t);         t = l3.out;
        totalFixes += l1.count + l2.count + l3.count;
        page.text = t;
    }
    return totalFixes;
}

function main() {
    const dry = process.argv.includes('--dry');
    const files = fs.readdirSync(TEXT_DIR).filter(f => /\.json$/.test(f));
    let grandTotal = 0;
    let touched = 0;

    console.log(`[clean-ocr] ${dry ? 'DRY RUN — ' : ''}Revisando ${files.length} archivos…`);

    for (const f of files) {
        const p = path.join(TEXT_DIR, f);
        let record;
        try { record = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }

        // Solo tocar los OCReados
        if (!record.meta?.ocrSource) continue;

        const fixes = cleanRecord(record);
        grandTotal += fixes;
        if (fixes > 0) {
            touched++;
            if (!dry) {
                record.meta.cleanedAt = new Date().toISOString();
                record.meta.cleanFixes = (record.meta.cleanFixes || 0) + fixes;
                fs.writeFileSync(p, JSON.stringify(record), 'utf8');
            }
            console.log(`  #${record.work_n} "${(record.title || '').slice(0, 40)}" — ${fixes} correcciones`);
        }
    }

    console.log(`\n[clean-ocr] ${dry ? '(dry) ' : ''}Total: ${grandTotal} correcciones en ${touched} libros.`);
    if (!dry && grandTotal > 0) {
        console.log('[clean-ocr] Ahora corré: node server/tutor/build-index.js && node server/tutor/build-digests.js');
    }
}

if (require.main === module) main();
module.exports = { cleanRecord };
