/* Supervised browser route recorder. It stores semantic targets, never typed values or secrets. */
(function () {
    const KEY = 'gunter_procedure_recording_v1';
    let recording = read();
    let saving = false;

    function read() { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; } }
    function persist() { try { recording ? sessionStorage.setItem(KEY, JSON.stringify(recording)) : sessionStorage.removeItem(KEY); } catch {} }
    function start(name) {
        if (recording) return { ok: false, error: 'recording_already_active' };
        const cleanName = String(name || '').trim().slice(0, 160);
        if (cleanName.length < 2) return { ok: false, error: 'procedure_name_required' };
        const approved = window.confirm('Gunter observará qué botones usas y en qué pantalla. No guardará contraseñas, texto escrito, archivos ni tokens. ¿Iniciar observación?');
        if (!approved) return { ok: false, error: 'consent_declined' };
        recording = { name: cleanName, startedAt: new Date().toISOString(), steps: [] };
        persist(); renderBanner();
        return { ok: true };
    }
    async function stop() {
        if (!recording || saving) return { ok: false, error: 'recording_not_active' };
        if (!recording.steps.length) return { ok: false, error: 'procedure_steps_required' };
        saving = true; renderBanner();
        try {
            const cp = window.GunterControlPlane;
            if (!cp?.createProcedure) throw new Error('control_plane_unavailable');
            const created = await cp.createProcedure({
                name: recording.name, consent: true, captureMode: 'web_observation', steps: recording.steps,
                supportedNodes: ['WEB'], requiredSkills: [...new Set(recording.steps.map(item => item.skill).filter(Boolean))]
            });
            const id = created.procedure.id;
            await cp.transitionProcedure({ id, state: 'OBSERVED' });
            recording = null; persist(); renderBanner();
            window.dispatchEvent(new CustomEvent('gunter-procedures-change', { detail: { procedureId: id } }));
            toast('Ruta guardada. Ahora debes simularla y aprobarla antes de ejecutarla.');
            return { ok: true, procedureId: id };
        } catch (error) {
            toast(error.message || 'No pude guardar la ruta.', true);
            return { ok: false, error: error.code || error.message };
        } finally { saving = false; renderBanner(); }
    }
    function cancel() { recording = null; persist(); renderBanner(); return { ok: true }; }

    function onClick(event) {
        if (!recording) return;
        const element = event.target?.closest?.('button,a,input,[role="button"],[data-gunter-action]');
        if (!element || element.closest('[data-gunter-recorder-control]')) return;
        if (element.matches('input[type="password"]')) return;
        const target = describe(element);
        if (!target.actionId && !target.elementId && !target.testId && !target.name) return;
        const text = `${target.name || ''} ${target.actionId || ''}`;
        const external = /enviar|publicar|subir|pagar|eliminar|borrar/i.test(text) || element.dataset.gunterRisk === 'external_write';
        recording.steps.push({
            action: `Activar ${target.name || target.actionId || target.elementId}`,
            kind: element.matches('a[href]') ? 'navigate' : element.matches('input[type="file"]') ? 'file.choose' : 'click',
            nodeType: 'WEB', route: location.pathname, target,
            risk: external ? 'external_write' : 'local_write', requiresConfirmation: external, verify: true
        });
        recording.steps = recording.steps.slice(0, 100);
        persist(); renderBanner();
    }
    function describe(element) {
        const role = element.getAttribute('role') || (element.tagName === 'A' ? 'link' : element.tagName === 'BUTTON' ? 'button' : element.tagName === 'INPUT' ? 'input' : 'control');
        const name = (element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || element.value || '').trim().replace(/\s+/g, ' ').slice(0, 180);
        return {
            actionId: String(element.dataset.gunterAction || '').slice(0, 160) || undefined,
            elementId: String(element.id || '').slice(0, 160) || undefined,
            testId: String(element.dataset.testid || '').slice(0, 160) || undefined,
            role, name
        };
    }
    function findTarget(target, root = document) {
        if (target.actionId) { const found = root.querySelector(`[data-gunter-action="${cssEscape(target.actionId)}"]`); if (found) return found; }
        if (target.elementId) { const found = root.getElementById?.(target.elementId) || root.querySelector(`#${cssEscape(target.elementId)}`); if (found) return found; }
        if (target.testId) { const found = root.querySelector(`[data-testid="${cssEscape(target.testId)}"]`); if (found) return found; }
        return [...root.querySelectorAll?.('button,a,input,[role="button"]') || []].find(element => describe(element).role === target.role && describe(element).name === target.name) || null;
    }

    async function simulate(procedureId) {
        const procedure = await getProcedure(procedureId);
        if (procedure.state !== 'OBSERVED') throw new Error('La ruta debe estar en estado Observada.');
        const failures = [];
        for (const step of procedure.steps) {
            if (step.nodeType === 'DESKTOP') {
                try {
                    if (step.skill === 'desktop.files.latest') {
                        const command = await runDesktopCommand(step.skill, {}, { autonomy: 'L4' });
                        if (!command?.evidence?.fileFound) failures.push({ order: step.order, reason: 'file_not_verified' });
                    } else if (String(step.skill || '').startsWith('desktop.ui.')) {
                        const target = desktopTarget(step);
                        const command = await runDesktopCommand('desktop.ui.inspect', { app: target.app, window: target.window, target: target.control }, { autonomy: 'L3' });
                        if (!command?.evidence?.controlsInspected) failures.push({ order: step.order, reason: 'control_not_verified' });
                    } else {
                        failures.push({ order: step.order, reason: `simulation_not_supported:${step.skill || 'unknown'}` });
                    }
                } catch (error) { failures.push({ order: step.order, reason: error.code || error.message }); }
                continue;
            }
            if (step.nodeType !== 'WEB') { failures.push({ order: step.order, reason: `native_node_required:${step.nodeType}` }); continue; }
            try {
                const response = await fetch(step.route || location.pathname, { credentials: 'same-origin' });
                const html = await response.text();
                const doc = new DOMParser().parseFromString(html, 'text/html');
                if (!findTarget(step.target || {}, doc)) failures.push({ order: step.order, reason: 'target_not_found' });
            } catch { failures.push({ order: step.order, reason: 'route_unavailable' }); }
        }
        if (failures.length) return { ok: false, failures };
        return window.GunterControlPlane.transitionProcedure({ id: procedureId, state: 'SIMULATED', evidence: { checkedSteps: procedure.steps.length, failures: 0, mode: 'non_destructive_dom_check' } });
    }
    async function approve(procedureId) {
        const procedure = await getProcedure(procedureId);
        if (procedure.state !== 'SIMULATED') throw new Error('Primero simula la ruta sin ejecutar acciones.');
        if (!window.confirm(`Aprobar “${procedure.name}” permitirá ejecutarla bajo supervisión. Las acciones externas volverán a pedir confirmación. ¿Aprobar?`)) return { ok: false, error: 'approval_declined' };
        return window.GunterControlPlane.transitionProcedure({ id: procedureId, state: 'APPROVED', evidence: { approvedByUser: true, mode: 'explicit_ui_confirmation' } });
    }
    async function execute(procedureId) {
        const procedure = await getProcedure(procedureId);
        if (!['APPROVED', 'ASSISTED', 'TRUSTED'].includes(procedure.state)) throw new Error('La ruta aún no está aprobada.');
        const executed = [];
        const runtime = { lastFile: null };
        for (const step of procedure.steps) {
            if (step.nodeType === 'DESKTOP') {
                if (step.skill === 'desktop.files.latest') {
                    const command = await runDesktopCommand(step.skill, { type: step.payloadTemplate?.type || '' }, { autonomy: 'L4' });
                    runtime.lastFile = command.result?.file || null;
                    executed.push(step.order);
                    continue;
                }
                if (!String(step.skill || '').startsWith('desktop.ui.')) throw new Error(`La capacidad ${step.skill || 'desconocida'} aún no admite repetición supervisada.`);
                const target = desktopTarget(step);
                if (step.requiresConfirmation && !window.confirm(`La ruta quiere ejecutar: ${step.action} en ${target.app || target.window}. ¿Confirmas este paso?`)) throw new Error('Ejecución cancelada antes de modificar la aplicación.');
                const payload = { app: target.app, window: target.window, target: target.control };
                if (step.skill === 'desktop.ui.type') {
                    const text = window.prompt(`Texto para “${target.control.name || target.control.automationId}” en ${target.app || target.window}:`);
                    if (text === null) throw new Error('Ejecución cancelada antes de escribir.');
                    if (!text.trim()) throw new Error('El texto no puede estar vacío.');
                    payload.text = text.slice(0, 4000);
                } else if (step.skill === 'desktop.ui.wait') {
                    payload.timeoutMs = Number(step.payloadTemplate?.timeoutMs) || 10000;
                } else if (step.skill === 'desktop.ui.scroll') {
                    payload.direction = step.payloadTemplate?.direction || 'down';
                    payload.amount = Number(step.payloadTemplate?.amount) || 3;
                } else if (step.skill === 'desktop.ui.hotkey') {
                    payload.shortcut = step.payloadTemplate?.shortcut || 'enter';
                } else if (step.skill === 'desktop.ui.select_file') {
                    let filePath = step.payloadTemplate?.source === 'latest_download' ? runtime.lastFile?.path : null;
                    if (!filePath) filePath = window.prompt('Ruta absoluta del archivo que debe seleccionar Gunter:');
                    if (filePath === null) throw new Error('Ejecución cancelada antes de seleccionar el archivo.');
                    if (!filePath.trim()) throw new Error('Indica una ruta de archivo válida.');
                    payload.filePath = filePath.trim().slice(0, 4096);
                }
                await runDesktopCommand(step.skill, payload, { autonomy: 'L3' });
                executed.push(step.order);
                continue;
            }
            if (step.nodeType !== 'WEB') throw new Error(`Se necesita un nodo ${step.nodeType} conectado para el paso ${step.order}.`);
            if (step.route && step.route !== location.pathname) throw new Error(`Abre ${step.route} para ejecutar esta ruta supervisada.`);
            const element = findTarget(step.target || {});
            if (!element) throw new Error(`No encuentro el control del paso ${step.order}. Vuelve a enseñar la ruta.`);
            if (step.risk === 'external_write' && !window.confirm(`La ruta quiere ejecutar: ${step.action}. ¿Confirmas este envío o publicación?`)) throw new Error('Ejecución cancelada antes de la acción externa.');
            if (step.kind === 'file.choose') { element.click(); throw new Error('Selecciona el archivo manualmente; el navegador no permite completar esta parte de forma automática.'); }
            element.click(); executed.push(step.order);
        }
        if (procedure.state === 'APPROVED') await window.GunterControlPlane.transitionProcedure({ id: procedureId, state: 'ASSISTED', evidence: { executedSteps: executed, mode: 'supervised_web_replay' } });
        return { ok: true, executed };
    }

    async function captureDesktopTarget(nodeId, delayMs = 5000) {
        const command = await runDesktopCommand('desktop.ui.capture_target', { delayMs }, { nodeId, autonomy: 'L2' });
        if (!command.result?.target || !command.evidence?.targetCaptured) throw new Error('El PC no pudo identificar el control señalado.');
        return command.result;
    }

    async function createDesktopProcedure(name, steps) {
        const cleanName = String(name || '').trim().slice(0, 160);
        if (cleanName.length < 2) throw new Error('procedure_name_required');
        const normalized = (Array.isArray(steps) ? steps : []).slice(0, 40).map((step, index) => {
            const allowedSkills = ['desktop.ui.click', 'desktop.ui.type', 'desktop.ui.focus', 'desktop.ui.wait', 'desktop.ui.scroll', 'desktop.ui.hotkey', 'desktop.ui.select_file'];
            const skill = allowedSkills.includes(step.skill) ? step.skill : null;
            if (!skill || (!step.target?.app && !step.target?.window) || (!step.target?.target?.name && !step.target?.target?.automationId)) return null;
            const label = step.target.target.name || step.target.target.automationId;
            const verbs = {
                'desktop.ui.click': 'Pulsar', 'desktop.ui.type': 'Escribir en', 'desktop.ui.focus': 'Enfocar',
                'desktop.ui.wait': 'Esperar', 'desktop.ui.scroll': 'Desplazar', 'desktop.ui.hotkey': 'Usar atajo en',
                'desktop.ui.select_file': 'Seleccionar archivo en'
            };
            const payloadTemplate = skill === 'desktop.ui.type' ? { text: '{{execution.text}}' }
                : skill === 'desktop.ui.wait' ? { timeoutMs: Math.max(1000, Math.min(Number(step.options?.timeoutMs) || 10000, 30000)) }
                : skill === 'desktop.ui.scroll' ? { direction: step.options?.direction || 'down', amount: Math.max(1, Math.min(Number(step.options?.amount) || 3, 10)) }
                : skill === 'desktop.ui.hotkey' ? { shortcut: step.options?.shortcut || 'enter' }
                : skill === 'desktop.ui.select_file' ? { source: step.options?.source === 'latest_download' ? 'latest_download' : 'prompt' }
                : {};
            const external = ['desktop.ui.click', 'desktop.ui.type', 'desktop.ui.hotkey', 'desktop.ui.select_file'].includes(skill);
            return {
                action: `${verbs[skill]} ${label}`,
                kind: skill.replace('desktop.', ''), skill, nodeType: 'DESKTOP',
                target: {
                    app: step.target.app, window: step.target.window, name: step.target.target.name,
                    automationId: step.target.target.automationId, controlType: step.target.target.controlType
                },
                payloadTemplate,
                risk: skill === 'desktop.ui.wait' ? 'read' : external ? 'external_write' : 'local_write',
                requiresConfirmation: external, verify: true, order: index + 1
            };
        }).filter(Boolean);
        if (!normalized.length) throw new Error('procedure_steps_required');
        const executableSteps = [];
        for (const step of normalized) {
            if (step.skill === 'desktop.ui.select_file' && step.payloadTemplate?.source === 'latest_download' && !executableSteps.some(item => item.skill === 'desktop.files.latest')) {
                executableSteps.push({
                    action: 'Localizar el archivo más reciente de Descargas', kind: 'file.latest_download', skill: 'desktop.files.latest',
                    nodeType: 'DESKTOP', target: { app: 'filesystem', screen: 'Downloads' }, payloadTemplate: {},
                    risk: 'read', requiresConfirmation: false, verify: true
                });
            }
            executableSteps.push(step);
        }
        executableSteps.forEach((step, index) => { step.order = index + 1; });
        const cp = window.GunterControlPlane;
        const created = await cp.createProcedure({
            name: cleanName, consent: true, captureMode: 'native_observation', steps: executableSteps,
            supportedNodes: ['DESKTOP'], requiredSkills: [...new Set(executableSteps.map(step => step.skill))]
        });
        await cp.transitionProcedure({ id: created.procedure.id, state: 'OBSERVED' });
        window.dispatchEvent(new CustomEvent('gunter-procedures-change', { detail: { procedureId: created.procedure.id } }));
        return created;
    }

    async function runDesktopCommand(skill, payload, options = {}) {
        const cp = window.GunterControlPlane;
        const data = await cp.nodes();
        const node = options.nodeId
            ? (data.items || []).find(item => item.nodeId === options.nodeId)
            : (data.items || []).find(item => item.nodeType === 'DESKTOP' && ['ONLINE', 'DEGRADED', 'SYNCING'].includes(item.state));
        if (!node || !['ONLINE', 'DEGRADED', 'SYNCING'].includes(node.state)) throw Object.assign(new Error('No hay un PC con Gunter Node conectado.'), { code: 'desktop_node_offline' });
        if (!(node.capabilities || []).includes(skill === 'desktop.ui.capture_target' ? 'desktop.ui.capture_target' : skill)) throw Object.assign(new Error('Actualiza y reinicia Gunter Node para usar esta capacidad.'), { code: 'desktop_node_update_required' });
        const queued = await cp.queueCommand({
            nodeId: node.nodeId, skill, payload, autonomy: options.autonomy || 'L3', confirmed: true,
            idempotencyKey: `procedure:${skill}:${Date.now()}:${Math.random().toString(36).slice(2, 9)}`, ttlMs: 120000
        });
        const command = await cp.waitForCommand(queued.command.id, { timeoutMs: 90000 });
        if (command.state !== 'VERIFIED') throw Object.assign(new Error(command.result?.error || command.error || 'El PC no pudo verificar el paso.'), { code: command.result?.error || command.error });
        return command;
    }

    function desktopTarget(step) {
        const app = step.target?.app || null;
        const requireDialogTitle = step.skill === 'desktop.ui.select_file';
        return { app, window: app && !requireDialogTitle ? null : step.target?.window || null, control: { name: step.target?.name || '', automationId: step.target?.automationId || '', controlType: step.target?.controlType || '' } };
    }
    async function getProcedure(id) {
        const data = await window.GunterControlPlane.procedures({ limit: 200 });
        const procedure = (data.items || []).find(item => item.id === id);
        if (!procedure) throw new Error('Ruta no encontrada.');
        return procedure;
    }
    function renderBanner() {
        let banner = document.getElementById('gunter-procedure-recorder');
        if (!recording) { banner?.remove(); return; }
        if (!banner) { banner = document.createElement('aside'); banner.id = 'gunter-procedure-recorder'; banner.className = 'procedure-recorder'; banner.dataset.gunterRecorderControl = 'true'; document.body.appendChild(banner); }
        banner.innerHTML = `<span class="procedure-recorder__pulse" aria-hidden="true"></span><div><strong>Gunter está aprendiendo</strong><small>${escapeHtml(recording.name)} · ${recording.steps.length} pasos</small></div><button type="button" data-recorder-stop>${saving ? 'Guardando…' : 'Detener y guardar'}</button><button type="button" class="procedure-recorder__cancel" data-recorder-cancel aria-label="Cancelar grabación">×</button>`;
        banner.querySelector('[data-recorder-stop]').disabled = saving;
        banner.querySelector('[data-recorder-stop]').onclick = () => stop();
        banner.querySelector('[data-recorder-cancel]').onclick = () => { if (window.confirm('¿Descartar la ruta observada?')) cancel(); };
    }
    function toast(message, danger) { window.GunterNotificationsService?.showToast?.(message, { priority: danger ? 'high' : 'normal', duration: 5000 }) || console[danger ? 'warn' : 'info']('[procedures]', message); }
    function cssEscape(value) { return window.CSS?.escape ? CSS.escape(String(value)) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }
    function escapeHtml(value) { const div = document.createElement('div'); div.textContent = String(value || ''); return div.innerHTML; }

    document.addEventListener('click', onClick, true);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderBanner); else renderBanner();
    window.GunterProcedureRecorder = { start, stop, cancel, simulate, approve, execute, captureDesktopTarget, createDesktopProcedure, isRecording: () => Boolean(recording) };
})();
