/* =============================================
   GUNTER CONTROLLER - Delegation Panel (Sprint E)
   -------------------------------------------------
   Genera mensajes de delegación con 5 tonos.
   Acciones: copiar, enviar por WA (preview),
   crear recordatorio de seguimiento.
   ============================================= */

(function () {
    let host = null;
    let lastDraft = null;
    let projectsList = [];

    const TONES = [
        { id: 'cordial',         label: 'Cordial', icon: '☕' },
        { id: 'formal',          label: 'Formal',  icon: '🎩' },
        { id: 'direct',          label: 'Directo', icon: '⚡' },
        { id: 'urgent',          label: 'Urgente', icon: '🔥' },
        { id: 'whatsapp_short',  label: 'WA corto', icon: '💬' }
    ];

    function flagOn() { return !!(window.PremiumFeaturesService?.isEnabled?.('delegationMode')); }
    function subOn(k)  { return !!(window.PremiumFeaturesService?.isEnabled?.(k)); }

    async function mount(selector) {
        host = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!host) return;
        host.classList.add('gpi-panel');
        await loadProjects();
        renderShell();
        window.addEventListener('gunterPremiumFeaturesChange', (e) => {
            if (!host) return;
            const k = e.detail?.key;
            if (!k || k === 'delegationMode' || (k && k.startsWith('delegationMode'))) {
                renderShell();
            }
        });
    }

    async function loadProjects() {
        try {
            const r = await fetch('/api/knowledge/projects');
            const d = await r.json();
            projectsList = d?.projects || [];
        } catch { projectsList = []; }
    }

    function renderShell() {
        if (!host) return;
        if (!flagOn()) {
            host.innerHTML = `
                <div class="gpi-card gpi-delegation">
                    <header class="gpi-card__head">
                        <div>
                            <h3>🤝 Modo delegación</h3>
                            <p class="gpi-card__hint">Convierte instrucciones en mensajes listos para delegar.</p>
                        </div>
                    </header>
                    <div class="gpi-empty"><p>Esta función está desactivada.</p><p>Actívala en <em>Configuración → Premium → Modo delegación</em>.</p></div>
                </div>`;
            return;
        }

        host.innerHTML = `
            <div class="gpi-card gpi-delegation">
                <header class="gpi-card__head">
                    <div>
                        <h3>🤝 Modo delegación</h3>
                        <p class="gpi-card__hint">Convierte instrucciones en mensajes listos para delegar.</p>
                    </div>
                </header>

                <div class="gpi-deleg-form">
                    <label class="gpi-deleg-label">Qué quieres delegar</label>
                    <textarea id="gpi-deleg-instruction" class="gpi-textarea"
                        placeholder="Ej: revisar la propuesta final antes del viernes y confirmar ajustes."></textarea>

                    <div class="gpi-deleg-row">
                        <div>
                            <label class="gpi-deleg-label">Destinatario</label>
                            <input id="gpi-deleg-recipient" class="gpi-input" type="text" placeholder="Ej: Fabián">
                        </div>
                        <div>
                            <label class="gpi-deleg-label">Proyecto (opcional)</label>
                            <select id="gpi-deleg-project" class="gpi-select">
                                <option value="">— Sin proyecto —</option>
                                ${projectsList.map(p => `<option value="${esc(p.id)}" data-name="${esc(p.name)}">${esc(p.name)}</option>`).join('')}
                            </select>
                        </div>
                        <div>
                            <label class="gpi-deleg-label">Fecha límite (opcional)</label>
                            <input id="gpi-deleg-due" class="gpi-input" type="date">
                        </div>
                    </div>

                    <label class="gpi-deleg-label">Tono</label>
                    <div class="gpi-deleg-tones" role="tablist">
                        ${TONES.map(t => `
                            <button class="gpi-deleg-tone ${t.id === 'cordial' ? 'is-active' : ''}" data-tone="${t.id}">
                                <span class="gpi-deleg-tone__icon">${t.icon}</span>
                                <span>${t.label}</span>
                            </button>
                        `).join('')}
                    </div>

                    <div class="gpi-deleg-actions">
                        <button id="gpi-deleg-generate" class="gpi-btn">✨ Generar mensaje</button>
                    </div>
                </div>

                <div id="gpi-deleg-output" class="gpi-deleg-output" hidden></div>
            </div>
        `;

        host.querySelectorAll('.gpi-deleg-tone').forEach(b => {
            b.addEventListener('click', () => {
                host.querySelectorAll('.gpi-deleg-tone').forEach(x => x.classList.remove('is-active'));
                b.classList.add('is-active');
            });
        });
        host.querySelector('#gpi-deleg-generate').addEventListener('click', generate);
    }

    async function generate() {
        const instruction = host.querySelector('#gpi-deleg-instruction').value.trim();
        const recipient   = host.querySelector('#gpi-deleg-recipient').value.trim() || null;
        const projectSel  = host.querySelector('#gpi-deleg-project');
        const projectMatch = projectSel.selectedOptions[0]?.dataset?.name || null;
        const dueAt       = host.querySelector('#gpi-deleg-due').value || null;
        const tone        = host.querySelector('.gpi-deleg-tone.is-active')?.dataset.tone || 'cordial';

        if (!instruction) {
            toast('Escribe qué quieres delegar.', 'warn');
            return;
        }

        const out = host.querySelector('#gpi-deleg-output');
        out.removeAttribute('hidden');
        out.innerHTML = `<div class="gpi-loading"><div class="gpi-spinner"></div><span>Redactando mensaje con el tono que elegiste…</span></div>`;

        try {
            const r = await window.GunterPremiumIntel.createDelegationDraft({
                instruction, recipient, tone, projectMatch, dueAt
            });
            if (!r.success) {
                out.innerHTML = `<div class="gpi-error">⚠ ${esc(r.naturalResponse || 'No pude redactar.')}</div>`;
                return;
            }
            lastDraft = r.data;
            renderDraft(r.data);
        } catch (e) {
            out.innerHTML = `<div class="gpi-error">⚠ ${esc(e.message || 'Error.')}</div>`;
        }
    }

    function renderDraft(d) {
        const out = host.querySelector('#gpi-deleg-output');
        const showCopy = subOn('delegationModeMessageDrafts') || subOn('delegationModeWhatsappDrafts');
        const showFollow = subOn('delegationModeFollowUp');

        out.innerHTML = `
            <div class="gpi-deleg-result">
                <div class="gpi-deleg-result__head">
                    <h4>Borrador (${esc(d.toneLabel)})</h4>
                    ${d.project ? `<span class="gpi-chip">${esc(d.project.name)}</span>` : ''}
                </div>
                <textarea class="gpi-textarea gpi-deleg-result__draft" id="gpi-deleg-draft">${esc(d.draft)}</textarea>

                ${(d.alternatives || []).length ? `
                    <details class="gpi-deleg-alts">
                        <summary>Ver ${d.alternatives.length} alternativa${d.alternatives.length === 1 ? '' : 's'}</summary>
                        ${d.alternatives.map((a, i) => `
                            <div class="gpi-deleg-alt">
                                <p>${esc(a)}</p>
                                <button class="gpi-btn gpi-btn--small" data-use-alt="${i}">Usar esta</button>
                            </div>
                        `).join('')}
                    </details>` : ''}

                <div class="gpi-deleg-actions">
                    ${showCopy ? `<button id="gpi-deleg-copy" class="gpi-btn">📋 Copiar mensaje</button>` : ''}
                    ${showFollow ? `<button id="gpi-deleg-followup" class="gpi-btn gpi-btn--ghost">⏰ Crear recordatorio de seguimiento</button>` : ''}
                    ${window.GunterStyleMirror?.flagOn?.() ? `<button id="gpi-deleg-mirror" class="gpi-btn gpi-btn--ghost" title="Reescribir el borrador imitando tu estilo personal con este destinatario (F5 — Modo espejo)">🪞 En mi estilo</button>` : ''}
                </div>
                <p class="gpi-deleg-hint" id="gpi-deleg-mirror-hint" style="display:none;font-size:11px;color:var(--text-muted);margin-top:4px;"></p>
            </div>
        `;

        out.querySelectorAll('[data-use-alt]').forEach(b => {
            b.addEventListener('click', () => {
                const i = +b.dataset.useAlt;
                out.querySelector('#gpi-deleg-draft').value = d.alternatives[i];
            });
        });
        out.querySelector('#gpi-deleg-copy')?.addEventListener('click', copyDraft);
        out.querySelector('#gpi-deleg-followup')?.addEventListener('click', createFollowupReminder);
        out.querySelector('#gpi-deleg-mirror')?.addEventListener('click', () => rewriteInMyStyle(d));
    }

    /**
     * v2 (F5) — Reescribe el borrador actual en el estilo del usuario para el destinatario.
     * Usa contactKey = 'name:<recipient>' como heurística básica.
     */
    async function rewriteInMyStyle(d) {
        const btn = host.querySelector('#gpi-deleg-mirror');
        const hint = host.querySelector('#gpi-deleg-mirror-hint');
        const draftEl = host.querySelector('#gpi-deleg-draft');
        if (!btn || !draftEl) return;
        const recipient = (d.recipient || host.querySelector('#gpi-deleg-recipient')?.value || '').trim();
        if (!recipient) { toast('Falta destinatario para aplicar tu estilo.', 'warn'); return; }
        const contactKey = 'name:' + recipient.toLowerCase().replace(/\s+/g, '_');
        const intent = draftEl.value.trim();
        if (!intent) { toast('No hay borrador para reescribir.', 'warn'); return; }

        btn.disabled = true; btn.textContent = '🪞 Reescribiendo…';
        hint.style.display = 'none'; hint.textContent = '';
        try {
            const r = await window.GunterStyleMirror.redact({ contactKey, intent, context: d.project?.name ? 'Proyecto: ' + d.project.name : '' });
            if (r?.text) {
                draftEl.value = r.text;
                hint.style.display = '';
                if (r.fallback) {
                    hint.textContent = '⚠ Sin perfil de estilo aprendido para este contacto. Usé reescritura genérica. Construye un perfil desde tus mensajes pasados (F5) para mejorar.';
                } else {
                    hint.textContent = `🪞 Reescrito con tu estilo (${r.style}).`;
                }
            } else {
                toast('No se pudo reescribir.', 'error');
            }
        } catch (e) {
            toast('Error: ' + e.message, 'error');
        } finally {
            btn.disabled = false; btn.textContent = '🪞 En mi estilo';
        }
    }

    async function copyDraft() {
        const text = host.querySelector('#gpi-deleg-draft').value;
        try {
            await navigator.clipboard.writeText(text);
            toast('Mensaje copiado.', 'success');
        } catch { toast('No pude acceder al portapapeles.', 'error'); }
    }

    async function createFollowupReminder() {
        if (!window.GunterNotificationsService?.schedule) {
            toast('Notificaciones no disponibles.', 'error');
            return;
        }
        const recipient = lastDraft?.recipient || 'la persona';
        const project = lastDraft?.project?.name ? ` (${lastDraft.project.name})` : '';
        // Programar a 2 días vista por defecto
        const fireAt = new Date(Date.now() + 2 * 86400000).toISOString();
        try {
            await window.GunterNotificationsService.schedule({
                title: `Seguimiento: ¿${recipient} avanzó con la delegación?${project}`,
                fireAt,
                priority: 'normal',
                meta: { source: 'delegation', recipient, projectId: lastDraft?.project?.id || null }
            });
            toast('Recordatorio programado en 2 días.', 'success');
        } catch (e) {
            toast('No pude programar: ' + (e.message || ''), 'error');
        }
    }

    function toast(msg, variant) {
        if (window.GunterNotificationsService?.showToast) {
            window.GunterNotificationsService.showToast(msg, {
                variant: variant === 'error' ? 'error' : variant === 'warn' ? 'warn' : 'success',
                duration: 2800, silent: true
            });
        }
    }
    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    window.GunterDelegationPanel = { mount };
})();
