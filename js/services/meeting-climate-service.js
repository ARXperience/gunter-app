/* =============================================
   GUNTER SERVICE - Meeting Climate (v2 — F4)
   -------------------------------------------------
   Análisis emocional y de dinámica en tiempo real
   para una reunión activa.

   Cómo funciona:
   - Polling cada POLL_MS al transcriptionService global
     para obtener el último texto.
   - Heurísticas locales (rápidas, gratis):
       energía, agreement, intensidad, ritmo
   - Cada LLM_MS, refinar con un LLM call sobre el último
     chunk para extraer mood, riesgo, sugerencia.
   - Overlay flotante en meeting.html (auto-monta).

   API:
     GunterMeetingClimate.start({ getter? })   — getter() devuelve transcript actual
     GunterMeetingClimate.stop()
     GunterMeetingClimate.snapshot()           — estado actual {energy, agreement, mood,...}
     GunterMeetingClimate.attachOverlay(rootSel?)
   ============================================= */

(function () {
    if (window.GunterMeetingClimate) return;

    const POLL_MS = 30 * 1000;        // 30s heurísticas
    const LLM_MS  = 75 * 1000;        // 75s LLM refinement
    const MIN_NEW_CHARS = 200;        // ignorar polls sin material nuevo
    const TAIL_FOR_LLM = 1800;        // chars al LLM

    let pollTimer = null, llmTimer = null;
    let lastSeenText = '';
    let lastLLMAt = 0;
    let getter = null;
    let overlay = null;

    let state = {
        active: false,
        startedAt: null,
        lastUpdateAt: null,
        energy: 0.5,        // 0..1
        agreement: 0.5,     // 0..1 (agreement vs disagreement)
        intensity: 0.5,     // 0..1
        pace: 0.5,          // 0..1
        mood: 'neutral',    // 'calmado'|'tenso'|'entusiasta'|'frustrado'|'aburrido'|'neutral'
        risks: [],          // ['ruido', 'desacuerdo en X', 'silencio largo']
        suggestion: '',
        sample: ''          // último chunk analizado (para debug)
    };

    function flagOn() { return !!(window.PremiumFeaturesService?.isEnabled?.('meetingClimate')); }

    // --------------------------- Heurísticas locales ---------------------------

    const POSITIVE = /\b(s[ií]|claro|exacto|perfecto|de acuerdo|me gusta|excelente|brutal|genial|va|dale|me parece|tienes raz[oó]n|ok|listo|aprobado)\b/gi;
    const NEGATIVE = /\b(no|nunca|jam[aá]s|no estoy de acuerdo|no creo|no me parece|esto est[aá] mal|imposible|no funciona|no s[eé] si|tengo dudas|prefiero no|disiento)\b/gi;
    const INTENSE  = /[!]{1,}|\bMUY\b|\bSUPER\b|\bDEMASIADO\b|\bURGENTE\b|\bYA\b\b|\bAHORA\b|\bRAPIDO\b/gi;
    const QUESTION = /\?/g;
    const FILLERS  = /\b(eh+|um+|este|o sea|tipo|como que|no s[eé])\b/gi;

    function score(text) {
        const t = text || '';
        const words = (t.match(/\S+/g) || []).length || 1;
        const pos = (t.match(POSITIVE) || []).length;
        const neg = (t.match(NEGATIVE) || []).length;
        const intense = (t.match(INTENSE) || []).length;
        const q = (t.match(QUESTION) || []).length;
        const fillers = (t.match(FILLERS) || []).length;

        // Agreement = positivos vs negativos (saturado)
        const agreement = clamp(0.5 + (pos - neg) * 0.07, 0, 1);
        // Intensity por palabras intensas + signos
        const intensity = clamp(0.3 + intense * 0.06, 0, 1);
        // Energy combina intensidad + densidad de preguntas (engagement)
        const energy = clamp(0.4 + intensity * 0.35 + (q / words) * 8, 0, 1);
        // Pace: aprox por palabras / segundo no lo tenemos; estimamos por longitud y fillers (negativos)
        const pace = clamp(0.5 + (words / 800) - fillers * 0.02, 0, 1);
        return { agreement, intensity, energy, pace };
    }

    function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

    function deriveMood(s) {
        if (s.intensity > 0.7 && s.agreement < 0.4) return 'tenso';
        if (s.intensity > 0.7 && s.agreement > 0.6) return 'entusiasta';
        if (s.energy < 0.35) return 'aburrido';
        if (s.agreement < 0.35) return 'frustrado';
        if (s.energy > 0.6 && s.agreement > 0.55) return 'productivo';
        return 'calmado';
    }

    // --------------------------- LLM refinement ---------------------------

    async function refineWithLLM(chunk) {
        if (!window.GunterNlpLlm?.complete) return null;
        if (!chunk || chunk.length < 200) return null;
        const prompt = `Analiza el clima de esta reunión a partir del siguiente fragmento de transcripción (en español).
Devuelve SOLO JSON con:
{
  "mood": "calmado|tenso|entusiasta|frustrado|aburrido|productivo|neutral",
  "agreement": 0.0-1.0,
  "energy": 0.0-1.0,
  "risks": ["string corta describiendo riesgo o fricción"],
  "suggestion": "una micro-sugerencia accionable para el moderador, máx 90 chars"
}

Fragmento:
"""
${chunk.slice(-TAIL_FOR_LLM)}
"""`;
        try {
            const raw = await window.GunterNlpLlm.complete(prompt, {
                temperature: 0.1,
                maxTokens: 250,
                jsonMode: true,
                skipMemory: true   // evitar inflar prompt con LTM
            });
            const parsed = JSON.parse(raw);
            return {
                mood: typeof parsed.mood === 'string' ? parsed.mood : null,
                agreement: typeof parsed.agreement === 'number' ? parsed.agreement : null,
                energy: typeof parsed.energy === 'number' ? parsed.energy : null,
                risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 3) : [],
                suggestion: typeof parsed.suggestion === 'string' ? parsed.suggestion.slice(0, 140) : ''
            };
        } catch (e) {
            console.warn('[climate] LLM refine failed:', e?.message);
            return null;
        }
    }

    // --------------------------- Tick principal ---------------------------

    async function tick() {
        if (!flagOn()) return;
        let text = '';
        try {
            if (getter) text = String(await getter() || '');
        } catch { return; }
        if (!text) return;

        const newPart = text.slice(lastSeenText.length);
        if (newPart.length < MIN_NEW_CHARS && lastSeenText) return;
        lastSeenText = text;

        // Heurísticas
        const sc = score(newPart || text);
        state.energy = (state.energy * 0.4 + sc.energy * 0.6);
        state.agreement = (state.agreement * 0.4 + sc.agreement * 0.6);
        state.intensity = (state.intensity * 0.4 + sc.intensity * 0.6);
        state.pace = sc.pace;
        state.mood = deriveMood(state);
        state.lastUpdateAt = new Date().toISOString();
        state.sample = (newPart || text).slice(-300);

        // Avatar mood
        try {
            window.__GUNTER_PRIMARY_AVATAR__?.playAnimation?.(state.mood === 'tenso' || state.mood === 'frustrado' ? 'alert' : state.mood === 'entusiasta' ? 'wave' : 'think');
        } catch { /* noop */ }

        // LLM refinement (rate-limited)
        const now = Date.now();
        if (now - lastLLMAt > LLM_MS) {
            lastLLMAt = now;
            const refined = await refineWithLLM(text);
            if (refined) {
                if (refined.mood)              state.mood = refined.mood;
                if (refined.agreement != null) state.agreement = refined.agreement;
                if (refined.energy != null)    state.energy = refined.energy;
                state.risks = refined.risks || state.risks;
                state.suggestion = refined.suggestion || state.suggestion;
            }
        }

        renderOverlay();
        window.dispatchEvent(new CustomEvent('gunter-climate-update', { detail: { ...state } }));
    }

    // --------------------------- Overlay UI ---------------------------

    function attachOverlay(rootSel) {
        if (overlay) return;
        const root = rootSel ? document.querySelector(rootSel) : document.body;
        if (!root) return;
        overlay = document.createElement('div');
        overlay.id = 'gunter-climate-overlay';
        overlay.style.cssText = `
            position:fixed;bottom:18px;right:18px;z-index:9999;
            background:rgba(20,20,28,0.92);color:#fff;
            padding:12px 14px;border-radius:12px;font-family:system-ui,sans-serif;
            font-size:12px;width:240px;box-shadow:0 8px 24px rgba(0,0,0,0.35);
            backdrop-filter:blur(10px);transition:opacity 0.3s;
        `;
        overlay.innerHTML = '<div style="text-align:center;opacity:0.6;">Esperando audio…</div>';
        root.appendChild(overlay);
        // Listener para minimizar
        overlay.addEventListener('dblclick', () => {
            overlay.style.opacity = overlay.style.opacity === '0.25' ? '1' : '0.25';
        });
    }

    function moodEmoji(m) {
        return ({
            calmado:'😌', tenso:'😬', entusiasta:'🤩', frustrado:'😤',
            aburrido:'😴', productivo:'🚀', neutral:'😐'
        })[m] || '😐';
    }

    function bar(pct, color = '#5b8def') {
        const w = Math.round(pct * 100);
        return `<div style="background:rgba(255,255,255,0.1);height:6px;border-radius:3px;overflow:hidden;margin-top:2px;">
            <div style="width:${w}%;background:${color};height:100%;transition:width 0.5s;"></div>
        </div>`;
    }

    function renderOverlay() {
        if (!overlay) return;
        const moodColor = ({
            calmado:'#4caf50', tenso:'#e53935', entusiasta:'#ffb300',
            frustrado:'#fb8c00', aburrido:'#90a4ae', productivo:'#42a5f5', neutral:'#90a4ae'
        })[state.mood] || '#90a4ae';
        overlay.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <strong style="font-size:13px;">🌡 Clima de la reunión</strong>
                <span style="font-size:18px;">${moodEmoji(state.mood)}</span>
            </div>
            <div style="font-size:11px;opacity:0.85;text-transform:uppercase;letter-spacing:0.5px;color:${moodColor};font-weight:600;">${state.mood}</div>
            <div style="margin-top:8px;">
                <div style="display:flex;justify-content:space-between;font-size:10px;opacity:0.7;">⚡ Energía<span>${Math.round(state.energy * 100)}%</span></div>
                ${bar(state.energy, '#ffb300')}
                <div style="display:flex;justify-content:space-between;font-size:10px;opacity:0.7;margin-top:6px;">🤝 Acuerdo<span>${Math.round(state.agreement * 100)}%</span></div>
                ${bar(state.agreement, '#4caf50')}
                <div style="display:flex;justify-content:space-between;font-size:10px;opacity:0.7;margin-top:6px;">🔥 Intensidad<span>${Math.round(state.intensity * 100)}%</span></div>
                ${bar(state.intensity, '#e53935')}
            </div>
            ${state.suggestion ? `<div style="margin-top:10px;padding:6px 8px;background:rgba(91,141,239,0.15);border-radius:6px;font-size:11px;line-height:1.3;">💡 ${escapeHtml(state.suggestion)}</div>` : ''}
            ${state.risks?.length ? `<div style="margin-top:6px;font-size:10px;opacity:0.7;">⚠ ${escapeHtml(state.risks.slice(0,2).join(' · '))}</div>` : ''}
            <div style="margin-top:6px;font-size:9px;opacity:0.4;text-align:right;">doble click → minimizar</div>
        `;
    }

    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        }[c]));
    }

    // --------------------------- Public API ---------------------------

    function start(opts = {}) {
        if (!flagOn()) return;
        if (pollTimer) return;
        getter = opts.getter || defaultGetter;
        state.active = true;
        state.startedAt = new Date().toISOString();
        attachOverlay(opts.rootSel);
        // Tick inicial rápido
        setTimeout(() => tick().catch(() => {}), 5000);
        pollTimer = setInterval(() => tick().catch(() => {}), POLL_MS);
    }

    function stop() {
        if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
        if (llmTimer)  { clearInterval(llmTimer); llmTimer = null; }
        state.active = false;
        if (overlay) {
            overlay.style.opacity = '0';
            setTimeout(() => { overlay?.remove(); overlay = null; }, 400);
        }
    }

    function defaultGetter() {
        // Intenta leer del transcriptionService global de meeting.html
        try {
            if (typeof window.transcriptionService?.getMergedTranscript === 'function') {
                return window.transcriptionService.getMergedTranscript();
            }
        } catch {}
        // Fallback: textarea
        try {
            const ta = document.getElementById('transcription-textarea');
            if (ta) return ta.value;
        } catch {}
        // Fallback final: localStorage (no live)
        return localStorage.getItem('gunter_full_transcript') || '';
    }

    function snapshot() { return { ...state }; }

    window.GunterMeetingClimate = {
        start, stop, snapshot, attachOverlay, flagOn,
        // util para testing manual
        _setSample: (text) => { lastSeenText = ''; getter = () => text; tick(); }
    };

    // Auto-arranque cuando el usuario inicia grabación en meeting.html.
    // Detectamos por escuchar evento custom o cambio en transcripción.
    window.addEventListener('gunter-recording-started', () => start());
    window.addEventListener('gunter-recording-stopped', () => stop());
})();
