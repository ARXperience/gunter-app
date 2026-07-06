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

const ROOT = path.join(__dirname, '..');
const BACKUP_DIR = path.join(ROOT, 'backups');
const KEEP = 14;
const EVERY_MS = 12 * 60 * 60 * 1000;   // 12 h
const BOOT_DELAY_MS = 3 * 60 * 1000;    // 3 min tras el arranque

const SOURCES = [
    { src: path.join(ROOT, 'data'), name: 'data', skip: ['tts-cache'] },
    { src: path.join(ROOT, 'whatsapp-data'), name: 'whatsapp-data', skip: [] },
    { src: path.join(ROOT, 'whatsapp-session'), name: 'whatsapp-session', skip: [] }
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

module.exports = { schedule, runBackup, lastBackup };
