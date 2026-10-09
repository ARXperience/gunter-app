/* Read-only, account-safe diagnostics. Never returns raw logs or trace inputs. */
(function (root) {
    if (root.GunterDiagnostics) return;
    const normalize = text => String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    function recognizes(text) {
        const value = normalize(text);
        return /\b(diagnostico|diagnostica|errores|error|esta fallando|que esta pasando|que falla|que fallo|que paso|salio mal|paso algo|no me escuchas|modelos locales|estado del sistema|estado general|revisa tus errores|log|logs|debug|checkup|check up|health|todo bien)\b/.test(value);
    }
    function classify(available, known) {
        return available ? 'FUNCIONANDO' : known ? 'NO DISPONIBLE' : 'SIN DATOS SUFICIENTES';
    }
    async function microphone() {
        if (!navigator.mediaDevices?.getUserMedia) return { status: 'NO DISPONIBLE', reason: 'Este navegador no ofrece captura de micrófono.' };
        if (!navigator.permissions?.query) return { status: 'SIN DATOS SUFICIENTES', reason: 'El navegador no expone el estado del permiso sin pedir acceso.' };
        try {
            const result = await navigator.permissions.query({ name: 'microphone' });
            if (result.state === 'denied') return { status: 'NO DISPONIBLE', reason: 'Permiso de micrófono denegado.' };
            if (result.state === 'prompt') return { status: 'DEGRADADO', reason: 'Permiso pendiente: pulsa Hablar o activa la escucha desde Configuración.' };
            const wake = root.GunterWakeWord?.getState?.();
            return { status: 'FUNCIONANDO', reason: wake?.active ? `Captura activa (${wake.phase || 'sin fase'}).` : 'Permiso concedido; no hay captura activa.' };
        } catch {
            return { status: 'SIN DATOS SUFICIENTES', reason: 'No puedo consultar el permiso sin solicitar acceso.' };
        }
    }
    async function serverLogs() {
        if (!root.GunterAuth?.getUser?.() || root.GunterAuth.getUser().role !== 'admin') return { status: 'SIN DATOS SUFICIENTES', reason: 'Los errores globales del servidor solo están disponibles para administración.' };
        try {
            const response = await fetch('/api/auth/admin/stats', { credentials: 'same-origin', cache: 'no-store' });
            if (!response.ok) return { status: 'SIN DATOS SUFICIENTES', reason: `Consulta autorizada del servidor no disponible (HTTP ${response.status}).` };
            const data = await response.json();
            const logs = data.logs;
            if (!logs) return { status: 'SIN DATOS SUFICIENTES', reason: 'El servidor no devolvió contadores de errores.' };
            return { status: logs.errors ? 'DEGRADADO' : 'FUNCIONANDO', reason: `${Number(logs.errors) || 0} errores y ${Number(logs.warnings) || 0} advertencias en el buffer del servidor; no se consultó contenido privado.` };
        } catch {
            return { status: 'SIN DATOS SUFICIENTES', reason: 'No pude consultar contadores del servidor.' };
        }
    }
    async function inspect() {
        const runtime = root.GunterRuntimeState?.getState?.() || {};
        const browser = root.GunterLogBuffer?.getSummary?.();
        const traces = root.GunterTraceLogger?.getAll?.() || [];
        const traceErrors = traces.reduce((sum, trace) => sum + (Array.isArray(trace.errors) ? trace.errors.length : 0), 0);
        const mic = await microphone();
        const localOnly = runtime.privacy === 'LOCAL_ONLY' || runtime.mode === 'LOCAL';
        const modelsKnown = runtime.loaded === true;
        const model = (ready, installed, required) => ({
            status: classify(ready, modelsKnown),
            reason: !modelsKnown ? 'Estado del runtime todavía no recibido.' : ready ? 'Runtime local listo.' : installed ? 'Instalado, pero no listo o desactivado.' : required ? 'Modelo o runtime no instalado.' : 'Proveedor local no disponible.'
        });
        const stt = model(runtime.localSTTAvailable, runtime.localSTTInstalled, true);
        const llm = model(runtime.localBrainAvailable, runtime.localBrainInstalled, true);
        const tts = model(runtime.localTTSAvailable, runtime.providers?.tts?.local, true);
        const network = runtime.backendAvailable === true ? { status: 'FUNCIONANDO', reason: 'Servidor local responde.' }
            : runtime.backendAvailable === false ? { status: 'NO DISPONIBLE', reason: 'Servidor local sin respuesta.' }
                : { status: 'SIN DATOS SUFICIENTES', reason: 'Sin comprobación reciente del servidor.' };
        const tools = root.GunterAssistantTools?.listTools?.();
        return {
            microphone: mic, stt, llm, tts, network,
            browser: browser ? { status: browser.byLevel.error ? 'DEGRADADO' : 'FUNCIONANDO', reason: `${browser.byLevel.error || 0} errores y ${browser.byLevel.warn || 0} advertencias en esta página; no se muestra su contenido.` } : { status: 'SIN DATOS SUFICIENTES', reason: 'Buffer del navegador no disponible.' },
            traces: root.GunterTraceLogger ? { status: traceErrors ? 'DEGRADADO' : 'FUNCIONANDO', reason: `${traceErrors} fallos registrados en ${traces.length} ejecuciones locales; no se leen entradas ni conversaciones.` } : { status: 'SIN DATOS SUFICIENTES', reason: 'Trazas no disponibles en esta página.' },
            tools: Array.isArray(tools) ? { status: tools.length ? 'FUNCIONANDO' : 'DEGRADADO', reason: `${tools.length} herramientas registradas; su disponibilidad concreta depende del dispositivo y los permisos.` } : { status: 'SIN DATOS SUFICIENTES', reason: 'Registro de herramientas no cargado.' },
            server: await serverLogs(), localOnly
        };
    }
    async function answer(text) {
        if (!recognizes(text)) return null;
        const state = await inspect();
        const entries = [
            ['Micrófono', state.microphone], ['STT local (Moonshine)', state.stt],
            ['IA local', state.llm], ['TTS local', state.tts], ['Conexión al servidor', state.network],
            ['Navegador', state.browser], ['Trazas', state.traces], ['Herramientas', state.tools], ['Servidor', state.server]
        ];
        const focus = /no me escuchas|microfono|voz/.test(normalize(text)) ? ['Micrófono', 'STT local (Moonshine)', 'Conexión al servidor']
            : /modelos locales/.test(normalize(text)) ? ['STT local (Moonshine)', 'IA local', 'TTS local'] : null;
        const lines = (focus ? entries.filter(([label]) => focus.includes(label)) : entries)
            .map(([label, value]) => `${label}: ${value.status}. ${value.reason}`);
        if (state.localOnly) lines.push('Privacidad: LOCAL_ONLY/LOCAL; no envié este diagnóstico a un proveedor cloud.');
        lines.push('No modifiqué ajustes ni reinicié servicios. Si un estado es desconocido, no puedo afirmar una causa.');
        return lines.join('\n');
    }
    root.GunterDiagnostics = { recognizes, inspect, answer };
})(window);
