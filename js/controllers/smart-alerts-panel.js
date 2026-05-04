/* =============================================
   GUNTER CONTROLLER - Smart WhatsApp Alerts (Sprint F)
   -------------------------------------------------
   Genera previews de alertas. NUNCA envía sin
   confirmación explícita.

   Subflags:
     - smartWhatsappAlertsMorning      (resumen del día)
     - smartWhatsappAlertsDuePayments  (pagos vencen)
     - smartWhatsappAlertsProjectRisk  (proyectos en riesgo)
   ============================================= */

(function () {
    let host = null;
    let waConnected = false;
    let myPhone = null;

    function flagOn() { return !!(window.PremiumFeaturesService?.isEnabled?.('smartWhatsappAlerts')); }
    function subOn(k)  { return !!(window.PremiumFeaturesService?.isEnabled?.(k)); }

    async function mount(selector) {
        host = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!host) return;
        host.classList.add('gpi-panel');
        renderShell();
        await checkWaStatus();
        await refresh();
        window.addEventListener('gunterPremiumFeaturesChange', (e) => {
            if (!host) return;
            const k = e.detail?.key;
            if (!k || k === 'smartWhatsappAlerts' || (k && k.startsWith('smartWhatsappAlerts'))) {
                renderShell();
                refresh().catch(() => {});
            }
        });
        window.addEventListener('whatsapp-status', () => checkWaStatus());
    }

    async function checkWaStatus() {
        try {
            const r = await fetch('/api/whatsapp/status');
            const d = await r.json();
            waConnected = d?.state === 'connected';
            myPhone = d?.myPhone || null;
            updateWaBadge();
        } catch { waConnected = false; }
    }

    function updateWaBadge() {
        const badge = host?.querySelector('#gpi-alerts-wa-badge');
        if (!badge) return;
        if (waConnected) {
            badge.className = 'gpi-chip';
            badge.textContent = `WhatsApp conectado${myPhone ? ' · ' + myPhone : ''}`;
        } else {
            badge.className = 'gpi-chip gpi-chip--warn';
            badge.textContent = 'WhatsApp NO conectado';
        }
    }

    function renderShell() {
        if (!host) return;
        host.innerHTML = `
            <div class="gpi-card gpi-alerts">
                <header class="gpi-card__head">
                    <div>
                        <h3>🔔 Alertas inteligentes por WhatsApp</h3>
                        <p class="gpi-card__hint">Previews con contexto. Tú decides qué enviar.</p>
                        <div style="margin-top:8px;"><span id="gpi-alerts-wa-badge" class="gpi-chip">…</span></div>
                    </div>
                    <div class="gpi-card__actions">
                        <button id="gpi-alerts-refresh" class="gpi-btn">Generar previews</button>
                    </div>
                </header>
                <div id="gpi-alerts-body"></div>
                <div id="gpi-alerts-recipient-modal"></div>
            </div>
        `;
        host.querySelector('#gpi-alerts-refresh').addEventListener('click', () => refresh(true));
    }

    async function refresh(force = false) {
        if (!host) return;
        if (!flagOn()) { renderDisabled(); return; }
        const types = [];
        if (subOn('smartWhatsappAlertsMorning'))     types.push('morning');
        if (subOn('smartWhatsappAlertsDuePayments')) types.push('payments');
        if (subOn('smartWhatsappAlertsProjectRisk')) types.push('risk');
        if (!types.length) {
            $body().innerHTML = `<div class="gpi-empty"><p>Activa al menos una sub-alerta:</p><p>resumen matutino, pagos próximos o proyectos en riesgo.</p></div>`;
            return;
        }
        renderLoading();
        try {
            const r = await window.GunterPremiumIntel.getSmartWhatsappAlerts({ types });
            renderResult(r);
        } catch (e) {
            renderError(e.message || String(e));
        }
    }

    function $body() { return host?.querySelector('#gpi-alerts-body'); }

    function renderDisabled() {
        $body().innerHTML = `<div class="gpi-empty"><p>Las <strong>Alertas inteligentes</strong> están desactivadas.</p><p>Actívalas en <em>Configuración → Premium → Alertas inteligentes por WhatsApp</em>.</p></div>`;
    }
    function renderLoading() { $body().innerHTML = `<div class="gpi-loading"><div class="gpi-spinner"></div><span>Preparando previews de alertas con tu contexto actual…</span></div>`; }
    function renderError(m) { $body().innerHTML = `<div class="gpi-error">⚠ ${esc(m)}</div>`; }

    function renderResult(r) {
        if (!r.success) { $body().innerHTML = `<div class="gpi-empty"><p>${esc(r.naturalResponse || 'Sin alertas.')}</p></div>`; return; }
        const alerts = r.data?.alerts || [];
        if (!alerts.length) {
            $body().innerHTML = `<div class="gpi-empty"><p>🎉 No detecté nada urgente para alertar ahora mismo.</p></div>`;
            return;
        }

        $body().innerHTML = `
            <div class="gpi-summary">
                <div class="gpi-summary__icon">🔔</div>
                <div><p class="gpi-summary__text">${esc(r.naturalResponse || r.summary)}</p></div>
            </div>

            <ul class="gpi-alerts-list">
                ${alerts.map((a, i) => `
                    <li class="gpi-alert gpi-alert--${esc(a.priority)}" data-alert-idx="${i}">
                        <header class="gpi-alert__head">
                            <h4>${esc(a.title)}</h4>
                            <span class="gpi-chip ${a.priority === 'high' ? 'gpi-chip--warn' : ''}">${esc(a.priority)}</span>
                        </header>
                        <pre class="gpi-alert__preview">${esc(a.preview)}</pre>
                        <div class="gpi-alert__actions">
                            <button class="gpi-btn gpi-btn--small" data-copy="${i}">📋 Copiar</button>
                            <button class="gpi-btn gpi-btn--small gpi-btn--send" data-send="${i}" ${waConnected ? '' : 'disabled'} title="${waConnected ? 'Enviar por WhatsApp' : 'WhatsApp no conectado'}">💬 Enviar por WhatsApp…</button>
                        </div>
                    </li>
                `).join('')}
            </ul>
        `;

        // Guardar referencia
        host.__alerts = alerts;
        host.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => copyAlert(+b.dataset.copy)));
        host.querySelectorAll('[data-send]').forEach(b => b.addEventListener('click', () => askRecipientAndSend(+b.dataset.send)));
    }

    async function copyAlert(idx) {
        const a = host.__alerts?.[idx];
        if (!a) return;
        try {
            await navigator.clipboard.writeText(a.preview);
            toast('Alerta copiada al portapapeles.', 'success');
        } catch { toast('No pude acceder al portapapeles.', 'error'); }
    }

    function askRecipientAndSend(idx) {
        const a = host.__alerts?.[idx];
        if (!a) return;
        if (!waConnected) {
            toast('Conecta WhatsApp en Premium → WhatsApp Assistant.', 'warn');
            return;
        }
        const modal = host.querySelector('#gpi-alerts-recipient-modal');
        modal.innerHTML = `
            <div class="gpi-modal-backdrop" id="gpi-alert-backdrop">
                <div class="gpi-modal">
                    <h4>Enviar alerta por WhatsApp</h4>
                    <p class="gpi-modal__hint">Vas a enviar esta alerta. ¿A quién?</p>
                    <pre class="gpi-modal__preview">${esc(a.preview)}</pre>
                    <label class="gpi-deleg-label">Número (con país, sin +)</label>
                    <input id="gpi-alert-recipient" class="gpi-input" type="tel" placeholder="${esc(myPhone || '573001234567')}" value="${esc(myPhone || '')}">
                    <p class="gpi-modal__warn">⚠️ Gunter enviará exactamente lo que ves arriba. Confirma antes de enviar.</p>
                    <div class="gpi-deleg-actions">
                        <button id="gpi-alert-cancel" class="gpi-btn gpi-btn--ghost">Cancelar</button>
                        <button id="gpi-alert-confirm" class="gpi-btn gpi-btn--send">💬 Enviar ahora</button>
                    </div>
                </div>
            </div>
        `;
        modal.querySelector('#gpi-alert-cancel').addEventListener('click', () => { modal.innerHTML = ''; });
        modal.querySelector('#gpi-alert-backdrop').addEventListener('click', (e) => {
            if (e.target.id === 'gpi-alert-backdrop') modal.innerHTML = '';
        });
        modal.querySelector('#gpi-alert-confirm').addEventListener('click', async () => {
            const to = modal.querySelector('#gpi-alert-recipient').value.trim();
            if (!to) { toast('Falta el número.', 'warn'); return; }
            const btn = modal.querySelector('#gpi-alert-confirm');
            btn.disabled = true; btn.textContent = 'Enviando…';
            try {
                const resp = await fetch('/api/whatsapp/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ to, text: a.preview })
                });
                const data = await resp.json();
                if (!resp.ok || data?.error) throw new Error(data?.error || `HTTP ${resp.status}`);
                modal.innerHTML = '';
                toast('✓ Alerta enviada por WhatsApp.', 'success');
            } catch (e) {
                btn.disabled = false; btn.textContent = '💬 Enviar ahora';
                toast('No pude enviar: ' + (e.message || ''), 'error');
            }
        });
    }

    function toast(msg, variant) {
        if (window.GunterNotificationsService?.showToast) {
            window.GunterNotificationsService.showToast(msg, {
                variant: variant === 'error' ? 'error' : variant === 'warn' ? 'warn' : 'success',
                duration: 3000, silent: true
            });
        }
    }
    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
    }

    window.GunterSmartAlertsPanel = { mount, refresh };
})();
