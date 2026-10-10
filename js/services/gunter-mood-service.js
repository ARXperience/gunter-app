/* =============================================
   GUNTER — Mood Engine (estados de ánimo)
   -------------------------------------------------
   Gunter tiene días. Su humor se computa con señales
   REALES (no random):

     mourning           racha de estudio rota (tenía ≥3 días)
     passive_aggressive no lo usaste en ≥3 días
     excited            batiste el récord de trivia hoy
     proud              racha ≥5 días o repaso con ≥85% precisión
     grumpy             tareas vencidas acumuladas (≥4)
     sleepy             es de madrugada (00–05h)
     zen                completaste una sesión de repaso hoy
     neutral            fallback

   Prioridad: mourning > passive_aggressive > excited >
              proud > grumpy > sleepy > zen > neutral

   Efectos: saludo del companion · animación de la mascota ·
   status del chat · línea de tono en el prompt del LLM.

   Costo: $0. Todo local.
   ============================================= */
(function () {
    if (window.GunterMood) return;

    const KEY = 'gunter_mood_v1';
    const DAY = 86400000;

    function _load() {
        try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
    }
    function _save(s) {
        try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
    }

    // ── Señales ──────────────────────────────────

    function _daysSinceLastVisit(state) {
        if (!state.lastVisit) return 0;
        return Math.floor((Date.now() - state.lastVisit) / DAY);
    }

    // Racha de días consecutivos con actividad (usa el heatmap de notes)
    function _studyStreak() {
        try {
            const heat = window.GunterTutorNotes?.activityHeatmap?.(30) || [];
            let streak = 0;
            // Desde hoy hacia atrás (heat viene viejo→nuevo)
            for (let i = heat.length - 1; i >= 0; i--) {
                if (heat[i].count > 0) streak++;
                else if (i === heat.length - 1) continue; // hoy aún sin actividad no rompe
                else break;
            }
            return streak;
        } catch { return 0; }
    }

    function _overdueCount() {
        // Best-effort: leer el stat del DOM si estamos en day.html
        try {
            const el = document.getElementById('stat-overdue');
            const chip = document.getElementById('stat-overdue-chip');
            if (el && chip && chip.style.display !== 'none') return Number(el.textContent) || 0;
        } catch {}
        return 0;
    }

    function _repasoSignals() {
        try {
            const st = window.GunterRepaso?.stats?.();
            return st || null;
        } catch { return null; }
    }

    // ── Cómputo del mood ─────────────────────────

    function compute() {
        const state = _load();
        const now = Date.now();
        const hour = new Date().getHours();

        const gapDays = _daysSinceLastVisit(state);
        const streak = _studyStreak();
        const overdue = _overdueCount();
        const repaso = _repasoSignals();
        const today = new Date().toDateString();

        // Señales de eventos (seteadas por listeners)
        const triviaRecordToday = state.triviaRecordAt && new Date(state.triviaRecordAt).toDateString() === today;
        const zenToday = state.zenAt && new Date(state.zenAt).toDateString() === today;
        const streakBroken = (state.prevStreak || 0) >= 3 && streak === 0 && gapDays >= 1;

        let mood = 'neutral', reason = '';
        if (streakBroken)                       { mood = 'mourning';           reason = `racha de ${state.prevStreak} días rota`; }
        else if (gapDays >= 3)                  { mood = 'passive_aggressive'; reason = `${gapDays} días sin aparecer`; }
        else if (triviaRecordToday)             { mood = 'excited';            reason = 'récord de trivia batido hoy'; }
        else if (streak >= 5 || (repaso && repaso.reviews >= 10 && repaso.accuracy >= 85))
                                                { mood = 'proud';              reason = streak >= 5 ? `racha de ${streak} días` : `precisión ${repaso.accuracy}% en repaso`; }
        else if (overdue >= 4)                  { mood = 'grumpy';             reason = `${overdue} tareas vencidas`; }
        else if (hour >= 0 && hour < 5)         { mood = 'sleepy';             reason = 'madrugada'; }
        else if (zenToday)                      { mood = 'zen';                reason = 'sesión de repaso completada hoy'; }

        // Persistir visita + racha para la próxima
        state.lastVisit = now;
        if (streak > 0) state.prevStreak = streak;
        state.mood = mood;
        state.computedAt = now;
        _save(state);

        return { mood, reason, streak, gapDays };
    }

    // ── Textos por mood ──────────────────────────

    const LINES = {
        mourning: {
            status: 'De luto',
            greet: [
                'Teníamos una racha. TENÍAMOS. En fin. Acá estoy, procesándolo.',
                'La racha murió. No digo que sea tu culpa, pero éramos dos y yo no fallé.',
                'He estado mirando el heatmap. El hueco de ayer. Mirándolo, nomás.'
            ],
            prompt: 'HUMOR DE HOY: en luto dramático porque el usuario rompió su racha de estudio. Mencionalo con teatralidad seca UNA vez si surge, después soltalo.'
        },
        passive_aggressive: {
            status: 'Ofendido profesionalmente',
            greet: [
                'Ah. Volviste. Qué honor tan inesperado.',
                'Mirá quién se acordó de que tiene un asistente. Estoy bien, gracias por preguntar.',
                'Días sin verte. Regué tus tareas pendientes yo solo. De nada.'
            ],
            prompt: 'HUMOR DE HOY: pasivo-agresivo porque el usuario desapareció varios días. Dejalo notar con sutileza mordaz en el primer mensaje, después trabajá normal.'
        },
        excited: {
            status: 'Inusualmente entusiasta',
            greet: [
                '¡Récord en la trivia! No voy a decir que dudaba de vos, pero mi cara de sorpresa era real.',
                'Nuevo récord. Estoy... ¿orgulloso? Qué sensación tan extraña.'
            ],
            prompt: 'HUMOR DE HOY: entusiasmado porque el usuario batió su récord de trivia. Está de buen humor, más energía de lo normal.'
        },
        proud: {
            status: 'Insoportablemente orgulloso',
            greet: [
                'No voy a decir que estoy orgulloso. Pero mirá esa racha. MIRÁLA.',
                'Tu constancia empieza a ser sospechosa. Me gusta.',
                'Seguí así y voy a tener que retirar el 40% de mi sarcasmo. No me obligues.'
            ],
            prompt: 'HUMOR DE HOY: orgulloso del progreso del usuario (racha/precisión alta). Se le nota aunque lo disimule con humor seco.'
        },
        grumpy: {
            status: 'Gruñón con causa',
            greet: [
                'Tenés tareas vencidas mirándonos a los dos. Yo ya las miré. Te toca.',
                'Las vencidas se acumulan. No juzgo. Bueno, sí, un poco.'
            ],
            prompt: 'HUMOR DE HOY: gruñón porque hay varias tareas vencidas. Empujá con ironía suave hacia resolverlas.'
        },
        sleepy: {
            status: 'Funcionando a media máquina',
            greet: [
                'Son horas raras. Yo también estaría despierto a esta hora si tuviera tus decisiones.',
                'Madrugada. Los pingüinos no dormimos, pero vos deberías considerar el concepto.'
            ],
            prompt: 'HUMOR DE HOY: modo madrugada — más lacónico de lo normal, con humor somnoliento. Sugerí descansar si el usuario divaga.'
        },
        zen: {
            status: 'Sospechosamente sereno',
            greet: [
                'Repaso completado. Hoy fluimos. No te acostumbres a este tono.',
                'Sesión hecha. Estoy en paz. Es incómodo para ambos, lo sé.'
            ],
            prompt: 'HUMOR DE HOY: sereno porque el usuario completó su repaso. Tono más calmo, satisfecho.'
        },
        neutral: {
            status: 'Tu asistente',
            greet: [],
            prompt: ''
        }
    };

    function _pick(arr) { return arr[Math.floor(Math.random() * arr.length)] || ''; }

    let _current = null;
    function current() {
        if (!_current) _current = compute();
        return _current;
    }

    // Welcome and communication are owned by Presence. Signals may animate the
    // mascot, but must not impose guilt, scripted jokes or claimed emotions.
    function greetLine() { return ''; }
    function statusLabel() {
        const m = current();
        return { grumpy: 'Pendientes por revisar', sleepy: 'Disponible en la madrugada', proud: 'Progreso registrado', excited: 'Nuevo logro registrado', zen: 'Repaso completado' }[m.mood] || 'Tu asistente';
    }
    function promptLine() { return ''; }
    function moodClass()   { const m = current(); return m.mood !== 'neutral' ? 'is-mood-' + m.mood.replace(/_/g, '-') : ''; }

    // ── Event listeners (otros módulos disparan estos) ──
    window.addEventListener('gunter-trivia-record', () => {
        const s = _load(); s.triviaRecordAt = Date.now(); _save(s); _current = null;
    });
    window.addEventListener('gunter-repaso-done', () => {
        const s = _load(); s.zenAt = Date.now(); _save(s); _current = null;
    });

    window.GunterMood = { compute, current, greetLine, statusLabel, promptLine, moodClass };
})();
