/* =============================================
   WhatsApp Handler v3 — Gunter conversacional
   -------------------------------------------------
   - Siempre habla en lenguaje natural con la
     personalidad seleccionada (voiceStyle).
   - Memoria por contacto (historia + facts).
   - Wake word obligatorio al iniciar, luego
     sesión activa 8 min.
   - Acciones: crear tarea, crear evento, crear
     recordatorio, listar, modificar, completar,
     cancelar, responder preguntas con contexto.
   - Audio → Whisper → procesado.
   - Imagen → Gemini Vision → procesada.
   ============================================= */

const store = require('./message-log');
const memory = require('./memory');
const personality = require('./personality');
const mirror = require('./state-mirror');
const openai = require('../openai-client');
const gemini = require('../gemini-client');

let knowledge = null;
try { knowledge = require('../knowledge'); }
catch (e) { console.warn('[wa-handler] knowledge module not available:', e.message); }

let premiumIntel = null;
try { premiumIntel = require('../premium-intel'); }
catch (e) { console.warn('[wa-handler] premium-intel module not available:', e.message); }

// Mapa: detector regex de intent premium → action premium-intel + extractor de params.
// Va ANTES del LLM. Si matchea, ejecutamos directamente el premium-intel y respondemos.
const PREMIUM_INTENTS = [
    { rx: /\b(planif[ií]ca(?:me)?\s+(?:el\s+)?d[ií]a|organiza\s+(?:mi\s+)?d[ií]a|qu[eé]\s+tengo\s+hoy|brief\s+(?:de\s+)?hoy|plan\s+(?:de\s+)?hoy|qu[eé]\s+es\s+lo\s+m[aá]s\s+importante\s+hoy)\b/i,
      action: 'daily_plan',
      params: () => ({}) },
    { rx: /\b(organ[ií]za(?:me)?\s+(?:la\s+)?semana|planea\s+(?:mi\s+)?semana|plan\s+semanal|qu[eé]\s+tengo\s+(?:esta\s+)?semana)\b/i,
      action: 'weekly_plan',
      params: () => ({}) },
    { rx: /\b(qu[eé]\s+proyectos?\s+(?:est[aá]n?\s+(?:quietos?|inactivos?|en\s+riesgo)|necesitan?\s+seguimiento)|proyectos?\s+atrasados?)\b/i,
      action: 'project_followups',
      params: () => ({}) },
    { rx: /\b(qu[eé]\s+es\s+lo\s+m[aá]s\s+urgente|qu[eé]\s+debo\s+hacer\s+primero|ordena\s+(?:mis\s+)?pendientes|qu[eé]\s+est[aá]\s+atrasado)\b/i,
      action: 'urgency_ranking',
      params: () => ({ scope: /semana|esta\s+semana/i.test(arguments[0] || '') ? 'week' : 'today' }) },
    { rx: /\b(alertas?\s+(?:inteligente|de\s+whatsapp|por\s+whatsapp))\b/i,
      action: 'wa_alerts',
      params: () => ({}) }
];

// Helper: dado el texto del usuario, intenta resolver un projectId si menciona un nombre.
function tryResolveProjectFromText(text, contactId) {
    if (!knowledge) return null;
    try {
        const r = knowledge.resolveProject(text, { contactId });
        return r.exact ? r.exact.id : null;
    } catch { return null; }
}

