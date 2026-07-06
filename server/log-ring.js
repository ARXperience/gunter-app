/* =============================================
   GUNTER — Server log ring buffer
   ---------------------------------------------
   Captura console.log/warn/error en un buffer circular en memoria
   (máx 600 entradas) para que el panel admin pueda ver los logs
   del servidor en vivo sin acceso SSH. Espejo server-side del
   log-buffer.js del cliente.

   Redacta patrones sensibles (API keys, tokens) antes de guardar.
   ============================================= */

const MAX_ENTRIES = 600;
const ring = [];
let seq = 0;

const SENSITIVE = [
    [/sk-[A-Za-z0-9_-]{10,}/g, 'sk-***'],
    [/AIza[A-Za-z0-9_-]{10,}/g, 'AIza***'],
    [/(s|svc)_[a-f0-9]{32,}/g, '$1_***'],
    [/Bearer\s+[A-Za-z0-9._-]{10,}/g, 'Bearer ***']
];

function redact(text) {
    let t = String(text);
    for (const [re, rep] of SENSITIVE) t = t.replace(re, rep);
    return t;
}

function push(level, args) {
    try {
        const msg = args.map(a => {
            if (typeof a === 'string') return a;
            if (a instanceof Error) return a.stack || a.message;
            try { return JSON.stringify(a); } catch { return String(a); }
        }).join(' ');
        ring.push({ n: ++seq, ts: new Date().toISOString(), level, msg: redact(msg).slice(0, 500) });
        if (ring.length > MAX_ENTRIES) ring.splice(0, ring.length - MAX_ENTRIES);
    } catch { /* nunca romper el server por logging */ }
}

let installed = false;
function install() {
    if (installed) return;
    installed = true;
    const origLog = console.log, origWarn = console.warn, origError = console.error;
    console.log = (...a) => { push('info', a); origLog.apply(console, a); };
    console.warn = (...a) => { push('warn', a); origWarn.apply(console, a); };
    console.error = (...a) => { push('error', a); origError.apply(console, a); };
}

function getRecent({ limit = 120, level = null, search = null } = {}) {
    let out = ring;
    if (level && level !== 'all') {
        out = level === 'warn'
            ? out.filter(e => e.level === 'warn' || e.level === 'error')
            : out.filter(e => e.level === level);
    }
    if (search) {
        const q = String(search).toLowerCase();
        out = out.filter(e => e.msg.toLowerCase().includes(q));
    }
    return out.slice(-Math.min(Number(limit) || 120, MAX_ENTRIES));
}

function stats() {
    return {
        total: ring.length,
        errors: ring.filter(e => e.level === 'error').length,
        warnings: ring.filter(e => e.level === 'warn').length,
        oldest: ring[0]?.ts || null,
        newest: ring[ring.length - 1]?.ts || null
    };
}

module.exports = { install, getRecent, stats };
