/* =============================================
   GUNTER CORE - Time Parser (ES)
   -------------------------------------------------
   Convierte lenguaje natural temporal en español a
   fechas/horas ISO 8601. Estrategia:
     1) Regex puro (0 latencia)
     2) Reglas compuestas
     3) LLM como último recurso (nlp-llm-service)

   Mantiene timezone del usuario. Detecta ambigüedad
   y la reporta en vez de adivinar.
   ============================================= */

(function () {
    const DAYS_ES = {
        'lunes': 1, 'martes': 2, 'miércoles': 3, 'miercoles': 3,
        'jueves': 4, 'viernes': 5, 'sábado': 6, 'sabado': 6, 'domingo': 0
    };
    const MONTHS_ES = {
        'enero': 0, 'febrero': 1, 'marzo': 2, 'abril': 3, 'mayo': 4, 'junio': 5,
        'julio': 6, 'agosto': 7, 'septiembre': 8, 'setiembre': 8, 'octubre': 9,
        'noviembre': 10, 'diciembre': 11
    };
    const HOUR_WORDS = {
        una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
        siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
        trece: 13, catorce: 14, quince: 15, dieciseis: 16, dieciséis: 16,
        diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20,
        veintiuna: 21, veintiuno: 21, veintidos: 22, veintidós: 22,
        veintitres: 23, veintitrés: 23
    };

    // ---------- Core helpers ----------
    function nowInTz(tz, instant = new Date()) {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
        }).formatToParts(new Date(instant));
        const get = type => Number(parts.find(p => p.type === type)?.value || 0);
        // Date contenedor de campos de pared; no representa todavía un instante.
        return new Date(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
    }

    function toIsoWithTz(date, tz) {
        // Returns an ISO-like string preserving the local fields of `date`.
        // Not perfect for DST edge cases; acceptable for assistant use.
        const pad = n => String(n).padStart(2, '0');
        const y = date.getFullYear();
        const m = pad(date.getMonth() + 1);
        const d = pad(date.getDate());
        const h = pad(date.getHours());
        const mi = pad(date.getMinutes());
        const s = pad(date.getSeconds());
        return `${y}-${m}-${d}T${h}:${mi}:${s}${tzOffsetString(date, tz)}`;
    }

    function tzOffsetString(date, tz) {
        try {
            const wallGuess = Date.UTC(
                date.getFullYear(), date.getMonth(), date.getDate(),
                date.getHours(), date.getMinutes(), date.getSeconds()
            );
            let offsetMinutes = offsetAt(new Date(wallGuess), tz);
            const instant = new Date(wallGuess - offsetMinutes * 60_000);
            offsetMinutes = offsetAt(instant, tz); // corrige cambios DST cercanos
            const sign = offsetMinutes < 0 ? '-' : '+';
            const absolute = Math.abs(offsetMinutes);
            return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
        } catch { return 'Z'; }
    }

    function offsetAt(instant, tz) {
        try {
            const parts = new Intl.DateTimeFormat('en-CA', {
                timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
                hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
            }).formatToParts(instant);
            const get = type => Number(parts.find(p => p.type === type)?.value || 0);
            const representedAsUtc = Date.UTC(
                get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')
            );
            return Math.round((representedAsUtc - instant.getTime()) / 60_000);
        } catch {
            const formatter = new Intl.DateTimeFormat('en-US', {
                timeZone: tz, timeZoneName: 'shortOffset'
            });
            const parts = formatter.formatToParts(date);
            const raw = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT';
            const m = raw.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
            if (!m) return 'Z';
            const sign = m[1].startsWith('-') ? '-' : '+';
            const h = Math.abs(parseInt(m[1], 10)).toString().padStart(2, '0');
            const min = (m[2] || '00').padStart(2, '0');
            return (sign === '-' ? -1 : 1) * (Number(h) * 60 + Number(min));
        }
    }

    function addDays(date, days) {
        const d = new Date(date); d.setDate(d.getDate() + days); return d;
    }

    function setTime(date, hour, minute = 0) {
        const d = new Date(date); d.setHours(hour, minute, 0, 0); return d;
    }

    function result(raw, iso, kind, tz, extras = {}) {
        return {
            raw, iso, kind, timezone: tz,
            confidence: extras.confidence ?? (iso ? 0.9 : 0),
            method: extras.method || 'regex',
            ...(extras.end ? { end: extras.end } : {}),
            ...(extras.rrule ? { rrule: extras.rrule } : {}),
            ...(extras.ambiguity ? { ambiguity: extras.ambiguity } : {})
        };
    }

    // ---------- Time-of-day extraction ----------
    // Matches: "a las 3", "a las 15:30", "a las 3 pm", "3:45 pm", "3h", "9 de la mañana"
    function extractTimeOfDay(text) {
        const normalized = String(text).replace(
            /\b(a las?|hacia las?|sobre las?)\s+(una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|diecis[eé]is|diecisiete|dieciocho|diecinueve|veinte|veintiun[oa]|veintid[oó]s|veintitr[eé]s)\b/gi,
            (_, prefix, word) => `${prefix} ${HOUR_WORDS[word.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')]}`
        );
        if (/\bmediod[ií]a\b/i.test(normalized)) return { hour: 12, minute: 0, ambiguous: false, consumed: 'mediodía' };
        if (/\bmedianoche\b/i.test(normalized)) return { hour: 0, minute: 0, ambiguous: false, consumed: 'medianoche' };
        const patterns = [
            /\b(?:a las |a la |hacia las |sobre las )?(\d{1,2})[:.](\d{2})\s*(am|pm|a\.?m\.?|p\.?m\.?)?\b/i,
            /\b(?:a las |a la )?(\d{1,2})\s*(am|pm|a\.?m\.?|p\.?m\.?)\b/i,
            /\b(?:a las |a la )(\d{1,2})(?:\s+y\s+(media|cuarto))?\s*(?:de la (mañana|manana|tarde|noche|madrugada))?\b/i,
            /\b(\d{1,2})\s*h(?:oras?)?\b/i
        ];
        for (const re of patterns) {
            const m = normalized.match(re);
            if (m) {
                let hour = parseInt(m[1], 10);
                let minute = /[:.]\d{2}/.test(m[0]) ? parseInt(m[2], 10) : 0;
                if (/\by media\b/i.test(m[0])) minute = 30;
                if (/\by cuarto\b/i.test(m[0])) minute = 15;
                const ampm = (m.find?.(x => /^(am|pm|a\.?m\.?|p\.?m\.?)$/i.test(x || '')) || '').toLowerCase();
                const pod = (m.find?.(x => /^(mañana|manana|tarde|noche|madrugada)$/i.test(x || '')) || '').toLowerCase();
                if (ampm.startsWith('p') && hour < 12) hour += 12;
                if (ampm.startsWith('a') && hour === 12) hour = 0;
                if (/tarde|noche/.test(pod) && hour < 12) hour += 12;
                if (/madrugada|mañana|manana/.test(pod) && hour === 12) hour = 0;
                // Ambiguity: bare "3" without am/pm → assume within working hours
                const ambiguous = !ampm && !pod && hour >= 1 && hour <= 11;
                return { hour, minute, ambiguous, consumed: m[0] };
            }
        }
        return null;
    }

    // ---------- Regex-based parser ----------
    function parseWithRegex(raw, referenceDate, tz) {
        const text = raw.toLowerCase().trim();
        const today = nowInTz(tz, referenceDate);
        const tod = extractTimeOfDay(text);

        if (/\b(ahora|ahorita|en este momento)\b/.test(text)) {
            return result(raw, toIsoWithTz(today, tz), 'instant', tz, { confidence: 1 });
        }

        if (/\besta\s+(mañana|manana|tarde|noche)\b/.test(text) && !tod) {
            const hour = /tarde/.test(text) ? 15 : /noche/.test(text) ? 20 : 9;
            return result(raw, toIsoWithTz(setTime(today, hour, 0), tz), 'instant', tz, { confidence: 0.8 });
        }

        if (/\b(mas tarde|más tarde)\b/.test(text) && !tod) {
            const d = new Date(today); d.setHours(d.getHours() + 2);
            return result(raw, toIsoWithTz(d, tz), 'instant', tz, {
                confidence: 0.55,
                ambiguity: { options: [toIsoWithTz(d, tz)], reason: '“Más tarde” no indica una hora exacta; propongo dentro de 2 horas.' }
            });
        }

        // "hoy"
        if (/\b(hoy|today)\b/.test(text)) {
            if (tod) return result(raw, toIsoWithTz(setTime(today, tod.hour, tod.minute), tz), 'instant', tz);
            return result(raw, toIsoWithTz(setTime(today, 9, 0), tz), 'allDay', tz, { confidence: 0.85 });
        }

        // "mañana"
        if (/\b(mañana|manana|tomorrow)\b/.test(text) && !/(pasado|la mañana|de la mañana)/.test(text)) {
            const d = addDays(today, 1);
            if (tod) return result(raw, toIsoWithTz(setTime(d, tod.hour, tod.minute), tz), 'instant', tz);
            return result(raw, toIsoWithTz(setTime(d, 9, 0), tz), 'allDay', tz, { confidence: 0.85 });
        }

        // "pasado mañana"
        if (/\bpasado\s+(mañana|manana)\b/.test(text)) {
            const d = addDays(today, 2);
            if (tod) return result(raw, toIsoWithTz(setTime(d, tod.hour, tod.minute), tz), 'instant', tz);
            return result(raw, toIsoWithTz(setTime(d, 9, 0), tz), 'allDay', tz);
        }

        // "ayer"
        if (/\bayer\b/.test(text)) {
            const d = addDays(today, -1);
            return result(raw, toIsoWithTz(setTime(d, 9, 0), tz), 'allDay', tz);
        }

        // "en N minutos|horas|días|semanas|meses"
        const relM = text.match(/\ben\s+(\d+)\s+(minuto|minutos|hora|horas|día|dias|días|semana|semanas|mes|meses)\b/);
        if (relM) {
            const n = parseInt(relM[1], 10);
            const unit = relM[2];
            const d = new Date(today);
            if (/minuto/.test(unit)) d.setMinutes(d.getMinutes() + n);
            else if (/hora/.test(unit)) d.setHours(d.getHours() + n);
            else if (/día|dia/.test(unit)) d.setDate(d.getDate() + n);
            else if (/semana/.test(unit)) d.setDate(d.getDate() + n * 7);
            else if (/mes/.test(unit)) d.setMonth(d.getMonth() + n);
            return result(raw, toIsoWithTz(d, tz), 'instant', tz);
        }

        // "la próxima semana" / "la semana próxima" / "la semana que viene"
        if (/(próxima|proxima|siguiente)\s+semana|semana\s+(próxima|proxima|que viene|siguiente)/.test(text)) {
            const d = addDays(today, 7 - (today.getDay() || 7) + 1); // next Monday
            if (tod) return result(raw, toIsoWithTz(setTime(d, tod.hour, tod.minute), tz), 'instant', tz);
            return result(raw, toIsoWithTz(setTime(d, 9, 0), tz), 'allDay', tz, { confidence: 0.8 });
        }

        // "todos los <día>" → recurring
        const recM = text.match(/todos los (lunes|martes|miércoles|miercoles|jueves|viernes|sábados?|sabados?|domingos?)/);
        if (recM) {
            const day = recM[1].replace(/s$/, '');
            const dayNum = DAYS_ES[day];
            const codes = { 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA', 0: 'SU' };
            const hour = tod?.hour ?? 9;
            const rrule = `FREQ=WEEKLY;BYDAY=${codes[dayNum]};BYHOUR=${hour}`;
            // Find next occurrence as iso
            const diff = ((dayNum - today.getDay()) + 7) % 7 || 7;
            const d = setTime(addDays(today, diff), hour, tod?.minute ?? 0);
            return result(raw, toIsoWithTz(d, tz), 'recurring', tz, { rrule });
        }

        // "el <día>" / "<día>" — needs disambiguation
        const dayM = text.match(/(?:el )?(próximo |proximo |este )?(lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo)\b/);
        if (dayM) {
            const mod = (dayM[1] || '').trim();
            const day = dayM[2];
            const target = DAYS_ES[day];
            const curDay = today.getDay();
            let diffThis = (target - curDay + 7) % 7;
            if (diffThis === 0) diffThis = 7;
            const thisDate = setTime(addDays(today, diffThis), tod?.hour ?? 9, tod?.minute ?? 0);
            const nextDate = setTime(addDays(today, diffThis + 7), tod?.hour ?? 9, tod?.minute ?? 0);

            if (mod.startsWith('próximo') || mod.startsWith('proximo')) {
                return result(raw, toIsoWithTz(nextDate, tz), tod ? 'instant' : 'allDay', tz);
            }
            if (mod.startsWith('este')) {
                return result(raw, toIsoWithTz(thisDate, tz), tod ? 'instant' : 'allDay', tz);
            }
            // Ambiguous
            return result(raw, toIsoWithTz(thisDate, tz), tod ? 'instant' : 'allDay', tz, {
                confidence: 0.55,
                ambiguity: {
                    options: [toIsoWithTz(thisDate, tz), toIsoWithTz(nextDate, tz)],
                    reason: `"${day}" puede ser este ${day} o el próximo.`
                }
            });
        }

        // "<DD> de <mes>( de <YYYY>)?"
        const dateM = text.match(/(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+de\s+(\d{4}))?/);
        if (dateM) {
            const d = parseInt(dateM[1], 10);
            const m = MONTHS_ES[dateM[2]];
            const y = dateM[3] ? parseInt(dateM[3], 10) : today.getFullYear();
            const date = new Date(y, m, d, tod?.hour ?? 9, tod?.minute ?? 0);
            // If date is in the past and no year provided → next year
            if (!dateM[3] && date < today) date.setFullYear(y + 1);
            return result(raw, toIsoWithTz(date, tz), tod ? 'instant' : 'allDay', tz);
        }

        // "DD/MM" or "DD/MM/YYYY"
        const numM = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
        if (numM) {
            const d = parseInt(numM[1], 10);
            const m = parseInt(numM[2], 10) - 1;
            const y = numM[3] ? (numM[3].length === 2 ? 2000 + parseInt(numM[3], 10) : parseInt(numM[3], 10)) : today.getFullYear();
            const date = new Date(y, m, d, tod?.hour ?? 9, tod?.minute ?? 0);
            if (!numM[3] && date < today) date.setFullYear(y + 1);
            return result(raw, toIsoWithTz(date, tz), tod ? 'instant' : 'allDay', tz);
        }

        // Range: "de X a Y"
        const rangeM = text.match(/de\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?\s+a\s+(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)?/i);
        if (rangeM) {
            let h1 = parseInt(rangeM[1], 10), m1 = parseInt(rangeM[2] || 0, 10);
            let h2 = parseInt(rangeM[4], 10), m2 = parseInt(rangeM[5] || 0, 10);
            const a1 = (rangeM[3] || '').toLowerCase(), a2 = (rangeM[6] || '').toLowerCase();
            if (a1.startsWith('p') && h1 < 12) h1 += 12;
            if (a2.startsWith('p') && h2 < 12) h2 += 12;
            const start = setTime(today, h1, m1);
            const end = setTime(today, h2, m2);
            return result(raw, toIsoWithTz(start, tz), 'range', tz, { end: toIsoWithTz(end, tz) });
        }

        // Just a time-of-day with no date → today at that time
        if (tod && !text.match(/(hoy|mañana|manana|semana|mes|año)/)) {
            return result(raw, toIsoWithTz(setTime(today, tod.hour, tod.minute), tz), 'instant', tz, {
                confidence: tod.ambiguous ? 0.6 : 0.8
            });
        }

        return null;
    }

    // ---------- LLM fallback ----------
    async function parseWithLlm(raw, referenceDate, tz) {
        if (!window.GunterNlpLlm) return null;
        const prompt = `Convierte la siguiente expresión temporal en español a fecha/hora ISO 8601.
Referencia: ${referenceDate.toISOString()}  (timezone: ${tz})
Expresión: "${raw}"

Responde SOLO con JSON:
{"iso": "2026-04-24T09:00:00-05:00", "kind": "instant|allDay|range|recurring", "end": "...", "rrule":"...", "ambiguity": {"options":[],"reason":""}, "confidence": 0.0}
Si no puedes resolverlo, "iso" debe ser null.`;
        try {
            const text = await window.GunterNlpLlm.complete(prompt, { temperature: 0, maxTokens: 300, jsonMode: true });
            const parsed = JSON.parse(text);
            return result(raw, parsed.iso || null, parsed.kind || 'instant', tz, {
                method: 'llm',
                confidence: parsed.confidence ?? (parsed.iso ? 0.8 : 0),
                end: parsed.end,
                rrule: parsed.rrule,
                ambiguity: parsed.ambiguity
            });
        } catch { return null; }
    }

    // ---------- Public API ----------
    async function parse(raw, referenceDate = new Date(), tz = 'UTC') {
        if (!raw) return result('', null, 'instant', tz, { confidence: 0 });
        const regex = parseWithRegex(raw, referenceDate, tz);
        if (regex && regex.iso && regex.confidence >= 0.7) return regex;
        const llm = await parseWithLlm(raw, referenceDate, tz);
        return llm || regex || result(raw, null, 'instant', tz, { confidence: 0 });
    }

    async function parseMany(expressions, userContext) {
        if (!expressions || expressions.length === 0) return [];
        const ref = new Date(userContext.now);
        const tz = userContext.timezone;
        const out = [];
        for (const e of expressions) {
            out.push(await parse(e.raw, ref, tz));
        }
        return out;
    }

    function isAmbiguous(resolved) {
        return !!(resolved && resolved.ambiguity);
    }

    window.GunterTimeParser = { parse, parseMany, isAmbiguous };
})();
