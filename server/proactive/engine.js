/* =============================================
   PROACTIVE PULSE — Trigger Engine (v2 — F3)
   -------------------------------------------------
   Evalúa el snapshot de proyectos + commitments + tasks
   y genera "intervenciones" cuando detecta condiciones
   que merecen atención del usuario.

   Triggers (todos opt-in vía severidad):
     T1. commitments_overdue              (high)
     T2. commitment_due_soon (<24h)       (mid)
     T3. project_idle_long (>14 días)     (mid)
     T4. project_no_followups             (mid)
     T5. day_too_loaded (>6 events hoy)   (low)
     T6. urgent_decision_pending          (high)
     T7. meeting_no_agenda_tomorrow       (mid)
     T8. weekly_review_overdue (sin plan) (low)
   ============================================= */

const knowledge = require('../knowledge');
let commitments = null;
try { commitments = require('../commitments'); } catch { /* opcional */ }

const HOURS = (n) => n * 3600 * 1000;
const DAYS  = (n) => n * 24 * HOURS(1);

function snapshotOrNull() {
    try { return knowledge.getSnapshot() || null; } catch { return null; }
}

function tNow() { return Date.now(); }

/**
 * @returns {Array<intervention>}
 */
async function evaluate({ aggression = 'normal', tz = 'America/Bogota' } = {}) {
    const interventions = [];
    const snap = snapshotOrNull();
    const now = tNow();

    // ===== T1, T2: commitments =====
    if (commitments?.listAll) {
        try {
            const all = commitments.listAll({});
            const overdue = all.filter(c => c.status === 'overdue');
            const dueSoon = all.filter(c => c.status === 'pending' && c.dueAt && (new Date(c.dueAt).getTime() - now) <= HOURS(24) && (new Date(c.dueAt).getTime() - now) > 0);

            if (overdue.length) {
                interventions.push({
                    type: 'commitments_overdue',
                    severity: 'high',
                    title: `${overdue.length} compromiso${overdue.length > 1 ? 's' : ''} vencido${overdue.length > 1 ? 's' : ''}`,
                    message: `Tienes ${overdue.length} promesa${overdue.length > 1 ? 's' : ''} vencida${overdue.length > 1 ? 's' : ''}: ${overdue.slice(0,3).map(c => `"${c.action}"`).join(', ')}${overdue.length > 3 ? '…' : ''}.`,
                    suggestedActions: [
                        { label: 'Ver compromisos', action: 'open_tab', payload: { tab: 'commitments' } },
                        { label: 'Marcar todos cumplidos', action: 'commitments_bulk_fulfill', payload: { ids: overdue.map(c => c.id) } }
                    ],
                    dedupeKey: `overdue:${overdue.length}:${overdue[0]?.id || ''}`
                });
            }
            for (const c of dueSoon.slice(0, 5)) {
                const hoursLeft = Math.round((new Date(c.dueAt).getTime() - now) / HOURS(1));
                interventions.push({
                    type: 'commitment_due_soon',
                    severity: hoursLeft <= 4 ? 'high' : 'mid',
                    title: `Vence en ${hoursLeft}h: ${c.action}`,
                    message: `Tu compromiso "${c.action}"${c.beneficiary && c.beneficiary !== 'unknown' ? ' con ' + c.beneficiary : ''} vence pronto. ¿Bloqueo tiempo en el calendario?`,
                    suggestedActions: [
                        { label: 'Marcar cumplido', action: 'commitment_fulfill', payload: { id: c.id } },
                        { label: 'Posponer 1 día', action: 'snooze_intervention', payload: { hours: 24 } }
                    ],
                    payload: { commitmentId: c.id },
                    dedupeKey: `due-soon:${c.id}`
                });
            }
        } catch (e) { /* silencioso */ }
    }

    // ===== T3: project idle =====
    if (snap?.projects?.length) {
        for (const p of snap.projects) {
            if (!p.lastActivityAt) continue;
            const daysIdle = (now - new Date(p.lastActivityAt).getTime()) / DAYS(1);
            if (daysIdle >= 14 && daysIdle < 60) {
                interventions.push({
                    type: 'project_idle_long',
                    severity: daysIdle >= 30 ? 'mid' : 'low',
                    title: `${p.name} inactivo ${Math.round(daysIdle)} días`,
                    message: `El proyecto "${p.name}" no tiene actividad en ${Math.round(daysIdle)} días. ¿Reenganchamos? Puedo redactar un mensaje al cliente o sacar pendientes.`,
                    suggestedActions: [
                        { label: 'Resumen del proyecto', action: 'project_summary', payload: { projectId: p.id } },
                        { label: 'Generar mensaje de seguimiento', action: 'delegation_draft', payload: { projectId: p.id, intent: 'reactivar' } }
                    ],
                    projectId: p.id,
                    dedupeKey: `idle:${p.id}:${Math.floor(daysIdle / 7)}`
                });
            }
        }
    }

    // ===== T5: day_too_loaded =====
    try {
        const todayEvents = (snap?.events || []).filter(e => isToday(e.startAt, tz));
        if (todayEvents.length >= 6) {
            interventions.push({
                type: 'day_too_loaded',
                severity: 'low',
                title: `Hoy tienes ${todayEvents.length} eventos`,
                message: `Día denso. ¿Quieres que genere un Plan de Hoy o reorganice prioridades?`,
                suggestedActions: [
                    { label: 'Plan de hoy', action: 'open_tab', payload: { tab: 'plan-day' } },
                    { label: 'Ranking de urgencia', action: 'open_tab', payload: { tab: 'urgency' } }
                ],
                dedupeKey: `day-loaded:${dateStr(tz)}`
            });
        }
    } catch { /* noop */ }

    // ===== T7: meeting tomorrow without agenda =====
    try {
        const tomorrow = (snap?.events || []).filter(e => isTomorrow(e.startAt, tz));
        for (const e of tomorrow) {
            if (e.agenda && e.agenda.length > 10) continue;
            interventions.push({
                type: 'meeting_no_agenda_tomorrow',
                severity: 'mid',
                title: `Mañana: ${e.title || 'reunión sin título'}`,
                message: `Tu reunión "${e.title}" mañana ${fmtTime(e.startAt, tz)} no tiene agenda. ¿Te preparo un brief con el contexto del proyecto?`,
                suggestedActions: [
                    { label: 'Generar brief', action: 'meeting_brief', payload: { eventId: e.id } },
                    { label: 'Posponer 1 día', action: 'snooze_intervention', payload: { hours: 22 } }
                ],
                payload: { eventId: e.id },
                dedupeKey: `no-agenda:${e.id}`
            });
        }
    } catch { /* noop */ }

    // Filtrar por nivel de agresividad: 'soft' = solo high; 'normal' = high+mid; 'high' = todos
    const minSev = aggression === 'soft' ? 'high' : (aggression === 'normal' ? 'mid' : 'low');
    const sevOrder = { high: 0, mid: 1, low: 2 };
    return interventions.filter(i => sevOrder[i.severity] <= sevOrder[minSev]);
}

function dateStr(tz) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function isToday(iso, tz) {
    if (!iso) return false;
    try {
        const a = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(iso));
        return a === dateStr(tz);
    } catch { return false; }
}

function isTomorrow(iso, tz) {
    if (!iso) return false;
    try {
        const t = new Date();
        t.setUTCDate(t.getUTCDate() + 1);
        const tomorrowStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' }).format(t);
        const a = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(iso));
        return a === tomorrowStr;
    } catch { return false; }
}

function fmtTime(iso, tz) {
    try {
        return new Intl.DateTimeFormat('es-MX', { timeZone: tz, hour:'2-digit', minute:'2-digit' }).format(new Date(iso));
    } catch { return ''; }
}

module.exports = { evaluate };
