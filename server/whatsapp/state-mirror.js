/* =============================================
   Server mirror of browser tasks/events
   -------------------------------------------------
   El browser hace POST /api/state/push con su
   estado actual. El handler de WhatsApp lee aquí
   para responder preguntas como "¿qué tengo hoy?"
   con datos reales.
   ============================================= */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'whatsapp-data');
const FILE = path.join(DIR, 'state-mirror.json');

const EMPTY = { tasks: [], events: [], reminders: [], updatedAt: null };

function ensure() {
    if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
}

function get() {
    try {
        ensure();
        if (!fs.existsSync(FILE)) return { ...EMPTY };
        return JSON.parse(fs.readFileSync(FILE, 'utf8')) || { ...EMPTY };
    } catch { return { ...EMPTY }; }
}

function set(state) {
    ensure();
    const next = {
        tasks: Array.isArray(state.tasks) ? state.tasks.slice(0, 200) : [],
        events: Array.isArray(state.events) ? state.events.slice(0, 200) : [],
        reminders: Array.isArray(state.reminders) ? state.reminders.slice(0, 100) : [],
        updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(FILE, JSON.stringify(next, null, 2), 'utf8');
    return next;
}

/** Tareas de hoy no terminadas */
function todayTasks() {
    const s = get();
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    return (s.tasks || []).filter(t => {
        if (t.status === 'done' || t.status === 'cancelled') return false;
        if (!t.dueAt) return t.status === 'pending';
        const d = new Date(t.dueAt);
        return d >= start && d <= end;
    });
}
function overdueTasks() {
    const s = get();
    const now = new Date().toISOString();
    return (s.tasks || []).filter(t => t.status === 'pending' && t.dueAt && t.dueAt < now);
}
function todayEvents() {
    const s = get();
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    const end = new Date(now); end.setHours(23, 59, 59, 999);
    return (s.events || []).filter(e => {
        if (!e.startAt) return false;
        const d = new Date(e.startAt);
        return d >= start && d <= end;
    });
}
function upcomingEvents(days = 7) {
    const s = get();
    const now = new Date();
    const limit = new Date(now); limit.setDate(now.getDate() + days);
    return (s.events || []).filter(e => {
        if (!e.startAt) return false;
        const d = new Date(e.startAt);
        return d >= now && d <= limit;
    });
}

function findByFuzzyTitle(query) {
    const s = get();
    const q = String(query || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!q) return { tasks: [], events: [] };
    const match = t => {
        const n = (t.title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return n.includes(q) || q.includes(n.split(' ')[0] || '');
    };
    return {
        tasks: (s.tasks || []).filter(match),
        events: (s.events || []).filter(match)
    };
}

/** Resumen compacto para incluir como contexto al LLM */
function contextSummary() {
    const today = todayTasks();
    const ov = overdueTasks();
    const evs = todayEvents();
    const ups = upcomingEvents(7);
    const fmt = iso => {
        try { return new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
        catch { return iso; }
    };
    const lines = [];
    lines.push(`TAREAS HOY (${today.length}):`);
    today.slice(0, 10).forEach(t => lines.push(`- [${t.id || ''}] ${t.title}${t.dueAt ? ' @ ' + fmt(t.dueAt) : ''}${t.priority === 'urgent' ? ' [URGENTE]' : ''}`));
    if (ov.length) {
        lines.push(`\nVENCIDAS (${ov.length}):`);
        ov.slice(0, 10).forEach(t => lines.push(`- [${t.id || ''}] ${t.title} · venció ${fmt(t.dueAt)}`));
    }
    lines.push(`\nEVENTOS HOY (${evs.length}):`);
    evs.slice(0, 10).forEach(e => lines.push(`- [${e.id || ''}] ${e.title} @ ${fmt(e.startAt)}`));
    if (ups.length) {
        lines.push(`\nPRÓXIMOS 7 DÍAS (${ups.length}):`);
        ups.slice(0, 10).forEach(e => lines.push(`- [${e.id || ''}] ${e.title} @ ${fmt(e.startAt)}`));
    }
    return lines.join('\n');
}

module.exports = {
    get, set,
    todayTasks, overdueTasks, todayEvents, upcomingEvents,
    findByFuzzyTitle, contextSummary
};