// Detecta delegación, project_summary y project_360 (necesitan extraer entidades).
function detectComplexPremiumIntent(text, contactId) {
    if (!premiumIntel || !text) return null;

    // Project summary: "resume X", "como va X", "estado de X"
    const sumMatch = text.match(/\b(?:resume(?:me)?(?:\s+el)?\s+proyecto\s+|res[uú]men\s+(?:de|del)\s+|c[oó]mo\s+va\s+(?:el\s+proyecto\s+)?|d[ai]me\s+(?:el\s+)?estado\s+(?:de|del)\s+)([^.?!]+)/i);
    if (sumMatch) {
        const projectId = tryResolveProjectFromText(sumMatch[1], contactId);
        if (projectId) return { action: 'project_executive_summary', params: { projectId } };
    }

    // Project 360: "abre X 360", "vista completa de X", "X 360"
    const m360 = text.match(/\b(?:abre\s+|vista\s+(?:completa|general)\s+(?:de|del)\s+|d[ai]me\s+vista\s+completa\s+(?:de|del)\s+)?([^.?!]+?)\s*(?:360|trescientos\s+sesenta)\b/i)
            || text.match(/\b360\s+(?:de|del)\s+([^.?!]+)/i);
    if (m360) {
        const projectId = tryResolveProjectFromText(m360[1], contactId);
        if (projectId) return { action: 'project_360', params: { projectId } };
    }

    // Decisión: "qué decisiones se tomaron sobre X", "qué se decidió sobre X"
    const decMatch = text.match(/\b(?:qu[eé]\s+decisiones?\s+(?:se\s+)?(?:tomamos|tomaron|hay)\s+(?:sobre\s+|en\s+)?|qu[eé]\s+se\s+decid[ií][oó]\s+sobre\s+|busca\s+(?:la\s+)?decisi[oó]n\s+(?:sobre|de)\s+)([^.?!]+)/i);
    if (decMatch) {
        const projectId = tryResolveProjectFromText(decMatch[1], contactId);
        return { action: 'decisions_list', params: projectId ? { projectId } : { q: decMatch[1].trim().slice(0, 80) } };
    }

    // Delegación: "redacta mensaje para X", "delega a X que ..."
    const delMatch = text.match(/\b(?:delega(?:r)?\s+a\s+([A-ZÁÉÍÓÚ][\wáéíóúñ]+)\s+(.+)|redact(?:a|ar)\s+mensaje\s+para\s+([A-ZÁÉÍÓÚ][\wáéíóúñ]+)\s+(?:pidi[eé]ndole\s+|para\s+que\s+)(.+))/i);
    if (delMatch) {
        const recipient = delMatch[1] || delMatch[3];
        const instruction = delMatch[2] || delMatch[4];
        return { action: 'delegation_draft', params: { recipient, instruction, tone: 'whatsapp_short' } };
    }

    return null;
}

// Detector principal: corre regex simples + complejos. Retorna { action, params } o null.
function detectPremiumIntent(text, contactId) {
    if (!premiumIntel || !text) return null;
    for (const r of PREMIUM_INTENTS) {
        if (r.rx.test(text)) return { action: r.action, params: r.params(text) || {} };
    }
    return detectComplexPremiumIntent(text, contactId);
}

const SESSION_TTL_MS = 8 * 60 * 1000;
const sessions = new Map();

const WAKE_RX = /\b(hi|hey|hola|oye|ok|okey)\s+gunter\b|\bgunt[ae]r\b|\bgonter\b/i;

function isAwake(phone) {
    const last = sessions.get(phone);
    return last && (Date.now() - last) < SESSION_TTL_MS;
}
function wake(phone) { sessions.set(phone, Date.now()); }

