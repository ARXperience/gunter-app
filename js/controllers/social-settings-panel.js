/* Connection controls and supervised learned-route management. */
(function () {
    let host;
    let connections = [];
    let procedures = [];
    async function mount(selector = '#social-settings-panel') {
        host = document.querySelector(selector);
        if (!host) return;
        host.innerHTML = '<div class="social-settings__loading">Verificando canales y rutas…</div>';
        await refresh();
    }
    async function refresh() {
        try {
            const cp = window.GunterControlPlane;
            const [social, learned] = await Promise.all([cp.socialConnections(), cp.procedures({ limit: 100 })]);
            connections = social.items || []; procedures = learned.items || [];
            render();
        } catch (error) { host.innerHTML = `<div class="social-settings__error"><strong>No pude cargar conexiones</strong><span>${esc(error.message)}</span><button type="button">Reintentar</button></div>`; host.querySelector('button').onclick = refresh; }
    }
    function render() {
        const beeperPaired = connections.some(item => item.connectionMode === 'beeper_local' && item.node?.paired);
        host.innerHTML = `<div class="social-settings">
            <section class="social-settings__section"><header><div><span class="social-settings__eyebrow">CANALES</span><h3>Redes y mensajería</h3><p>Vincula tus cuentas personales desde este equipo. Gunter te explicará las condiciones antes de solicitar acceso.</p></div><a href="day.html#conversations">Abrir conversaciones</a></header>
                <div class="social-connections">${connections.map(connectionCard).join('')}</div>
                <div class="social-consent"><span>✓</span><p><strong>Control humano por diseño.</strong> Gunter puede leer para resumir y preparar borradores, pero enviar siempre exige tu orden o un clic confirmado.</p>${beeperPaired ? '<button type="button" class="is-secondary" data-beeper-unpair>Desvincular nodo</button>' : ''}</div>
            </section>
            <section class="social-settings__section"><header><div><span class="social-settings__eyebrow">ENSEÑAR A GUNTER</span><h3>Rutas aprendidas</h3><p>Graba botones y pantallas como objetivos semánticos. La ruta debe simularse y aprobarse antes de poder repetirse.</p></div></header>
                <div class="procedure-teach"><label>Nombre de la ruta<input type="text" maxlength="160" placeholder="Ej. completar reporte semanal" data-procedure-name></label><button type="button" data-desktop-procedure>Enseñar ruta del PC</button><button type="button" class="is-secondary" data-start-recording>Observar esta web</button><button type="button" class="is-secondary" data-instagram-template>Preparar publicación</button></div>
                <div class="procedure-native-note"><strong>Cada dispositivo conserva sus propios permisos.</strong><span>Gunter Node para PC puede abrir rutas y programas, controlar multimedia y guardar objetivos accesibles por nombre o identificador, sin depender de coordenadas. Escribir, pulsar, publicar o enviar vuelve a pedir confirmación. En Android/iOS, el alcance seguirá limitado por los permisos de la app móvil.</span></div>
                <div class="procedure-list">${renderProcedures()}</div>
            </section>
        </div>`;
        bind();
    }
    function connectionCard(item) {
        const missing = item.missingConfiguration?.length ? `Falta: ${item.missingConfiguration.join(', ')}` : '';
        const beeperMode = ['beeper_local', 'beeper_desktop_node'].includes(item.connectionMode);
        const nodeStatus = beeperMode ? `<span class="social-node-state ${item.node?.live ? 'is-live' : ''}"><i></i>${item.node?.live ? 'Recepción en vivo' : item.node?.reachable ? 'Nodo disponible' : 'Nodo sin conexión'}</span>` : '';
        const actionLabel = beeperMode ? (item.node?.paired ? 'Verificar cuenta' : item.connectionMode === 'beeper_desktop_node' ? 'Configurar en este PC' : 'Vincular con Beeper') : (item.canConnect ? 'Conectar' : 'Revisar configuración');
        return `<article class="social-connection ${item.connected ? 'is-connected' : ''}" data-provider-card="${item.id}"><div class="social-connection__top"><span class="social-connection__logo" data-provider="${item.id}">${item.label.slice(0, 1)}</span><div><strong>${esc(item.label)}</strong><small>${esc(stateLabel(item.state))}</small></div><label class="social-switch"><input type="checkbox" data-provider-toggle="${item.id}" ${item.enabled ? 'checked' : ''}><span></span><em>${item.enabled ? 'Activo' : 'Inactivo'}</em></label></div><p>${esc(missing || description(item.id))}</p>${nodeStatus}<div class="social-connection__actions">${item.connected ? `<button type="button" class="is-secondary" data-provider-disconnect="${item.id}">Desactivar canal</button>` : `<button type="button" data-provider-connect="${item.id}" ${!item.enabled ? 'disabled' : ''}>${actionLabel}</button>`}<span>${item.accountLabel ? esc(item.accountLabel) : 'Sin cuenta vinculada'}</span></div><div data-provider-extra></div></article>`;
    }
    function renderProcedures() {
        if (!procedures.length) return '<div class="procedure-empty"><strong>No hay rutas guardadas</strong><span>Inicia una observación y Gunter irá registrando los controles que utilices.</span></div>';
        return procedures.map(item => {
            const native = item.steps.some(step => step.nodeType !== 'WEB');
            return `<article class="procedure-row"><div class="procedure-row__index">${item.steps.length}</div><div class="procedure-row__copy"><strong>${esc(item.name)}</strong><span>${stateLabelProcedure(item.state)} · ${native ? 'Web + nodo nativo' : 'Web'} · v${item.version}</span></div><div class="procedure-row__actions">${item.state === 'OBSERVED' ? '<button type="button" data-procedure-action="simulate">Simular</button>' : ''}${item.state === 'SIMULATED' ? '<button type="button" data-procedure-action="approve">Aprobar</button>' : ''}${['APPROVED','ASSISTED','TRUSTED'].includes(item.state) ? '<button type="button" data-procedure-action="execute">Ejecutar</button>' : ''}<button type="button" class="is-secondary" data-procedure-id="${item.id}" data-procedure-action="details">${native && item.state === 'OBSERVED' ? 'Requisitos' : 'Detalles'}</button></div><div class="procedure-row__status" data-state="${item.state}">${item.state}</div><input type="hidden" value="${item.id}"></article>`;
        }).join('');
    }
    function bind() {
        host.querySelectorAll('[data-provider-toggle]').forEach(input => input.addEventListener('change', async () => { input.disabled = true; try { await window.GunterControlPlane.updateSocialConnection({ provider: input.dataset.providerToggle, enabled: input.checked }); await refresh(); } catch (error) { window.alert(human(error)); input.disabled = false; } }));
        host.querySelectorAll('[data-provider-connect]').forEach(button => button.addEventListener('click', () => connect(button.dataset.providerConnect, button)));
        host.querySelectorAll('[data-provider-disconnect]').forEach(button => button.addEventListener('click', () => disconnect(button.dataset.providerDisconnect, button)));
        host.querySelector('[data-beeper-unpair]')?.addEventListener('click', unpairBeeper);
        host.querySelector('[data-start-recording]')?.addEventListener('click', () => { const name = host.querySelector('[data-procedure-name]').value; const result = window.GunterProcedureRecorder.start(name); if (!result.ok && result.error !== 'consent_declined') window.alert(human({ code: result.error })); });
        host.querySelector('[data-desktop-procedure]')?.addEventListener('click', () => openDesktopBuilder(host.querySelector('[data-procedure-name]').value));
        host.querySelector('[data-instagram-template]')?.addEventListener('click', () => {
            window.GunterNotificationsService?.showToast?.('Abre Instagram Web y captura: Nueva publicación → selector de archivo → Siguiente → Compartir. Elige “última descarga” en el paso de archivo.', { duration: 9000 });
            openDesktopBuilder('Publicar la última descarga en Instagram');
        });
        host.querySelectorAll('[data-procedure-action]').forEach(button => button.addEventListener('click', () => procedureAction(button)));
    }
    async function connect(provider, button) {
        const current = connections.find(item => item.id === provider);
        if (['beeper_local', 'beeper_desktop_node'].includes(current?.connectionMode)) { openBeeperGuide(provider, current); return; }
        if (!current?.canConnect) { window.alert(current?.missingConfiguration?.length ? `Configura estas variables del servidor y reinicia Gunter:\n${current.missingConfiguration.join('\n')}` : `El adaptador oficial de ${current?.label || provider} aún no está instalado. El estado seguirá visible como pendiente; no se marcará como conectado.`); return; }
        button.disabled = true; button.textContent = 'Conectando…';
        try { await window.GunterControlPlane.connectSocial(provider); await refresh(); if (provider === 'whatsapp') showWhatsAppQr(); } catch (error) { window.alert(human(error)); await refresh(); }
    }
    async function showWhatsAppQr() {
        const extra = host.querySelector('[data-provider-card="whatsapp"] [data-provider-extra]');
        if (!extra || !window.GunterWhatsApp) return;
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const info = await window.GunterWhatsApp.qr();
            if (info.qr) { extra.innerHTML = `<div class="social-qr"><img src="${info.qr}" alt="Código QR para conectar WhatsApp"><span>Escanéalo desde WhatsApp → Dispositivos vinculados.</span></div>`; return; }
            await new Promise(resolve => setTimeout(resolve, 750));
        }
    }
    async function disconnect(provider, button) { if (!window.confirm(`¿Desconectar ${provider}?`)) return; button.disabled = true; try { await window.GunterControlPlane.disconnectSocial(provider); await refresh(); } catch (error) { window.alert(human(error)); button.disabled = false; } }
    async function unpairBeeper() {
        if (!window.confirm('Esto desvinculará Instagram y Messenger de Gunter. Las cuentas seguirán conectadas dentro de Beeper. ¿Continuar?')) return;
        try { await window.GunterControlPlane.unpairBeeper(); await refresh(); } catch (error) { window.alert(human(error)); }
    }
    function openBeeperGuide(provider, current) {
        document.querySelector('.social-onboarding')?.remove();
        const paired = Boolean(current.node?.paired);
        const desktopNode = current.connectionMode === 'beeper_desktop_node';
        const dialog = document.createElement('dialog');
        dialog.className = 'social-onboarding';
        dialog.innerHTML = `<form method="dialog" class="social-onboarding__shell" data-beeper-form>
            <button type="button" class="social-onboarding__close" aria-label="Cerrar" data-beeper-close>×</button>
            <aside class="social-onboarding__guide">
            <span class="gunter-particle-thumb social-onboarding__gunter" data-gunter-particles="thumb" role="img" aria-label="Gunter en partículas"></span>
                <span>GUNTER TE EXPLICA</span>
                <h3>${paired ? `Verifiquemos ${providerLabel(provider)}` : 'Antes de vincular'}</h3>
                <p>${paired ? 'El nodo ya está autorizado. Solo comprobaré que tu cuenta esté añadida y disponible.' : desktopNode ? 'Tu PC ya está vinculado. El acceso de Beeper se guardará cifrado en ese equipo, no en el servidor.' : 'Esta conexión funciona desde tu propio equipo y necesita que Beeper permanezca abierto.'}</p>
            </aside>
            <section class="social-onboarding__content">
                <div class="social-onboarding__steps" aria-label="Proceso de conexión"><span class="is-active">1 · Condiciones</span><span>2 · Acceso local</span><span>3 · Verificación</span></div>
                ${paired ? pairedGuide(provider, current, desktopNode) : desktopNode ? firstNodePairGuide(provider) : firstPairGuide(provider)}
                <div class="social-onboarding__error" role="alert" data-beeper-error hidden></div>
                <div class="social-onboarding__actions"><button type="button" class="is-secondary" data-beeper-close>Ahora no</button><button type="submit" data-beeper-submit>${paired ? 'Verificar de nuevo' : 'Verificar y vincular'}</button></div>
            </section>
        </form>`;
        document.body.appendChild(dialog);
        dialog.querySelectorAll('[data-beeper-close]').forEach(button => button.addEventListener('click', () => dialog.close()));
        dialog.addEventListener('close', () => dialog.remove());
        dialog.querySelector('[data-beeper-form]').addEventListener('submit', event => submitBeeper(event, provider, paired, dialog, desktopNode));
        dialog.showModal();
    }
    function firstPairGuide(provider) {
        return `<div class="social-onboarding__conditions">
            <label><input type="checkbox" required data-beeper-condition><span><strong>Beeper Desktop debe estar instalado y abierto.</strong> La recepción en vivo se pausa cuando el PC o Beeper se apagan.</span></label>
            <label><input type="checkbox" required data-beeper-condition><span><strong>La cuenta debe estar añadida en Beeper.</strong> Puede ser personal; Meta podría solicitar verificación o reconexión.</span></label>
            <label><input type="checkbox" required data-beeper-condition><span><strong>El historial inicial puede ser parcial.</strong> Los mensajes recientes aparecerán primero mientras Beeper sincroniza.</span></label>
            <label><input type="checkbox" required data-beeper-condition><span><strong>Gunter no enviará por iniciativa propia.</strong> Cada mensaje necesita una orden explícita o confirmación manual.</span></label>
        </div>
        <div class="social-onboarding__setup"><div><b>1</b><p><strong>Prepara Beeper</strong><span>Instálalo, inicia sesión y agrega tu cuenta de ${providerLabel(provider)}.</span></p><a href="https://www.beeper.com/download" target="_blank" rel="noopener">Descargar Beeper ↗</a></div><div><b>2</b><p><strong>Crea un acceso para Gunter</strong><span>En Beeper abre Configuración → Integraciones → Conexiones aprobadas → +.</span></p><a href="https://developers.beeper.com/desktop-api/auth/" target="_blank" rel="noopener">Ver guía oficial ↗</a></div></div>
        <label class="social-onboarding__token"><span>Token local de Beeper</span><input type="password" autocomplete="off" spellcheck="false" minlength="12" required placeholder="Pega aquí el token creado en Beeper"><small>Gunter lo cifra antes de guardarlo. Nunca escribas aquí tu contraseña de Instagram o Facebook.</small></label>`;
    }
    function firstNodePairGuide(provider) {
        return `<div class="social-onboarding__conditions">
            <label><input type="checkbox" required data-beeper-condition><span><strong>Beeper Desktop debe estar instalado y abierto.</strong> La recepción en vivo se pausa cuando el PC o Beeper se apagan.</span></label>
            <label><input type="checkbox" required data-beeper-condition><span><strong>La cuenta debe estar añadida en Beeper.</strong> Puede ser personal; Meta podría solicitar verificación o reconexión.</span></label>
            <label><input type="checkbox" required data-beeper-condition><span><strong>Gunter no enviará por iniciativa propia.</strong> Cada mensaje necesita una orden explícita o confirmación manual.</span></label>
        </div>
        <div class="social-onboarding__setup"><div><b>1</b><p><strong>Crea el acceso en Beeper</strong><span>Configuración → Integraciones → Conexiones aprobadas → +.</span></p><a href="https://developers.beeper.com/desktop-api/auth/" target="_blank" rel="noopener">Ver guía oficial ↗</a></div><div><b>2</b><p><strong>Guárdalo dentro de Gunter Node</strong><span>Ejecuta el comando en la terminal de este PC y vuelve a iniciar el nodo.</span></p></div></div>
        <div class="social-onboarding__command"><span>En la terminal de este PC</span><code>node gunter-node/cli.js beeper --token &lt;TOKEN_LOCAL_DE_BEEPER&gt;</code><small>Después ejecuta <b>npm run node:start</b>. El token se cifra en este equipo y no viaja al servidor de Gunter.</small></div>`;
    }
    function pairedGuide(provider, current, desktopNode = false) {
        const state = current.node?.reachable ? 'El nodo responde correctamente.' : 'No encuentro Beeper Desktop en este equipo.';
        return `<div class="social-onboarding__paired"><span class="${current.node?.reachable ? 'is-ok' : ''}"><i></i>${state}</span><h4>Comprueba estos dos puntos</h4><ol><li>Beeper Desktop está abierto en ${desktopNode ? 'el PC vinculado' : 'este mismo PC'}.</li><li>La cuenta de ${providerLabel(provider)} aparece en Beeper y no solicita reconexión.</li></ol><p>Después pulsa <strong>Verificar de nuevo</strong>. ${desktopNode ? 'La credencial permanece dentro de Gunter Node.' : 'No necesitas pegar otro token salvo que hayas revocado el acceso en Beeper.'}</p></div>`;
    }
    async function submitBeeper(event, provider, paired, dialog, desktopNode = false) {
        event.preventDefault();
        const submit = dialog.querySelector('[data-beeper-submit]');
        const errorBox = dialog.querySelector('[data-beeper-error]');
        errorBox.hidden = true; submit.disabled = true; submit.textContent = 'Comprobando nodo…';
        try {
            if (!paired && !desktopNode) {
                const accepted = [...dialog.querySelectorAll('[data-beeper-condition]')].every(input => input.checked);
                if (!accepted) throw { code: 'beeper_consent_required' };
                const token = dialog.querySelector('.social-onboarding__token input').value.trim();
                await window.GunterControlPlane.pairBeeper({ provider, token, consent: true, consentVersion: '2026-08-30' });
            } else {
                if (!paired) {
                    const accepted = [...dialog.querySelectorAll('[data-beeper-condition]')].every(input => input.checked);
                    if (!accepted) throw { code: 'beeper_consent_required' };
                }
                await window.GunterControlPlane.updateSocialConnection({ provider, enabled: true });
                await window.GunterControlPlane.connectSocial(provider);
            }
            await refresh();
            const result = connections.find(item => item.id === provider);
            if (!result?.connected) throw { code: result?.state === 'account_required' ? 'beeper_account_required' : result?.state || 'beeper_node_offline' };
            dialog.querySelector('.social-onboarding__content').innerHTML = `<div class="social-onboarding__success"><span>✓</span><h3>${providerLabel(provider)} está conectado</h3><p>Gunter ya puede recibir conversaciones mientras Beeper permanezca abierto. Para enviar, seguirá pidiendo tu confirmación.</p><div><a href="day.html#conversations">Abrir Conversaciones</a><button type="button" data-beeper-done>Listo</button></div></div>`;
            dialog.querySelector('[data-beeper-done]').onclick = () => dialog.close();
        } catch (error) {
            errorBox.textContent = human(error); errorBox.hidden = false;
            submit.disabled = false; submit.textContent = paired ? 'Verificar de nuevo' : 'Verificar y vincular';
        }
    }
    async function procedureAction(button) {
        const row = button.closest('.procedure-row'), id = row.querySelector('input[type="hidden"]').value, action = button.dataset.procedureAction;
        if (action === 'details') { const item = procedures.find(procedure => procedure.id === id); window.alert(item.steps.map(step => `${step.order}. ${step.action} [${step.nodeType}]${step.requiresConfirmation ? ' · requiere confirmación' : ''}`).join('\n')); return; }
        button.disabled = true;
        try {
            const recorder = window.GunterProcedureRecorder;
            const result = action === 'simulate' ? await recorder.simulate(id) : action === 'approve' ? await recorder.approve(id) : await recorder.execute(id);
            if (result?.ok === false && result.failures) window.alert(`La simulación encontró requisitos pendientes:\n${result.failures.map(item => `Paso ${item.order}: ${item.reason}`).join('\n')}`);
            await refresh();
        } catch (error) { window.alert(human(error)); button.disabled = false; }
    }
    async function openDesktopBuilder(initialName = '') {
        let nodeData;
        try { nodeData = await window.GunterControlPlane.nodes(); } catch (error) { window.alert(human(error)); return; }
        const nodes = (nodeData.items || []).filter(item => item.nodeType === 'DESKTOP' && ['ONLINE', 'DEGRADED', 'SYNCING'].includes(item.state));
        if (!nodes.length) { window.alert('Primero vincula e inicia Gunter Node en el PC que quieres enseñar.'); return; }
        document.querySelector('.procedure-builder')?.remove();
        const steps = [];
        const dialog = document.createElement('dialog');
        dialog.className = 'procedure-builder';
        dialog.innerHTML = `<div class="procedure-builder__shell">
            <header><div><span>RUTA DE PC · CAPTURA SUPERVISADA</span><h3>Enseña una secuencia</h3><p>Señala cada control. Gunter guardará su identidad accesible, nunca la posición del cursor ni el texto que escribas.</p></div><button type="button" data-builder-close aria-label="Cerrar">×</button></header>
            <div class="procedure-builder__setup">
                <label>Nombre de la ruta<input type="text" maxlength="160" data-builder-name value="${esc(initialName)}" placeholder="Ej. completar reporte semanal"></label>
                <label>PC<select data-builder-node>${nodes.map(node => `<option value="${esc(node.nodeId)}">${esc(node.deviceName)} · ${esc(node.state)}</option>`).join('')}</select></label>
            </div>
            <div class="procedure-builder__capture">
                <div><strong>Nuevo paso</strong><span>Elige la acción, pulsa capturar y mantén el cursor sobre el control en la otra aplicación.</span></div>
                <select data-builder-action aria-label="Acción del paso">
                    <option value="desktop.ui.click">Pulsar control</option><option value="desktop.ui.type">Escribir en campo</option>
                    <option value="desktop.ui.focus">Enfocar control</option><option value="desktop.ui.wait">Esperar hasta que aparezca</option>
                    <option value="desktop.ui.scroll">Desplazar contenido</option><option value="desktop.ui.hotkey">Usar atajo seguro</option>
                    <option value="desktop.ui.select_file">Seleccionar archivo</option>
                </select>
                <div class="procedure-builder__options" data-builder-options></div>
                <button type="button" data-builder-capture>Capturar en 5 segundos</button>
            </div>
            <div class="procedure-builder__status" data-builder-status aria-live="polite"><i></i><span>Preparado para capturar el primer control.</span></div>
            <ol class="procedure-builder__steps" data-builder-steps></ol>
            <footer><small>Antes de aprobarla, la ruta se simulará buscando cada control sin pulsarlo.</small><div><button type="button" class="is-secondary" data-builder-close>Cancelar</button><button type="button" data-builder-save disabled>Guardar ruta observada</button></div></footer>
        </div>`;
        document.body.appendChild(dialog);
        const stepList = dialog.querySelector('[data-builder-steps]');
        const save = dialog.querySelector('[data-builder-save]');
        const status = dialog.querySelector('[data-builder-status]');
        const actionSelect = dialog.querySelector('[data-builder-action]');
        const optionsPanel = dialog.querySelector('[data-builder-options]');
        const renderOptions = () => {
            const skill = actionSelect.value;
            optionsPanel.innerHTML = skill === 'desktop.ui.wait'
                ? '<label>Espera máxima<select data-step-timeout><option value="5000">5 segundos</option><option value="10000" selected>10 segundos</option><option value="20000">20 segundos</option><option value="30000">30 segundos</option></select></label>'
                : skill === 'desktop.ui.scroll'
                    ? '<label>Dirección<select data-step-direction><option value="down">Abajo</option><option value="up">Arriba</option><option value="right">Derecha</option><option value="left">Izquierda</option></select></label><label>Distancia<select data-step-amount><option value="1">Corta</option><option value="3" selected>Media</option><option value="6">Larga</option></select></label>'
                    : skill === 'desktop.ui.hotkey'
                        ? '<label>Atajo<select data-step-shortcut><option value="ctrl+s">Guardar · Ctrl+S</option><option value="ctrl+f">Buscar · Ctrl+F</option><option value="ctrl+a">Seleccionar todo · Ctrl+A</option><option value="ctrl+c">Copiar · Ctrl+C</option><option value="ctrl+v">Pegar · Ctrl+V</option><option value="enter">Aceptar · Enter</option><option value="escape">Cerrar · Escape</option><option value="tab">Siguiente campo · Tab</option><option value="shift+tab">Campo anterior · Shift+Tab</option><option value="alt+f4">Cerrar aplicación · Alt+F4</option></select></label>'
                        : skill === 'desktop.ui.select_file'
                            ? '<label>Archivo al ejecutar<select data-step-source><option value="prompt">Preguntar cuál archivo</option><option value="latest_download">Usar la última descarga</option></select></label>'
                            : '<span>Este paso utilizará únicamente la identidad accesible del control.</span>';
        };
        const readOptions = skill => skill === 'desktop.ui.wait' ? { timeoutMs: Number(dialog.querySelector('[data-step-timeout]')?.value) || 10000 }
            : skill === 'desktop.ui.scroll' ? { direction: dialog.querySelector('[data-step-direction]')?.value || 'down', amount: Number(dialog.querySelector('[data-step-amount]')?.value) || 3 }
            : skill === 'desktop.ui.hotkey' ? { shortcut: dialog.querySelector('[data-step-shortcut]')?.value || 'ctrl+s' }
            : skill === 'desktop.ui.select_file' ? { source: dialog.querySelector('[data-step-source]')?.value || 'prompt' }
            : {};
        const renderSteps = () => {
            stepList.innerHTML = steps.length ? steps.map((step, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span><div><strong>${esc(actionLabel(step.skill))} · ${esc(step.target.target.name || step.target.target.automationId)}</strong><small>${esc(step.target.app || step.target.window)}${step.target.window ? ` · ${esc(step.target.window)}` : ''} · ${esc(step.target.target.controlType)}${stepDetail(step) ? ` · ${esc(stepDetail(step))}` : ''}</small></div><button type="button" data-remove-step="${index}" aria-label="Eliminar paso">×</button></li>`).join('') : '<li class="is-empty"><div><strong>Aún no hay pasos</strong><small>Captura el primer botón o campo de la rutina.</small></div></li>';
            save.disabled = !steps.length;
            stepList.querySelectorAll('[data-remove-step]').forEach(button => button.onclick = () => { steps.splice(Number(button.dataset.removeStep), 1); renderSteps(); });
        };
        dialog.querySelector('[data-builder-capture]').onclick = async event => {
            const button = event.currentTarget;
            const skill = dialog.querySelector('[data-builder-action]').value;
            const nodeId = dialog.querySelector('[data-builder-node]').value;
            button.disabled = true; save.disabled = true; status.classList.remove('is-error'); status.classList.add('is-capturing');
            let seconds = 7;
            status.querySelector('span').textContent = `Cambia a la aplicación y señala el control… ${seconds}`;
            const countdown = setInterval(() => { seconds -= 1; status.querySelector('span').textContent = seconds > 0 ? `Mantén el cursor sobre el control… ${seconds}` : 'Identificando el control accesible…'; }, 1000);
            try {
                const target = await window.GunterProcedureRecorder.captureDesktopTarget(nodeId, 5000);
                const supported = target.target?.supportedActions || [];
                if (skill === 'desktop.ui.click' && !supported.includes('click')) throw new Error('Ese elemento no admite pulsación accesible. Señala el botón o control accionable más cercano.');
                if (skill === 'desktop.ui.type' && !supported.includes('type')) throw new Error('Ese elemento no es un campo editable accesible. Señala directamente el área de escritura.');
                if (skill === 'desktop.ui.scroll' && !supported.includes('scroll')) throw new Error('Ese elemento no expone desplazamiento accesible. Señala directamente la lista o panel desplazable.');
                steps.push({ skill, target, options: readOptions(skill) });
                status.querySelector('span').textContent = `Capturado: ${target.target.name || target.target.automationId} en ${target.app || target.window}.`;
                renderSteps();
            } catch (error) { status.querySelector('span').textContent = human(error); status.classList.add('is-error'); }
            finally { clearInterval(countdown); status.classList.remove('is-capturing'); button.disabled = false; save.disabled = !steps.length; }
        };
        save.onclick = async () => {
            const name = dialog.querySelector('[data-builder-name]').value.trim();
            save.disabled = true;
            try { await window.GunterProcedureRecorder.createDesktopProcedure(name, steps); dialog.close(); await refresh(); }
            catch (error) { status.querySelector('span').textContent = human(error); status.classList.add('is-error'); save.disabled = false; }
        };
        dialog.querySelectorAll('[data-builder-close]').forEach(button => button.onclick = () => dialog.close());
        dialog.addEventListener('close', () => dialog.remove());
        actionSelect.addEventListener('change', renderOptions);
        renderOptions(); renderSteps(); dialog.showModal();
    }
    function actionLabel(skill) { return ({ 'desktop.ui.click': 'Pulsar', 'desktop.ui.type': 'Escribir', 'desktop.ui.focus': 'Enfocar', 'desktop.ui.wait': 'Esperar', 'desktop.ui.scroll': 'Desplazar', 'desktop.ui.hotkey': 'Atajo', 'desktop.ui.select_file': 'Seleccionar archivo' })[skill] || skill; }
    function stepDetail(step) {
        if (step.skill === 'desktop.ui.wait') return `máx. ${Math.round((step.options?.timeoutMs || 10000) / 1000)} s`;
        if (step.skill === 'desktop.ui.scroll') return `${({ up: 'arriba', down: 'abajo', left: 'izquierda', right: 'derecha' })[step.options?.direction] || 'abajo'} × ${step.options?.amount || 3}`;
        if (step.skill === 'desktop.ui.hotkey') return step.options?.shortcut || 'enter';
        if (step.skill === 'desktop.ui.select_file') return step.options?.source === 'latest_download' ? 'última descarga' : 'preguntar al ejecutar';
        return '';
    }
    function description(id) { return ({ whatsapp: 'Mensajes y conversaciones mediante el bridge local de WhatsApp.', instagram: 'Mensajes de cuentas personales o profesionales a través del nodo local de Beeper.', messenger: 'Conversaciones de perfiles personales de Facebook a través del nodo local de Beeper.' })[id] || ''; }
    function providerLabel(id) { return ({ instagram: 'Instagram', messenger: 'Messenger', whatsapp: 'WhatsApp' })[id] || id; }
    function stateLabel(value) { return ({ connected: 'Conectado y recibiendo', syncing: 'Sincronizando historial', disconnected: 'Activo, sin conectar', disabled: 'Desactivado', node_required: 'Necesita Beeper Desktop', node_offline: 'Beeper está cerrado o sin conexión', token_invalid: 'Acceso revocado', account_required: 'Añade la cuenta en Beeper', reconnect_required: 'La cuenta necesita reconexión', connection_required: 'La cuenta necesita conexión', attention_required: 'Beeper necesita tu atención', reconnecting: 'Reconectando recepción en vivo', connecting: 'Conectando', backfilling: 'Sincronizando historial' })[value] || value; }
    function stateLabelProcedure(value) { return ({ DRAFT: 'Borrador', OBSERVED: 'Observada, falta simular', SIMULATED: 'Simulada, falta aprobar', APPROVED: 'Aprobada', ASSISTED: 'Ejecución supervisada', TRUSTED: 'Ruta confiable', RETIRED: 'Retirada' })[value] || value; }
    function human(error) {
        const code = error.code || error.message;
        return ({
            procedure_name_required: 'Escribe un nombre para la ruta.', procedure_steps_required: 'Captura al menos un paso antes de guardar.',
            recording_already_active: 'Ya hay una ruta en observación.', desktop_node_offline: 'No hay un PC con Gunter Node conectado.',
            desktop_node_update_required: 'Actualiza y reinicia Gunter Node para capturar controles.',
            desktop_ui_control_not_found: 'No pude identificar un control accesible bajo el cursor.',
            desktop_ui_control_not_identifiable: 'El elemento señalado no tiene nombre ni identificador accesible. Señala directamente el botón o campo.',
            desktop_ui_control_not_scrollable: 'El control señalado no permite desplazamiento accesible.',
            desktop_ui_sensitive_field_not_allowed: 'Por seguridad no se pueden capturar contraseñas, códigos, tokens, PIN ni OTP.',
            social_configuration_required: 'Falta configurar el proveedor.', social_adapter_required: 'El adaptador del proveedor todavía no está disponible.',
            admin_only: 'Solo el administrador puede conectar o desconectar el bridge compartido de WhatsApp.',
            beeper_consent_required: 'Lee y acepta las cuatro condiciones para continuar.', beeper_token_required: 'Pega el token local creado dentro de Beeper.',
            beeper_token_invalid: 'Beeper rechazó el token. Crea una nueva conexión aprobada e inténtalo otra vez.',
            beeper_node_offline: 'No pude encontrar Beeper Desktop. Ábrelo en este equipo y comprueba que la API esté habilitada.',
            beeper_node_required: 'Primero vincula Gunter con Beeper Desktop.',
            beeper_account_required: `El nodo funciona, pero aún no aparece tu cuenta de ${providerLabel(error.provider || '') || 'esta red'}. Agrégala en Beeper y vuelve a verificar.`,
            beeper_reconnect_required: 'Abre Beeper y vuelve a autenticar esta cuenta.',
            beeper_attention_required: 'Beeper necesita que completes una verificación antes de continuar.',
            social_provider_disconnected: 'La cuenta todavía no está lista en Beeper.'
        })[code] || error.message || code || 'No se pudo completar.';
    }
    function esc(value) { const div = document.createElement('div'); div.textContent = String(value ?? ''); return div.innerHTML; }
    window.addEventListener('gunter-procedures-change', refresh);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mount()); else mount();
    window.GunterSocialSettings = { mount, refresh };
})();
