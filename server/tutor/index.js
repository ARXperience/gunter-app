/* =============================================
   GUNTER TUTOR — Endpoint /api/tutor
   -------------------------------------------------
   Modo Tutor · Fase A: catalog + curricula + session
   context. Fase B (siguiente): text search sobre PDFs.
   Fase C: RAG con embeddings.
   ============================================= */

const fs = require('fs');
const path = require('path');

let sage = null;
try { sage = require('./sage'); }
catch (e) { console.warn('[tutor] sage engine not available:', e.message); }

const userStore = require('../user-store');

const CATALOG_DIR = path.join(__dirname, '..', '..', 'tutor-library', 'catalog');
const PDF_DIR     = path.join(__dirname, '..', '..', 'tutor-library', 'pdfs');
const TEXT_DIR    = path.join(__dirname, '..', '..', 'tutor-library', 'text');

// Multi-tenant: progreso, notas y saber personal por usuario del contexto
function sessionsFile() { return userStore.userFile('tutor-sessions.json'); }
function teachFile()    { return userStore.userFile('personal-knowledge.json'); }
function notesFile()    { return userStore.userFile('tutor-notes.json'); }

function _ensureDir(p) { try { fs.mkdirSync(path.dirname(p), { recursive: true }); } catch {} }

function _readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function _writeJson(p, data) {
  _ensureDir(p);
  fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
}

function _catalog() {
  const raw = _readJson(path.join(CATALOG_DIR, 'grinberg.json'), null);
  if (!raw) return null;
  // Añade info runtime: si el PDF existe en disco
  raw.works = (raw.works || []).map(w => ({
    ...w,
    hasFile: fs.existsSync(path.join(PDF_DIR, w.file || ''))
  }));
  raw.filesOnDisk = raw.works.filter(w => w.hasFile).length;
  return raw;
}

function _sessions() { return _readJson(sessionsFile(), { sessions: {}, updated: null }); }
function _saveSessions(s) { s.updated = new Date().toISOString(); _writeJson(sessionsFile(), s); }

/**
 * op: 'catalog'   → devuelve el catalog + qué PDFs están en disco
 * op: 'work'      → { n }     → devuelve metadata detallada de una obra
 * op: 'curricula' → devuelve las rutas de estudio disponibles
 * op: 'progress'  → { userId, workN?, chapter?, note? } → guarda avance
 * op: 'session'   → { userId } → devuelve estado de sesión (dónde quedó, plan sugerido)
 * op: 'suggest'   → { userId, themes?, level? } → sugiere próxima obra
 */