// ---------- Time parsing (lightweight es) ----------
function parseDue(text) {
    if (!text) return null;
    const t = String(text).toLowerCase().trim();
    const now = new Date();
    if (/mañana|manana|tomorrow/.test(t)) {
        const d = new Date(now); d.setDate(d.getDate() + 1);
        const h = extractHour(t) || { hour: 9, minute: 0 };
        d.setHours(h.hour, h.minute, 0, 0);
        return d.toISOString();
    }
    if (/pasado\s+mañana|pasado\s+manana/.test(t)) {
        const d = new Date(now); d.setDate(d.getDate() + 2);
        const h = extractHour(t) || { hour: 9, minute: 0 };
        d.setHours(h.hour, h.minute, 0, 0);
        return d.toISOString();
    }
    if (/\bhoy\b/.test(t)) {
        const d = new Date(now);
        const h = extractHour(t) || { hour: 18, minute: 0 };
        d.setHours(h.hour, h.minute, 0, 0);
        return d.toISOString();
    }
    const days = { domingo: 0, lunes: 1, martes: 2, miércoles: 3, miercoles: 3, jueves: 4, viernes: 5, sábado: 6, sabado: 6 };
    for (const [n, num] of Object.entries(days)) {
        if (new RegExp(`\\b${n}\\b`).test(t)) {
            const d = new Date(now);
            let diff = (num - d.getDay() + 7) % 7; if (diff === 0) diff = 7;
            d.setDate(d.getDate() + diff);
            const h = extractHour(t) || { hour: 9, minute: 0 };
            d.setHours(h.hour, h.minute, 0, 0);
            return d.toISOString();
        }
    }
    const rel = t.match(/en\s+(\d+)\s+(minutos?|horas?|d[ií]as?|semanas?)/);
    if (rel) {
        const n = parseInt(rel[1], 10);
        const d = new Date(now);
        if (/minuto/.test(rel[2])) d.setMinutes(d.getMinutes() + n);
        else if (/hora/.test(rel[2])) d.setHours(d.getHours() + n);
        else if (/semana/.test(rel[2])) d.setDate(d.getDate() + n * 7);
        else d.setDate(d.getDate() + n);
        return d.toISOString();
    }
    const dmy = t.match(/(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?/);
    if (dmy) {
        const d = new Date(now);
        d.setDate(parseInt(dmy[1], 10));
        d.setMonth(parseInt(dmy[2], 10) - 1);
        if (dmy[3]) d.setFullYear(parseInt(dmy[3], 10) < 100 ? 2000 + parseInt(dmy[3], 10) : parseInt(dmy[3], 10));
        const h = extractHour(t) || { hour: 9, minute: 0 };
        d.setHours(h.hour, h.minute, 0, 0);
        return d.toISOString();
    }
    return null;
}
function extractHour(t) {
    const m = String(t).match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
    if (!m) return null;
    let hour = parseInt(m[1], 10);
    const minute = m[2] ? parseInt(m[2], 10) : 0;
    const ampm = (m[3] || '').toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    if (hour < 0 || hour > 23) return null;
    return { hour, minute };
}

// ---------- Main NL planner ----------
async function planActions(userText, phone) {
    if (!openai.hasKey()) {
        return { reply: 'No tengo acceso al modelo ahora mismo. Configura OPENAI_API_KEY.', actions: [] };
    }

    const history = memory.historyForPrompt(phone, 10);
    const facts = memory.factsSummary(phone);
    const pState = personality.get();
    const preamble = personality.systemPreamble();
    const stateCtx = mirror.contextSummary();

    // === Knowledge layer (Fase 11) ===========================
    // 1) Contexto global de proyectos (siempre incluido si hay snapshot).
    // 2) Resolución del proyecto mencionado en este mensaje.
    // 3) Si encontramos "exact match", inyectamos su bundle al prompt.
    // 4) Si solo hay candidatos ambiguos, pedimos al LLM que pida aclaración.
    let knowledgeBlock = '';
    let resolvedProject = null;
    let candidateProjects = [];
    if (knowledge) {
        try {
            const stats = knowledge.stats();
            if (stats.hasSnapshot) {
                knowledgeBlock += `\n\nMEMORIA DE PROYECTOS (sync ${stats.lastSyncedAt}):\n` + knowledge.globalContextSummary({ maxProjects: 8 });

                const r = knowledge.resolveProject(userText, { contactId: phone });
                if (r.exact) {
                    resolvedProject = r.exact;
                    knowledge.touchAlias(phone, r.exact.id);
                    const bundle = knowledge.projectContextBundle(r.exact.id, { maxBytes: 4000 });
                    if (bundle) {
                        knowledgeBlock += `\n\nPROYECTO MENCIONADO (resuelto automáticamente):\n${bundle}`;
                    }
                } else if (r.candidates.length >= 2) {
                    candidateProjects = r.candidates.slice(0, 4).map(c => ({ id: c.project.id, name: c.project.name, score: c.score }));
                    knowledgeBlock += `\n\nPROYECTOS CANDIDATOS (ambiguo — pide aclaración si la query menciona "proyecto"):\n` + candidateProjects.map(c => `- ${c.name}`).join('\n');
                } else if (r.candidates.length === 1) {
                    // Un único candidato pero con score bajo: lo damos como hint
                    candidateProjects = [{ id: r.candidates[0].project.id, name: r.candidates[0].project.name, score: r.candidates[0].score }];
                }
            } else {
                knowledgeBlock += `\n\nMEMORIA DE PROYECTOS: (vacía — el usuario aún no ha sincronizado desde Gunter Web)`;
            }
        } catch (e) {
            console.warn('[wa-handler] knowledge enrich failed:', e.message);
        }
    }
    // =========================================================

    const systemPrompt = `${preamble}

CONTEXTO DEL USUARIO (${phone}):
${facts || '(sin hechos memorizados todavía)'}

ESTADO ACTUAL DE GUNTER (tareas/eventos reales que ya tiene en la app):
${stateCtx}
${knowledgeBlock}

HORA ACTUAL: ${new Date().toISOString()} (timezone ${pState.timezone || 'America/Bogota'})

TU TAREA:
1. Mantén la conversación de forma natural con la personalidad definida.
2. Detecta la intención del usuario y extrae las acciones concretas (si las hay).
3. Produce SIEMPRE una "reply" en lenguaje natural con tu personalidad.
4. Si es necesario crear/modificar/completar/cancelar tareas o eventos, agrégalos al array "actions".
5. Si el usuario hace una PREGUNTA sobre proyectos, responde usando SOLO la memoria de proyectos. NO inventes datos.
6. Si la memoria de proyectos está vacía, di que aún no se ha sincronizado.
7. Si hay PROYECTOS CANDIDATOS y la query es ambigua, pide aclaración listando los nombres.
8. Recuerda cosas sobre el usuario en "learn_facts".

ESQUEMA DE RESPUESTA (JSON estricto, sin texto fuera):
{
  "reply": "respuesta natural con tu personalidad, ≤120 palabras, sin JSON dentro",
  "actions": [
    { "type": "create_task",    "title": "string", "when": "mañana 10am|null", "priority": "normal|high|urgent", "tags": [], "project_match": "nombre del proyecto si lo mencionó, o null" },
    { "type": "create_event",   "title": "string", "when": "viernes 3pm",      "people": [], "project_match": "nombre del proyecto si lo mencionó, o null" },
    { "type": "create_reminder","title": "string", "when": "hoy 5pm",          "project_match": "opcional" },
    { "type": "complete_task",  "title_match": "texto parcial" },
    { "type": "cancel_event",   "title_match": "texto parcial" },
    { "type": "modify_task",    "title_match": "parcial", "new_when": "mañana 2pm", "new_priority": "urgent" },
    { "type": "add_project_note","project_match": "nombre", "note": "texto a recordar" },
    { "type": "summarize_project","project_match": "nombre" }
  ],
  "learn_facts": { "clave": "valor" },
  "user_name_detected": "string o null"
}

REGLAS:
- Si el usuario solo saluda o charla, "actions" = [] pero "reply" responde naturalmente.
- Si pregunta "¿qué tengo hoy?", usa el contexto de tareas/eventos para contestar.
- Si pregunta "¿qué proyectos tengo?", lista los proyectos de la memoria (no inventes).
- Si pregunta "¿qué sabes de SERVIMIL?", usa el bundle de PROYECTO MENCIONADO si existe.
- Si pregunta sobre algo que el bundle no contiene, di "no tengo esa información todavía".
- "project_match" en acciones: usa el NOMBRE EXACTO del proyecto mencionado por el usuario (ej "SERVIMIL", "Belocy"). El servidor lo resuelve.
- "when" puede ser expresiones en español naturales; el servidor las parsea.
- NUNCA mezcles JSON con el reply. El reply es texto puro.
- Mantén la personalidad SIEMPRE.`;

    const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userText }
    ];

    try {
        const raw = await openai.chatComplete({
            messages,
            temperature: 0.6,
            maxTokens: 600,
            jsonMode: true
        });
        let parsed;
        try { parsed = JSON.parse(raw); }
        catch {
            const m = raw.match(/\{[\s\S]*\}/);
            parsed = m ? JSON.parse(m[0]) : null;
        }
        if (!parsed) throw new Error('LLM no devolvió JSON válido');
        return {
            reply: String(parsed.reply || 'Listo.'),
            actions: Array.isArray(parsed.actions) ? parsed.actions : [],
            learnFacts: parsed.learn_facts || {},
            userName: parsed.user_name_detected || null
        };
    } catch (e) {
        console.error('[wa-handler] LLM error:', e.message);
        return {
            reply: 'Tuve un problema procesando tu mensaje. Vuelve a intentarlo.',
            actions: []
        };
    }
}

