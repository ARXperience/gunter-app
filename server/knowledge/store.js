/* =============================================
   GUNTER KNOWLEDGE STORE (Fase 11.2)
   -------------------------------------------------
   Persiste el ProjectKnowledgeSnapshot recibido
   del browser. JSON en disco; índice en memoria.

   Layout:
     whatsapp-data/knowledge/
       snapshot.json     (snapshot completo)
       index.json        (índice rápido)
       summaries.json    (resúmenes ejecutivos cached)
       contact-aliases.json  (contactId → projectIds frecuentes)

   API:
     putSnapshot(snapshot): {ok, lastSyncedAt, metadata}
     getSnapshot(): snapshot | null
     getIndex(): index
     getProject(id): project | null
     getProjectByName(name): project | null
     listProjects({limit?}): array
     stats(): metadata
     touchAlias(contactId, projectId)
     getAliases(contactId)
   ============================================= */

const fs = require('fs');
const path = require('path');

const DATA_DIR     = path.join(__dirname, '..', '..', 'whatsapp-data', 'knowledge');
const FILE_SNAP    = path.join(DATA_DIR, 'snapshot.json');
const FILE_INDEX   = path.join(DATA_DIR, 'index.json');
const FILE_SUMS    = path.join(DATA_DIR, 'summaries.json');
const FILE_ALIASES = path.join(DATA_DIR, 'contact-aliases.json');

let memSnapshot = null;
let memIndex = null;

function ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function lower(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function safeRead(file, fallback) {
    try {
        if (!fs.existsSync(file)) return fallback;
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch { return fallback; }
}

function safeWrite(file, data) {
    ensureDir();
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ---------- Snapshot persistence ----------
function loadSnapshot() {
    if (memSnapshot) return memSnapshot;
    memSnapshot = safeRead(FILE_SNAP, null);
    return memSnapshot;
}
function loadIndex() {
    if (memIndex) return memIndex;
    memIndex = safeRead(FILE_INDEX, null);
    if (!memIndex && memSnapshot) memIndex = buildIndex(memSnapshot);
    return memIndex;
}

function putSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.projects)) {
        throw new Error('Snapshot inválido: falta projects[]');
    }
    snapshot.receivedAt = new Date().toISOString();
    memSnapshot = snapshot;
    memIndex = buildIndex(snapshot);
    safeWrite(FILE_SNAP, snapshot);
    safeWrite(FILE_INDEX, memIndex);
    return {
        ok: true,
        lastSyncedAt: snapshot.syncedAt || snapshot.receivedAt,
        metadata: snapshot.metadata || {}
    };
}

function getSnapshot() { return loadSnapshot(); }
function getIndex() { return loadIndex(); }

function getProject(id) {
    const snap = loadSnapshot();
    if (!snap) return null;
    return (snap.projects || []).find(p => p.id === id) || null;
}

function getProjectByName(name) {
    const snap = loadSnapshot();
    if (!snap) return null;
    const norm = lower(name);
    return (snap.projects || []).find(p => p.nameNormalized === norm)
        || (snap.projects || []).find(p => lower(p.name) === norm)
        || null;
}

function listProjects({ limit = 50 } = {}) {
    const snap = loadSnapshot();
    if (!snap) return [];
    return (snap.projects || []).slice(0, limit).map(p => ({
        id: p.id,
        name: p.name,
        market: p.market,
        environment: p.environment,
        status: p.status,
        updatedAt: p.updatedAt,
        lastActivityAt: p.lastActivityAt,
        meetingCount: p.meetings?.length || 0,
        analysisCount: p.analyses?.length || 0,
        taskCount: p.tasks?.length || 0,
        eventCount: p.events?.length || 0,
        documentCount: p.documents?.length || 0
    }));
}

function stats() {
    const snap = loadSnapshot();
    if (!snap) return { hasSnapshot: false };
    return {
        hasSnapshot: true,
        lastSyncedAt: snap.syncedAt,
        receivedAt: snap.receivedAt,
        ...snap.metadata
    };
}

// ---------- Index builder ----------
function buildIndex(snapshot) {
    const projectsById = {};
    const projectsByName = {};      // nameNormalized → projectId
    const tasksByProject = {};
    const eventsByProject = {};
    const documentsByProject = {};
    const decisionsByProject = {};
    const keywords = {};            // keyword → [projectId, ...]

    for (const p of snapshot.projects || []) {
        projectsById[p.id] = {
            name: p.name, environment: p.environment,
            keywords: p.keywords || [], lastActivityAt: p.lastActivityAt
        };
        if (p.nameNormalized) projectsByName[p.nameNormalized] = p.id;

        tasksByProject[p.id]     = (p.tasks || []).map(t => t.id);
        eventsByProject[p.id]    = (p.events || []).map(e => e.id);
        documentsByProject[p.id] = (p.documents || []).map(d => d.id);
        decisionsByProject[p.id] = (p.decisions || []);

        for (const k of p.keywords || []) {
            if (!keywords[k]) keywords[k] = [];
            keywords[k].push(p.id);
        }
    }
    return {
        projectsById, projectsByName,
        tasksByProject, eventsByProject, documentsByProject, decisionsByProject,
        keywords,
        lastUpdated: new Date().toISOString()
    };
}

// ---------- Summaries cache ----------
function getSummary(projectId) {
    const all = safeRead(FILE_SUMS, {});
    return all[projectId] || null;
}
function setSummary(projectId, summary) {
    const all = safeRead(FILE_SUMS, {});
    all[projectId] = { ...summary, cachedAt: new Date().toISOString() };
    safeWrite(FILE_SUMS, all);
    return all[projectId];
}
function clearSummary(projectId) {
    const all = safeRead(FILE_SUMS, {});
    delete all[projectId];
    safeWrite(FILE_SUMS, all);
}

// ---------- Contact aliases ----------
function touchAlias(contactId, projectId) {
    if (!contactId || !projectId) return;
    const all = safeRead(FILE_ALIASES, {});
    if (!all[contactId]) all[contactId] = { projects: {}, updatedAt: null };
    all[contactId].projects[projectId] = (all[contactId].projects[projectId] || 0) + 1;
    all[contactId].updatedAt = new Date().toISOString();
    safeWrite(FILE_ALIASES, all);
}

function getAliases(contactId) {
    const all = safeRead(FILE_ALIASES, {});
    const entry = all[contactId];
    if (!entry) return [];
    return Object.entries(entry.projects)
        .sort((a, b) => b[1] - a[1])
        .map(([projectId, hits]) => ({ projectId, hits }));
}

module.exports = {
    putSnapshot, getSnapshot, getIndex,
    getProject, getProjectByName, listProjects,
    stats,
    getSummary, setSummary, clearSummary,
    touchAlias, getAliases
};
