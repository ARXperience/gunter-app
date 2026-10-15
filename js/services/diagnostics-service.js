/* Read-only, account-safe diagnostics. Never returns raw logs or trace inputs. */
(function (root) {
    if (root.GunterDiagnostics) return;
    const normalize = text => String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const CAUSES = {
        MICROPHONE_PERMISSION_DENIED: ['El navegador rechazó el permiso del micrófono.', 'Revisa el permiso del micrófono para esta aplicación en los ajustes del navegador.'],
        VOICE_PLAYBACK_BLOCKED: ['El navegador bloqueó la reproducción del audio.', 'Pulsa Probar voz en Configuración → Voz y escucha para autorizar su reproducción.'],
        LOCAL_TTS_PLAYBACK_FAILED: ['El audio local se generó, pero el reproductor no pudo reproducirlo.', 'Prueba la voz y revisa el dispositivo de salida y el volumen de la pestaña.'],
        VOICE_PLAYBACK_FAILED: ['El reproductor no pudo reproducir la respuesta.', 'Prueba la voz y revisa el dispositivo de salida y el volumen de la pestaña.'],
        BROWSER_TTS_UNAVAILABLE: ['La síntesis de voz del navegador no está disponible.', 'Revisa el motor de voz configurado en Voz y escucha.'],
        BROWSER_TTS_FAILED: ['La síntesis de voz del navegador falló.', 'Prueba la voz desde Voz y escucha para comprobar el reproductor.'],
        LOCAL_TTS_NOT_INSTALLED: ['El motor o los pesos de Supertonic local no están disponibles.', 'Revisa el estado de los motores en Configuración → Asistente e IA.'],
        LOCAL_TTS_UNAVAILABLE: ['Supertonic no pudo generar la voz local.', 'Revisa el estado del motor en Asistente e IA; la respuesta escrita sigue disponible.'],
        LOCAL_TTS_BUSY: ['El motor local está atendiendo otra generación de voz.', 'Espera a que termine o interrumpe la respuesta anterior.'],
        LOCAL_TTS_TIMEOUT: ['La generación de voz local excedió el tiempo permitido.', 'Revisa el estado del motor en Asistente e IA; no se cambió a otra voz y el texto sigue disponible.'],
        LOCAL_STT_NOT_INSTALLED: ['El modelo o runtime de Moonshine no está instalado.', 'Revisa el motor local en Configuración → Asistente e IA.'],
        LOCAL_STT_UNAVAILABLE: ['Moonshine no pudo transcribir el audio.', 'Revisa el estado del motor local y el formato de la grabación.'],
        LOCAL_STT_BUSY: ['Moonshine está transcribiendo otra grabación.', 'Espera a que termine la transcripción actual.'],
        LOCAL_STT_INVALID_AUDIO: ['La grabación no pudo leerse como audio válido.', 'Comprueba que la grabación no esté vacía y usa un formato admitido.'],
        LOCAL_STT_AUDIO_TOO_LARGE: ['La grabación excede el límite del transcriptor local.', 'Divide el audio en fragmentos de hasta 120 segundos o 30 MB.'],
        LOCAL_PROVIDER_NOT_INSTALLED: ['El proveedor local requerido no está instalado.', 'Revisa sus archivos y su estado en Asistente e IA.'],
        LOCAL_MODEL_NOT_INSTALLED: ['El modelo local requerido no está instalado.', 'Revisa sus archivos y su estado en Asistente e IA.'],
        LOCAL_PROVIDER_UNAVAILABLE: ['La IA local no está disponible.', 'Revisa el motor y el modelo en Configuración → Asistente e IA.'],
        NETWORK_UNAVAILABLE: ['La conexión necesaria para esa función no está disponible.', 'Revisa la conexión con el servidor; no cambies la privacidad para ocultar el problema.'],
        LOCAL_ONLY_MODE: ['La privacidad LOCAL_ONLY impide esa conexión externa.', 'Usa una herramienta local compatible; no he cambiado tu privacidad.'],
        PERMISSION_DENIED: ['La acción fue rechazada por falta de permiso.', 'Revisa el permiso concreto antes de volver a solicitar la acción.'],
        SYNC_UNAVAILABLE: ['La sincronización no está disponible.', 'Conserva los datos locales y revisa el servidor antes de reintentar.']
    };
    function knownCause(value) {
        const code = typeof value === 'string' ? value : value?.code;
        if (!Object.hasOwn(CAUSES, code || '')) return null;
        return { code, reason: CAUSES[code][0], advice: CAUSES[code][1] };
    }
    function recognizes(text) {
        const value = normalize(text);
        const command = value.replace(/^[¿¡\s]*(?:(?:hi|hey|hola|oye)\s+)?(?:gunter|gonter|gunder)[,\s]+/, '').trim();
        if (/^(?:[¿¡\s]*)(?:por favor\s+)?(?:activa|activar|desactiva|desactivar|habilita|inhabilita|enciende|apaga|configura|cambia|ajusta|pon|establece|restablece|crea|crear|agrega|anade|edita|modifica|completa|cancela|reabre|elimina|borra|envia|publica|mueve|recuerdame)\b/.test(command)) return false;
        return /\b(diagnostico|diagnostica|errores|error|esta fallando|que esta pasando|que falla|que fallo|que paso|salio mal|paso algo|no me escuchas|no me hablas|modelos locales|estado del sistema|estado general|revisa tus errores|log|logs|debug|checkup|check up|health|todo bien)\b/.test(value)
            || /\b(?:no (?:me |se )?(?:esta(?:n)? )?(?:funciona(?:ndo)?|habla(?:ndo)?|hablas|responde|respondiendo|escucha(?:ndo)?|oye|oyes|suena)|dejo de funcionar)\b/.test(value)
            || /\b(?:por que|revisa|comprueba)\b.*\b(?:no (?:funciona|habla|responde|escucha|suena)|falla|fallando)\b/.test(value)
            || /\b(?:voz|audio|microfono|dictado|escucha)\b.*\b(?:no funciona|no suena|falla|no responde)\b/.test(value);
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
            const cfg = root.PremiumFeaturesService?.getWakeWordConfig?.();
            if (cfg?.enabled === false) return { status: 'DESACTIVADO', reason: 'La activación por nombre está desactivada por tu preferencia.', advice: 'Puedes cambiarla en Configuración → Voz y escucha; no he modificado tu elección.' };
            return { status: wake?.active ? 'FUNCIONANDO' : 'INACTIVO', reason: wake?.active ? 'El micrófono está capturando audio.' : cfg?.listeningMode === 'manual' ? 'El micrófono tiene permiso, pero el modo de escucha es Manual y no hay captura activa.' : 'Permiso concedido; no hay captura activa.', advice: wake?.active ? undefined : cfg?.listeningMode === 'manual' ? 'Pulsa Hablar, o selecciona Continuo en Configuración → Voz y escucha para invocarme sin un botón en cada orden.' : 'Revisa el modo de escucha y mantén la aplicación abierta y visible. No estoy escuchando ahora.' };
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
        const owner = root.GunterAuth?.getUser?.()?.id;
        const browser = owner ? root.GunterLogBuffer?.getDiagnosticSummary?.({ codes: Object.keys(CAUSES) }) : null;
        const traces = owner ? root.GunterTraceLogger?.getDiagnosticSummary?.() : null;
        const mic = await microphone();
        const localOnly = runtime.privacy === 'LOCAL_ONLY' || runtime.mode === 'LOCAL';
        const modelsKnown = runtime.loaded === true;
        const model = (ready, installed, flag, error) => ({
            status: classify(ready, modelsKnown),
            reason: !modelsKnown ? 'Estado del runtime todavía no recibido.' : ready ? 'Runtime local listo.' : flag === false ? 'El motor local está desactivado en el Centro de control.' : knownCause(error)?.reason || (installed ? 'Instalado, pero el runtime todavía no está listo.' : 'Modelo o runtime no instalado.'),
            advice: modelsKnown && !ready ? knownCause(error)?.advice || 'Revisa el estado del motor en Configuración → Asistente e IA.' : undefined
        });
        const stt = model(runtime.localSTTAvailable, runtime.localSTTInstalled, runtime.flags?.['stt.local'], runtime.localSTTError);
        const llm = model(runtime.localBrainAvailable, runtime.localBrainInstalled, runtime.flags?.['ai.local'], runtime.localBrainError);
        const tts = model(runtime.localTTSAvailable, !!runtime.providers?.tts?.local && runtime.providers.tts.local.status !== 'NOT_INSTALLED', runtime.flags?.['tts.local']);
        const cfg = root.PremiumFeaturesService?.getVoiceConfig?.();
        const voiceMode = cfg?.effectiveMode || (!cfg?.enabled ? 'text_only' : cfg?.onlyAfterWakeWord ? 'wake_word_only' : cfg?.mode);
        const voicePolicy = !cfg ? { status: 'SIN DATOS SUFICIENTES', reason: 'La configuración de voz no se ha cargado.' }
            : voiceMode === 'text_only' ? { status: 'DESACTIVADO', reason: 'Tu configuración responde solo con texto.', advice: 'Selecciona Todas las respuestas con voz en Configuración → Voz y escucha si quieres escuchar la conversación.' }
                : voiceMode === 'notifications_only' ? { status: 'RESTRINGIDO', reason: 'La voz está reservada a notificaciones; no a las respuestas del chat.', advice: 'Selecciona Todas las respuestas con voz para escuchar también el chat.' }
                    : voiceMode === 'wake_word_only' && cfg.wakeWordResponseMode === 'text' ? { status: 'RESTRINGIDO', reason: 'La voz está limitada a la activación por nombre, pero esa activación responde solo con texto.', advice: 'Cambia Respuesta tras decir su nombre a Con voz, o elige Todas las respuestas con voz.' }
                        : root.GunterVoice?.isMeetingActive?.() && cfg.inMeetings === false ? { status: 'RESTRINGIDO', reason: 'Hay una reunión activa y desactivaste las respuestas de voz durante reuniones.', advice: 'Activa Voz también en reuniones en vivo si deseas escucharla en este contexto.' }
                            : voiceMode === 'wake_word_only' ? { status: 'RESTRINGIDO', reason: 'Solo hablaré tras una orden por nombre; los mensajes escritos responden por texto.', advice: 'Elige Todas las respuestas con voz para escuchar también los mensajes escritos.' }
                                : { status: 'ACTIVADO', reason: cfg.wakeWordResponseMode === 'text' ? 'La voz responde al chat escrito, pero las órdenes por nombre responden solo con texto.' : 'Las respuestas de conversación tienen voz habilitada.' };
        const playback = root.GunterVoice?.getPlaybackState?.();
        const fault = knownCause(playback?.error);
        const voicePlayback = !playback ? { status: 'SIN DATOS SUFICIENTES', reason: 'El reproductor no está disponible en esta página.' }
            : fault ? { status: 'ERROR', ...fault }
                : playback.error ? { status: 'ERROR', reason: 'El reproductor registró un fallo sin un código reconocido.', advice: 'Usa Probar voz para comprobar el error actual; no puedo atribuirle una causa exacta.' }
                    : { status: playback.speaking ? 'FUNCIONANDO' : playback.pending ? 'PREPARANDO' : 'INACTIVO', reason: playback.speaking ? 'El navegador está reproduciendo audio; no puedo comprobar el volumen físico de tu equipo.' : playback.pending ? 'El audio aún se está preparando; todavía no se reproduce.' : 'No hay audio reproduciéndose ahora.' };
        const evidence = (browser?.evidence || []).flatMap(entry => (entry.codes || []).map(code => {
            const cause = knownCause(code);
            return cause ? { ...cause, at: entry.at, source: 'browser' } : null;
        })).filter(Boolean).filter((item, index, rows) => rows.findLastIndex(row => row.code === item.code) === index).slice(-3);
        const network = runtime.backendAvailable === true ? { status: 'FUNCIONANDO', reason: 'Servidor local responde.' }
            : runtime.backendAvailable === false ? { status: 'NO DISPONIBLE', reason: 'Servidor local sin respuesta.' }
                : { status: 'SIN DATOS SUFICIENTES', reason: 'Sin comprobación reciente del servidor.' };
        const tools = root.GunterAssistantTools?.listTools?.();
        const server = await serverLogs();
        if (owner !== root.GunterAuth?.getUser?.()?.id) return { accountChanged: true };
        return {
            microphone: mic, stt, llm, tts, network, voicePolicy, voicePlayback, evidence,
            browser: browser?.available ? { status: browser.byLevel.error ? 'DEGRADADO' : 'FUNCIONANDO', reason: `${browser.byLevel.error || 0} errores y ${browser.byLevel.warn || 0} advertencias de tu cuenta en esta página; no se muestra su contenido.` } : { status: 'SIN DATOS SUFICIENTES', reason: 'No hay un buffer de diagnóstico atribuido a tu cuenta.' },
            traces: traces?.available ? { status: traces.errors ? 'DEGRADADO' : 'FUNCIONANDO', reason: `${traces.errors} fallos registrados en ${traces.total} ejecuciones de tu cuenta; no se leen entradas ni conversaciones legacy sin propietario.` } : { status: 'SIN DATOS SUFICIENTES', reason: 'No hay trazas de diagnóstico atribuidas a tu cuenta.' },
            tools: Array.isArray(tools) ? { status: tools.length ? 'FUNCIONANDO' : 'DEGRADADO', reason: `${tools.length} herramientas registradas; su disponibilidad concreta depende del dispositivo y los permisos.` } : { status: 'SIN DATOS SUFICIENTES', reason: 'Registro de herramientas no cargado.' },
            server, localOnly
        };
    }
    async function answer(text) {
        if (!recognizes(text)) return null;
        const state = await inspect();
        if (state.accountChanged) return 'La cuenta cambió durante el diagnóstico. Solicítalo de nuevo desde tu sesión; no mostraré señales de otra cuenta.';
        const entries = [
            ['Micrófono', state.microphone], ['STT local (Moonshine)', state.stt],
            ['IA local', state.llm], ['TTS local', state.tts], ['Preferencia de voz', state.voicePolicy], ['Reproducción de voz', state.voicePlayback], ['Conexión al servidor', state.network],
            ['Navegador', state.browser], ['Trazas', state.traces], ['Herramientas', state.tools], ['Servidor', state.server]
        ];
        const focus = /no me (?:esta )?(?:escucha|oye)|no me oyes|microfono|dictado|escucha/.test(normalize(text)) ? ['Micrófono', 'STT local (Moonshine)', 'Conexión al servidor']
            : /no (?:me )?(?:esta )?(?:habla|hablando)|no se oye|voz|audio|suena|sonido/.test(normalize(text)) ? ['Preferencia de voz', 'Reproducción de voz', 'TTS local', 'Conexión al servidor']
            : /modelos locales/.test(normalize(text)) ? ['STT local (Moonshine)', 'IA local', 'TTS local'] : null;
        const lines = (focus ? entries.filter(([label]) => focus.includes(label)) : entries)
            .map(([label, value]) => `${label}: ${value.status}. ${value.reason}${value.advice ? ' ' + value.advice : ''}`);
        if (state.evidence.length) {
            lines.push('En los registros recientes de tu cuenta encontré estas señales; son antecedentes, no una prueba de que el fallo siga activo:');
            state.evidence.forEach(item => lines.push(`${item.code}: ${item.reason} ${item.advice}`));
        }
        if (state.localOnly) lines.push('Privacidad: LOCAL_ONLY/LOCAL; no envié este diagnóstico a un proveedor cloud.');
        lines.push('No modifiqué ajustes ni reinicié servicios. Si un estado es desconocido, no puedo afirmar una causa.');
        return lines.join('\n');
    }
    root.GunterDiagnostics = { recognizes, inspect, answer };
})(window);