// Resuelve "project_match" usando knowledge.resolveProject + aliases del contacto.
// Devuelve { project, ambiguous, candidates }.
function resolveProjectFor(matchText, phone) {
    if (!knowledge || !matchText) return { project: null, ambiguous: false, candidates: [] };
    try {
        const r = knowledge.resolveProject(matchText, { contactId: phone });
        if (r.exact) return { project: r.exact, ambiguous: false, candidates: [] };
        if (r.candidates.length >= 2) {
            return { project: null, ambiguous: true, candidates: r.candidates.map(c => c.project) };
        }
        if (r.candidates.length === 1) return { project: r.candidates[0].project, ambiguous: false, candidates: [] };
    } catch (e) { console.warn('[wa-handler] resolveProjectFor failed:', e.message); }
    return { project: null, ambiguous: false, candidates: [] };
}

// Construye descripción enriquecida para Calendar/event con contexto del proyecto.
function buildEventDescription(project, baseNote = '') {
    const parts = ['Creado por Gunter desde WhatsApp.'];
    if (project) {
        parts.push(`Proyecto: ${project.name}.`);
        if (project.summary) parts.push(`Contexto: ${project.summary.slice(0, 200)}`);
    }
    if (baseNote) parts.push(baseNote);
    return parts.join('\n');
}

