/* Progressive capability settings integrated into Configuración > Asistente IA. */
(function () {
    let mounted = false;
    let pairingPoll = null;
    let hybridDirty = false;

    async function mount(target = '#premium-panel') {
        if (mounted) return;
        const host = typeof target === 'string' ? document.querySelector(target) : target;
        if (!host || !window.GunterControlPlane) return;
        mounted = true;
        const root = document.createElement('section');
        root.className = 'cp-settings';
        root.setAttribute('aria-labelledby', 'cp-settings-title');
        root.innerHTML = `
            <header class="cp-settings__head">
                <div>
                    <span class="cp-kicker">CONTROL PLANE · V1</span>
                    <h2 id="cp-settings-title">Centro de control de Gunter</h2>
                    <p>Decide qué puede hacer Gunter, dónde puede hacerlo y cuándo debe pedir confirmación.</p>
                </div>
                <span class="cp-live" id="cp-settings-live"><i></i> Comprobando</span>
            </header>
            <div class="cp-plan" id="cp-plan-summary" aria-live="polite"></div>
            <div class="cp-hybrid-block" id="cp-hybrid-block" aria-live="polite"><p class="cp-empty">Comprobando el modo de inteligencia…</p></div>
            <div class="cp-capabilities" id="cp-capabilities"><p class="cp-empty">Cargando capacidades…</p></div>
            <div class="cp-nodes-block">
                <div class="cp-section-title"><div><span>03</span><h3>Dispositivos activos</h3></div><div class="cp-node-actions"><button type="button" class="cp-link" id="cp-refresh-nodes">Actualizar</button><button type="button" class="cp-pair-action" id="cp-pair-desktop">Vincular este PC</button><button type="button" class="cp-pair-action" id="cp-pair-android">Vincular Android</button><button type="button" class="cp-pair-action" id="cp-pair-ios">Vincular iPhone</button></div></div>
                <p class="cp-section-help">Gunter Node mantiene las credenciales y acciones del sistema en tu propio equipo. Puedes revocar el acceso cuando quieras.</p>
                <div id="cp-user-nodes"><p class="cp-empty">Comprobando nodos…</p></div>
            </div>
            <div class="cp-functional-block">
                <div class="cp-section-title"><div><span>04</span><h3>Mapa funcional de Gunter</h3></div><small id="cp-functional-count">Comprobando cobertura…</small></div>
                <p class="cp-section-help">Una vista honesta de lo que ya funciona, lo que está protegido y lo que necesita una aplicación nativa o proveedor externo.</p>
                <div id="cp-functional-map"><p class="cp-empty">Cargando mapa funcional…</p></div>
            </div>`;
        host.prepend(root);
        root.addEventListener('change', onChange);
        root.addEventListener('click', onClick);
        window.addEventListener('gunter-sync-state', onSyncState);
        await loadAll();
    }

    async function loadAll() {
        const live = document.getElementById('cp-settings-live');
        try {
            await window.GunterControlPlane.ensureWebNode().catch(() => null);
            const [health, entitlementData, settingsData, nodesData, capabilityData, hybridData] = await Promise.all([
                window.GunterControlPlane.health(), window.GunterControlPlane.entitlements(),
                window.GunterControlPlane.settings(), window.GunterControlPlane.nodes(), window.GunterControlPlane.capabilities(),
                window.GunterControlPlane.hybridStatus()
            ]);
            if (live) { live.className = `cp-live ${health.status === 'ok' ? 'is-ok' : 'is-warn'}`; live.innerHTML = `<i></i> ${health.status === 'ok' ? 'En línea' : 'Degradado'}`; }
            renderPlan(entitlementData);
            renderHybrid(hybridData);
            renderCapabilities(settingsData.items || []);
            renderNodes(nodesData.items || []);
            renderFunctionalMap(capabilityData);
        } catch (error) {
            if (live) { live.className = 'cp-live is-error'; live.innerHTML = '<i></i> Sin conexión'; }
            const list = document.getElementById('cp-capabilities');
            if (list) list.innerHTML = `<p class="cp-empty">No pude cargar el Control Plane: ${escapeHtml(error.message)}</p>`;
        }
    }

    function renderHybrid(data) {
        const root = document.getElementById('cp-hybrid-block');
        if (!root) return;
        const pendingMode = hybridDirty ? root.querySelector('#cp-hybrid-mode')?.value : null;
        const pendingPrivacy = hybridDirty ? root.querySelector('#cp-hybrid-privacy')?.value : null;
        const installed = data.localBrainInstalled && data.localBrainRuntimeAvailable;
        const active = !!data.flags?.['ai.local'];
        const ready = !!data.localBrainReady;
        const status = ready ? 'Listo para responder' : installed ? 'Instalado, detenido' : 'Modelo o motor no instalado';
        const stt = data.providers?.stt || {};
        const sttInstalled = !!(data.localSTTInstalled && data.localSTTRuntimeAvailable);
        const sttActive = !!data.flags?.['stt.local'];
        const sttStatus = data.localSTTReady ? 'Listo para transcribir' : sttInstalled ? 'Instalado, no listo' : 'No instalado';
        const tts = data.providers?.tts?.local || {};
        const ttsInstalled = !!tts.installed;
        const ttsActive = !!data.flags?.['tts.local'];
        const ttsStatus = tts.status === 'READY' ? 'Listo para hablar' : ttsInstalled ? 'Instalado, no listo' : 'No instalado';
        root.innerHTML = `<div class="cp-section-title"><div><span>01</span><h3>Modo de inteligencia</h3></div><small>${escapeHtml(status)}</small></div>
            <p class="cp-section-help">AUTO y CLOUD conservan la transcripción en nube. LOCAL usa Ministral para chat y Moonshine para transcripción si ambos están instalados y habilitados. LOCAL_ONLY bloquea la nube; las funciones sin proveedor local siguen sin estar disponibles.</p>
            <div class="cp-hybrid-controls">
                <label>Proveedor de chat<select id="cp-hybrid-mode"><option value="AUTO">Automático (actual)</option><option value="CLOUD">Nube</option><option value="LOCAL" ${installed ? '' : 'disabled'}>Local · Ministral 3 3B</option></select></label>
                <label>Privacidad<select id="cp-hybrid-privacy"><option value="STANDARD">Estándar</option><option value="LOCAL_ONLY">Solo local · sin nube</option></select></label>
                <button type="button" class="cp-save" id="cp-hybrid-save">Guardar modo</button>
            </div>
            <div class="cp-hybrid-runtime"><span>Motor local: <strong>${escapeHtml(status)}</strong>${data.localBrainError ? ` · ${escapeHtml(data.localBrainError)}` : ''}</span>
                <button type="button" class="cp-link" id="cp-hybrid-flag" ${installed ? '' : 'disabled'}>${active ? 'Desactivar modelo local' : 'Activar modelo local'}</button>
                ${active ? `<button type="button" class="cp-link" id="cp-hybrid-runtime">${ready ? 'Detener motor' : 'Iniciar motor'}</button>` : ''}
            </div>
            <div class="cp-hybrid-runtime"><span>STT nube: <strong>${stt.cloud?.configured ? 'Configurado' : 'No configurado'}</strong> · STT local: <strong>${escapeHtml(sttStatus)}</strong> · Modelo: ${escapeHtml(data.localSTTModel || stt.local?.model || 'Moonshine Spanish Small Streaming')}${data.localSTTError ? ` · ${escapeHtml(data.localSTTError)}` : ''}</span>
                <button type="button" class="cp-link" id="cp-stt-flag" ${sttInstalled ? '' : 'disabled'}>${sttActive ? 'Desactivar STT local' : 'Activar STT local'}</button>
            </div>
            <div class="cp-hybrid-runtime"><span>Voz local: <strong>${escapeHtml(ttsStatus)}</strong> · Supertonic 3 M1${tts.error ? ` · ${escapeHtml(tts.error)}` : ''}</span>
                <button type="button" class="cp-link" id="cp-tts-flag" ${ttsInstalled ? '' : 'disabled'}>${ttsActive ? 'Desactivar voz local' : 'Activar voz local'}</button>
            </div>
            <p class="cp-section-help">Activar o detener el motor requiere una cuenta administradora. No instala ni descarga modelos desde esta pantalla.</p>`;
        root.querySelector('#cp-hybrid-mode').value = pendingMode || data.mode || 'AUTO';
        root.querySelector('#cp-hybrid-privacy').value = pendingPrivacy || data.privacy || 'STANDARD';
    }

    function renderPlan(data) {
        const root = document.getElementById('cp-plan-summary');
        if (!root) return;
        const state = data.subscription?.state || '—';
        root.innerHTML = `
            <div><span>Plan aplicado</span><strong>${escapeHtml(data.plan?.name || 'Sin plan')}</strong></div>
            <div><span>Suscripción</span><strong class="cp-state cp-state--${state.toLowerCase()}">${escapeHtml(state)}</strong></div>
            <div><span>Snapshot</span><strong>${escapeHtml((data.hash || '').slice(0, 10) || '—')}</strong></div>`;
    }

    function renderCapabilities(items) {
        const root = document.getElementById('cp-capabilities');
        if (!root) return;
        const ready = items.filter(item => item.available);
        const future = items.filter(item => !item.available);
        root.innerHTML = `
            <div class="cp-section-title"><div><span>02</span><h3>Permisos del asistente</h3></div><small>${ready.length} disponibles · ${future.length} protegidos</small></div>
            <p class="cp-section-help">Estos permisos son el límite de seguridad. Los ajustes de cada función aparecen después, en el catálogo del asistente.</p>
            <div class="cp-capability-list cp-capability-list--ready">${ready.map(capabilityRow).join('')}</div>
            ${future.length ? `<details class="cp-future"><summary>Próximas capacidades <span>${future.length}</span></summary><p>Requieren un plan compatible y un despliegue aprobado por el administrador.</p><div class="cp-capability-list">${future.map(capabilityRow).join('')}</div></details>` : ''}`;
    }

    function capabilityRow(item) {
        const locked = !item.available;
        const advanced = item.advancedFields?.length ? `
            <details class="cp-advanced" data-setting-details="${escapeAttr(item.key)}">
                <summary>Configuración avanzada</summary>
                <div class="cp-advanced__grid">${item.advancedFields.map(field => fieldControl(item, field)).join('')}</div>
                <button type="button" class="cp-save" data-save-setting="${escapeAttr(item.key)}">Guardar detalles</button>
            </details>` : '';
        return `<article class="cp-capability ${locked ? 'is-locked' : ''}" data-setting="${escapeAttr(item.key)}" data-updated-at="${escapeAttr(item.updatedAt || '')}">
            <div class="cp-capability__main">
                <div><span class="cp-entitlement">${escapeHtml(item.entitlement)}</span><h4>${escapeHtml(item.label)}</h4><p>${escapeHtml(item.description)}</p></div>
                <label class="cp-switch" title="${locked ? escapeAttr(lockText(item.lockedReason)) : 'Activar o desactivar'}">
                    <input type="checkbox" data-setting-toggle="${escapeAttr(item.key)}" ${item.enabled ? 'checked' : ''} ${locked ? 'disabled' : ''}>
                    <span></span>
                </label>
            </div>
            ${locked ? `<p class="cp-lock">No disponible: ${escapeHtml(lockText(item.lockedReason))}</p>` : advanced}
        </article>`;
    }

    function fieldControl(item, field) {
        const value = item.advanced?.[field];
        const booleanField = /enabled|localOnly|sessionOnly|bargeIn|vad|media|messaging|location|camera|gpu|fallback|alerts/i.test(field);
        if (booleanField) return `<label><span>${humanize(field)}</span><input type="checkbox" data-advanced-field="${escapeAttr(field)}" ${value === true ? 'checked' : ''}></label>`;
        const numberField = /days|minutes|limit|budget|threshold|ram|storage/i.test(field);
        return `<label><span>${humanize(field)}</span><input type="${numberField ? 'number' : 'text'}" data-advanced-field="${escapeAttr(field)}" value="${escapeAttr(Array.isArray(value) ? value.join(', ') : value ?? '')}" placeholder="${numberField ? '0' : 'Opcional'}"></label>`;
    }

    function renderNodes(items) {
        const root = document.getElementById('cp-user-nodes');
        if (!root) return;
        root.innerHTML = items.length ? `<div class="cp-node-list">${items.map(node => `
            <article class="cp-node" data-node="${escapeAttr(node.nodeId)}">
                <span class="cp-node__dot cp-node__dot--${node.state.toLowerCase()}"></span>
                <div><strong>${escapeHtml(node.deviceName)}</strong><small>${escapeHtml(node.nodeType)} · ${escapeHtml(node.state)} · protocolo ${escapeHtml(node.protocolVersion)}${nodeAccessText(node)}</small></div>
                <time>${node.lastSeenAt ? new Date(node.lastSeenAt).toLocaleString('es-CO') : 'Sin heartbeat'}</time>
                ${node.nodeType !== 'WEB' ? `<div class="cp-node-controls">${node.nodeType === 'DESKTOP' ? `<button type="button" class="cp-link" data-node-permissions="${escapeAttr(node.nodeId)}" data-permission-scope="${node.health?.filesystemScope === 'all' && node.health?.programScope === 'all' ? 'standard' : 'all'}">${node.health?.filesystemScope === 'all' && node.health?.programScope === 'all' ? 'Limitar acceso' : 'Permitir acceso general'}</button>` : ''}<button type="button" class="cp-link cp-link--danger" data-revoke-node="${escapeAttr(node.nodeId)}">Revocar</button></div>` : ''}
            </article>`).join('')}</div>` : '<p class="cp-empty">Todavía no hay dispositivos registrados.</p>';
    }

    function renderFunctionalMap(data) {
        const root = document.getElementById('cp-functional-map');
        const count = document.getElementById('cp-functional-count');
        if (!root) return;
        if (count) count.textContent = `${data.stats?.enabled || 0} habilitadas · ${data.stats?.total || 0} definidas`;
        const labels = { A: 'Experiencia', B: 'Inteligencia', C: 'Dispositivos e integraciones', D: 'Operación y negocio', E: 'Seguridad y calidad' };
        root.innerHTML = Object.entries(data.groups || {}).map(([group, items], index) => `<details class="cp-map-group" ${index === 0 ? 'open' : ''}>
            <summary><span>${escapeHtml(group)}</span><strong>${escapeHtml(labels[group] || group)}</strong><small>${items.filter(item => item.enabled).length}/${items.length}</small></summary>
            <div class="cp-map-list">${items.map(item => `<div class="cp-map-row">
                <span class="cp-map-id">${escapeHtml(item.id)}</span>
                <div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.featureKey)} · ${item.surfaces.map(escapeHtml).join(' / ')}</small>${item.reason ? `<p>${escapeHtml(item.reason)}</p>` : ''}</div>
                <span class="cp-status cp-status--${escapeAttr(item.status)}">${escapeHtml(statusLabel(item.status))}</span>
            </div>`).join('')}</div>
        </details>`).join('') + `<p class="cp-governance-note">Las 4 matrices obligatorias —riesgo, plataformas, estados y flujos end-to-end— se aplican como reglas transversales del Control Plane.</p>`;
    }

    async function onChange(event) {
        if (event.target.matches?.('#cp-hybrid-mode, #cp-hybrid-privacy')) {
            hybridDirty = true;
            return;
        }
        const toggle = event.target.closest('[data-setting-toggle]');
        if (!toggle) return;
        toggle.disabled = true;
        try {
            const article = toggle.closest('[data-setting]');
            const data = await window.GunterControlPlane.updateSetting({ key: toggle.dataset.settingToggle, enabled: toggle.checked, baseUpdatedAt: article?.dataset.updatedAt || null });
            toggle.checked = !!data.setting?.enabled;
            announce(data.queued ? 'Cambio guardado; se sincronizará al recuperar conexión.' : 'Configuración actualizada');
        } catch (error) {
            toggle.checked = !toggle.checked;
            announce(error.code === 'entitlement_required' ? 'Tu plan no incluye esta capacidad.' : error.message, true);
        } finally { toggle.disabled = false; }
    }

    async function onClick(event) {
        const hybridSave = event.target.closest('#cp-hybrid-save');
        if (hybridSave) {
            hybridSave.disabled = true;
            try {
                const mode = document.getElementById('cp-hybrid-mode').value;
                const privacy = document.getElementById('cp-hybrid-privacy').value;
                if (window.GunterRuntimeState?.setMode) await window.GunterRuntimeState.setMode(mode, privacy);
                else {
                    await window.GunterControlPlane.updateHybridMode({ mode, privacy });
                    await window.GunterRuntimeState?.refresh?.();
                }
                hybridDirty = false;
                renderHybrid(await window.GunterControlPlane.hybridStatus());
                announce('Modo de inteligencia actualizado.');
            } catch (error) { announce(error.message, true); }
            finally { hybridSave.disabled = false; }
            return;
        }
        const hybridFlag = event.target.closest('#cp-hybrid-flag');
        if (hybridFlag) {
            hybridFlag.disabled = true;
            try {
                const active = (await window.GunterControlPlane.hybridStatus()).flags?.['ai.local'];
                await window.GunterControlPlane.updateFlag({ key: 'ai.local', state: active ? 'off' : 'on' });
                renderHybrid(await window.GunterControlPlane.hybridStatus());
                announce(active ? 'Modelo local desactivado y detenido.' : 'Modelo local habilitado.');
            } catch (error) { announce(error.status === 403 ? 'Solo un administrador puede cambiar este permiso.' : error.message, true); }
            finally { hybridFlag.disabled = false; }
            return;
        }
        const hybridRuntime = event.target.closest('#cp-hybrid-runtime');
        if (hybridRuntime) {
            hybridRuntime.disabled = true;
            try {
                const ready = (await window.GunterControlPlane.hybridStatus()).localBrainReady;
                await window.GunterControlPlane.localBrainAction(ready ? 'stop' : 'start');
                renderHybrid(await window.GunterControlPlane.hybridStatus());
                announce(ready ? 'Motor local detenido.' : 'Motor local listo.');
            } catch (error) { announce(error.status === 403 ? 'Solo un administrador puede controlar el motor local.' : error.message, true); }
            finally { hybridRuntime.disabled = false; }
            return;
        }
        const sttFlag = event.target.closest('#cp-stt-flag');
        if (sttFlag) {
            sttFlag.disabled = true;
            try {
                const active = (await window.GunterControlPlane.hybridStatus()).flags?.['stt.local'];
                await window.GunterControlPlane.updateFlag({ key: 'stt.local', state: active ? 'off' : 'on' });
                renderHybrid(await window.GunterControlPlane.hybridStatus());
                window.GunterRuntimeState?.refresh?.().catch(() => {});
                announce(active ? 'Transcripción local desactivada.' : 'Transcripción local habilitada. Solo transcribe; las acciones por voz requieren confirmación.');
            } catch (error) { announce(error.status === 403 ? 'Solo un administrador puede cambiar este permiso.' : error.message, true); }
            finally { sttFlag.disabled = false; }
            return;
        }
        const ttsFlag = event.target.closest('#cp-tts-flag');
        if (ttsFlag) {
            ttsFlag.disabled = true;
            try {
                const active = (await window.GunterControlPlane.hybridStatus()).flags?.['tts.local'];
                await window.GunterControlPlane.updateFlag({ key: 'tts.local', state: active ? 'off' : 'on' });
                renderHybrid(await window.GunterControlPlane.hybridStatus());
                window.GunterRuntimeState?.refresh?.().catch(() => {});
                announce(active ? 'Voz local desactivada.' : 'Voz local activada. Gunter está cargando Supertonic 3 M1.');
            } catch (error) { announce(error.status === 403 ? 'Solo un administrador puede cambiar este permiso.' : error.message, true); }
            finally { ttsFlag.disabled = false; }
            return;
        }
        const save = event.target.closest('[data-save-setting]');
        if (save) {
            const article = save.closest('[data-setting]');
            const advanced = {};
            article.querySelectorAll('[data-advanced-field]').forEach(input => {
                const raw = input.type === 'checkbox' ? input.checked : input.value.trim();
                advanced[input.dataset.advancedField] = input.type === 'number' && raw !== '' ? Number(raw) : raw.includes?.(',') ? raw.split(',').map(value => value.trim()).filter(Boolean) : raw;
            });
            save.disabled = true;
            try { const data = await window.GunterControlPlane.updateSetting({ key: save.dataset.saveSetting, advanced, baseUpdatedAt: article?.dataset.updatedAt || null }); announce(data.queued ? 'Detalles guardados para sincronizar.' : 'Detalles guardados'); }
            catch (error) { announce(error.message, true); }
            finally { save.disabled = false; }
            return;
        }
        const revoke = event.target.closest('[data-revoke-node]');
        if (revoke && confirm('¿Revocar este dispositivo? Sus comandos pendientes se cancelarán.')) {
            revoke.disabled = true;
            try { await window.GunterControlPlane.revokeNode(revoke.dataset.revokeNode); await loadAll(); announce('Dispositivo revocado'); }
            catch (error) { announce(error.message, true); revoke.disabled = false; }
            return;
        }
        const permission = event.target.closest('[data-node-permissions]');
        if (permission) {
            const scope = permission.dataset.permissionScope;
            const explanation = scope === 'all'
                ? 'Gunter podrá leer cualquier archivo o carpeta y abrir cualquier programa que Windows permita a tu usuario. Las acciones externas y destructivas seguirán exigiendo confirmación. ¿Conceder acceso general?'
                : 'Gunter volverá a limitarse a Descargas, Documentos, Escritorio y la lista segura de programas. ¿Continuar?';
            if (!confirm(explanation)) return;
            permission.disabled = true;
            try {
                const queued = await window.GunterControlPlane.queueCommand({
                    nodeId: permission.dataset.nodePermissions, skill: 'desktop.permissions.update',
                    payload: { filesystemScope: scope, programScope: scope, confirmed: true },
                    idempotencyKey: `permissions:${permission.dataset.nodePermissions}:${scope}:${Date.now()}`,
                    autonomy: 'L2', confirmed: true, ttlMs: 120000
                });
                const command = await window.GunterControlPlane.waitForCommand(queued.command.id, { timeoutMs: 60000 });
                if (command.state !== 'VERIFIED') throw new Error(command.error || 'El dispositivo no confirmó el cambio.');
                await new Promise(resolve => setTimeout(resolve, 500));
                await loadAll();
                announce(scope === 'all' ? 'Acceso general concedido a este PC.' : 'El PC volvió al acceso limitado.');
            } catch (error) { announce(error.message, true); permission.disabled = false; }
            return;
        }
        if (event.target.closest('#cp-refresh-nodes')) await loadAll();
        if (event.target.closest('#cp-pair-desktop')) await beginDesktopPairing();
        if (event.target.closest('#cp-pair-android')) await beginMobilePairing('ANDROID');
        if (event.target.closest('#cp-pair-ios')) await beginMobilePairing('IOS');
    }

    async function beginDesktopPairing() {
        const trigger = document.getElementById('cp-pair-desktop');
        if (trigger) trigger.disabled = true;
        try {
            const data = await window.GunterControlPlane.createNodePairing({
                nodeType: 'DESKTOP', deviceName: 'Mi PC · Gunter Node',
                capabilities: [
                    'desktop.apps.open', 'desktop.apps.discover', 'desktop.files.read', 'desktop.files.open', 'desktop.files.latest', 'desktop.files.list', 'desktop.files.search',
                    'desktop.media.control', 'desktop.ui.inspect', 'desktop.ui.capture_target', 'desktop.ui.focus', 'desktop.ui.click', 'desktop.ui.type',
                    'desktop.ui.wait', 'desktop.ui.scroll', 'desktop.ui.hotkey', 'desktop.ui.select_file', 'social.beeper.bridge'
                ]
            });
            showPairingDialog(data);
        } catch (error) {
            const labels = { node_limit_reached: 'Tu plan ya alcanzó el límite de PCs vinculados.', feature_flag_disabled: 'El acompañante de PC todavía no está habilitado para esta cuenta.', entitlement_required: 'Tu plan no incluye el acompañante de PC.' };
            announce(labels[error.code] || error.message, true);
        } finally { if (trigger) trigger.disabled = false; }
    }

    async function beginMobilePairing(nodeType) {
        const trigger = document.getElementById(nodeType === 'IOS' ? 'cp-pair-ios' : 'cp-pair-android');
        if (trigger) trigger.disabled = true;
        try {
            const data = await window.GunterControlPlane.createNodePairing({
                nodeType, deviceName: `${nodeType === 'IOS' ? 'iPhone/iPad' : 'Android'} · Gunter`,
                capabilities: ['mobile.apps.open', 'mobile.files.read', 'mobile.media.control', 'mobile.messaging.prepare', 'mobile.reminders.write']
            });
            showMobilePairingDialog(data);
        } catch (error) {
            const labels = { node_limit_reached: 'Tu plan ya alcanzó el límite de dispositivos.', feature_flag_disabled: 'El acompañante móvil todavía no está habilitado para esta cuenta.', entitlement_required: 'Tu plan no incluye el acompañante móvil.' };
            announce(labels[error.code] || error.message, true);
        } finally { if (trigger) trigger.disabled = false; }
    }

    function showMobilePairingDialog(data) {
        closePairingDialog();
        const pairing = data.pairing || {};
        const serverUrl = location.origin && location.origin !== 'null' ? location.origin : 'https://gunter.example.com';
        const pairingToken = data.pairingToken || '';
        const isIOS = pairing.nodeType === 'IOS';
        const deviceLabel = isIOS ? 'iPhone o iPad' : 'Android';
        const dialog = document.createElement('dialog');
        dialog.className = 'cp-pairing-dialog';
        dialog.innerHTML = `<div class="cp-pairing-shell">
            <button type="button" class="cp-pairing-close" data-close-pairing aria-label="Cerrar">×</button>
            <span class="cp-pairing-kicker">GUNTER MÓVIL · ACCESO DE UN SOLO USO</span>
            <h3>Vincula tu ${deviceLabel} de forma segura</h3>
            <p class="cp-pairing-lead">El acceso vence en 10 minutos y deja de servir en cuanto el teléfono lo reclama. No compartas el código.</p>
            <ol class="cp-pairing-steps">
                <li><span>01</span><div><strong>Instala el acompañante para ${deviceLabel}</strong><small>${isIOS ? 'Abre gunter-mobile/ios con XcodeGen y firma desde Xcode.' : 'Compila gunter-mobile/android con Android Studio.'}</small></div></li>
                <li><span>02</span><div><strong>En el teléfono, indica la dirección del servidor</strong><code>${escapeHtml(serverUrl)}</code></div></li>
                <li><span>03</span><div><strong>Usa este código de un solo uso</strong><code id="cp-mobile-pairing-token">${escapeHtml(pairingToken)}</code><button type="button" class="cp-copy-command" data-copy-mobile-token>Copiar código</button></div></li>
                <li><span>04</span><div><strong>Concede permisos desde el teléfono</strong><small>Archivos solo de carpetas seleccionadas; multimedia y notificaciones según los permisos del sistema.</small></div></li>
            </ol>
            <div class="cp-pairing-state" id="cp-pairing-state"><i></i><div><strong>Esperando el móvil…</strong><small>Vence ${new Date(pairing.expiresAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</small></div></div>
        </div>`;
        document.body.appendChild(dialog);
        dialog.addEventListener('click', async event => {
            if (event.target.closest('[data-close-pairing]')) closePairingDialog();
            if (event.target.closest('[data-copy-mobile-token]')) {
                try { await navigator.clipboard.writeText(pairingToken); event.target.textContent = 'Copiado'; }
                catch { announce('No pude copiarlo; selecciónalo manualmente.', true); }
            }
        });
        dialog.addEventListener('cancel', event => { event.preventDefault(); closePairingDialog(); });
        dialog.showModal();
        pairingPoll = setInterval(async () => {
            try {
                const status = await window.GunterControlPlane.nodePairingStatus(pairing.pairingId);
                const state = document.getElementById('cp-pairing-state');
                if (status.pairing?.state === 'CLAIMED') {
                    clearInterval(pairingPoll); pairingPoll = null;
                    if (state) { state.classList.add('is-connected'); state.innerHTML = `<i></i><div><strong>${escapeHtml(status.node?.deviceName || 'Móvil vinculado')}</strong><small>El dispositivo ya puede iniciar su acompañante.</small></div>`; }
                    await loadAll();
                } else if (status.pairing?.state === 'EXPIRED') {
                    clearInterval(pairingPoll); pairingPoll = null;
                    if (state) { state.classList.add('is-expired'); state.innerHTML = '<i></i><div><strong>El acceso venció</strong><small>Cierra esta ventana y crea uno nuevo.</small></div>'; }
                }
            } catch { /* A transient network error must not discard one-time access. */ }
        }, 2500);
    }

    function showPairingDialog(data) {
        closePairingDialog();
        const pairing = data.pairing || {};
        const serverUrl = location.origin && location.origin !== 'null' ? location.origin : 'http://127.0.0.1:3001';
        const command = `node gunter-node/cli.js pair --server ${serverUrl} --token ${data.pairingToken} --name "Mi PC"`;
        const dialog = document.createElement('dialog');
        dialog.className = 'cp-pairing-dialog';
        dialog.innerHTML = `<div class="cp-pairing-shell">
            <button type="button" class="cp-pairing-close" data-close-pairing aria-label="Cerrar">×</button>
            <span class="cp-pairing-kicker">GUNTER NODE · ACCESO DE UN SOLO USO</span>
            <h3>Vincula este PC sin compartir tus contraseñas</h3>
            <p class="cp-pairing-lead">El acceso vence en 10 minutos y deja de servir apenas este equipo lo reclama.</p>
            <ol class="cp-pairing-steps">
                <li><span>01</span><div><strong>Abre una terminal en la carpeta de Gunter</strong><small>En Windows puedes usar PowerShell o la terminal integrada.</small></div></li>
                <li><span>02</span><div><strong>Ejecuta este comando una sola vez</strong><code id="cp-pairing-command">${escapeHtml(command)}</code><button type="button" class="cp-copy-command" data-copy-command>Copiar comando</button></div></li>
                <li><span>03</span><div><strong>Elige el alcance del dispositivo</strong><code>node gunter-node/cli.js permissions --files all --programs all --yes</code><small>Este permiso es opcional y permite acceder a cualquier ruta o programa que Windows autorice para tu usuario. Puedes volver a “standard” cuando quieras.</small></div></li>
                <li><span>04</span><div><strong>Déjalo residente en Windows</strong><code>node gunter-node/cli.js install</code><small>Lo iniciará al abrir sesión, sin otorgarle permisos nuevos. Si prefieres probarlo primero, usa <code>npm run node:start</code>.</small></div></li>
            </ol>
            <div class="cp-pairing-state" id="cp-pairing-state"><i></i><div><strong>Esperando este PC…</strong><small>Vence ${new Date(pairing.expiresAt).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</small></div></div>
            <p class="cp-pairing-privacy">El token de Beeper se configura después en este PC y permanece cifrado allí. Gunter nunca solicita tu contraseña de Instagram o Facebook.</p>
        </div>`;
        document.body.appendChild(dialog);
        dialog.addEventListener('click', async event => {
            if (event.target.closest('[data-close-pairing]')) closePairingDialog();
            if (event.target.closest('[data-copy-command]')) {
                try { await navigator.clipboard.writeText(command); event.target.textContent = 'Copiado'; }
                catch { announce('No pude copiarlo; selecciónalo manualmente.', true); }
            }
        });
        dialog.addEventListener('cancel', event => { event.preventDefault(); closePairingDialog(); });
        dialog.showModal();
        pairingPoll = setInterval(async () => {
            try {
                const status = await window.GunterControlPlane.nodePairingStatus(pairing.pairingId);
                const state = document.getElementById('cp-pairing-state');
                if (status.pairing?.state === 'CLAIMED') {
                    clearInterval(pairingPoll); pairingPoll = null;
                    if (state) { state.classList.add('is-connected'); state.innerHTML = `<i></i><div><strong>${escapeHtml(status.node?.deviceName || 'PC vinculado')}</strong><small>Conexión segura completada. Inícialo con npm run node:start o déjalo residente con install.</small></div>`; }
                    await loadAll();
                } else if (status.pairing?.state === 'EXPIRED') {
                    clearInterval(pairingPoll); pairingPoll = null;
                    if (state) { state.classList.add('is-expired'); state.innerHTML = '<i></i><div><strong>El acceso venció</strong><small>Cierra esta ventana y crea uno nuevo.</small></div>'; }
                }
            } catch { /* A transient network error must not discard the one-time access. */ }
        }, 2500);
    }

    function closePairingDialog() {
        if (pairingPoll) clearInterval(pairingPoll);
        pairingPoll = null;
        const dialog = document.querySelector('.cp-pairing-dialog');
        if (dialog) { try { dialog.close(); } catch { } dialog.remove(); }
    }

    function nodeAccessText(node) {
        if (node.nodeType !== 'DESKTOP') return '';
        const files = node.health?.filesystemScope === 'all' ? 'archivos: acceso general' : 'archivos: carpetas estándar';
        const programs = node.health?.programScope === 'all' ? 'programas: acceso general' : 'programas: lista segura';
        const interaction = (node.capabilities || []).includes('desktop.ui.type') ? 'multimedia e interacción accesible' : 'interacción pendiente de actualizar';
        return ` · ${escapeHtml(files)} · ${escapeHtml(programs)} · ${escapeHtml(interaction)}`;
    }

    function announce(message, error = false) {
        if (window.GunterNotificationsService?.showToast) window.GunterNotificationsService.showToast(message, { priority: error ? 'high' : 'normal' });
        else if (error) alert(message);
    }
    function onSyncState(event) {
        const live = document.getElementById('cp-settings-live');
        if (!live || !event.detail) return;
        const { state, pending = 0 } = event.detail;
        if (state === 'SYNCING') { live.className = 'cp-live is-warn'; live.innerHTML = '<i></i> Sincronizando'; }
        else if (state === 'OFFLINE' || state === 'DEGRADED') { live.className = 'cp-live is-warn'; live.innerHTML = `<i></i> ${pending ? `${pending} pendiente(s)` : 'Modo local'}`; }
        else if (state === 'CONFLICT') { live.className = 'cp-live is-error'; live.innerHTML = `<i></i> ${pending} conflicto(s)`; }
        else if (pending) { live.className = 'cp-live is-warn'; live.innerHTML = `<i></i> ${pending} pendiente(s)`; }
        else { live.className = 'cp-live is-ok'; live.innerHTML = '<i></i> En línea'; }
    }
    function lockText(reason) { return String(reason || '').startsWith('subscription_') ? 'suscripción sin acceso' : reason === 'not_in_plan' ? 'no incluida en el plan' : reason === 'off' ? 'despliegue aún desactivado' : reason === 'admin_only' ? 'prueba administrativa' : reason || 'capacidad no disponible'; }
    function statusLabel(status) { return ({ active: 'Activo', partial: 'Parcial', protected: 'Protegido', native_required: 'Requiere app', external_required: 'Requiere proveedor', plan_required: 'Requiere plan' })[status] || status; }
    function humanize(value) { return String(value).replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()); }
    function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
    function escapeAttr(value) { return escapeHtml(value).replace(/`/g, '&#96;'); }

    window.GunterControlPlaneSettings = { mount, reload: loadAll };
})();
