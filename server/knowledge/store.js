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
const userStore = require('../user-store');
const ctx = require('../user-context');

// Multi-tenant: cada usuario tiene su carpeta knowledge/ (el dueño hereda
// la legacy whatsapp-data/knowledge/ por migración automática).
function kFile(name) { return path.join(userStore.userKnowledgeDir(), name); }

// Caches en memoria POR USUARIO (uid → data)
const memSnapshots = new Map();
const memIndexes = new Map();
const MAX_MEM_USERS = 20;   // higiene: no retener snapshots de usuarios inactivos

function _memGet(map) { return map.get(ctx.currentUserId()) || null; }
function _memSet(map, value) {
    const uid = ctx.currentUserId();
    map.set(uid, value);
    if (map.size > MAX_MEM_USERS) {
        const oldest = map.keys().next().value;
        if (oldest !== uid) map.delete(oldest);
    }
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
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

// ---------- Snapshot persistence ----------
function loadSnapshot() {
    let snap = _memGet(memSnapshots);
    if (snap) return snap;
    snap = safeRead(kFile('snapshot.json'), null);
    if (snap) _memSet(memSnapshots, snap);
    return snap;
}
function loadIndex() {
    let idx = _memGet(memIndexes);
    if (idx) return idx;
    idx = safeRead(kFile('index.json'), null);
    if (!idx) {
        const snap = loadSnapshot();
        if (snap) idx = buildIndex(snap);
    }
    if (idx) _memSet(memIndexes, idx);
    return idx;
}

function putSnapshot(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.projects)) {
        throw new Error('Snapshot inválido: falta projects[]');
    }
    snapshot.receivedAt = new Date().toISOString();
    const idx = buildIndex(snapshot);
    _memSet(memSnapshots, snapshot);
    _memSet(memIndexes, idx);
    safeWrite(kFile('snapshot.json'), snapshot);
    safeWrite(kFile('index.json'), idx);
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
    const all = safeRead(kFile('summaries.json'), {});
    return all[projectId] || null;
}
function setSummary(projectId, summary) {
    const all = safeRead(kFile('summaries.json'), {});
    all[projectId] = { ...summary, cachedAt: new Date().toISOString() };
    safeWrite(kFile('summaries.json'), all);
    return all[projectId];
}
function clearSummary(projectId) {
    const all = safeRead(kFile('summaries.json'), {});
    delete all[projectId];
    safeWrite(kFile('summaries.json'), all);
}

// ---------- Contact aliases ----------
function touchAlias(contactId, projectId) {
    if (!contactId || !projectId) return;
    const all = safeRead(kFile('contact-aliases.json'), {});
    if (!all[contactId]) all[contactId] = { projects: {}, updatedAt: null };
    all[contactId].projects[projectId] = (all[contactId].projects[projectId] || 0) + 1;
    all[contactId].updatedAt = new Date().toISOString();
    safeWrite(kFile('contact-aliases.json'), all);
}

function getAliases(contactId) {
    const all = safeRead(kFile('contact-aliases.json'), {});
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