// ---------- Execute actions ----------
function executeActions(actions, phone) {
    const executed = [];
    for (const a of actions || []) {
        try {
            switch (a.type) {
                case 'create_task': {
                    const dueAt = a.when ? parseDue(a.when) : null;
                    const { project, ambiguous, candidates } = resolveProjectFor(a.project_match || '', phone);
                    if (ambiguous) {
                        executed.push({ type: 'task_ambiguous', title: a.title, candidates: candidates.map(p => p.name) });
                        break;
                    }
                    const tags = [...(a.tags || []), 'whatsapp'];
                    if (project) {
                        tags.push(`project:${project.id}`);
                        knowledge?.touchAlias?.(phone, project.id);
                    }
                    store.enqueueSync({
                        kind: 'task', source: 'whatsapp', from: phone,
                        payload: {
                            title: a.title,
                            dueAt,
                            priority: a.priority || 'normal',
                            tags,
                            projectId: project?.id || null,
                            projectName: project?.name || null,
                            notes: project ? `Proyecto: ${project.name}` : 'Desde WhatsApp'
                        }
                    });
                    executed.push({ type: 'task', title: a.title, dueAt, projectName: project?.name || null });
                    break;
                }
                case 'create_event': {
                    const startAt = a.when ? parseDue(a.when) : null;
                    if (!startAt) break;
                    const endAt = new Date(new Date(startAt).getTime() + 3600_000).toISOString();
                    const { project, ambiguous, candidates } = resolveProjectFor(a.project_match || '', phone);
                    if (ambiguous) {
                        executed.push({ type: 'event_ambiguous', title: a.title, candidates: candidates.map(p => p.name) });
                        break;
                    }
                    const tags = ['whatsapp'];
                    if (project) {
                        tags.push(`project:${project.id}`);
                        knowledge?.touchAlias?.(phone, project.id);
                    }
                    store.enqueueSync({
                        kind: 'event', source: 'whatsapp', from: phone,
                        payload: {
                            title: a.title,
                            startAt, endAt,
                            attendees: a.people || [],
                            tags,
                            projectId: project?.id || null,
                            projectName: project?.name || null,
                            description: buildEventDescription(project)
                        }
                    });
                    executed.push({ type: 'event', title: a.title, startAt, projectName: project?.name || null });
                    break;
                }
                case 'create_reminder': {
                    const fireAt = a.when ? parseDue(a.when) : null;
                    if (!fireAt) break;
                    const { project } = resolveProjectFor(a.project_match || '', phone);
                    const tags = ['reminder', 'whatsapp'];
                    if (project) tags.push(`project:${project.id}`);
                    store.enqueueSync({
                        kind: 'task', source: 'whatsapp', from: phone,
                        payload: {
                            title: a.title,
                            dueAt: fireAt,
                            priority: 'high',
                            tags,
                            projectId: project?.id || null,
                            projectName: project?.name || null,
                            notes: 'Recordatorio'
                        }
                    });
                    executed.push({ type: 'reminder', title: a.title, fireAt, projectName: project?.name || null });
                    break;
                }
                case 'add_project_note': {
                    const { project, ambiguous, candidates } = resolveProjectFor(a.project_match || '', phone);
                    if (ambiguous) {
                        executed.push({ type: 'note_ambiguous', candidates: candidates.map(p => p.name) });
                        break;
                    }
                    if (!project) {
                        executed.push({ type: 'note_no_project' });
                        break;
                    }
                    knowledge?.touchAlias?.(phone, project.id);
                    // La nota va al sync-queue como kind:'project_note' para que el browser la persista en el proyecto
                    store.enqueueSync({
                        kind: 'project_note', source: 'whatsapp', from: phone,
                        payload: { projectId: project.id, projectName: project.name, note: String(a.note || '').slice(0, 500), at: new Date().toISOString() }
                    });
                    executed.push({ type: 'project_note', projectName: project.name });
                    break;
                }
                case 'summarize_project': {
                    // El resumen se calcula on-demand por el LLM; aquí solo registramos intención.
                    const { project, ambiguous, candidates } = resolveProjectFor(a.project_match || '', phone);
                    if (ambiguous) {
                        executed.push({ type: 'summary_ambiguous', candidates: candidates.map(p => p.name) });
                    } else if (project) {
                        knowledge?.touchAlias?.(phone, project.id);
                        executed.push({ type: 'summary_resolved', projectName: project.name });
                    }
                    break;
                }
                case 'complete_task': {
                    // El server no tiene acceso directo al IndexedDB, pero sí al mirror.
                    // Busca por fuzzy match y deja una acción "pending_complete" para que el browser la procese al abrir.
                    const { tasks } = mirror.findByFuzzyTitle(a.title_match || '');
                    const tid = tasks[0]?.id;
                    if (tid) {
                        store.enqueueSync({
                            kind: 'task_op', source: 'whatsapp', from: phone,
                            payload: { op: 'complete', taskId: tid, titleMatched: tasks[0].title }
                        });
                        executed.push({ type: 'complete_task', title: tasks[0].title });
                    }
                    break;
                }
                case 'cancel_event': {
                    const { events } = mirror.findByFuzzyTitle(a.title_match || '');
                    const ev = events[0];
                    if (ev) {
                        store.enqueueSync({
                            kind: 'event_op', source: 'whatsapp', from: phone,
                            payload: { op: 'cancel', eventId: ev.id, titleMatched: ev.title }
                        });
                        executed.push({ type: 'cancel_event', title: ev.title });
                    }
                    break;
                }
                case 'modify_task': {
                    const { tasks } = mirror.findByFuzzyTitle(a.title_match || '');
                    const t = tasks[0];
                    if (t) {
                        store.enqueueSync({
                            kind: 'task_op', source: 'whatsapp', from: phone,
                            payload: {
                                op: 'modify', taskId: t.id,
                                titleMatched: t.title,
                                patch: {
                                    ...(a.new_when ? { dueAt: parseDue(a.new_when) } : {}),
                                    ...(a.new_priority ? { priority: a.new_priority } : {})
                                }
                            }
                        });
                        executed.push({ type: 'modify_task', title: t.title });
                    }
                    break;
                }
            }
        } catch (e) {
            console.error('[wa-handler] action error:', e);
        }
    }
    return executed;
}

