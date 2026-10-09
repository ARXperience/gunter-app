/* =============================================
   GUNTER — Backups automáticos (v47)
   ---------------------------------------------
   Copia data/ (usuarios, sesiones, datos personales) y
   whatsapp-data/ a backups/<fecha>/ cada 12 horas + uno al
   arrancar (3 min después del boot para no frenar el inicio).

   Retención: últimos 14 backups (≈1 semana). Se excluye
   data/tts-cache/ (regenerable y pesado).
   backups/ está en .gitignore — es disco local.
   ============================================= */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const BACKUP_DIR = path.resolve(process.env.GUNTER_BACKUP_DIR || path.join(ROOT, 'backups'));
const KEEP = 14;
const EVERY_MS = 12 * 60 * 60 * 1000;   // 12 h
const BOOT_DELAY_MS = 3 * 60 * 1000;    // 3 min tras el arranque

const SOURCES = [
    { src: path.resolve(process.env.GUNTER_DATA_DIR || path.join(ROOT, 'data')), name: 'data', skip: ['tts-cache'] },
    { src: path.resolve(process.env.GUNTER_WHATSAPP_DATA_DIR || path.join(ROOT, 'whatsapp-data')), name: 'whatsapp-data', skip: [] },
    { src: path.resolve(process.env.GUNTER_WHATSAPP_SESSION_DIR || path.join(ROOT, 'whatsapp-session')), name: 'whatsapp-session', skip: [] }
];

function runBackup() {
    try {
        const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        const dest = path.join(BACKUP_DIR, stamp);
        if (fs.existsSync(dest)) return;   // ya corrió este minuto
        fs.mkdirSync(dest, { recursive: true });

        let copied = 0;
        for (const { src, name, skip } of SOURCES) {
            if (!fs.existsSync(src)) continue;
            fs.cpSync(src, path.join(dest, name), {
                recursive: true,
                filter: (p) => !skip.some(s => p.includes(path.sep + s))
            });
            copied++;
        }

        // Retención: conservar solo los KEEP más recientes
        const all = fs.readdirSync(BACKUP_DIR)
            .filter(d => fs.statSync(path.join(BACKUP_DIR, d)).isDirectory())
            .sort();
        for (const old of all.slice(0, Math.max(0, all.length - KEEP))) {
            fs.rmSync(path.join(BACKUP_DIR, old), { recursive: true, force: true });
        }

        console.log(`💾 [backup] Respaldo creado: backups/${stamp} (${copied} carpetas · retengo ${Math.min(all.length, KEEP)})`);
        return dest;
    } catch (e) {
        console.error('❌ [backup] Falló:', e.message);
        return null;
    }
}

function lastBackup() {
    try {
        const all = fs.readdirSync(BACKUP_DIR)
            .filter(d => fs.statSync(path.join(BACKUP_DIR, d)).isDirectory())
            .sort();
        return all[all.length - 1] || null;
    } catch { return null; }
}

let _scheduled = false;
function schedule() {
    if (_scheduled) return;
    _scheduled = true;
    setTimeout(runBackup, BOOT_DELAY_MS);
    setInterval(runBackup, EVERY_MS);
    console.log('💾 [backup] Programado: al arrancar (+3 min) y cada 12 h → backups/ (retención 14)');
}

// Inventory only: never includes file contents or credentials. A browser-side
// exporter remains future work and is not activated by this foundation.
function inventory() {
    return { version: 1,
        browser: { indexedDB: ['gunter_daily', 'gunter_documents', 'gunter_transcription_db',
            'gunter_audio_vault', 'gunter_transcript_archive', 'gunter_embeddings',
            'gunter_semantic_index', 'gunter_conversation_memory'],
            localStorage: ['gunter_control_outbox_v1', 'gunter_prefs', 'gunter_companion_log'],
            status: 'BROWSER_EXPORT_NOT_CONFIGURED', exhaustive: false },
        files: SOURCES.map(source => ({ name: source.name, exists: fs.existsSync(source.src),
            format: 'JSON_OR_JSONL_DIRECTORY', backupEligible: true })),
        backupDirectoryConfigured: !!BACKUP_DIR, lastBackup: lastBackup() };
}
function createTestManifest(entries) {
    if (!Array.isArray(entries) || entries.some(entry => typeof entry.name !== 'string' || typeof entry.content !== 'string'))
        throw new TypeError('test_entries_required');
    return { schemaVersion: 1, kind: 'TEST_ONLY', createdAt: new Date().toISOString(),
        entries: entries.map(entry => ({ name: entry.name, bytes: Buffer.byteLength(entry.content),
            sha256: crypto.createHash('sha256').update(entry.content).digest('hex') })) };
}
function validateTestManifest(manifest, entries) {
    if (manifest?.schemaVersion !== 1 || manifest.kind !== 'TEST_ONLY') return false;
    const generated = createTestManifest(entries);
    return JSON.stringify(generated.entries) === JSON.stringify(manifest.entries);
}
module.exports = { schedule, runBackup, lastBackup, inventory, createTestManifest, validateTestManifest };
