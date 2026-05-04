/* =============================================
   GUNTER CONTROLLER - Decisions Center Panel (Sprint D)
   -------------------------------------------------
   Lista, búsqueda y registro manual de decisiones.
   Subflags:
     - decisionCenterAutoDetect : detector LLM en
       formularios "guardar decisión"
     - decisionCenterTimeline   : agrupar por fecha
     - decisionCenterSearch     : input de búsqueda
   ============================================= */

(function () {
    let host = null;
    let allDecisions = [];
    let filterText = '';
    let filterProject = '';
    let projectsList = [];

    function flagOn() { return !!(window.PremiumFeaturesService?.isEnabled?.('decisionCenter')); }
    function subOn(k)  { return !!(window.PremiumFeaturesService?.isEnabled?.(k)); }

    async function mount(selector) {
        host = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!host) return;
        host.classList.add('gpi-panel');
        renderShell();
        await loadProjects();
        await refresh();
        window.addEventListener('gunterPremiumFeaturesChange', (e) => {
            if (!host) return;
            const k = e.detail?.key;
            if (!k || k === 'decisionCenter' || (k && k.startsWith('decisionCenter'))) {
                renderShell();
                refresh().catch(() => {});
            }
        });
    }

    function renderShell() {
        if (!host) return;
        host.innerHTML = `
            <div class="gpi-card gpi-decisions">
                <header class="gpi-card__head">
                    <div>
                        <h3>🧭 Centro de decisiones</h3>
                        <p class="gpi-card__hint">Decisiones tomadas en reuniones o conversaciones, organizadas por proyecto.</p>
                    </div>
                    <div class="gpi-card__actions">
                        <button id="gpi-dec-add" class="gpi-btn">+ Guardar decisión</button>
                        <button id="gpi-dec-refresh" class="gpi-btn gpi-btn--ghost">Refrescar</button>
                    </div>
                </header>
                <div class="gpi-dec-filters">
                    <select id="gpi-dec-project" class="gpi-select">
                        <option value="">Todos los proyectos</option>
                    </select>
                    ${subOn('decisionCenterSearch') ? `
                        <input id="gpi-dec-search" class="gpi-input" type="search" placeholder="Buscar en decisiones…" value="${esc(filterText)}">
                    ` : ''}
                </div>
                <div id="gpi-dec-add-form" class="gpi-dec-form" hidden></div>
                <div id="gpi-dec-body"></div>
            </div>
        `;
        host.querySelector('#gpi-dec-add').addEventListener('click', toggleAddForm);
        host.querySelector('#gpi-dec-refresh').addEventListener('click', () => refresh());
        host.querySelector('#gpi-dec-project').addEventListener('change', (e) => {
            filterProject = e.target.value;
            renderList();
        });
        const search = host.querySelector('#gpi-dec-search');
        if (search) {
            search.addEventListener('input', (e) => {
                filterText = e.target.value.trim();
                renderList();
            });
        }
    }

    async function loadProjects() {
        try {
            const resp = await fetch('/api/knowledge/projects');
            const d = await resp.json();
            projectsList = d?.projects || [];
            const sel = host.querySelector('#gpi-dec-project');
            if (sel) {
                sel.innerHTML = '<option value="">Todos los proyectos</option>' +
                    projectsList.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
            }
        } catch { /* ignore */ }
    }

    async function refresh() {
        if (!host) return;
        if (!flagOn()) { renderDisabled(); return; }
        renderLoading();
        try {
            const r = await window.GunterPremiumIntel.getDecisions({});
            allDecisions = r.success ? (r.data?.decisions || []) : [];
            renderList();
        } catch (e) {
            renderError(e.message || String(e));
        }
    }

    function $body() { return host?.querySelector('#gpi-dec-body'); }

    function renderDisabled() {
        $body().innerHTML = `<div class="gpi-empty"><p>El <strong>Centro de decisiones</strong> está desactivado.</p><p>Actívalo en <em>Configuración → Premium → Centro de decisiones</em>.</p></div>`;
    }
    function renderLoading() { $body().innerHTML = `<div class="gpi-loading"><div class="gpi-spinner"></div><span>Buscando decisiones guardadas en tus proyectos…</span></div>`; }
    function renderError(m) { $body().innerHTML = `<div class="gpi-error">⚠ ${esc(m)}</div>`; }

    function renderList() {
        const filtered = allDecisions.filter(d => {
            if (filterProject && d.projectId !== filterProject) return false;
            if (filterText) {
                const needle = filterText.toLowerCase();
                if (!d.text.toLowerCase().includes(needle) && !(d.projectName || '').toLowerCase().includes(needle)) return false;
            }
            return true;
        });

        if (filtered.length === 0) {
            $body().innerHTML = `
                <div class="gpi-empty">
                    <div class="gpi-empty__icon">🧭</div>
                    <h4>Aún no hay decisiones registradas</h4>
                    <p>Gunter detecta decisiones automáticamente en reuniones, o puedes guardarlas tú con <strong>"+ Guardar decisión"</strong>.</p>
                    <p class="gpi-empty__hint">También puedes decirle a Gunter desde voz o WhatsApp: <em>"guarda esta decisión: vamos a cobrar 7.500.000"</em>.</p>
                </div>`;
            return;
        }

        const useTimeline = subOn('decisionCenterTimeline');
        if (useTimeline) {
            const grouped = groupByDate(filtered);
            $body().innerHTML = Object.entries(grouped).map(([day, items]) => `
                <section class="gpi-dec-day">
                    <h4 class="gpi-dec-day__head">${esc(day)}</h4>
                    <ul class="gpi-dec-list">${items.map(renderItem).join('')}</ul>
                </section>
            `).join('');
        } else {
            $body().innerHTML = `<ul class="gpi-dec-list">${filtered.map(renderItem).join('')}</ul>`;
        }
    }

    function renderItem(d) {
        return `
            <li class="gpi-dec-item">
                <span class="gpi-dec-item__icon">🧭</span>
                <div class="gpi-dec-item__body">
                    <p class="gpi-dec-item__text">${esc(d.text)}</p>
                    <div class="gpi-dec-item__meta">
                        ${d.projectName ? `<span class="gpi-chip">${esc(d.projectName)}</span>` : ''}
                        ${d.at ? `<span class="gpi-dec-item__date">${formatDateShort(d.at)}</span>` : ''}
                        ${d.source ? `<span class="gpi-dec-item__source">${esc(d.source)}</span>` : ''}
                    </div>
                </div>
            </li>`;
    }

    function groupByDate(items) {
        const out = {};
        for (const it of items) {
            const day = it.at ? formatDateLong(it.at) : 'Sin fecha';
            if (!out[day]) out[day] = [];
            out[day].push(it);
        }
        return out;
    }

    function toggleAddForm() {
        const form = host.querySelector('#gpi-dec-add-form');
        if (!form) return;
        if (form.hasAttribute('hidden')) {
            form.removeAttribute('hidden');
            form.innerHTML = `
                <h4>Nueva decisión</h4>
                <textarea id="gpi-dec-text" class="gpi-textarea" placeholder="Ej: Acordamos cobrar 7.500.000 por el paquete completo."></textarea>
                <div class="gpi-dec-form__row">
                    <select id="gpi-dec-project-new" class="gpi-select">
                        <option value="">Sin proyecto</option>
                        ${projectsList.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}
                    </select>
                    <select id="gpi-dec-impact" class="gpi-select">
                        <option value="medium">Impacto medio</option>
                        <option value="low">Impacto bajo</option>
                        <option value="high">Impacto alto</option>
                    </select>
                </div>
                <div class="gpi-dec-form__actions">
                    <button id="gpi-dec-detect" class="gpi-btn gpi-btn--ghost">🔍 Detectar (IA)</button>
                    <button id="gpi-dec-cancel" class="gpi-btn gpi-btn--ghost">Cancelar</button>
                    <button id="gpi-dec-save" class="gpi-btn">Guardar decisión</button>
                </div>
                <div id="gpi-dec-form-msg" class="gpi-dec-form__msg"></div>
            `;
            form.querySelector('#gpi-dec-cancel').addEventListener('click', toggleAddForm);
            form.querySelector('#gpi-dec-save').addEventListener('click', saveDecision);
            form.querySelector('#gpi-dec-detect').addEventListener('click', detectFromText);
        } else {
            form.setAttribute('hidden', '');
            form.innerHTML = '';
        }
    }

    async function detectFromText() {
        const text = host.querySelector('#gpi-dec-text')?.value.trim();
        const msg = host.querySelector('#gpi-dec-form-msg');
        if (!text) { msg.textContent = 'Pega o escribe el texto para analizar.'; return; }
        if (!subOn('decisionCenterAutoDetect')) {
            msg.innerHTML = '<span class="gpi-dec-form__warn">Activa la subopción <em>Detectar decisiones automáticamente</em> en Premium.</span>';
            return;
        }
        msg.textContent = 'Analizando con IA…';
        try {
            const r = await window.GunterPremiumIntel.detectDecisionsFromText(text);
            if (!r.success || !r.data?.decisions?.length) {
                msg.textContent = 'No detecté decisiones explícitas en el texto.';
                return;
            }
            const list = r.data.decisions.map((d, i) => `${i + 1}. ${d.decision}${d.responsible ? ' (' + d.responsible + ')' : ''}`).join('\n');
            host.querySelector('#gpi-dec-text').value = list;
            msg.innerHTML = `<span class="gpi-dec-form__ok">✓ Encontré ${r.data.decisions.length} decisión${r.data.decisions.length === 1 ? '' : 'es'}.</span>`;
        } catch (e) {
            msg.textContent = '⚠ ' + (e.message || 'No pude analizar el texto.');
        }
    }

    async function saveDecision() {
        const text = host.querySelector('#gpi-dec-text')?.value.trim();
        const projectId = host.querySelector('#gpi-dec-project-new')?.value || null;
        const msg = host.querySelector('#gpi-dec-form-msg');
        if (!text) { msg.textContent = 'Escribe la decisión.'; return; }

        // Persistencia: las decisiones manuales van como nota al proyecto vía gunterData,
        // o como entry en localStorage si no hay proyecto.
        try {
            if (projectId && window.gunterData?.data?.projects) {
                const proj = window.gunterData.data.projects.find(p => p.id === projectId);
                if (proj) {
                    proj.decisions = Array.isArray(proj.decisions) ? proj.decisions : [];
                    proj.decisions.push({
                        text: text.slice(0, 280),
                        source: 'manual',
                        at: new Date().toISOString()
                    });
                    proj.updatedAt = new Date().toISOString();
                    window.gunterData.save();
                    window.dispatchEvent(new CustomEvent('gunter-data-changed', { detail: { projectId } }));
                }
            } else {
                // Decisión global → localStorage
                const key = 'gunter_manual_decisions';
                const list = JSON.parse(localStorage.getItem(key) || '[]');
                list.push({ text: text.slice(0, 280), source: 'manual', at: new Date().toISOString() });
                localStorage.setItem(key, JSON.stringify(list.slice(-100)));
            }
            msg.innerHTML = '<span class="gpi-dec-form__ok">✓ Decisión guardada.</span>';
            setTimeout(() => { toggleAddForm(); refresh(); }, 800);
        } catch (e) {
            msg.textContent = '⚠ ' + (e.message || 'No pude guardar.');
        }
    }

    function formatDateShort(iso) {
        try { return new Date(iso).toLocaleDateString('es-MX', { day:'numeric', month:'short' }); } catch { return iso || '—'; }
    }
    function formatDateLong(iso) {
        try { return new Date(iso).toLocaleDateString('es-MX', { weekday:'long', day:'numeric', month:'long' }); } catch { return iso || 'Sin fecha'; }
    }
    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    window.GunterDecisionsPanel = { mount, refresh };
})();