// ---------- Main handle ----------
async function handle(text, ctx = {}) {
    const { from } = ctx;
    const trimmed = (text || '').trim();
    if (!trimmed) return { reply: '', ignored: true };

    // Wake word gate
    const hasWake = WAKE_RX.test(trimmed);
    const awake = isAwake(from);
    if (!hasWake && !awake) return { reply: '', ignored: true };
    if (hasWake) wake(from);

    // Persistir turno del usuario
    memory.appendTurn(from, 'user', trimmed);

    // Strip wake si es saludo pelado
    const clean = hasWake ? trimmed.replace(WAKE_RX, '').trim() : trimmed;

    if (!clean) {
        const pState = personality.get();
        const greeting = greetingByStyle(pState.voiceStyle, memory.getFullContact(from)?.name);
        memory.appendTurn(from, 'assistant', greeting);
        wake(from);
        return { reply: greeting };
    }

    // === Premium intent shortcut (Sprint B) ============================
    // Si la query matchea un intent premium claro, ejecutamos directamente
    // el módulo y respondemos con su naturalResponse. Saltamos LLM/planActions
    // → más rápido, más barato, más predecible.
    const premiumIntent = detectPremiumIntent(clean, from);
    if (premiumIntent && premiumIntel) {
        try {
            const result = await premiumIntel.dispatch(premiumIntent.action, premiumIntent.params);
            const reply = result.naturalResponse || result.summary || 'Listo.';
            memory.appendTurn(from, 'assistant', reply, { premiumAction: premiumIntent.action });
            wake(from);
            return { reply, meta: { premiumAction: premiumIntent.action, success: result.success } };
        } catch (e) {
            console.warn('[wa-handler] premium intent failed:', e.message);
            // Cae al flujo normal LLM si premium falla
        }
    }
    // ===================================================================

    // NLU + plan
    const plan = await planActions(clean, from);

    // Ejecutar acciones sincronizables
    const executed = executeActions(plan.actions || [], from);

    // Aprender facts
    if (plan.learnFacts) {
        for (const [k, v] of Object.entries(plan.learnFacts)) {
            if (v) memory.setFact(from, k, v);
        }
    }
    if (plan.userName) memory.setName(from, plan.userName);

    // Persistir respuesta
    memory.appendTurn(from, 'assistant', plan.reply, { actions: executed.length });
    wake(from);

    return { reply: plan.reply };
}

