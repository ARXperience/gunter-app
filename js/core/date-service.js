/* =============================================
   GUNTER CORE - Date Service
   -------------------------------------------------
   Helpers sin dependencias para trabajar con
   fechas/horas en ISO 8601, timezones y RRULE
   simplificado. Usado por calendar-service y
   por el pipeline.
   ============================================= */

(function () {
    function tzOf(ctx) {
        return ctx?.timezone || (Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';
    }

    function nowIso() { return new Date().toISOString(); }

    function addMinutes(iso, mins) {
        const d = new Date(iso); d.setMinutes(d.getMinutes() + mins); return d.toISOString();
    }
    function addDays(iso, days) {
        const d = new Date(iso); d.setDate(d.getDate() + days); return d.toISOString();
    }
    function addHours(iso, hours) {
        const d = new Date(iso); d.setHours(d.getHours() + hours); return d.toISOString();
    }

    function startOfDay(iso) {
        const d = new Date(iso); d.setHours(0, 0, 0, 0); return d.toISOString();
    }
    function endOfDay(iso) {
        const d = new Date(iso); d.setHours(23, 59, 59, 999); return d.toISOString();
    }

    function isSameDay(a, b) {
        const x = new Date(a), y = new Date(b);
        return x.getFullYear() === y.getFullYear()
            && x.getMonth() === y.getMonth()
            && x.getDate() === y.getDate();
    }

    function diffDays(a, b) {
        return Math.round((new Date(a) - new Date(b)) / 86_400_000);
    }

    function humanRelative(iso, locale = 'es-MX') {
        const diff = (new Date(iso) - Date.now()) / 60000;
        const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
        if (Math.abs(diff) < 1) return 'ahora';
        if (Math.abs(diff) < 60) return rtf.format(Math.round(diff), 'minute');
        if (Math.abs(diff) < 1440) return rtf.format(Math.round(diff / 60), 'hour');
        return rtf.format(Math.round(diff / 1440), 'day');
    }

    function fmtDate(iso, tz, opts = { weekday: 'long', day: 'numeric', month: 'long' }) {
        try {
            return new Date(iso).toLocaleDateString('es-MX', { timeZone: tz, ...opts });
        } catch { return iso; }
    }
    function fmtTime(iso, tz) {
        try {
            return new Date(iso).toLocaleTimeString('es-MX', {
                timeZone: tz, hour: '2-digit', minute: '2-digit'
            });
        } catch { return iso; }
    }
    function fmtDateTime(iso, tz) {
        return `${fmtDate(iso, tz)} ${fmtTime(iso, tz)}`;
    }

    // ---------- RRULE helpers (simplificado; FREQ/BYDAY/INTERVAL) ----------
    function buildRRule({ freq = 'WEEKLY', byDay, interval, count, until }) {
        const parts = [`FREQ=${freq}`];
        if (interval) parts.push(`INTERVAL=${interval}`);
        if (byDay) parts.push(`BYDAY=${Array.isArray(byDay) ? byDay.join(',') : byDay}`);
        if (count) parts.push(`COUNT=${count}`);
        if (until) parts.push(`UNTIL=${until.replace(/[-:]/g, '').slice(0, 15) + 'Z'}`);
        return parts.join(';');
    }

    function parseRRule(rule) {
        if (!rule) return null;
        const clean = rule.replace(/^RRULE:/, '');
        const out = {};
        for (const pair of clean.split(';')) {
            const [k, v] = pair.split('=');
            if (!k) continue;
            if (k === 'BYDAY') out.byDay = v.split(',');
            else if (k === 'INTERVAL' || k === 'COUNT') out[k.toLowerCase()] = parseInt(v, 10);
            else out[k.toLowerCase()] = v;
        }
        return out;
    }

    function nextOccurrence(rrule, from = new Date()) {
        const r = parseRRule(rrule);
        if (!r || r.freq !== 'WEEKLY' || !r.byDay) return null;
        const codeToNum = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
        const target = codeToNum[r.byDay[0]];
        if (target === undefined) return null;
        const d = new Date(from);
        const diff = ((target - d.getDay()) + 7) % 7 || 7;
        d.setDate(d.getDate() + diff);
        d.setHours(r.byhour ? parseInt(r.byhour, 10) : 9, 0, 0, 0);
        return d.toISOString();
    }

    // ---------- Event duration inference ----------
    /**
     * If the user says "reunión de 1 hora" but we only have startAt,
     * pick a sensible endAt. Default 60 min.
     */
    function inferEndAt(startAt, { durationMinutes, fromText } = {}) {
        if (durationMinutes) return addMinutes(startAt, durationMinutes);
        if (fromText) {
            const m = fromText.match(/(\d+)\s*(hora|horas|h)|(\d+)\s*(minuto|minutos|min)/i);
            if (m) {
                const n = parseInt(m[1] || m[3], 10);
                const unit = m[2] || m[4];
                return addMinutes(startAt, /hora|h/.test(unit) ? n * 60 : n);
            }
        }
        return addMinutes(startAt, 60);
    }

    window.GunterDateService = {
        tzOf, nowIso,
        addMinutes, addDays, addHours,
        startOfDay, endOfDay,
        isSameDay, diffDays,
        humanRelative, fmtDate, fmtTime, fmtDateTime,
        buildRRule, parseRRule, nextOccurrence,
        inferEndAt
    };
})();
