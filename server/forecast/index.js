/* =============================================
   FORECAST PROBABILÍSTICO — Facade (v2 — F6)
   -------------------------------------------------
   Predice tiempo a entrega y probabilidad de cumplir
   deadline para un proyecto, basado en:
     - velocity histórica de tareas (cuántas se cierran/semana)
     - cantidad de tareas pendientes
     - cantidad de compromisos vencidos asociados
     - inactividad reciente (días sin actividad)
     - número de bloqueadores
   Modelo: Monte Carlo simple (1k simulaciones), determinístico
   con seed por projectId para que sea reproducible.

   Storage: data/forecast-history.json
   ============================================= */

const fs = require('fs');
const path = require('path');
const knowledge = require('../knowledge');

let commitments = null;
try { commitments = require('../commitments'); } catch {}

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const FILE     = path.join(DATA_DIR, 'forecast-history.json');

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }

function loadAll() {
    try {
        ensureDir();
        if (!fs.existsSync(FILE)) return {};
        return JSON.parse(fs.readFileSync(FILE, 'utf8')) || {};
    } catch { return {}; }
}

function saveAll(obj) {
    try { ensureDir(); fs.writeFileSync(FILE, JSON.stringify(obj, null, 2), 'utf8'); }
    catch (e) { console.warn('[forecast] save:', e.message); }
}

