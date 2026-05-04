/* =============================================
   GUNTER KNOWLEDGE SEARCH (Fase 11.4)
   -------------------------------------------------
   Búsqueda local-first sobre el snapshot:
     - resolveProject(query): match por nombre exacto,
       parcial, alias, keywords y mercado.
     - search(query, opts): ranking simple sobre
       texto en proyectos, reuniones, análisis,
       tareas y documentos.
     - findInTranscripts(needle): busca frases en
       transcriptionExcerpt de meetings.
   ============================================= */

const store = require('./store');

function lower(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function tokens(s) {
    return lower(s).match(/[a-z0-9ñ]{2,}/g) || [];
}

const STOP = new Set([
    'que','de','la','el','los','las','un','una','unos','unas','y','o','en','para','por',
    'del','con','al','se','su','sus','lo','le','les','es','son','este','esta','estos','estas',
    'me','mi','tu','tus','mis','muy','sin','sobre','como','pero','si','no','ya','también',
    'tambien','entre','desde','hasta','cuando','donde','dentro','tipo','sus','nuestro','nuestra',
    'qué','que','quién','quien','dónde','donde','cómo','como','cuál','cual','cuáles','cuales','cuándo','cuando',
    'gunter','sabes','sabe','muestra','muestrame','muéstrame','dime','tiene','hay','tengo'
]);

function meaningful(toks) {
    return toks.filter(t => !STOP.has(t) && t.length > 2);
}

// ---------- Project resolution ----------
/**
 * Devuelve { exact, candidates } donde:
 *   exact = project | null   (match suficientemente claro para auto-seleccionar)
 *   candidates = top-N proyectos con score
 */
function resolveProject(query, { contactId = null, topN = 3 } = {}) {
    const snap = store.getSnapshot();
    if (!snap || !snap.projects?.length) {
        return { exact: null, candidates: [], reason: 'no-snapshot' };
    }

    const q = lower(query);
    const qToks = meaningful(tokens(query));
    if (!q || qToks.length === 0) {
        return { exact: null, candidates: [], reason: 'empty-query' };
    }

    const aliases = contactId ? store.getAliases(contactId) : [];
    const aliasBoost = new Map(aliases.map(a => [a.projectId, Math.min(a.hits, 5) * 0.4]));

    const qNoSpace = q.replace(/\s+/g, '');

    const scored = snap.projects.map(p => {
        const nameNorm = p.nameNormalized || lower(p.name);
        const nameNoSpace = nameNorm.replace(/\s+/g, '');
        let score = 0;
        const reasons = [];

        // 1) Exact match en nombre completo (con o sin espacios — "servi mil" = "servimil")
        if (q === nameNorm) { score += 10; reasons.push('exact-name'); }
        else if (qNoSpace === nameNoSpace && nameNoSpace.length >= 3) { score += 9; reasons.push('exact-no-space'); }

        // 2) Substring del nombre completo en query, o viceversa (con/sin espacios)
        if (q.includes(nameNorm) && nameNorm.length >= 3) { score += 6; reasons.push('contains-full-name'); }
        if (nameNorm.includes(q) && q.length >= 3)        { score += 5; reasons.push('name-contains-query'); }
        if (qNoSpace.includes(nameNoSpace) && nameNoSpace.length >= 4) { score += 5; reasons.push('contains-name-no-space'); }
        if (nameNoSpace.includes(qNoSpace) && qNoSpace.length >= 4)    { score += 4; reasons.push('name-contains-q-no-space'); }

        // 3) Tokens del nombre presentes en query
        const nameToks = meaningful(tokens(p.name));
        const nameMatches = nameToks.filter(t => qToks.includes(t)).length;
        if (nameMatches > 0) { score += nameMatches * 2.5; reasons.push(`name-tokens:${nameMatches}`); }

        // 4) Tokens del mercado/keywords presentes en query
        const marketToks = meaningful(tokens(p.market || ''));
        const marketMatches = marketToks.filter(t => qToks.includes(t)).length;
        if (marketMatches > 0) { score += marketMatches * 1.2; reasons.push(`market:${marketMatches}`); }

        const kwSet = new Set(p.keywords || []);
        const kwMatches = qToks.filter(t => kwSet.has(t)).length;
        if (kwMatches > 0) { score += kwMatches * 0.8; reasons.push(`keywords:${kwMatches}`); }

        // 5) Substring del environment
        if (qToks.includes(lower(p.environment))) { score += 0.5; reasons.push('env'); }

        // 6) Alias boost por contacto
        if (aliasBoost.has(p.id)) {
            const b = aliasBoost.get(p.id);
            score += b;
            reasons.push(`alias-boost:${b.toFixed(2)}`);
        }

        // 7) Recency tiny boost (proyectos activos < 30d)
        if (p.lastActivityAt) {
            const ageDays = (Date.now() - new Date(p.lastActivityAt).getTime()) / 86400000;
            if (ageDays < 30) score += Math.max(0, 0.5 - ageDays / 60);
        }

        return { project: p, score, reasons };
    });

    scored.sort((a, b) => b.score - a.score);
    const positives = scored.filter(s => s.score > 0).slice(0, topN);

    // Decisión "exact":
    //   - top score >= 5  Y  segundo está al menos 2 puntos por debajo, o
    //   - top score >= 8 (alguien claramente ganó)
    const top = positives[0];
    const second = positives[1];
    let exact = null;
    if (top) {
        if (top.score >= 8) exact = top.project;
        else if (top.score >= 5 && (!second || top.score - second.score >= 2)) exact = top.project;
    }

    return {
        exact,
        candidates: positives.map(s => ({ project: s.project, score: +s.score.toFixed(2), reasons: s.reasons }))
    };
}

// ---------- Generic search across content ----------
/**
 * scope: 'projects' | 'meetings' | 'tasks' | 'documents' | 'decisions' | 'all'
 * Devuelve resultados rankeados con tipo y match.
 */
function search(query, { scope = 'all', projectId = null, limit = 8 } = {}) {
    const snap = store.getSnapshot();
    if (!snap) return [];
    const qToks = meaningful(tokens(query));
    if (qToks.length === 0) return [];

    const projects = projectId
        ? (snap.projects || []).filter(p => p.id === projectId)
        : (snap.projects || []);

    const out = [];

    for (const p of projects) {
        if (scope === 'projects' || scope === 'all') {
            const blob = lower([p.name, p.market, p.summary, ...(p.keywords || [])].join(' '));
            const sc = scoreText(blob, qToks);
            if (sc > 0) out.push({ kind: 'project', score: sc, projectId: p.id, projectName: p.name, snippet: p.summary || p.market || p.name });
        }
        if (scope === 'meetings' || scope === 'all') {
            for (const m of p.meetings || []) {
                const blob = lower(m.transcriptionExcerpt || '');
                const sc = scoreText(blob, qToks);
                if (sc > 0) out.push({
                    kind: 'meeting', score: sc, projectId: p.id, projectName: p.name,
                    meetingId: m.id, at: m.timestamp,
                    snippet: extractSnippet(m.transcriptionExcerpt, qToks)
                });
            }
        }
        if (scope === 'tasks' || scope === 'all') {
            for (const t of p.tasks || []) {
                const blob = lower([t.title, ...(t.tags || [])].join(' '));
                const sc = scoreText(blob, qToks);
                if (sc > 0) out.push({
                    kind: 'task', score: sc, projectId: p.id, projectName: p.name,
                    taskId: t.id, title: t.title, status: t.status, dueAt: t.dueAt
                });
            }
        }
        if (scope === 'documents' || scope === 'all') {
            for (const d of p.documents || []) {
                const blob = lower([d.title, d.empresa, d.resumen, d.tipo].join(' '));
                const sc = scoreText(blob, qToks);
                if (sc > 0) out.push({
                    kind: 'document', score: sc, projectId: p.id, projectName: p.name,
                    documentId: d.id, title: d.title, empresa: d.empresa, valor: d.valor,
                    snippet: d.resumen
                });
            }
        }
        if (scope === 'decisions' || scope === 'all') {
            for (const dec of p.decisions || []) {
                const blob = lower(dec.text || '');
                const sc = scoreText(blob, qToks);
                if (sc > 0) out.push({
                    kind: 'decision', score: sc, projectId: p.id, projectName: p.name,
                    text: dec.text, source: dec.source, at: dec.at
                });
            }
        }
    }

    // Globals (sin proyecto)
    if (!projectId && (scope === 'tasks' || scope === 'all')) {
        for (const t of snap.globalTasks || []) {
            const blob = lower([t.title, ...(t.tags || [])].join(' '));
            const sc = scoreText(blob, qToks);
            if (sc > 0) out.push({
                kind: 'task', score: sc, projectId: null, projectName: null,
                taskId: t.id, title: t.title, status: t.status, dueAt: t.dueAt
            });
        }
    }
    if (!projectId && (scope === 'documents' || scope === 'all')) {
        for (const d of snap.globalDocuments || []) {
            const blob = lower([d.title, d.empresa, d.resumen, d.tipo].join(' '));
            const sc = scoreText(blob, qToks);
            if (sc > 0) out.push({
                kind: 'document', score: sc, projectId: null, projectName: null,
                documentId: d.id, title: d.title, empresa: d.empresa, valor: d.valor,
                snippet: d.resumen
            });
        }
    }

    out.sort((a, b) => b.score - a.score);
    return out.slice(0, limit);
}

function scoreText(blob, qToks) {
    if (!blob || !qToks.length) return 0;
    let score = 0;
    let matched = 0;
    for (const t of qToks) {
        if (blob.includes(t)) { score += 1; matched++; }
        // boost por substring de mayor tamaño
        if (t.length >= 5 && blob.indexOf(t) >= 0) score += 0.4;
    }
    if (matched === qToks.length) score += 1.0;   // todos los términos presentes
    return score;
}

function extractSnippet(text, qToks, ctx = 80) {
    if (!text) return '';
    const lo = lower(text);
    let bestIdx = -1;
    for (const t of qToks) {
        const idx = lo.indexOf(t);
        if (idx >= 0 && (bestIdx < 0 || idx < bestIdx)) bestIdx = idx;
    }
    if (bestIdx < 0) return text.slice(0, 200);
    const start = Math.max(0, bestIdx - ctx);
    const end = Math.min(text.length, bestIdx + ctx + 80);
    return (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
}

// ---------- Project context bundle ----------
// Empaqueta info compacta de un proyecto para meterla al prompt del LLM.
function projectContextBundle(projectId, { maxBytes = 4000 } = {}) {
    const p = store.getProject(projectId);
    if (!p) return null;

    const lines = [];
    lines.push(`PROYECTO: ${p.name} (id: ${p.id})`);
    if (p.market) lines.push(`Mercado: ${p.market}`);
    if (p.environment) lines.push(`Entorno: ${p.environment}`);
    if (p.status) lines.push(`Estado: ${p.status}`);
    if (p.lastActivityAt) lines.push(`Última actividad: ${p.lastActivityAt}`);
    if (p.summary) lines.push(`Resumen: ${p.summary}`);

    if (p.keywords?.length) lines.push(`Keywords: ${p.keywords.slice(0, 10).join(', ')}`);

    if (p.meetings?.length) {
        lines.push(`\n— REUNIONES (${p.meetings.length}):`);
        for (const m of p.meetings.slice(-3)) {
            lines.push(`  · ${m.timestamp || ''} (${m.duration || 0}s)`);
            if (m.transcriptionExcerpt) lines.push(`    "${m.transcriptionExcerpt.slice(0, 400)}..."`);
        }
    }

    if (p.analyses?.length) {
        lines.push(`\n— ANÁLISIS (${p.analyses.length}):`);
        for (const a of p.analyses.slice(-4)) {
            lines.push(`  · [${a.title}] ${a.payloadSummary?.slice(0, 280) || ''}`);
        }
    }

    if (p.tasks?.length) {
        lines.push(`\n— TAREAS (${p.tasks.length}):`);
        for (const t of p.tasks.slice(0, 8)) {
            lines.push(`  · ${t.title} [${t.status || 'pending'}${t.dueAt ? ' @ ' + t.dueAt : ''}${t.priority === 'urgent' ? ' URGENTE' : ''}]`);
        }
    }

    if (p.events?.length) {
        lines.push(`\n— EVENTOS (${p.events.length}):`);
        for (const e of p.events.slice(0, 6)) {
            lines.push(`  · ${e.title} @ ${e.startAt || '—'}`);
        }
    }

    if (p.documents?.length) {
        lines.push(`\n— DOCUMENTOS (${p.documents.length}):`);
        for (const d of p.documents.slice(0, 6)) {
            const v = d.valor ? ` ${d.valor}${d.moneda ? ' ' + d.moneda : ''}` : '';
            const f = d.fechaVencimiento ? ` vence ${d.fechaVencimiento}` : '';
            lines.push(`  · [${d.tipo}] ${d.title}${v}${f}`);
        }
    }

    if (p.decisions?.length) {
        lines.push(`\n— DECISIONES (${p.decisions.length}):`);
        for (const d of p.decisions.slice(0, 5)) {
            lines.push(`  · "${d.text}"`);
        }
    }

    let bundle = lines.join('\n');
    if (bundle.length > maxBytes) bundle = bundle.slice(0, maxBytes) + '\n…(truncado)';
    return bundle;
}

// ---------- Global summary ----------
function globalContextSummary({ maxProjects = 8 } = {}) {
    const snap = store.getSnapshot();
    if (!snap) return 'No hay snapshot de proyectos sincronizado.';
    const lines = [];
    lines.push(`PROYECTOS ACTIVOS (${snap.projects.length}):`);
    for (const p of (snap.projects || []).slice(0, maxProjects)) {
        const meta = [];
        if (p.environment) meta.push(p.environment);
        if (p.market) meta.push(p.market);
        const counts = `${p.meetings?.length || 0}r/${p.tasks?.length || 0}t/${p.documents?.length || 0}d`;
        lines.push(`- ${p.name} [${counts}]${meta.length ? ' · ' + meta.join(', ') : ''}`);
    }
    if (snap.globalTasks?.length) lines.push(`\nTAREAS GLOBALES: ${snap.globalTasks.length}`);
    if (snap.recentDecisions?.length) {
        lines.push(`\nÚLTIMAS DECISIONES (${Math.min(snap.recentDecisions.length, 4)}):`);
        for (const d of snap.recentDecisions.slice(0, 4)) {
            lines.push(`  · [${d.project}] ${d.text}`);
        }
    }
    lines.push(`\nÚltima sync: ${snap.syncedAt || '—'}`);
    return lines.join('\n');
}

module.exports = {
    resolveProject, search,
    projectContextBundle,
    globalContextSummary
};
