/* =============================================
   GUNTER CONTROLLER - Meeting Follow-up Card (Sprint E)
   -------------------------------------------------
   Card que se monta en results.html después de
   terminar una reunión / generar análisis.
   Subflags:
     - meetingSmartFollowUpTasks     : sugerir tareas
     - meetingSmartFollowUpDecisions : guardar decisiones
     - meetingSmartFollowUpWhatsapp  : enviar resumen WA
   No ejecuta nada sin confirmación del usuario.
   ============================================= */

(function () {
    let host = null;
    let lastResult = null;
    let projectId = null;

    function flagOn() { return !!(window.PremiumFeaturesService?.isEnabled?.('meetingSmartFollowUp')); }
    function subOn(k)  { return !!(window.PremiumFeaturesService?.isEnabled?.(k)); }

    async function mount(selector, opts = {}) {
        host = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!host) return;
        host.classList.add('gpi-panel');
        projectId = opts.projectId || localStorage.getItem('gunter_project_id') || null;
        renderShell();
        await refresh();
        window.addEventListener('gunterPremiumFeaturesChange', (e) => {
            if (!host) return;
            const k = e.detail?.key;
            if (!k || k === 'meetingSmartFollowUp' || (k && k.startsWith('meetingSmartFollowUp'))) {
                renderShell();
                refresh().catch(() => {});
            }
        });
    }

    function renderShell() {
        if (!host) return;
        host.innerHTML = `
            <div class="gpi-card gpi-followup">
                <header class="gpi-card__head">
                    <div>
                        <h3>✅ Follow-up inteligente</h3>
                        <p class="gpi-card__hint">Tareas, decisiones y próximos pasos detectados en esta reunión.</p>
                    </div>
                    <div class="gpi-card__actions">
                        <button id="gpi-fu-refresh" class="gpi-btn">Refrescar</button>
                    </div>
                </header>
                <div id="gpi-fu-body"></div>
            </div>
        `;
        host.querySelector('#gpi-fu-refresh').addEventListener('click', () => refresh());
    }

    async function refresh() {
        if (!host) return;
        if (!flagOn()) { renderDisabled(); return; }
        if (!projectId) { renderEmpty('No detecto un proyecto activo en esta página.'); return; }
        renderLoading();
        try {
            const r = await window.GunterPremiumIntel.getMeetingFollowUp(projectId);
            lastResult = r;
            renderResult(r);
        } catch (e) {
            renderError(e.message || String(e));
        }
    }

    function $body() { return host?.querySelector('#gpi-fu-body'); }

    function renderDisabled() {
        $body().innerHTML = `<div class="gpi-empty"><p>El <strong>Follow-up inteligente</strong> está desactivado.</p><p>Actívalo en <em>Configuración → Premium → Follow-up inteligente</em>.</p></div>`;
    }
    function renderEmpty(m) { $body().innerHTML = `<div class="gpi-empty"><p>${esc(m)}</p></div>`; }
    function renderLoading() { $body().innerHTML = `<div class="gpi-loading"><div class="gpi-spinner"></div><span>Detectando tareas, decisiones y próximos pasos en la reunión…</span></div>`; }
    function renderError(m) { $body().innerHTML = `<div class="gpi-error">⚠ ${esc(m)}</div>`; }

    function renderResult(r) {
        if (!r.success) { $body().innerHTML = `<div class="gpi-empty"><p>${esc(r.naturalResponse || 'Sin datos.')}</p></div>`; return; }
        const d = r.data;
        const showTasks     = subOn('meetingSmartFollowUpTasks');
        const showDecisions = subOn('meetingSmartFollowUpDecisions');
        const showWhatsapp  = subOn('meetingSmartFollowUpWhatsapp');

        $body().innerHTML = `
            <div class="gpi-summary">
                <div class="gpi-summary__icon">✅</div>
                <div>
                    <p class="gpi-summary__text">${esc(r.naturalResponse || r.summary)}</p>
                    ${d.meetingAt ? `<p class="gpi-summary__rec">📅 ${formatDateLong(d.meetingAt)}</p>` : ''}
                </div>
            </div>

            ${showTasks ? renderTasksSection(d.tasks || []) : ''}
            ${showDecisions ? renderDecisionsSection(d.decisions || []) : ''}
            ${renderListSection('❓ Preguntas abiertas', d.questions || [])}
            ${renderListSection('🚨 Riesgos detectados', d.risks || [])}
            ${renderListSection('👉 Próximos pasos', d.nextSteps || [])}

            ${showWhatsapp ? `
                <div class="gpi-fu-actions">
                    <button id="gpi-fu-copy" class="gpi-btn gpi-btn--ghost">📋 Copiar resumen</button>
                    <button id="gpi-fu-wa" class="gpi-btn">💬 Preparar mensaje WhatsApp</button>
                </div>
                <div id="gpi-fu-wa-out" class="gpi-fu-wa-out" hidden></div>` : `
                <div class="gpi-fu-actions">
                    <button id="gpi-fu-copy" class="gpi-btn gpi-btn--ghost">📋 Copiar resumen</button>
                </div>`}
        `;

        host.querySelector('#gpi-fu-copy')?.addEventListener('click', copySummary);
        host.querySelector('#gpi-fu-wa')?.addEventListener('click', prepareWhatsappMessage);
        bindTaskCreate(d.tasks || []);
        bindDecisionSave(d.decisions || []);
    }

    function renderTasksSection(tasks) {
        if (!tasks.length) return '';
        return `
            <section class="gpi-section">
                <h4>📝 Tareas detectadas</h4>
                <ul class="gpi-list">
                    ${tasks.map((t, i) => `
                        <li class="gpi-fu-task" data-task-idx="${i}">
                            <div class="gpi-fu-task__body">
                                <strong>${esc(t.title || t.text || '')}</strong>
                                <div class="gpi-fu-task__meta">
                                    ${t.responsible ? `<span class="gpi-chip">${esc(t.responsible)}</span>` : ''}
                                    ${t.when ? `<span class="gpi-chip gpi-chip--mini">${esc(t.when)}</span>` : ''}
                                </div>
                            </div>
                            <button class="gpi-btn gpi-btn--small gpi-fu-task__create" data-create-task="${i}">+ Crear tarea</button>
                        </li>
                    `).join('')}
                </ul>
            </section>`;
    }

    function renderDecisionsSection(decs) {
        if (!decs.length) return '';
        return `
            <section class="gpi-section">
                <h4>🧭 Decisiones</h4>
                <ul class="gpi-list">
                    ${decs.map((d, i) => `
                        <li class="gpi-fu-task" data-dec-idx="${i}">
                            <div class="gpi-fu-task__body">
                                <strong>${esc(d.text || d.decision || '')}</strong>
                                ${d.responsible ? `<div class="gpi-fu-task__meta"><span class="gpi-chip">${esc(d.responsible)}</span></div>` : ''}
                            </div>
                            <button class="gpi-btn gpi-btn--small gpi-fu-task__create" data-save-decision="${i}">+ Guardar</button>
                        </li>
                    `).join('')}
                </ul>
            </section>`;
    }

    function renderListSection(title, items) {
        if (!items?.length) return '';
        return `
            <section class="gpi-section">
                <h4>${title}</h4>
                <ul class="gpi-list-bare">
                    ${items.map(t => `<li>${esc(typeof t === 'string' ? t : (t.text || ''))}</li>`).join('')}
                </ul>
            </section>`;
    }

    function bindTaskCreate(tasks) {
        host.querySelectorAll('[data-create-task]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const i = +btn.dataset.createTask;
                const t = tasks[i];
                if (!t || !window.GunterTasksService?.create) return;
                btn.disabled = true; btn.textContent = '…';
                try {
                    await window.GunterTasksService.create({
                        title: t.title || t.text,
                        priority: 'normal',
                        projectId: projectId,
                        tags: ['from-meeting', `project:${projectId}`],
                        source: 'meeting-followup',
                        notes: t.responsible ? `Responsable: ${t.responsible}` : ''
                    });
                    btn.textContent = '✓ Creada';
                    toast('Tarea creada en Gunter Día.', 'success');
                } catch (e) {
                    btn.disabled = false; btn.textContent = '+ Crear tarea';
                    toast('No pude crear la tarea: ' + (e.message || ''), 'error');
                }
            });
        });
    }

    function bindDecisionSave(decisions) {
        host.querySelectorAll('[data-save-decision]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const i = +btn.dataset.saveDecision;
                const d = decisions[i];
                if (!d || !window.gunterData?.data?.projects) return;
                btn.disabled = true; btn.textContent = '…';
                try {
                    const proj = window.gunterData.data.projects.find(p => p.id === projectId);
                    if (!proj) throw new Error('Proyecto no encontrado.');
                    proj.decisions = Array.isArray(proj.decisions) ? proj.decisions : [];
                    proj.decisions.push({
                        text: (d.text || d.decision || '').slice(0, 280),
                        source: 'meeting-followup',
                        at: new Date().toISOString()
                    });
                    proj.updatedAt = new Date().toISOString();
                    window.gunterData.save();
                    window.dispatchEvent(new CustomEvent('gunter-data-changed', { detail: { projectId } }));
                    btn.textContent = '✓ Guardada';
                    toast('Decisión guardada en el proyecto.', 'success');
                } catch (e) {
                    btn.disabled = false; btn.textContent = '+ Guardar';
                    toast('No pude guardar: ' + (e.message || ''), 'error');
                }
            });
        });
    }

    async function copySummary() {
        if (!lastResult) return;
        const d = lastResult.data;
        const lines = [`📋 *Follow-up reunión*`];
        if (d.tasks?.length) {
            lines.push(`\n*Tareas:*`);
            d.tasks.forEach(t => lines.push(`• ${t.title || t.text}${t.responsible ? ' ('+t.responsible+')' : ''}`));
        }
        if (d.decisions?.length) {
            lines.push(`\n*Decisiones:*`);
            d.decisions.forEach(x => lines.push(`• ${x.text || x.decision}`));
        }
        if (d.nextSteps?.length) {
            lines.push(`\n*Próximos pasos:*`);
            d.nextSteps.forEach(s => lines.push(`• ${s}`));
        }
        try {
            await navigator.clipboard.writeText(lines.join('\n'));
            toast('Resumen copiado al portapapeles.', 'success');
        } catch {
            toast('No pude acceder al portapapeles.', 'error');
        }
    }

    async function prepareWhatsappMessage() {
        if (!lastResult) return;
        const out = host.querySelector('#gpi-fu-wa-out');
        const d = lastResult.data;
        const text = [
            `📋 *Follow-up de la reunión*`,
            d.tasks?.length ? `\n*Tareas:*\n${d.tasks.map(t => `• ${t.title || t.text}${t.responsible ? ' ('+t.responsible+')' : ''}`).join('\n')}` : '',
            d.decisions?.length ? `\n*Decisiones:*\n${d.decisions.map(x => `• ${x.text || x.decision}`).join('\n')}` : '',
            d.nextSteps?.length ? `\n*Próximos pasos:*\n${d.nextSteps.map(s => `• ${s}`).join('\n')}` : ''
        ].filter(Boolean).join('\n');

        out.removeAttribute('hidden');
        out.innerHTML = `
            <h4>Mensaje listo para revisar</h4>
            <textarea class="gpi-textarea" id="gpi-fu-wa-text">${esc(text)}</textarea>
            <p class="gpi-fu-hint">Copia este texto o pégalo en una conversación de WhatsApp. Gunter NO lo envía solo.</p>
            <button class="gpi-btn" id="gpi-fu-wa-copy">📋 Copiar</button>
        `;
        out.querySelector('#gpi-fu-wa-copy').addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(out.querySelector('#gpi-fu-wa-text').value);
                toast('Mensaje copiado.', 'success');
            } catch { toast('No pude acceder al portapapeles.', 'error'); }
        });
    }

    function toast(msg, variant) {
        if (window.GunterNotificationsService?.showToast) {
            window.GunterNotificationsService.showToast(msg, { variant: variant === 'error' ? 'error' : 'success', duration: 2800, silent: true });
        }
    }
    function formatDateLong(iso) {
        try { return new Date(iso).toLocaleString('es-MX', { weekday:'long', day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }); } catch { return iso; }
    }
    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    window.GunterMeetingFollowupCard = { mount, refresh };
})();