// PRNG determinístico (mulberry32)
function seededRng(seed) {
    let s = seed >>> 0;
    return () => {
        s |= 0; s = (s + 0x6D2B79F5) | 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hashString(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

function dayDiff(a, b) {
    return (new Date(a).getTime() - new Date(b).getTime()) / 86400000;
}

/**
 * Calcula features del proyecto desde el snapshot + commitments.
 */
function projectFeatures(project) {
    const tasks = project.tasks || [];
    const open = tasks.filter(t => t.status !== 'done' && t.status !== 'completed' && !t.completedAt);
    const closed = tasks.filter(t => t.status === 'done' || t.status === 'completed' || t.completedAt);

    // Velocity: tareas cerradas en últimos 28 días / 4 semanas
    const now = Date.now();
    const closed28d = closed.filter(t => {
        const d = t.completedAt || t.updatedAt;
        return d && (now - new Date(d).getTime()) <= 28 * 86400000;
    });
    const velocityPerWeek = closed28d.length / 4;

    // Inactividad
    const lastActivity = project.lastActivityAt || project.updatedAt;
    const daysIdle = lastActivity ? dayDiff(now, lastActivity) : 999;

    // Compromisos vencidos asociados
    let overdueCommitments = 0;
    if (commitments?.listAll) {
        try {
            const cmts = commitments.listAll({ projectId: project.id });
            overdueCommitments = cmts.filter(c => c.status === 'overdue').length;
        } catch {}
    }

    // Deadline si lo hay
    const deadline = project.deadline || project.dueDate || null;
    const daysToDeadline = deadline ? dayDiff(deadline, now) : null;

    // Bloqueadores (heurística por etiquetas o status 'blocked')
    const blockers = open.filter(t => t.status === 'blocked' || /bloque/i.test(t.title || '')).length;

    return {
        openTasks: open.length,
        closedTasks: closed.length,
        velocityPerWeek,
        daysIdle,
        overdueCommitments,
        deadline,
        daysToDeadline,
        blockers
    };
}

/**
 * Monte Carlo: simula completar las openTasks restantes.
 * - throughputDistribution: por semana = Poisson(λ = velocityPerWeek)
 * - drag por inactividad / overdue commitments / blockers
 * Devuelve array de días-hasta-completar (1k simulaciones).
 */
function simulate(features, runs = 1000, seedKey = '') {
    const rng = seededRng(hashString(seedKey || 'default'));
    const lambdaBase = Math.max(0.25, features.velocityPerWeek); // mínimo 0.25 tareas/semana
    // Drag multiplicativo
    let drag = 1.0;
    if (features.daysIdle > 14) drag *= 0.7;
    if (features.daysIdle > 30) drag *= 0.7;
    if (features.overdueCommitments > 0) drag *= Math.max(0.3, 1 - features.overdueCommitments * 0.1);
    if (features.blockers > 0)            drag *= Math.max(0.4, 1 - features.blockers * 0.15);
    const lambda = lambdaBase * drag;

    const days = [];
    for (let r = 0; r < runs; r++) {
        let remaining = features.openTasks;
        let weeks = 0;
        const maxWeeks = 200;
        while (remaining > 0 && weeks < maxWeeks) {
            // sample Poisson(lambda) by Knuth
            const k = poissonSample(lambda, rng);
            remaining -= k;
            weeks++;
            // Pequeña probabilidad de un blocker espontáneo (3%)
            if (rng() < 0.03) weeks += 1;
        }
        days.push(weeks * 7);
    }
    days.sort((a, b) => a - b);
    return days;
}

function poissonSample(lambda, rng) {
    const L = Math.exp(-lambda);
    let k = 0; let p = 1;
    do {
        k++;
        p *= rng();
    } while (p > L);
    return k - 1;
}

function percentile(arr, p) {
    if (!arr.length) return 0;
    const idx = Math.min(arr.length - 1, Math.floor((p / 100) * arr.length));
    return arr[idx];
}

/**
 * Forecast para un proyecto específico.
 * Si tiene deadline, calcula probabilidad de cumplirlo.
 */
async function forecastProject({ projectId } = {}) {
    if (!projectId) throw new Error('projectId required');
    const project = knowledge.getProject ? knowledge.getProject(projectId) : null;
    if (!project) return { ok: false, reason: 'project-not-found' };

    const features = projectFeatures(project);
    if (features.openTasks === 0) {
        return {
            ok: true,
            projectId,
            projectName: project.name,
            features,
            estimateDays: { p50: 0, p80: 0, p95: 0 },
            etaP50: new Date().toISOString(),
            etaP80: new Date().toISOString(),
            etaP95: new Date().toISOString(),
            probabilityHitDeadline: features.deadline ? 1 : null,
            confidence: 'high',
            note: 'Sin tareas abiertas: el proyecto se considera en cierre.'
        };
    }

    const days = simulate(features, 1000, projectId);
    const p50 = percentile(days, 50);
    const p80 = percentile(days, 80);
    const p95 = percentile(days, 95);

    const now = Date.now();
    let probabilityHitDeadline = null;
    if (features.deadline) {
        const deadlineMs = new Date(features.deadline).getTime();
        const daysAvailable = (deadlineMs - now) / 86400000;
        const hits = days.filter(d => d <= daysAvailable).length;
        probabilityHitDeadline = hits / days.length;
    }

    // Confianza basada en cantidad de datos
    const confidence = features.closedTasks >= 8 ? 'alta'
                     : features.closedTasks >= 3 ? 'media'
                     : 'baja';

    const result = {
        ok: true,
        projectId,
        projectName: project.name,
        features,
        estimateDays: { p50, p80, p95 },
        etaP50: new Date(now + p50 * 86400000).toISOString(),
        etaP80: new Date(now + p80 * 86400000).toISOString(),
        etaP95: new Date(now + p95 * 86400000).toISOString(),
        probabilityHitDeadline,
        confidence,
        generatedAt: new Date().toISOString()
    };

    // Persistir histórico
    const hist = loadAll();
    hist[projectId] = hist[projectId] || [];
    hist[projectId].push({ at: result.generatedAt, p50, p80, p95, probabilityHitDeadline, openTasks: features.openTasks, velocity: features.velocityPerWeek });
    if (hist[projectId].length > 50) hist[projectId] = hist[projectId].slice(-50);
    saveAll(hist);

    return result;
}

async function forecastAll({ topN = 10 } = {}) {
    const projects = knowledge.listProjects ? knowledge.listProjects({ limit: 200 }) : [];
    const results = [];
    for (const p of projects) {
        try {
            const r = await forecastProject({ projectId: p.id });
            if (r.ok) results.push(r);
        } catch { /* skip */ }
    }
    // Ordenar por riesgo: bajo probabilityHitDeadline primero (los riesgosos)
    results.sort((a, b) => {
        const pa = a.probabilityHitDeadline ?? 1;
        const pb = b.probabilityHitDeadline ?? 1;
        if (pa !== pb) return pa - pb;
        return b.estimateDays.p50 - a.estimateDays.p50;
    });
    return { items: results.slice(0, topN), totalEvaluated: results.length };
}

function getHistory(projectId) {
    return loadAll()[projectId] || [];
}

function clear() { saveAll({}); return true; }

module.exports = { forecastProject, forecastAll, getHistory, clear };
