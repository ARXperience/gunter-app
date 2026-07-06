/* =============================================
   GUNTER ACTIONS — State persistente (v1)
   -------------------------------------------------
   Estado server-side de los flags premium. Es la
   "source of truth" que ambos canales (browser + WA)
   consultan y modifican.

   Storage: data/features-state.json
   ============================================= */

const fs = require('fs');
const userStore = require('../user-store');

// Multi-tenant: cada usuario tiene sus propios flags premium
function filePath() { return userStore.userFile('features-state.json'); }

function load() {
  try {
    const fp = filePath();
    if (!fs.existsSync(fp)) return {};
    const raw = fs.readFileSync(fp, 'utf8');
    return JSON.parse(raw) || {};
  } catch (e) {
    console.warn('[actions/state] load failed:', e.message);
    return {};
  }
}

function save(state) {
  try {
    fs.writeFileSync(filePath(), JSON.stringify(state, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.warn('[actions/state] save failed:', e.message);
    return false;
  }
}

function get(flag) {
  const s = load();
  return s[flag];
}

function set(flag, value, meta = {}) {
  const s = load();
  s[flag] = value;
  s.__meta = s.__meta || {};
  s.__meta[flag] = {
    updatedAt: new Date().toISOString(),
    updatedBy: meta.source || 'unknown',   // 'browser' | 'whatsapp' | 'system'
    reason: meta.reason || null
  };
  save(s);
  return true;
}

function getAll() {
  const s = load();
  const clean = { ...s };
  delete clean.__meta;
  return clean;
}

function getMeta(flag) {
  const s = load();
  return s.__meta?.[flag] || null;
}

/**
 * Sync desde el browser: recibe el objeto completo de flags del cliente
 * y lo persiste. Útil al arrancar la app o cambiar flags en la UI.
 */
function syncFromBrowser(flags) {
  if (!flags || typeof flags !== 'object') return false;
  const current = load();
  for (const [k, v] of Object.entries(flags)) {
    if (k === '__meta') continue;
    current[k] = v;
  }
  current.__meta = current.__meta || {};
  current.__meta._lastSync = { at: new Date().toISOString(), source: 'browser' };
  save(current);
  return true;
}

module.exports = { load, save, get, set, getAll, getMeta, syncFromBrowser };