async function handle(op, params = {}) {
  const cat = _catalog();
  if (!cat) return { success: false, error: 'catalog-missing', message: 'No pude cargar el catalog de la biblioteca del tutor.' };

  switch (op) {
    case 'catalog':
      return { success: true, data: {
        author: cat.author,
        totalWorks: cat.total_works,
        filesOnDisk: cat.filesOnDisk,
        themesRoot: cat.themes_root,
        curricula: cat.curricula,
        works: cat.works
      }};

    case 'work': {
      const n = String(params.n || '');
      const w = (cat.works || []).find(x => x.n === n);
      if (!w) return { success: false, error: 'work-not-found', message: `Obra #${n} no está en el catalog.` };
      const prereqs = (w.prerequisites || []).map(pn => {
        const p = cat.works.find(x => x.n === pn);
        return p ? { n: p.n, title: p.title } : null;
      }).filter(Boolean);
      return { success: true, data: { ...w, prereqDetails: prereqs, author: cat.author } };
    }

    case 'curricula':
      return { success: true, data: cat.curricula.map(c => ({
        ...c,
        works: (c.path || []).map(n => {
          const w = cat.works.find(x => x.n === n);
          return w ? { n: w.n, title: w.title, difficulty: w.difficulty } : { n, title: 'desconocida' };
        })
      })) };

    case 'session': {
      const userId = String(params.userId || 'default');
      const all = _sessions();
      const s = all.sessions[userId] || { userId, currentWork: null, chapters: {}, history: [], startedAt: null };
      // Enriquece con metadata
      if (s.currentWork) {
        const w = cat.works.find(x => x.n === s.currentWork);
        s.currentWorkMeta = w ? { n: w.n, title: w.title, themes: w.themes, difficulty: w.difficulty } : null;
      }
      return { success: true, data: s };
    }

    case 'progress': {
      const userId = String(params.userId || 'default');
      const all = _sessions();
      const s = all.sessions[userId] || { userId, currentWork: null, chapters: {}, history: [], startedAt: null };
      if (!s.startedAt) s.startedAt = new Date().toISOString();

      if (params.workN) s.currentWork = String(params.workN);
      if (params.chapter && s.currentWork) {
        s.chapters[s.currentWork] = s.chapters[s.currentWork] || [];
        if (!s.chapters[s.currentWork].includes(params.chapter)) {
          s.chapters[s.currentWork].push(params.chapter);
        }
      }
      s.history.push({
        at: new Date().toISOString(),
        workN: params.workN || s.currentWork,
        chapter: params.chapter || null,
        note: params.note || null
      });
      if (s.history.length > 200) s.history = s.history.slice(-200);
      all.sessions[userId] = s;
      _saveSessions(all);
      return { success: true, data: s };
    }

    case 'suggest': {
      const userId = String(params.userId || 'default');
      const all = _sessions();
      const s = all.sessions[userId];
      const seen = new Set(Object.keys(s?.chapters || {}));
      const wantThemes = new Set((params.themes || []).map(x => String(x).toLowerCase()));
      const level = params.level || 'principiante';
      const levelOrder = { principiante: 0, intermedio: 1, avanzado: 2 };

      const candidates = (cat.works || []).filter(w => {
        if (seen.has(w.n)) return false;
        if (levelOrder[w.difficulty] > levelOrder[level]) return false;
        if (wantThemes.size && !(w.themes || []).some(t => wantThemes.has(t))) return false;
        const prereqsMet = (w.prerequisites || []).every(p => seen.has(p));
        return prereqsMet;
      });

      const first = candidates[0] || null;
      return { success: true, data: {
        suggested: first ? { n: first.n, title: first.title, themes: first.themes, difficulty: first.difficulty, why: 'Prerrequisitos cumplidos y del nivel apropiado.' } : null,
        alternatives: candidates.slice(1, 4).map(w => ({ n: w.n, title: w.title, difficulty: w.difficulty }))
      }};
    }

    case 'search': {
      const query = String(params.query || '').trim();
      if (query.length < 3) return { success: false, error: 'query-too-short', message: 'Dame al menos 3 caracteres.' };
      const topN = Math.min(Math.max(1, parseInt(params.limit, 10) || 8), 30);
      const restrictTo = new Set((params.workNumbers || []).map(String));
      const results = _searchTexts(query, cat, restrictTo, topN);
      return { success: true, data: { query, hits: results, hitCount: results.length } };
    }

    // ═════════════════════════════════════════════
    // SAGE — BM25 + concepts + cross-refs
    // ═════════════════════════════════════════════
    case 'sage-status':
      if (!sage) return { success: false, error: 'sage-missing', message: 'Motor sage no cargado.' };
      return { success: true, data: sage.indexStatus() };

    case 'sage-query': {
      if (!sage) return { success: false, error: 'sage-missing', message: 'Motor sage no cargado.' };
      const q = String(params.query || '').trim();
      if (q.length < 3) return { success: false, error: 'query-too-short' };
      const restrictWorks = params.workNumbers ? params.workNumbers.map(String) : null;
      const result = sage.sage(q, { limit: params.limit || 6, restrictWorks });
      return { success: true, data: result };
    }

    case 'sage-bm25': {
      if (!sage) return { success: false, error: 'sage-missing' };
      const q = String(params.query || '').trim();
      if (q.length < 3) return { success: false, error: 'query-too-short' };
      const result = sage.query(q, {
        limit: params.limit || 8,
        restrictWorks: params.workNumbers ? params.workNumbers.map(String) : null
      });
      return { success: true, data: result };
    }

    case 'sage-concepts': {
      if (!sage) return { success: false, error: 'sage-missing' };
      const n = String(params.n || '');
      const c = sage.bookConcepts(n);
      if (!c) return { success: false, error: 'work-not-indexed', message: `Obra #${n} sin conceptos (probablemente escaneada).` };
      return { success: true, data: c };
    }

    case 'sage-crossrefs': {
      if (!sage) return { success: false, error: 'sage-missing' };
      const n = String(params.n || '');
      return { success: true, data: { workN: n, refs: sage.crossRefs(n) } };
    }

    case 'sage-experts': {
      if (!sage) return { success: false, error: 'sage-missing' };
      const term = String(params.term || '').trim();
      if (!term) return { success: false, error: 'term-empty' };
      return { success: true, data: { term, experts: sage.conceptBookMap(term) } };
    }

    case 'sage-digest': {
      if (!sage) return { success: false, error: 'sage-missing' };
      const n = String(params.n || '');
      const digest = sage.bookDigest(n);
      if (!digest) return { success: false, error: 'digest-missing', message: `Digest para #${n} no generado. Corre "node server/tutor/build-digests.js" primero.` };
      return { success: true, data: digest };
    }

    // ═════════════════════════════════════════════
    // TEACH — "Enséñale a Gunter": conocimiento personal
    // del usuario, indexado y consultable con citas.
    // Persistencia: data/personal-knowledge.json
    // ═════════════════════════════════════════════
    case 'teach-add': {
      const title = String(params.title || '').trim().slice(0, 120);
      const text = String(params.text || '').trim();
      if (text.length < 10) return { success: false, error: 'text-too-short', message: 'Dame al menos una frase completa.' };
      const kPath = teachFile();
      const store = _readJson(kPath, { entries: [] });
      const entry = {
        id: 'k_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        title: title || text.split(/\s+/).slice(0, 8).join(' ') + '…',
        text: text.slice(0, 8000),
        tags: params.tags || [],
        at: new Date().toISOString()
      };
      store.entries.push(entry);
      _writeJson(kPath, store);
      return { success: true, data: { id: entry.id, title: entry.title, total: store.entries.length } };
    }

    case 'teach-list': {
      const kPath = teachFile();
      const store = _readJson(kPath, { entries: [] });
      return { success: true, data: {
        total: store.entries.length,
        entries: store.entries.map(e => ({ id: e.id, title: e.title, at: e.at, chars: e.text.length }))
      }};
    }

    case 'teach-remove': {
      const kPath = teachFile();
      const store = _readJson(kPath, { entries: [] });
      const before = store.entries.length;
      const target = String(params.id || '');
      // Acepta id o índice 1-based
      if (/^\d+$/.test(target)) {
        store.entries.splice(Number(target) - 1, 1);
      } else {
        store.entries = store.entries.filter(e => e.id !== target);
      }
      _writeJson(kPath, store);
      return { success: true, data: { removed: before - store.entries.length, total: store.entries.length } };
    }

    case 'teach-search': {
      const q = String(params.query || '').trim();
      if (q.length < 3) return { success: false, error: 'query-too-short' };
      const kPath = teachFile();
      const store = _readJson(kPath, { entries: [] });
      if (!store.entries.length) return { success: true, data: { hits: [] } };

      // BM25-lite: TF de términos stemmed (reutiliza el tokenizer del sage)
      let tokenize;
      try { ({ tokenize } = require('./build-index')); }
      catch { tokenize = (s) => String(s).toLowerCase().split(/\s+/).filter(w => w.length > 2); }
      const qTokens = tokenize(q);
      if (!qTokens.length) return { success: true, data: { hits: [] } };

      const hits = [];
      for (const e of store.entries) {
        const docTokens = tokenize(e.text + ' ' + e.title);
        let score = 0;
        for (const t of qTokens) {
          const tf = docTokens.filter(d => d === t || d.startsWith(t)).length;
          score += tf;
        }
        if (score > 0) {
          // Snippet alrededor del primer match
          const norm = e.text.toLowerCase();
          let pos = -1;
          for (const t of qTokens) {
            const i = norm.indexOf(t.slice(0, 5));
            if (i >= 0 && (pos < 0 || i < pos)) pos = i;
          }
          const start = Math.max(0, (pos < 0 ? 0 : pos) - 80);
          hits.push({
            id: e.id, title: e.title, score,
            snippet: (start > 0 ? '…' : '') + e.text.slice(start, start + 320) + (start + 320 < e.text.length ? '…' : ''),
            at: e.at
          });
        }
      }
      hits.sort((a, b) => b.score - a.score);
      return { success: true, data: { hits: hits.slice(0, Math.min(params.limit || 4, 10)) } };
    }

    // ═════════════════════════════════════════════
    // NOTES SYNC — respaldo server-side de la huella
    // de estudio (localStorage → data/tutor-notes.json)
    // ═════════════════════════════════════════════
    case 'notes-push': {
      const userId = String(params.userId || 'default');
      const payload = params.data;
      if (!payload || typeof payload !== 'object') {
        return { success: false, error: 'bad-payload' };
      }
      const notesPath = notesFile();
      let all = _readJson(notesPath, { users: {} });
      // Merge conservador: el push del cliente es la fuente de verdad,
      // pero guardamos backup previo la primera vez del día.
      all.users[userId] = {
        notes: payload.notes || [],
        bookmarks: payload.bookmarks || [],
        history: (payload.history || []).slice(-500),
        repaso: payload.repaso || null,
        rules: payload.rules || null,
        pushedAt: new Date().toISOString()
      };
      _writeJson(notesPath, all);
      return { success: true, data: { saved: true, notes: all.users[userId].notes.length, bookmarks: all.users[userId].bookmarks.length } };
    }

    case 'notes-pull': {
      const userId = String(params.userId || 'default');
      const notesPath = notesFile();
      const all = _readJson(notesPath, { users: {} });
      const data = all.users[userId] || null;
      return { success: true, data };
    }

    case 'sage-inventory': {
      if (!sage) return { success: false, error: 'sage-missing' };
      const inv = sage.inventory();
      if (!inv) return { success: false, error: 'index-not-built' };
      return { success: true, data: inv };
    }

    // Bulk warmup: digests + concepts + crossrefs de TODAS las obras en 1 request.
    // Reemplaza los ~65 requests paralelos del warmup client-side.
    case 'sage-bulk': {
      if (!sage) return { success: false, error: 'sage-missing' };
      const inv = sage.inventory();
      if (!inv) return { success: false, error: 'index-not-built' };
      const digests = {}, concepts = {}, crossRefs = {};
      for (const w of inv.indexed) {
        const d = sage.bookDigest(w.workN);
        if (d) digests[w.workN] = d;
        const c = sage.bookConcepts(w.workN);
        if (c) concepts[w.workN] = c;
        crossRefs[w.workN] = sage.crossRefs(w.workN);
      }
      return { success: true, data: { inventory: inv, digests, concepts, crossRefs } };
    }

    case 'sage-synthesize': {
      if (!sage) return { success: false, error: 'sage-missing' };
      const q = String(params.query || '').trim();
      if (q.length < 4) return { success: false, error: 'query-too-short' };
      const res = sage.synthesize(q, { limit: params.limit || 12 });
      return { success: true, data: res };
    }

    case 'sage-chapter': {
      if (!sage) return { success: false, error: 'sage-missing' };
      const n = String(params.n || '');
      const chIdx = params.chapterIdx;
      if (chIdx === undefined || chIdx === null) return { success: false, error: 'chapter-missing' };
      const chapter = sage.chapterContent(n, chIdx);
      if (!chapter) return { success: false, error: 'chapter-not-found', message: `Capítulo #${chIdx} de obra #${n} no encontrado.` };
      return { success: true, data: chapter };
    }

    default:
      return { success: false, error: 'unknown-op', message: `Op no reconocida: ${op}. Válidas: catalog, work, curricula, session, progress, suggest, search, sage-status, sage-query, sage-bm25, sage-concepts, sage-crossrefs, sage-experts.` };
  }
}

