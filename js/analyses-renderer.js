/* =============================================
   GUNTER APP - Analyses Renderer
   -------------------------------------------------
   Dibuja los 7 tipos de análisis devueltos por
   GunterAnalyses.generate(). Cada tipo tiene su
   propio renderer. Los análisis generados se
   cachean en localStorage por (projectId, type).
   ============================================= */

(function () {
    const STORAGE_KEY = 'gunter_generated_analyses';

    function readCache() {
        try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
    }
    function writeCache(obj) {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch { }
    }
    function cacheKey(projectId, analysisId) {
        return `${projectId || 'default'}::${analysisId}`;
    }

    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // ---------- Card selector ----------
    function renderCards({ environment, onSelect, cachedIds = new Set() }) {
        const grid = document.getElementById('analyses-grid');
        if (!grid) return;
        const list = window.GunterAnalyses.listFor(environment);
        grid.innerHTML = list.map(def => `
            <button class="analysis-card" data-analysis-id="${def.id}" style="
                text-align:left; border:1px solid var(--glass-border, rgba(255,255,255,0.08));
                background: var(--bg-card, rgba(13,17,23,0.8));
                padding: var(--space-4); border-radius: var(--theme-radius, 10px);
                cursor:pointer; transition: border-color .2s, transform .15s;
                display:flex; flex-direction:column; gap:8px;">
                <div style="display:flex; align-items:center; gap:10px;">
                    <span style="font-size:22px;">${def.icon}</span>
                    <strong style="font-size:15px;">${escapeHtml(def.title)}</strong>
                    ${cachedIds.has(def.id) ? '<span style="margin-left:auto; font-size:10px; color:#22c55e;">✓ generado</span>' : ''}
                </div>
                <p style="color: var(--text-muted); font-size: 12px; line-height:1.4; margin:0;">${escapeHtml(def.description)}</p>
                <span style="font-size: 10px; color: var(--accent-primary, #00d4ff); margin-top:auto;">${escapeHtml(def.methodology)}</span>
            </button>
        `).join('');

        grid.querySelectorAll('.analysis-card').forEach(el => {
            el.addEventListener('mouseenter', () => {
                el.style.borderColor = 'var(--accent-primary, #00d4ff)';
                el.style.transform = 'translateY(-2px)';
            });
            el.addEventListener('mouseleave', () => {
                el.style.borderColor = 'var(--glass-border, rgba(255,255,255,0.08))';
                el.style.transform = '';
            });
            el.addEventListener('click', () => onSelect(el.dataset.analysisId));
        });
    }

    function setOutput(html) {
        const out = document.getElementById('analysis-output');
        if (out) out.innerHTML = html;
    }

    function clearOutput() {
        const out = document.getElementById('analysis-output');
        if (out) out.innerHTML = '';
    }

    function renderLoading(title) {
        setOutput(`
            <div style="padding: var(--space-5); text-align:center;">
                <div style="display:inline-block; width:36px; height:36px; border:3px solid rgba(255,255,255,0.1); border-top-color: var(--accent-primary, #00d4ff); border-radius:50%; animation: spin 0.8s linear infinite;"></div>
                <p style="margin-top: 12px; color: var(--text-muted);">Gunter está pensando: <strong>${escapeHtml(title)}</strong>…</p>
            </div>
            <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
        `);
    }

    function renderError(err) {
        setOutput(`
            <div style="padding: var(--space-5); border:1px solid #ef444455; background:#ef444411; border-radius: 8px; color:#fca5a5;">
                ⚠️ ${escapeHtml(err?.message || String(err))}
            </div>
        `);
    }

    // ---------- Per-type renderers ----------
    function section(title, body) {
        return `<div style="margin-bottom: var(--space-4);">
            <h3 style="font-size: 16px; margin-bottom: 8px;">${escapeHtml(title)}</h3>
            ${body}
        </div>`;
    }
    function pill(text, color) {
        return `<span style="display:inline-block; padding:3px 10px; border-radius:999px; background:${color}22; color:${color}; border:1px solid ${color}55; font-size:11px; margin-right:4px; margin-bottom:4px;">${escapeHtml(text)}</span>`;
    }
    function list(items) {
        if (!items || !items.length) return '<p style="color:var(--text-muted);">Sin datos.</p>';
        return `<ul style="padding-left: 20px;">${items.map(i => `<li style="margin-bottom:4px;">${escapeHtml(i)}</li>`).join('')}</ul>`;
    }

    const RENDERERS = {
        proyectual: (p) => {
            const pc = p.project_charter || {};
            const sh = p.stakeholders || [];
            const wbs = p.wbs || [];
            return `
                ${section('🎯 Propósito', `<p>${escapeHtml(pc.purpose || '—')}</p>`)}
                ${section('🏁 Objetivos SMART', list(pc.objectives))}
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--space-3);">
                    ${section('✅ Dentro de alcance', list(pc.scope_in))}
                    ${section('🚫 Fuera de alcance', list(pc.scope_out))}
                </div>
                ${section('📏 Criterios de éxito', list(pc.success_criteria))}
                ${section('👥 Stakeholders', sh.length ? `
                    <table style="width:100%; border-collapse:collapse; font-size: 13px;">
                        <thead><tr style="text-align:left; color: var(--text-muted);">
                            <th style="padding:6px 4px;">Persona/Rol</th><th>Rol</th><th>Influencia</th><th>Interés</th>
                        </tr></thead>
                        <tbody>${sh.map(s => `
                            <tr style="border-top:1px solid rgba(255,255,255,0.05);">
                                <td style="padding:6px 4px;">${escapeHtml(s.name)}</td>
                                <td>${escapeHtml(s.role)}</td>
                                <td>${pill(s.influence || '-', '#60a5fa')}</td>
                                <td>${pill(s.interest || '-', '#f59e0b')}</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>` : '<p style="color:var(--text-muted);">Sin stakeholders identificados.</p>')}
                ${section('🧱 WBS — Desglose de trabajo', wbs.length ? wbs.map(w => `
                    <div style="border-left: 3px solid var(--accent-primary, #00d4ff); padding: 8px 12px; margin-bottom: 8px; background: rgba(255,255,255,0.03);">
                        <strong>${escapeHtml(w.phase)}</strong> ${pill('Esfuerzo: ' + (w.estimated_effort || '-'), '#a78bfa')}
                        ${list(w.deliverables)}
                    </div>`).join('') : '<p style="color:var(--text-muted);">Sin fases.</p>')}
                ${section('🔒 Restricciones', list(p.constraints))}
                ${section('🧪 Supuestos a validar', list(p.assumptions))}
                ${p.gunter_note ? `<blockquote style="border-left:3px solid var(--accent-primary,#00d4ff); padding: 8px 14px; color: var(--text-muted); margin-top: var(--space-4);">🐧 ${escapeHtml(p.gunter_note)}</blockquote>` : ''}
            `;
        },
        estrategico: (p) => {
            const s = p.swot || {};
            const pe = p.pestel || {};
            const f = p.porter_five_forces || {};
            const quad = (title, items, color) => `
                <div style="padding: var(--space-3); border:1px solid ${color}55; border-radius:8px; background:${color}11;">
                    <strong style="color:${color};">${title}</strong>
                    ${list(items)}
                </div>`;
            return `
                ${section('🎯 SWOT', `
                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--space-3);">
                        ${quad('Fortalezas', s.strengths, '#22c55e')}
                        ${quad('Debilidades', s.weaknesses, '#ef4444')}
                        ${quad('Oportunidades', s.opportunities, '#60a5fa')}
                        ${quad('Amenazas', s.threats, '#f59e0b')}
                    </div>
                `)}
                ${section('🌍 PESTEL', `
                    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px,1fr)); gap: var(--space-3);">
                        ${Object.entries(pe).map(([k, v]) => `
                            <div style="padding: var(--space-3); border:1px solid var(--glass-border, rgba(255,255,255,0.08)); border-radius:8px;">
                                <strong style="text-transform:capitalize;">${escapeHtml(k)}</strong>
                                <p style="margin:4px 0 0; color:var(--text-muted); font-size:13px;">${escapeHtml(v)}</p>
                            </div>`).join('')}
                    </div>
                `)}
                ${section('🛡️ 5 Fuerzas de Porter', `
                    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px,1fr)); gap: var(--space-3);">
                        ${Object.entries(f).map(([k, v]) => `
                            <div style="padding: var(--space-3); border:1px solid var(--glass-border, rgba(255,255,255,0.08)); border-radius:8px;">
                                <strong>${escapeHtml(k.replace(/_/g, ' '))}</strong>
                                <p style="margin:4px 0 0; color:var(--text-muted); font-size:13px;">${escapeHtml(v)}</p>
                            </div>`).join('')}
                    </div>
                `)}
                ${p.strategic_recommendation ? section('🎓 Recomendación estratégica', `<p>${escapeHtml(p.strategic_recommendation)}</p>`) : ''}
                ${p.gunter_note ? `<blockquote style="border-left:3px solid var(--accent-primary,#00d4ff); padding: 8px 14px; color: var(--text-muted);">🐧 ${escapeHtml(p.gunter_note)}</blockquote>` : ''}
            `;
        },
        ideas: (p) => {
            return `
                ${section('💎 Insights clave', (p.key_insights || []).map(i => `
                    <div style="padding: var(--space-3); margin-bottom: 8px; background: rgba(255,255,255,0.03); border-radius:8px;">
                        <strong>${escapeHtml(i.title)}</strong>
                        <blockquote style="border-left:3px solid var(--accent-primary,#00d4ff); padding: 4px 12px; margin: 6px 0; color:var(--text-muted); font-size:13px;">"${escapeHtml(i.quote)}"</blockquote>
                        <p style="margin:0; font-size:13px;">${escapeHtml(i.why_matters)}</p>
                    </div>`).join('') || '<p style="color:var(--text-muted);">Sin insights.</p>')}
                ${section('🧩 Jobs-To-Be-Done', (p.jobs_to_be_done || []).map(j => `
                    <p style="padding: 8px 12px; background: rgba(255,255,255,0.03); border-radius:6px; margin-bottom:6px;">
                        <strong>Cuando</strong> ${escapeHtml(j.when)} · <strong>quiero</strong> ${escapeHtml(j.i_want_to)} · <strong>para</strong> ${escapeHtml(j.so_that)}.
                    </p>`).join('') || '<p style="color:var(--text-muted);">Sin JTBD.</p>')}
                ${section('🚀 Oportunidades', `<table style="width:100%; font-size:13px; border-collapse:collapse;">
                    <thead><tr style="text-align:left; color:var(--text-muted);"><th>Idea</th><th>Impacto</th><th>Esfuerzo</th></tr></thead>
                    <tbody>${(p.opportunities || []).map(o => `
                        <tr style="border-top:1px solid rgba(255,255,255,0.05);">
                            <td style="padding:6px 4px;">${escapeHtml(o.idea)}</td>
                            <td>${pill(o.potential_impact || '-', '#22c55e')}</td>
                            <td>${pill(o.effort || '-', '#f59e0b')}</td>
                        </tr>`).join('')}</tbody></table>`)}
                ${section('🎭 Enfoques contraintuitivos', list(p.contrarian_takes))}
                ${p.curious_fact ? section('🤯 Dato curioso', `<p>${escapeHtml(p.curious_fact)}</p>`) : ''}
                ${p.gunter_note ? `<blockquote style="border-left:3px solid var(--accent-primary,#00d4ff); padding: 8px 14px; color: var(--text-muted);">🐧 ${escapeHtml(p.gunter_note)}</blockquote>` : ''}
            `;
        },
        tecnico: (p) => {
            if (p.applicable === false) {
                return `<div style="padding: var(--space-5); color:var(--text-muted); text-align:center;">
                    Este análisis no aplica: ${escapeHtml(p.reason || 'no se identificó un proyecto técnico en la conversación.')}
                </div>`;
            }
            const arch = p.recommended_architecture || {};
            const stack = p.tech_stack || {};
            return `
                ${section('🎯 Problema a resolver', `<p>${escapeHtml(p.problem_statement)}</p>`)}
                ${section('🏛️ Arquitectura recomendada', `
                    <p><strong>${escapeHtml(arch.pattern || '-')}</strong> — <span style="color:var(--text-muted);">${escapeHtml(arch.rationale || '')}</span></p>
                    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(240px,1fr)); gap: var(--space-3); margin-top:8px;">
                        ${(arch.components || []).map(c => `
                            <div style="padding: var(--space-3); border:1px solid var(--glass-border, rgba(255,255,255,0.08)); border-radius:8px;">
                                <strong>${escapeHtml(c.name)}</strong>
                                <p style="margin:4px 0; font-size:13px; color:var(--text-muted);">${escapeHtml(c.responsibility)}</p>
                                ${pill(c.tech_suggestion || '-', '#a78bfa')}
                            </div>`).join('')}
                    </div>`)}
                ${section('🧰 Stack tecnológico', `
                    <table style="width:100%; font-size:13px;">
                        ${Object.entries(stack).map(([layer, opts]) => `
                            <tr><td style="padding:4px 8px; font-weight:600; text-transform:capitalize; width:120px;">${escapeHtml(layer)}</td>
                            <td>${(opts || []).map(o => pill(o, '#60a5fa')).join('')}</td></tr>`).join('')}
                    </table>`)}
                ${section('🗃️ Modelo de datos', (p.data_model || []).map(e => `
                    <div style="padding: 8px 12px; margin-bottom:6px; background: rgba(255,255,255,0.03); border-radius:6px;">
                        <strong>${escapeHtml(e.entity)}</strong>
                        <div style="font-size:13px; color:var(--text-muted); margin: 4px 0;">${(e.fields || []).map(f => `<code style="padding:2px 6px; background:rgba(255,255,255,0.06); border-radius:4px; margin-right:4px;">${escapeHtml(f)}</code>`).join('')}</div>
                        ${e.relations ? `<p style="margin:0; font-size:12px; color:var(--text-muted);">Relaciones: ${escapeHtml(e.relations)}</p>` : ''}
                    </div>`).join('') || '<p style="color:var(--text-muted);">Sin modelo.</p>')}
                ${section('📝 Pasos de implementación', (p.implementation_steps || []).map(s => `
                    <div style="padding: var(--space-3); margin-bottom:8px; border-left:3px solid var(--accent-primary, #00d4ff); background: rgba(255,255,255,0.03);">
                        <strong>${escapeHtml(String(s.step))}. ${escapeHtml(s.title)}</strong>
                        ${list(s.tasks)}
                        <p style="margin: 4px 0 0; font-size:12px; color:var(--text-muted);">✔ Hecho cuando: ${escapeHtml(s.definition_of_done || '')}</p>
                    </div>`).join('') || '<p style="color:var(--text-muted);">Sin pasos.</p>')}
                ${section('⚠️ Riesgos técnicos', list(p.risks_technical))}
                ${section('➡️ Próximas acciones para desarrollo', list(p.next_actions_for_dev))}
                ${p.gunter_note ? `<blockquote style="border-left:3px solid var(--accent-primary,#00d4ff); padding: 8px 14px; color: var(--text-muted);">🐧 ${escapeHtml(p.gunter_note)}</blockquote>` : ''}
            `;
        },
        narrativo: (p) => {
            const h = p.hook_analysis || {};
            const a = p.story_arc || {};
            const pa = p.pacing || {};
            return `
                ${section('🪝 Gancho', `
                    <p><strong>${h.has_hook ? '✅ Tiene gancho' : '❌ Gancho débil'}</strong> · Score primeros 30s: <strong>${escapeHtml(String(h.first_30s_score ?? '-'))}</strong>/100</p>
                    <p style="color:var(--text-muted);">${escapeHtml(h.description || '')}</p>`)}
                ${section('📜 Arco narrativo', `
                    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px,1fr)); gap: var(--space-3);">
                        ${['setup', 'rising_action', 'climax', 'resolution'].map(k => `
                            <div style="padding: var(--space-3); border:1px solid var(--glass-border, rgba(255,255,255,0.08)); border-radius:8px;">
                                <strong style="text-transform:capitalize;">${escapeHtml(k.replace(/_/g, ' '))}</strong>
                                <p style="margin:4px 0 0; font-size:13px; color:var(--text-muted);">${escapeHtml(a[k] || '-')}</p>
                            </div>`).join('')}
                    </div>`)}
                ${section('⏱️ Ritmo', `<p>${pill(pa.rating || '-', '#a78bfa')} <span style="color:var(--text-muted);">${escapeHtml(pa.notes || '')}</span></p>`)}
                ${section('📉 Curva de retención estimada', (p.retention_curve || []).map(r => `
                    <div style="display:flex; align-items:center; gap:12px; margin-bottom:6px;">
                        <span style="width:90px; font-size:12px; color:var(--text-muted);">${escapeHtml(r.segment)}</span>
                        <div style="flex:1; height:8px; background:rgba(255,255,255,0.05); border-radius:4px; overflow:hidden;">
                            <div style="width:${Math.min(100, Math.max(0, r.estimated_retention || 0))}%; height:100%; background: linear-gradient(90deg, #22c55e, #60a5fa);"></div>
                        </div>
                        <span style="width:40px; text-align:right; font-size:12px;">${escapeHtml(String(r.estimated_retention || 0))}%</span>
                        <span style="flex:1; font-size:12px; color:var(--text-muted);">${escapeHtml(r.reason || '')}</span>
                    </div>`).join('') || '<p style="color:var(--text-muted);">Sin segmentos.</p>')}
                ${section('✂️ Ediciones recomendadas', list(p.recommended_edits))}
                ${p.gunter_note ? `<blockquote style="border-left:3px solid var(--accent-primary,#00d4ff); padding: 8px 14px; color: var(--text-muted);">🐧 ${escapeHtml(p.gunter_note)}</blockquote>` : ''}
            `;
        },
        riesgos: (p) => {
            const reg = p.risk_register || [];
            const heat = (score) => {
                if (score >= 15) return '#ef4444';
                if (score >= 8) return '#f59e0b';
                if (score >= 4) return '#eab308';
                return '#22c55e';
            };
            return `
                ${section('📋 Registro de riesgos (ISO 31000)', reg.length ? `
                    <table style="width:100%; font-size:13px; border-collapse:collapse;">
                        <thead><tr style="text-align:left; color:var(--text-muted);">
                            <th style="padding:6px 4px;">ID</th><th>Riesgo</th><th>Categoría</th>
                            <th>P</th><th>I</th><th>P×I</th><th>Mitigación</th><th>Dueño</th>
                        </tr></thead>
                        <tbody>${reg.map(r => `
                            <tr style="border-top:1px solid rgba(255,255,255,0.05);">
                                <td style="padding:6px 4px;"><code>${escapeHtml(r.id || '-')}</code></td>
                                <td><strong>${escapeHtml(r.title)}</strong><br><span style="color:var(--text-muted); font-size:12px;">${escapeHtml(r.description || '')}</span></td>
                                <td>${pill(r.category || '-', '#60a5fa')}</td>
                                <td>${escapeHtml(String(r.probability ?? '-'))}</td>
                                <td>${escapeHtml(String(r.impact ?? '-'))}</td>
                                <td><span style="padding:3px 8px; border-radius:999px; background:${heat(r.score)}33; color:${heat(r.score)}; border:1px solid ${heat(r.score)}99;">${escapeHtml(String(r.score ?? '-'))}</span></td>
                                <td style="color:var(--text-muted);">${escapeHtml(r.mitigation || '')}</td>
                                <td>${escapeHtml(r.owner || '-')}</td>
                            </tr>`).join('')}</tbody></table>` : '<p style="color:var(--text-muted);">Sin riesgos identificados.</p>')}
                <p style="margin-top:12px;"><strong>Riesgo más crítico:</strong> ${escapeHtml(p.top_risk || '-')} · <strong>Nivel residual:</strong> ${pill(p.residual_risk_level || '-', '#f59e0b')}</p>
                ${p.gunter_note ? `<blockquote style="border-left:3px solid var(--accent-primary,#00d4ff); padding: 8px 14px; color: var(--text-muted);">🐧 ${escapeHtml(p.gunter_note)}</blockquote>` : ''}
            `;
        },
        plan_accion: (p) => {
            return `
                ${section('🎯 Objetivos SMART', (p.smart_goals || []).map(g => `
                    <div style="padding: var(--space-3); margin-bottom:8px; border:1px solid var(--glass-border, rgba(255,255,255,0.08)); border-radius:8px;">
                        <strong>${escapeHtml(g.goal)}</strong>
                        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(140px,1fr)); gap:8px; margin-top:8px; font-size:12px;">
                            ${['specific', 'measurable', 'achievable', 'relevant', 'timebound'].map(k => `
                                <div><span style="color:var(--text-muted); text-transform:capitalize;">${k}:</span><br>${escapeHtml(g[k] || '-')}</div>`).join('')}
                        </div>
                    </div>`).join('') || '<p style="color:var(--text-muted);">Sin objetivos SMART.</p>')}
                ${section('🚀 OKRs', (p.okrs || []).map(o => `
                    <div style="padding: var(--space-3); margin-bottom:8px; background:rgba(255,255,255,0.03); border-radius:8px;">
                        <strong>O: ${escapeHtml(o.objective)}</strong>
                        <ul style="padding-left: 20px; margin: 6px 0 0;">${(o.key_results || []).map(kr => `<li style="font-size:13px;">KR: ${escapeHtml(kr)}</li>`).join('')}</ul>
                    </div>`).join('') || '<p style="color:var(--text-muted);">Sin OKRs.</p>')}
                ${section('🧩 Matriz RACI', (p.raci_matrix || []).length ? `
                    <table style="width:100%; font-size:13px; border-collapse:collapse;">
                        <thead><tr style="text-align:left; color:var(--text-muted);">
                            <th style="padding:6px 4px;">Actividad</th><th>R</th><th>A</th><th>C</th><th>I</th>
                        </tr></thead>
                        <tbody>${p.raci_matrix.map(r => `
                            <tr style="border-top:1px solid rgba(255,255,255,0.05);">
                                <td style="padding:6px 4px;"><strong>${escapeHtml(r.activity)}</strong></td>
                                <td>${escapeHtml(r.responsible)}</td>
                                <td>${escapeHtml(r.accountable)}</td>
                                <td>${escapeHtml(r.consulted)}</td>
                                <td>${escapeHtml(r.informed)}</td>
                            </tr>`).join('')}</tbody></table>` : '<p style="color:var(--text-muted);">Sin matriz RACI.</p>')}
                <div style="display:grid; grid-template-columns: 1fr 1fr; gap: var(--space-3);">
                    ${section('🗓️ Próximos 7 días', list(p.next_7_days))}
                    ${section('🗓️ Próximos 30 días', list(p.next_30_days))}
                </div>
                ${p.gunter_note ? `<blockquote style="border-left:3px solid var(--accent-primary,#00d4ff); padding: 8px 14px; color: var(--text-muted);">🐧 ${escapeHtml(p.gunter_note)}</blockquote>` : ''}
            `;
        }
    };

    function buildResultHTML(result, { regenerable = true } = {}) {
        const renderer = RENDERERS[result.analysisId];
        if (!renderer) return '<p>Renderer no disponible para este tipo.</p>';
        const body = renderer(result.payload || {});
        return `
            <div class="analysis-result-card" data-analysis-id="${escapeHtml(result.analysisId)}" style="border:1px solid var(--glass-border, rgba(255,255,255,0.08)); border-radius: var(--theme-radius, 10px); padding: var(--space-5); margin-bottom: var(--space-4); background: var(--bg-card, rgba(13,17,23,0.75));">
                <div style="display:flex; align-items:center; gap:10px; margin-bottom: var(--space-4);">
                    <span style="font-size:24px;">${result.definition.icon}</span>
                    <div>
                        <h2 style="margin:0; font-size:20px;">${escapeHtml(result.definition.title)}</h2>
                        <p style="margin:2px 0 0; font-size:12px; color:var(--text-muted);">${escapeHtml(result.definition.methodology)} · generado ${new Date(result.generatedAt).toLocaleString()}</p>
                    </div>
                    <div style="margin-left:auto; display:flex; gap:6px;">
                        ${regenerable ? `<button data-action="regenerate" data-id="${escapeHtml(result.analysisId)}" style="padding: 6px 12px; border-radius:6px; background: transparent; border: 1px solid var(--glass-border, rgba(255,255,255,0.1)); color: var(--text-muted); cursor:pointer;">↻ Regenerar</button>` : ''}
                        <button data-action="remove" data-id="${escapeHtml(result.analysisId)}" style="padding: 6px 10px; border-radius:6px; background: transparent; border: 1px solid #ef444455; color: #fca5a5; cursor:pointer;" title="Eliminar este análisis">✕</button>
                    </div>
                </div>
                ${body}
            </div>
        `;
    }

    /**
     * Render every cached analysis for this project into the stack,
     * most recent first.
     */
    function renderStack(projectId, ctx) {
        const stack = document.getElementById('analyses-stack');
        if (!stack) return;
        const cache = readCache();
        const prefix = `${projectId || 'default'}::`;
        const entries = Object.entries(cache)
            .filter(([k]) => k.startsWith(prefix))
            .map(([, v]) => v)
            .sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));

        if (entries.length === 0) {
            stack.innerHTML = `<p style="color:var(--text-muted); padding: var(--space-4); text-align:center; border:1px dashed var(--glass-border, rgba(255,255,255,0.08)); border-radius:10px;">
                Aquí se acumularán los análisis que generes.
            </p>`;
        } else {
            stack.innerHTML = entries.map(r => buildResultHTML(r)).join('');
        }
        bindStackActions(projectId, ctx);
    }

    function bindStackActions(projectId, ctx) {
        const stack = document.getElementById('analyses-stack');
        if (!stack) return;
        stack.querySelectorAll('[data-action="regenerate"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                runAnalysis(id, { ...ctx, projectId, forceRegenerate: true });
            });
        });
        stack.querySelectorAll('[data-action="remove"]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                const cache = readCache();
                delete cache[cacheKey(projectId, id)];
                writeCache(cache);
                renderStack(projectId, ctx);
                if (ctx && ctx.onChange) ctx.onChange();
            });
        });
    }

    // ---------- Controller ----------
    async function runAnalysis(analysisId, ctx) {
        const { projectInfo, transcription, environment, projectId, forceRegenerate = false, onChange } = ctx;
        const cache = readCache();
        const key = cacheKey(projectId, analysisId);
        if (!forceRegenerate && cache[key]) {
            // Already cached — make sure stack reflects it, scroll to it
            renderStack(projectId, ctx);
            scrollToAnalysis(analysisId);
            clearOutput();
            return cache[key];
        }
        const def = window.GunterAnalyses.definitions[analysisId];
        renderLoading(def.title);
        try {
            const result = await window.GunterAnalyses.generate(analysisId, { projectInfo, transcription, environment });
            const cache2 = readCache();
            cache2[key] = result;
            writeCache(cache2);
            clearOutput();
            renderStack(projectId, ctx);
            scrollToAnalysis(analysisId);
            if (onChange) onChange();
            return result;
        } catch (err) {
            renderError(err);
            throw err;
        }
    }

    function scrollToAnalysis(analysisId) {
        setTimeout(() => {
            const card = document.querySelector(`.analysis-result-card[data-analysis-id="${analysisId}"]`);
            if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 50);
    }

    function getCachedIds(projectId) {
        const cache = readCache();
        const prefix = `${projectId || 'default'}::`;
        return new Set(Object.keys(cache).filter(k => k.startsWith(prefix)).map(k => k.slice(prefix.length)));
    }

    function clearCacheFor(projectId) {
        const cache = readCache();
        const prefix = `${projectId || 'default'}::`;
        Object.keys(cache).filter(k => k.startsWith(prefix)).forEach(k => delete cache[k]);
        writeCache(cache);
    }

    function getCompletedAnalyses(projectId) {
        const cache = readCache();
        const prefix = `${projectId || 'default'}::`;
        return Object.entries(cache)
            .filter(([k]) => k.startsWith(prefix))
            .map(([, v]) => v)
            .sort((a, b) => new Date(a.generatedAt) - new Date(b.generatedAt));
    }

    window.GunterAnalysesRenderer = {
        renderCards,
        renderStack,
        runAnalysis,
        getCachedIds,
        getCompletedAnalyses,
        clearCacheFor
    };
})();
