/* =============================================
   GUNTER CORE - Temporal Context
   ---------------------------------------------
   Responde consultas de fecha/hora desde el reloj
   real y la zona IANA del dispositivo. No usa LLM.
   ============================================= */

(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.GunterTemporalContext = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    function detectTimezone() {
        try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
        catch { return 'UTC'; }
    }

    function normalize(text) {
        return String(text || '').toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[¿?¡!.,;:]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function safeTimezone(timezone) {
        const tz = timezone || detectTimezone();
        try {
            new Intl.DateTimeFormat('es', { timeZone: tz }).format(new Date());
            return tz;
        } catch { return 'UTC'; }
    }

    function snapshot(options = {}) {
        const date = options.now instanceof Date ? new Date(options.now) : new Date(options.now || Date.now());
        const timezone = safeTimezone(options.timezone);
        const locale = options.locale || 'es-CO';
        const dateText = new Intl.DateTimeFormat(locale, {
            timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
        }).format(date);
        const timeText = new Intl.DateTimeFormat(locale, {
            timeZone: timezone, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true
        }).format(date);
        const shortTime = new Intl.DateTimeFormat(locale, {
            timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true
        }).format(date);
        return {
            now: date.toISOString(),
            timezone,
            locale,
            dateText,
            timeText,
            shortTime
        };
    }

    function classify(text) {
        const t = normalize(text);
        if (!t) return null;
        if (/\b(que fecha y hora es|que hora y fecha es|fecha y hora actual|fecha y hora de hoy)\b/.test(t)) {
            return 'datetime';
        }
        const asksTime = /\b(que hora es|que horas son|dime la hora|hora actual|hora exacta|a que hora estamos)\b/.test(t);
        const asksDate = /\b(que fecha es|fecha de hoy|fecha actual|a que fecha estamos)\b/.test(t);
        const asksDay = /\b(que dia es|que dia estamos|dia de hoy|en que dia estamos)\b/.test(t);
        const asksTimezone = /\b(zona horaria|huso horario|timezone)\b/.test(t);
        if (asksTime && (asksDate || asksDay)) return 'datetime';
        if (asksTime) return 'time';
        if (asksDate || asksDay) return 'date';
        if (asksTimezone) return 'timezone';
        return null;
    }

    function answer(text, options = {}) {
        const intent = classify(text);
        if (!intent) return null;
        const current = snapshot(options);
        const spokenTime = current.timeText.replace(/\.$/, '');
        let reply;
        if (intent === 'time') reply = `Son las ${spokenTime}.`;
        else if (intent === 'date') reply = `Hoy es ${current.dateText}.`;
        else if (intent === 'timezone') reply = `Tu zona horaria actual es ${current.timezone}.`;
        else reply = `Hoy es ${current.dateText} y son las ${spokenTime}.`;
        return { intent, reply, ...current, source: 'device-clock' };
    }

    function partOfDay(options = {}) {
        const current = snapshot(options);
        const hourText = new Intl.DateTimeFormat('en-US', {
            timeZone: current.timezone, hour: '2-digit', hourCycle: 'h23'
        }).format(new Date(current.now));
        const hour = Number(hourText);
        if (hour < 12) return 'morning';
        if (hour < 19) return 'afternoon';
        return 'evening';
    }

    return { answer, classify, snapshot, partOfDay, detectTimezone, normalize };
});