function greetingByStyle(style, name) {
    const n = name ? ` ${name}` : '';
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    const G = {
        professional: [
            `Hola${n}. ¿En qué te ayudo?`,
            `Qué tal${n}. ¿Qué necesitas?`,
            `Aquí estoy${n}. Dime.`
        ],
        warm: [
            `Hola${n}, qué bueno saber de ti. ¿Qué necesitas?`,
            `¡Ey${n}! Cuéntame, ¿en qué te apoyo?`,
            `Hola${n}. Aquí ando, dime.`
        ],
        chaotic_scientist: [
            `Te escucho${n}. ¿Qué drama vamos a resolver hoy?`,
            `Dime${n}, ¿qué se nos rompió esta vez?`,
            `Aquí estoy${n}. Sorpréndeme.`,
            `Listo${n}. ¿Qué crisis tenemos?`
        ],
        energetic_cartoon: [
            `¡Hola${n}! ¡Cuéntame en qué trabajamos hoy! 🚀`,
            `¡Ey${n}! ¡Aquí estoy, dale!`,
            `¡Hola${n}! ¡Vamos con todo! ¿Qué hacemos?`
        ],
        minimal_penguin: [
            `Aquí.${n ? ' Dime' + n + '.' : ''}`,
            `Sí.${n ? ' ' + n + '.' : ''}`,
            `Te escucho.`
        ],
        executive: [
            `Buen día${n}. ¿Qué necesitas?`,
            `A la orden${n}. Dime.`,
            `Hola${n}. ¿En qué te apoyo hoy?`
        ],
        focus_coach: [
            `Listo${n}. ¿Qué vamos a ejecutar?`,
            `Aquí estoy${n}. ¿Cuál es la siguiente?`,
            `Va${n}. ¿Por dónde empezamos?`
        ]
    };
    const arr = G[style] || G.professional;
    return pick(arr);
}

// ---------- Media ----------
async function handleAudioMessage(buffer, mime, ctx) {
    try {
        const transcribed = await openai.transcribeAudio(buffer, mime || 'audio/ogg');
        if (!transcribed) return { reply: 'No pude entender el audio.' };
        const result = await handle(transcribed, ctx);
        if (result.ignored) return { reply: '' };
        return { reply: `🎙 _"${transcribed.slice(0, 140)}${transcribed.length > 140 ? '…' : ''}"_\n\n${result.reply}` };
    } catch (e) {
        return { reply: '⚠️ No pude transcribir el audio.' };
    }
}

async function handleImageMessage(buffer, mime, caption, ctx) {
    try {
        const captionTrim = (caption || '').trim();
        const hasWake = WAKE_RX.test(captionTrim);
        if (!hasWake && !isAwake(ctx.from)) return { reply: '', ignored: true };
        if (hasWake) wake(ctx.from);

        const description = await gemini.describeImage(buffer, mime || 'image/jpeg', captionTrim);
        const userText = captionTrim.replace(WAKE_RX, '').trim();
        const combined = userText
            ? `${userText}\n\n[imagen: ${description}]`
            : `El usuario me envió una imagen. Descripción: ${description}`;
        const result = await handle(combined, ctx);
        return { reply: `📷 _${description.slice(0, 130)}${description.length > 130 ? '…' : ''}_\n\n${result.reply}` };
    } catch (e) {
        return { reply: '⚠️ No pude analizar la imagen.' };
    }
}

module.exports = { handle, handleAudioMessage, handleImageMessage, WAKE_RX };
