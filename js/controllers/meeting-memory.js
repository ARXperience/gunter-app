/* =============================================
   GUNTER - Meeting Memory + Semantic Search (Fase 4)
   -------------------------------------------------
   Solo visible si PremiumFeaturesService.isEnabled
   ('meetingMemory'). Usa el SemanticIndex (vectores
   reales con OpenAI embeddings) para encontrar los
   top-K chunks relevantes y luego pasa SOLO esos al
   LLM como re-ranker. Fallback al modo "corpus completo"
   si los embeddings no están disponibles.
   ============================================= */

(function () {
    let host = null;
    let mounted = false;

    function visible() {
        return !!(window.PremiumFeaturesService?.isEnabled?.('meetingMemory'));
    }

    function mount(selector) {
        host = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!host) return;
        mounted = true;
        render();
        window.addEventListener('gunterPremiumFeaturesChange', () => render());
    }

    function render() {
        if (!host) return;
        if (!visible()) { host.innerHTML = ''; host.style.display = 'none'; return; }
        host.style.display = '';
        host.innerHTML = `
            <div class="gday__card gmem">
                <div class="gday__card-actions">
                    <h3>🧠 Memoria de reuniones</h3>
                    <span class="gmem__hint">Busca semántica en transcripciones y análisis</span>
                </div>
                <form id="gmem-form" class="gmem__form">
                    <input type="text" id="gmem-input" placeholder='¿Qué dijo Ana sobre precios? · Decisiones del último trimestre · Tareas pendientes de Juan'>
                    <button type="submit">🔍 Buscar</button>
                </form>
                <div class="gmem__filters">
                    <select id="gmem-filter-project">
                        <option value="">Todos los proyectos</option>
                    </select>
                    <select id="gmem-filter-range">
                        <option value="all">Todo el tiempo</option>
                        <option value="7">Últimos 7 días</option>
                        <option value="30">Últimos 30 días</option>
                        <option value="90">Últimos 90 días</option>
                    </select>
                    <button type="button" id="gmem-reindex" class="gmem__icon-btn" title="Reindexar memoria semántica">↻ Reindexar</button>
                </div>
                <div id="gmem-status" class="gmem__status"></div>
                <div id="gmem-results" class="gmem__results"></div>
            </div>
        `;
        populateProjectFilter();
        host.querySelector('#gmem-form').addEventListener('submit', onSearch);
        host.querySelector('#gmem-reindex').addEventListener('click', () => buildIndex({ force: false, manual: true }));
        // Disparo build silencioso al montar (no bloquea búsqueda manual).
        buildIndex({ force: false, manual: false }).catch(() => {});
    }

    async function buildIndex({ force, manual }) {
        const status = host?.querySelector('#gmem-status');
        if (!window.GunterSemanticIndex || !window.GunterEmbeddings) {
            if (manual && status) {
                status.innerHTML = `<span class="gmem__status-warn">⚠ Embeddings no disponibles (revisa /api/embeddings).</span>`;
            }
            return;
        }
        try {
            if (status && manual) status.textContent = 'Construyendo índice…';
            const res = await window.GunterSemanticIndex.ensureBuilt({
                force,
                onProgress: ({ done, total }) => {
                    if (status && total > 0) {
                        status.textContent = `Indexando ${done}/${total} fragmentos…`;
                    }
                }
            });
            const stats = await window.GunterSemanticIndex.stats();
            if (status) {
                status.innerHTML = `<span class="gmem__status-ok">✓ ${stats.chunks} fragmentos indexados${res.added ? ` · ${res.added} nuevos` : ''}</span>`;
            }
        } catch (e) {
            if (status) status.innerHTML = `<span class="gmem__status-err">⚠ ${escapeHtml(e.message || String(e))}</span>`;
        }
    }

    function populateProjectFilter() {
        const sel = host.querySelector('#gmem-filter-project');
        if (!sel || !window.gunterData) return;
        try {
            const projects = window.gunterData.getActiveProjects
                ? window.gunterData.getActiveProjects()
                : window.gunterData.getAllProjects().filter(p => !p.deletedAt);
            for (const p of projects) {
                const opt = document.createElement('option');
                opt.value = p.id; opt.textContent = p.name;
                sel.appendChild(opt);
            }
        } catch {}
    }

    async function onSearch(e) {
        e.preventDefault();
        const query = host.querySelector('#gmem-input').value.trim();
        if (!query) return;
        const projectFilter = host.querySelector('#gmem-filter-project').value;
        const rangeDays = host.querySelector('#gmem-filter-range').value;

        const out = host.querySelector('#gmem-results');
        out.innerHTML = `<div class="gmem__loading">🧠 Buscando en transcripciones, análisis y decisiones pasadas…</div>`;

        try {
            if (!window.GunterNlpLlm?.complete) {
                out.innerHTML = `<div class="gday__empty">El servicio de IA no está disponible.</div>`;
                return;
            }

            // Asegurar índice listo (no bloqueante si ya está)
            if (window.GunterSemanticIndex && window.GunterEmbeddings) {
                await window.GunterSemanticIndex.ensureBuilt({}).catch(() => {});
            }

            const sinceTs = rangeDays !== 'all'
                ? Date.now() - parseInt(rangeDays, 10) * 86_400_000
                : null;

            // Top-K por similitud (ruta principal)
            let topChunks = [];
            if (window.GunterSemanticIndex) {
                topChunks = await window.GunterSemanticIndex.search(query, {
                    topK: 8,
                    projectId: projectFilter || null,
                    sinceTs,
                    minScore: 0.18
                });
            }

            // Fallback al corpus completo si no hay índice o quedó vacío
            let context, citationsContext;
            if (topChunks.length) {
                context = topChunks.map((c, i) =>
                    `[#${i + 1} ${c.projectName} — ${new Date(c.createdAt).toLocaleDateString('es-MX')} — score ${c.score.toFixed(2)}]\n${c.text}`
                ).join('\n\n---\n\n');
                citationsContext = topChunks.map(c => ({
                    project: c.projectName,
                    date: new Date(c.createdAt).toLocaleDateString('es-MX')
                }));
            } else {
                const corpus = collectCorpus({ projectFilter, rangeDays });
                if (!corpus.length) {
                    out.innerHTML = `<div class="gday__empty">No hay reuniones que coincidan con los filtros.</div>`;
                    return;
                }
                context = corpus.map(c =>
                    `[${c.projectName} — ${c.date}]\n${c.snippet}`
                ).join('\n\n---\n\n').slice(0, 14000);
                citationsContext = [];
            }

            const prompt = `Eres un asistente de búsqueda de reuniones. Tengo los siguientes PASAJES relevantes (ya filtrados por similitud semántica).

PREGUNTA DEL USUARIO: "${query}"

PASAJES:
"""
${context}
"""

Tarea:
1. Si los pasajes responden la pregunta, sintetiza una respuesta breve en español latino (≤60 palabras).
2. Cita los pasajes que sustenten tu respuesta.
3. Devuelve JSON válido EXACTO:
{
  "direct_answer": "respuesta breve",
  "citations": [
    { "project": "...", "date": "...", "quote": "pasaje textual o parafraseado" }
  ],
  "connected_decisions": ["decisión 1", "decisión 2"]
}
Si nada coincide, direct_answer debe decirlo claramente y citations puede estar vacío.
NO inventes información. Responde ÚNICAMENTE el JSON.`;

            const raw = await window.GunterNlpLlm.complete(prompt, {
                temperature: 0.2, maxTokens: 700, jsonMode: true,
                system: 'Eres un asistente que responde con JSON válido en español latino, basado solo en los pasajes dados. Cero invención.'
            });

            let parsed;
            try { parsed = JSON.parse(raw); } catch {
                const m = raw.match(/\{[\s\S]*\}/);
                parsed = m ? JSON.parse(m[0]) : null;
            }
            if (!parsed) throw new Error('La IA no devolvió JSON parseable');

            renderResults(parsed, { semantic: topChunks.length > 0, retrieved: topChunks.length });
        } catch (err) {
            out.innerHTML = `<div class="gmem__error">⚠️ ${escapeHtml(err.message || String(err))}</div>`;
        }
    }

    function collectCorpus({ projectFilter, rangeDays }) {
        const out = [];
        try {
            const projects = window.gunterData?.getAllProjects?.() || [];
            const cutoff = rangeDays !== 'all' ? (Date.now() - parseInt(rangeDays, 10) * 86_400_000) : null;

            for (const p of projects) {
                if (p.deletedAt) continue;
                if (projectFilter && p.id !== projectFilter) continue;

                for (const a of p.analyses || []) {
                    if (cutoff && new Date(a.timestamp).getTime() < cutoff) continue;
                    if (a.transcription) {
                        out.push({
                            projectName: p.name,
                            date: new Date(a.timestamp).toLocaleDateString('es-MX'),
                            snippet: 'TRANSCRIPCIÓN: ' + a.transcription.slice(0, 3000)
                        });
                    }
                }
            }

            // Also add cached analyses
            try {
                const cached = JSON.parse(localStorage.getItem('gunter_generated_analyses') || '{}');
                for (const [key, val] of Object.entries(cached)) {
                    const [pid] = key.split('::');
                    if (projectFilter && pid !== projectFilter) continue;
                    if (cutoff && new Date(val.generatedAt).getTime() < cutoff) continue;
                    const pName = projects.find(pp => pp.id === pid)?.name || pid;
                    out.push({
                        projectName: pName,
                        date: new Date(val.generatedAt).toLocaleDateString('es-MX'),
                        snippet: `ANÁLISIS (${val.definition?.title || 'tipo'}): ${JSON.stringify(val.payload).slice(0, 2200)}`
                    });
                }
            } catch {}
        } catch {}
        return out;
    }

    function renderResults(data, info = {}) {
        const out = host.querySelector('#gmem-results');
        const citations = Array.isArray(data.citations) ? data.citations : [];
        const decisions = Array.isArray(data.connected_decisions) ? data.connected_decisions : [];
        const modeBadge = info.semantic
            ? `<span class="gmem__mode gmem__mode--semantic">vectorial · top ${info.retrieved}</span>`
            : `<span class="gmem__mode gmem__mode--legacy">corpus completo</span>`;

        out.innerHTML = `
            <div class="gmem__answer">
                <div class="gmem__answer-head">
                    <strong>Respuesta</strong>
                    ${modeBadge}
                </div>
                <p>${escapeHtml(data.direct_answer || '—')}</p>
            </div>
            ${citations.length ? `
                <div class="gmem__section">
                    <h4>📎 Citas del corpus</h4>
                    ${citations.map(c => `
                        <div class="gmem__cite">
                            <div class="gmem__cite-meta">${escapeHtml(c.project || '')} · ${escapeHtml(c.date || '')}</div>
                            <div class="gmem__cite-quote">"${escapeHtml(c.quote || '')}"</div>
                        </div>
                    `).join('')}
                </div>
            ` : ''}
            ${decisions.length ? `
                <div class="gmem__section">
                    <h4>🔗 Decisiones conectadas</h4>
                    <ul>${decisions.map(d => `<li>${escapeHtml(d)}</li>`).join('')}</ul>
                </div>
            ` : ''}
        `;
    }

    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function injectStyles() {
        if (document.getElementById('gmem-styles')) return;
        const s = document.createElement('style');
        s.id = 'gmem-styles';
        s.textContent = `
            .gmem { animation: gmemIn 380ms cubic-bezier(.22,.61,.36,1); }
            @keyframes gmemIn { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform: translateY(0); } }
            .gmem__hint { font-size: 11px; color: var(--gday-text-mute); letter-spacing: 1px; text-transform: uppercase; }
            .gmem__form { display: flex; gap: 8px; margin-bottom: 10px; }
            .gmem__form input {
                flex: 1;
                background: var(--gday-bg);
                border: 1px solid var(--gday-border);
                color: var(--gday-text);
                padding: 10px 14px;
                border-radius: var(--gday-radius-sm);
                font-family: inherit; font-size: 14px;
                outline: none;
            }
            .gmem__form input:focus { border-color: var(--gday-accent); }
            .gmem__form button {
                padding: 10px 18px;
                background: var(--gday-accent); color: var(--gday-bg);
                border: none; border-radius: var(--gday-radius-sm);
                font-family: inherit; font-weight: 600; cursor: pointer;
            }
            .gmem__filters { display: flex; gap: 8px; margin-bottom: 12px; flex-wrap: wrap; }
            .gmem__filters select {
                padding: 6px 10px;
                background: var(--gday-bg); border: 1px solid var(--gday-border);
                color: var(--gday-text-dim); border-radius: 6px;
                font-family: inherit; font-size: 12px;
            }
            .gmem__results { margin-top: 10px; }
            .gmem__loading { text-align: center; padding: 20px; color: var(--gday-text-mute); }
            .gmem__error {
                padding: 12px; border-radius: 8px;
                background: rgba(248,113,113,0.1); color: #fca5a5;
                border: 1px solid rgba(248,113,113,0.3);
            }
            .gmem__answer {
                padding: 14px 16px; background: var(--gday-bg);
                border: 1px solid color-mix(in srgb, var(--gday-accent) 30%, var(--gday-border));
                border-radius: 10px; margin-bottom: 12px;
            }
            .gmem__answer strong { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: var(--gday-accent); }
            .gmem__answer p { margin: 6px 0 0; font-size: 15px; line-height: 1.5; }
            .gmem__section { margin-top: 12px; }
            .gmem__section h4 { font-size: 12px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--gday-text-mute); margin: 0 0 8px; }
            .gmem__cite {
                padding: 10px 14px; background: var(--gday-surface);
                border-left: 3px solid var(--gday-accent);
                border-radius: 4px; margin-bottom: 8px;
            }
            .gmem__cite-meta { font-size: 10px; color: var(--gday-text-mute); letter-spacing: 0.5px; }
            .gmem__cite-quote { margin-top: 4px; font-style: italic; color: var(--gday-text); line-height: 1.45; font-size: 14px; }

            .gmem__status { font-size: 11px; color: var(--gday-text-mute); margin: 4px 0 8px; min-height: 14px; }
            .gmem__status-ok   { color: #4ade80; }
            .gmem__status-warn { color: #fbbf24; }
            .gmem__status-err  { color: #fca5a5; }

            .gmem__icon-btn {
                padding: 6px 10px; background: transparent;
                border: 1px solid var(--gday-border); color: var(--gday-text-dim);
                border-radius: 6px; font-family: inherit; font-size: 11px;
                cursor: pointer; transition: background 0.15s;
            }
            .gmem__icon-btn:hover { background: var(--gday-bg); color: var(--gday-text); }

            .gmem__answer-head {
                display: flex; align-items: center; justify-content: space-between;
                gap: 8px; margin-bottom: 4px;
            }
            .gmem__mode {
                font-size: 10px; padding: 2px 8px; border-radius: 999px;
                letter-spacing: 0.5px; text-transform: uppercase; font-weight: 600;
            }
            .gmem__mode--semantic { background: color-mix(in srgb, var(--gday-accent) 25%, transparent); color: var(--gday-accent); }
            .gmem__mode--legacy   { background: rgba(251,191,36,0.15); color: #fbbf24; }
        `;
        document.head.appendChild(s);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectStyles);
    } else {
        injectStyles();
    }

    window.GunterMeetingMemory = { mount, render };
})();