// ─────────────────────────────────────────────
// Text search grep-like sobre los .json extraídos
// ─────────────────────────────────────────────
function _normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function _searchTexts(query, catalog, restrictTo, topN) {
  if (!fs.existsSync(TEXT_DIR)) return [];
  const files = fs.readdirSync(TEXT_DIR).filter(f => /\.json$/.test(f));
  const qNorm = _normalize(query);
  const qTerms = qNorm.split(/\s+/).filter(w => w.length > 2);
  if (!qTerms.length) return [];

  const hits = [];
  for (const f of files) {
    const workN = f.replace(/\.json$/, '');
    if (restrictTo.size && !restrictTo.has(workN)) continue;

    let record;
    try { record = JSON.parse(fs.readFileSync(path.join(TEXT_DIR, f), 'utf8')); }
    catch { continue; }

    for (const p of (record.pages || [])) {
      const norm = _normalize(p.text);
      // Score: términos únicos matched * 2, +bonus por total de ocurrencias,
      // +bonus por frase exacta. Pesos ajustados para que páginas ricas suban.
      let hitTerms = 0;
      let totalHits = 0;
      for (const t of qTerms) {
        const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
        const matches = norm.match(re);
        if (matches) { hitTerms++; totalHits += matches.length; }
      }
      if (hitTerms === 0) continue;
      const exactPhrase = qNorm.length > 5 && norm.includes(qNorm);
      const score = hitTerms * 2 + Math.min(totalHits, 20) + (exactPhrase ? qTerms.length * 3 : 0);

      // Extract snippet alrededor del primer match
      let snippetStart = 0;
      const firstMatch = norm.indexOf(exactPhrase ? qNorm : qTerms[0]);
      if (firstMatch > 0) snippetStart = Math.max(0, firstMatch - 120);
      const rawText = p.text;
      // Re-mapear posición aproximada (norm es lowercased pero misma longitud)
      let snippet = rawText.slice(snippetStart, snippetStart + 360);
      if (snippetStart > 0) snippet = '…' + snippet;
      if (snippetStart + 360 < rawText.length) snippet = snippet + '…';

      hits.push({
        workN,
        title: record.title,
        pageNum: p.pageNum,
        score,
        snippet: snippet.replace(/\s+/g, ' ').trim(),
        exactPhrase
      });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, topN);
}

module.exports = { handle };
