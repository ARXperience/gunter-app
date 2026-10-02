/* Admin Operations Center for plans, devices, incidents and rollout. */
(function () {
    let mounted = false;
    let refreshTimer = null;

    async function mount() {
        if (mounted || !window.GunterControlPlane) return;
        mounted = true;
        document.addEventListener('click', onClick);
        document.addEventListener('change', onChange);
        document.getElementById('cp-plan-form')?.addEventListener('submit', onPlanSubmit);
        await refresh();
        refreshTimer = setInterval(refresh, 30000);
    }

    async function refresh() {
        try {
            const [overview, usersResponse] = await Promise.all([
                window.GunterControlPlane.operations(),
                fetch('/api/auth/admin/users').then(response => response.json())
            ]);
            renderOverview(overview);
            renderNodes(overview.nodes || []);
            renderIncidents(overview.incidents || []);
            renderPlans(overview.plans || [], overview.subscriptions || [], usersResponse.users || [], overview.featureFlags || []);
            renderFlags(overview.featureFlags || []);
        } catch (error) {
            setHtml('adm-ops-overview', `<p class="cp-empty">Control Plane no disponible: ${escapeHtml(error.message)}</p>`);
        }
    }

    function renderOverview(data) {
        const health = data.health || {};
        const nodes = data.nodeStats?.nodes || {};
        const commands = data.nodeStats?.commands || {};
        const incidents = data.incidentStats || {};
        const capabilityData = data.capabilities || { stats: {}, items: [] };
        const blockers = (capabilityData.items || []).filter(item => ['native_required', 'external_required', 'protected'].includes(item.status));
        setHtml('adm-ops-overview', `<div class="cp-ops-strip">
            ${metric('Estado', health.status || '—', `is-${health.status || 'unknown'}`)}
            ${metric('Nodos online', nodes.byState?.ONLINE || 0)}
            ${metric('Comandos verificados', commands.byState?.VERIFIED || 0)}
            ${metric('Incidentes activos', incidents.active || 0, incidents.critical ? 'is-critical' : '')}
            ${metric('Trazas', data.traceStats?.sampled || 0)}
            ${metric('Skills', data.skills?.total || 0)}
            ${metric('Capacidades', `${capabilityData.stats?.enabled || 0}/${capabilityData.stats?.total || 0}`)}
        </div>
        <details class="cp-ops-readiness"><summary>Preparación funcional <span>${blockers.length} pendientes controlados</span></summary>
            <div class="cp-readiness-grid">
                ${metric('Activas', capabilityData.stats?.active || 0)}
                ${metric('Parciales', capabilityData.stats?.partial || 0)}
                ${metric('Protegidas', capabilityData.stats?.protected || 0)}
                ${metric('Runtime nativo', capabilityData.stats?.nativeRequired || 0)}
                ${metric('Proveedor externo', capabilityData.stats?.externalRequired || 0)}
            </div>
            <div class="cp-readiness-list">${blockers.slice(0, 12).map(item => `<p><strong>${escapeHtml(item.id)} · ${escapeHtml(item.title)}</strong><span>${escapeHtml(item.reason || item.status)}</span></p>`).join('')}</div>
        </details>`);
    }

    function renderNodes(items) {
        setHtml('adm-control-nodes', items.length ? `<div class="cp-admin-list">${items.map(node => `
            <article class="cp-admin-row">
                <span class="cp-node__dot cp-node__dot--${String(node.state).toLowerCase()}"></span>
                <div><strong>${escapeHtml(node.deviceName)}</strong><small>${escapeHtml(node.nodeType)} · ${escapeHtml(node.os)} ${escapeHtml(node.osVersion || '')}</small></div>
                <div><span class="cp-admin-label">Estado</span>${escapeHtml(node.state)}</div>
                <div><span class="cp-admin-label">Último heartbeat</span>${formatDate(node.lastSeenAt)}</div>
                <button class="abtn abtn--danger" data-cp-revoke="${escapeAttr(node.nodeId)}" ${node.state === 'REVOKED' ? 'disabled' : ''}>Revocar</button>
            </article>`).join('')}</div>` : '<p class="cp-empty">No hay nodos registrados.</p>');
    }

    function renderIncidents(items) {
        setHtml('adm-control-incidents', items.length ? `<div class="cp-admin-list">${items.map(incident => `
            <article class="cp-admin-row cp-admin-row--incident">
                <span class="cp-severity cp-severity--${incident.severity.toLowerCase()}">${escapeHtml(incident.severity)}</span>
                <div><strong>${escapeHtml(incident.summary)}</strong><small>${escapeHtml(incident.code)} · ${escapeHtml(incident.service)} · ${incident.occurrences} ocurrencia(s)</small></div>
                <div><span class="cp-admin-label">Estado</span>${escapeHtml(incident.status)}</div>
                <div class="cp-admin-actions">
                    ${incident.status === 'OPEN' ? `<button class="abtn" data-cp-incident="acknowledge" data-id="${escapeAttr(incident.id)}">Reconocer</button>` : ''}
                    ${incident.status !== 'RECOVERED' ? `<button class="abtn abtn--ok" data-cp-incident="recover" data-id="${escapeAttr(incident.id)}">Recuperado</button>` : ''}
                </div>
            </article>`).join('')}</div>` : '<p class="cp-empty">No hay incidentes. El sistema está tranquilo.</p>');
    }

    function renderPlans(plans, subscriptions, users, featureFlags) {
        const root = document.getElementById('cp-plan-features');
        if (root && !root.dataset.ready) {
            root.dataset.ready = '1';
            root.innerHTML = `<summary>Seleccionar capacidades</summary><div class="cp-feature-picker">${featureFlags.map(flag => `
                <label><input type="checkbox" name="feature" value="${escapeAttr(flag.key)}"> ${escapeHtml(flag.key)}</label>`).join('')}</div>`;
        }
        setHtml('adm-control-plans', plans.length ? `<div class="cp-plan-list">${plans.map(plan => `
            <article><div><strong>${escapeHtml(plan.name)}</strong><small>${escapeHtml(plan.id)}${plan.system ? ' · sistema' : ''}</small></div><span>${plan.monthlyPrice == null ? 'Sin precio' : `${escapeHtml(plan.currency || '')} ${Number(plan.monthlyPrice).toLocaleString('es-CO')}`}</span><span>${Object.values(plan.features || {}).filter(Boolean).length} capacidades</span></article>`).join('')}</div>` : '<p class="cp-empty">No hay planes comerciales configurados.</p>');

        const byUser = new Map(subscriptions.map(item => [item.userId, item]));
        setHtml('adm-control-subscriptions', `<div class="cp-subscription-list">${users.filter(user => user.status === 'approved').map(user => {
            const current = byUser.get(user.id) || { planId: 'legacy_compat', state: 'ACTIVE' };
            return `<article data-subscription-user="${escapeAttr(user.id)}"><div><strong>${escapeHtml(user.displayName)}</strong><small>@${escapeHtml(user.username)}</small></div>
                <select data-sub-plan>${plans.map(plan => `<option value="${escapeAttr(plan.id)}" ${plan.id === current.planId ? 'selected' : ''}>${escapeHtml(plan.name)}</option>`).join('')}</select>
                <select data-sub-state>${['TRIAL','ACTIVE','PAST_DUE','GRACE','SUSPENDED','CANCELED'].map(state => `<option ${state === current.state ? 'selected' : ''}>${state}</option>`).join('')}</select>
                <button class="abtn abtn--ok" data-save-subscription>Aplicar</button></article>`;
        }).join('')}</div>`);
    }

    function renderFlags(items) {
        setHtml('adm-control-flags', `<div class="cp-flag-list">${items.map(flag => `<label><span><strong>${escapeHtml(flag.key)}</strong><small>${flag.enabled ? 'Disponible para este admin' : escapeHtml(flag.reason)}</small></span><select data-cp-flag="${escapeAttr(flag.key)}">${['off','admin_only','canary','on'].map(state => `<option value="${state}" ${state === flag.state ? 'selected' : ''}>${state}</option>`).join('')}</select></label>`).join('')}</div>`);
    }

    async function onClick(event) {
        const revoke = event.target.closest('[data-cp-revoke]');
        if (revoke && confirm('¿Revocar este nodo y cancelar sus comandos pendientes?')) {
            revoke.disabled = true;
            await window.GunterControlPlane.revokeNode(revoke.dataset.cpRevoke).catch(showError);
            return refresh();
        }
        const incident = event.target.closest('[data-cp-incident]');
        if (incident) {
            incident.disabled = true;
            await window.GunterControlPlane.updateIncident({ incidentId: incident.dataset.id, action: incident.dataset.cpIncident }).catch(showError);
            return refresh();
        }
        const saveSubscription = event.target.closest('[data-save-subscription]');
        if (saveSubscription) {
            const row = saveSubscription.closest('[data-subscription-user]');
            saveSubscription.disabled = true;
            await window.GunterControlPlane.setSubscription({ userId: row.dataset.subscriptionUser, planId: row.querySelector('[data-sub-plan]').value, state: row.querySelector('[data-sub-state]').value }).catch(showError);
            return refresh();
        }
        if (event.target.closest('#adm-control-refresh')) return refresh();
    }

    async function onChange(event) {
        const flag = event.target.closest('[data-cp-flag]');
        if (!flag) return;
        flag.disabled = true;
        try { await window.GunterControlPlane.updateFlag({ key: flag.dataset.cpFlag, state: flag.value }); }
        catch (error) { showError(error); }
        finally { flag.disabled = false; refresh(); }
    }

    async function onPlanSubmit(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const features = {};
        form.querySelectorAll('input[name=feature]:checked').forEach(input => { features[input.value] = true; });
        const payload = {
            id: form.elements.planId.value, name: form.elements.planName.value,
            monthlyPrice: form.elements.monthlyPrice.value === '' ? null : Number(form.elements.monthlyPrice.value),
            currency: form.elements.currency.value || null, limits: { nodes: Number(form.elements.nodes.value || 1) }, features
        };
        const button = form.querySelector('button[type=submit]');
        button.disabled = true;
        try { await window.GunterControlPlane.upsertPlan(payload); form.reset(); await refresh(); }
        catch (error) { showError(error); }
        finally { button.disabled = false; }
    }

    function metric(label, value, className = '') { return `<div class="cp-ops-metric ${className}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`; }
    function setHtml(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }
    function showError(error) { alert(error?.message || 'No se pudo completar la operación.'); }
    function formatDate(value) { return value ? new Date(value).toLocaleString('es-CO') : '—'; }
    function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
    function escapeAttr(value) { return escapeHtml(value).replace(/`/g, '&#96;'); }

    window.GunterControlPlaneAdmin = { mount, refresh, destroy() { if (refreshTimer) clearInterval(refreshTimer); } };
})();
