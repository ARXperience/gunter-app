/* =============================================
   GUNTER SERVICE - Project Knowledge (Fase 11.1)
   -------------------------------------------------
   Construye un ProjectKnowledgeSnapshot consolidando:
     - gunterData.projects[]                   (localStorage)
     - gunter_generated_analyses{}             (localStorage)
     - gunter_full_transcript                  (localStorage)
     - GunterTasksService.list()               (IndexedDB)
     - GunterEventsService.list()              (IndexedDB)
     - GunterDocumentService.list()            (IndexedDB)
     - GunterNotificationsService.list()       (IndexedDB)

   No envía nada — solo arma el objeto para que
   knowledge-sync-service decida cuándo empujar.

   Reglas:
     - Excluir audio blobs y data URLs grandes.
     - Truncar transcripciones a 4000 chars,
       análisis a 2000 chars (string).
     - Asociar tasks/events a projectId vía tags
       (formato 'project:<id>') o explícito.

   API:
     await GunterProjectKnowledge.build(): Snapshot
     GunterProjectKnowledge.hash(snapshot): string
     GunterProjectKnowledge.diffSummary(prev, next): string
   ============================================= */

(function () {
    const SNAPSHOT_VERSION = 1;
    const MAX_TRANSCRIPT_CHARS = 4000;
    const MAX_ANALYSIS_JSON_CHARS = 2000;

    function safeParse(json) {
        try { return JSON.parse(json); } catch { return null; }
    }

    function lower(s) {
        return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    }

    // Extrae projectId desde tags `project:<id>` o desde campo explícito
    function projectIdOf(item) {
        if (!item) return null;
        if (item.projectId) return item.projectId;
        const tags = Array.isArray(item.tags) ? item.tags : [];
        for (const t of tags) {
            const m = String(t || '').match(/^project:(.+)$/);
            if (m) return m[1];
        }
        return null;
    }

    function summarizeAnalysisPayload(payload) {
        if (!payload) return '';
        try {
            const s = typeof payload === 'string' ? payload : JSON.stringify(payload);
            return s.length > MAX_ANALYSIS_JSON_CHARS ? s.slice(0, MAX_ANALYSIS_JSON_CHARS) + '…' : s;
        } catch { return ''; }
    }

    function deriveKeywords(...texts) {
        const blob = lower(texts.filter(Boolean).join(' '));
        if (!blob) return [];
        const STOP = new Set(['de','la','el','los','las','y','o','en','un','una','para','por','que','del','con','al','se','su','sus','lo','le','les','es','son','este','esta','estos','estas','muy','más','sin','sobre','como','pero','si','no','ya','también','tambien','entre','desde','hasta','cuando','donde','dentro','tipo','sus','nuestro','nuestra']);
        const tokens = blob.match(/[a-z0-9áéíóúñ]{4,}/g) || [];
        const counts = new Map();
        for (const t of tokens) {
            if (STOP.has(t)) continue;
            counts.set(t, (counts.get(t) || 0) + 1);
        }
        return [...counts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 18)
            .map(([w]) => w);
    }

    function shortSummaryFromAnalyses(analyses) {
        if (!analyses?.length) return '';
        const last = analyses[analyses.length - 1];
        const t = last?.transcription || '';
        if (!t) return '';
        return t.replace(/\s+/g, ' ').slice(0, 280);
    }

    async function build() {
        const gd = window.gunterData;
        const cachedAnalyses = safeParse(localStorage.getItem('gunter_generated_analyses')) || {};
        // Fase A.A2: usar helper si está disponible para obtener transcript COMPLETO desde IDB
        let fullTranscript = '';
        if (window.GunterTranscriptStore?.load) {
            try { fullTranscript = (await window.GunterTranscriptStore.load() || '').trim(); }
            catch { fullTranscript = (localStorage.getItem('gunter_full_transcript') || '').trim(); }
        } else {
            fullTranscript = (localStorage.getItem('gunter_full_transcript') || '').trim();
        }

        const tasksAll      = window.GunterTasksService?.list ? await window.GunterTasksService.list().catch(() => []) : [];
        const eventsAll     = window.GunterEventsService?.list ? await window.GunterEventsService.list().catch(() => []) : [];
        const documentsAll  = window.GunterDocumentService?.list ? await window.GunterDocumentService.list().catch(() => []) : [];
        const remindersAll  = window.GunterNotificationsService?.list ? await window.GunterNotificationsService.list({ status: 'scheduled' }).catch(() => []) : [];

        // Index global tasks/events/documents by projectId
        const tasksByProject     = new Map();
        const eventsByProject    = new Map();
        const documentsByProject = new Map();
        const globalTasks = [], globalEvents = [], globalDocuments = [];

        for (const t of tasksAll) {
            const pid = projectIdOf(t);
            const compact = compactTask(t);
            if (pid) {
                if (!tasksByProject.has(pid)) tasksByProject.set(pid, []);
                tasksByProject.get(pid).push(compact);
            } else {
                globalTasks.push(compact);
            }
        }
        for (const e of eventsAll) {
            const pid = projectIdOf(e);
            const compact = compactEvent(e);
            if (pid) {
                if (!eventsByProject.has(pid)) eventsByProject.set(pid, []);
                eventsByProject.get(pid).push(compact);
            } else {
                globalEvents.push(compact);
            }
        }
        for (const d of documentsAll) {
            const pid = d.projectId || null;
            const compact = compactDocument(d);
            if (pid) {
                if (!documentsByProject.has(pid)) documentsByProject.set(pid, []);
                documentsByProject.get(pid).push(compact);
            } else {
                globalDocuments.push(compact);
            }
        }

        const projects = (gd?.getAllProjects?.() || [])
            .filter(p => !p.deletedAt)
            .map(p => buildProjectSlice(p, {
                cachedAnalyses,
                fullTranscript,
                tasks: tasksByProject.get(p.id) || [],
                events: eventsByProject.get(p.id) || [],
                documents: documentsByProject.get(p.id) || []
            }));

        const recentDecisions = collectRecentDecisions(projects);

        const snapshot = {
            version: SNAPSHOT_VERSION,
            syncedAt: new Date().toISOString(),
            source: 'browser',
            userId: localStorage.getItem('gunter_username') || 'local-user',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bogota',
            projects,
            globalTasks: globalTasks.slice(0, 200),
            globalEvents: globalEvents.slice(0, 200),
            globalDocuments: globalDocuments.slice(0, 200),
            globalReminders: remindersAll.slice(0, 100).map(compactReminder),
            recentDecisions: recentDecisions.slice(0, 30),
            metadata: {
                projectCount: projects.length,
                taskCount: tasksAll.length,
                meetingCount: projects.reduce((s, p) => s + (p.meetings?.length || 0), 0),
                documentCount: documentsAll.length,
                analysisCount: projects.reduce((s, p) => s + (p.analyses?.length || 0), 0)
            }
        };
        return snapshot;
    }

    function buildProjectSlice(p, ctx) {
        const meetings = (p.analyses || []).map(a => ({
            id: a.id || ('a_' + (a.timestamp || Date.now())),
            timestamp: a.timestamp,
            duration: a.duration || 0,
            transcriptionExcerpt: (a.transcription || '').slice(0, MAX_TRANSCRIPT_CHARS),
            transcriptionLength: (a.transcription || '').length,
            viability: a.viabilityStatus || a.analysis?.viability?.status || null
        }));

        const projectAnalyses = [];
        for (const [key, val] of Object.entries(ctx.cachedAnalyses)) {
            const [pid] = key.split('::');
            if (pid !== p.id) continue;
            projectAnalyses.push({
                key,
                analysisType: val.definition?.id || key.split('::')[1] || 'unknown',
                title: val.definition?.title || 'Análisis',
                methodology: val.definition?.methodology || null,
                generatedAt: val.generatedAt || null,
                payloadSummary: summarizeAnalysisPayload(val.payload)
            });
        }

        const summary = shortSummaryFromAnalyses(meetings.length ? p.analyses : []);
        const lastActivityAt = computeLastActivityAt(p, meetings, projectAnalyses, ctx.tasks, ctx.events);

        return {
            id: p.id,
            name: p.name || 'Sin nombre',
            nameNormalized: lower(p.name),
            market: p.market || '',
            environment: p.environment || 'empresarial',
            createdAt: p.createdAt,
            updatedAt: p.updatedAt,
            status: p.status || 'in_progress',
            summary,
            keywords: deriveKeywords(p.name, p.market, summary, meetings.map(m => m.transcriptionExcerpt).join(' ')),
            meetings,
            analyses: projectAnalyses,
            tasks: ctx.tasks,
            events: ctx.events,
            documents: ctx.documents,
            decisions: extractDecisionsFromAnalyses(projectAnalyses).slice(0, 10),
            lastActivityAt
        };
    }

    function computeLastActivityAt(p, meetings, analyses, tasks, events) {
        const candidates = [
            p.updatedAt, p.createdAt,
            ...meetings.map(m => m.timestamp),
            ...analyses.map(a => a.generatedAt),
            ...tasks.map(t => t.updatedAt || t.createdAt || t.dueAt),
            ...events.map(e => e.updatedAt || e.createdAt || e.startAt)
        ].filter(Boolean);
        if (!candidates.length) return p.updatedAt || p.createdAt || null;
        return candidates.sort().reverse()[0];
    }

    function extractDecisionsFromAnalyses(analyses) {
        const out = [];
        for (const a of analyses) {
            const s = a.payloadSummary || '';
            // Heurística simple: oraciones que contengan "decidi", "acordamos", "se decidió"
            const sents = s.split(/[.!?\n]+/);
            for (const sent of sents) {
                if (/decid|acordamos|aprobado|conclui|definimos|resolvimos/i.test(sent) && sent.trim().length > 12) {
                    out.push({
                        text: sent.trim().slice(0, 220),
                        source: a.title,
                        at: a.generatedAt
                    });
                }
            }
        }
        return out;
    }

    function collectRecentDecisions(projects) {
        const all = [];
        for (const p of projects) {
            for (const d of p.decisions || []) {
                all.push({ ...d, project: p.name, projectId: p.id });
            }
        }
        return all
            .filter(d => d.at)
            .sort((a, b) => (b.at || '').localeCompare(a.at || ''));
    }

    // ---------- Compactors ----------
    function compactTask(t) {
        return {
            id: t.id, title: t.title,
            status: t.status, priority: t.priority,
            dueAt: t.dueAt, createdAt: t.createdAt, updatedAt: t.updatedAt,
            tags: Array.isArray(t.tags) ? t.tags.slice(0, 8) : [],
            source: t.source || null,
            projectId: projectIdOf(t)
        };
    }
    function compactEvent(e) {
        return {
            id: e.id, title: e.title,
            startAt: e.startAt, endAt: e.endAt,
            location: e.location || null,
            description: (e.description || '').slice(0, 200),
            attendees: Array.isArray(e.attendees) ? e.attendees.slice(0, 10) : [],
            tags: Array.isArray(e.tags) ? e.tags.slice(0, 8) : [],
            source: e.source || null,
            externalIds: e.externalIds || null,
            projectId: projectIdOf(e)
        };
    }
    function compactDocument(d) {
        return {
            id: d.id,
            tipo: d.tipo || d.kind || 'documento',
            title: d.title || d.empresa || d.filename || 'Documento',
            empresa: d.empresa || null,
            valor: d.valor || null,
            moneda: d.moneda || null,
            fechaVencimiento: d.fechaVencimiento || d.fecha_vencimiento || null,
            resumen: (d.resumen || d.summary || '').slice(0, 300),
            confidence: d.confidence || null,
            createdAt: d.createdAt || d.savedAt || null,
            taskId: d.taskId || null,
            projectId: d.projectId || null
        };
    }
    function compactReminder(r) {
        return {
            id: r.id, title: r.title,
            fireAt: r.fireAt, priority: r.priority || 'normal',
            status: r.status,
            projectId: r.meta?.projectId || null
        };
    }

    // ---------- Hash (cheap content fingerprint) ----------
    // Para evitar push innecesario: si el snapshot es idéntico al anterior
    // (excluyendo syncedAt) no se vuelve a enviar.
    function hash(snapshot) {
        const clone = { ...snapshot, syncedAt: null };
        const str = JSON.stringify(clone);
        let h = 0;
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) - h) + str.charCodeAt(i);
            h |= 0;
        }
        return 'h' + (h >>> 0).toString(36);
    }

    function diffSummary(prev, next) {
        if (!prev) return 'snapshot inicial';
        const a = prev.metadata || {};
        const b = next.metadata || {};
        const parts = [];
        if (a.projectCount !== b.projectCount) parts.push(`proyectos ${a.projectCount}→${b.projectCount}`);
        if (a.taskCount !== b.taskCount) parts.push(`tareas ${a.taskCount}→${b.taskCount}`);
        if (a.meetingCount !== b.meetingCount) parts.push(`reuniones ${a.meetingCount}→${b.meetingCount}`);
        if (a.documentCount !== b.documentCount) parts.push(`documentos ${a.documentCount}→${b.documentCount}`);
        if (a.analysisCount !== b.analysisCount) parts.push(`análisis ${a.analysisCount}→${b.analysisCount}`);
        return parts.length ? parts.join(' · ') : 'sin cambios';
    }

    window.GunterProjectKnowledge = { build, hash, diffSummary, projectIdOf };
})();
