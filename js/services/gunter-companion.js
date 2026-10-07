/* =============================================
   GUNTER COMPANION — Widget flotante (v1)
   -------------------------------------------------
   Se auto-monta al DOM en cada página. Estados:
     minimized → bubble
     bubble    → burbuja contextual (cada ~2 min, 3s)
     expanded  → chat activo con historial
     hidden    → oculto (durante grabación)

   Flujo del mensaje:
     Tú → texto → GunterActions.dispatch()
                    ├─ si es intent válido → responde + aplica acción
                    └─ si null → cae a LLM via GunterNlpLlm.complete()

   Persistencia:
     - Log de chat en localStorage 'gunter_companion_log' (últimos 20)
     - Estado abierto/cerrado en 'gunter_companion_open'
   ============================================= */

(function () {
    if (window.GunterCompanion) return;

    const STATE = {
        mounted: false,
        expanded: false,
        hidden: false,
        pendingBubbleTimer: null,
        pendingHideTimer: null,
        bubbleShown: false,
        log: [],
        turnId: 0,
        turnController: null,
        currentPage: 'unknown'
    };

    const LOG_KEY = 'gunter_companion_log';
    const OPEN_KEY = 'gunter_companion_open';
    const MAX_LOG = 20;
    const BUBBLE_INTERVAL_MS = 2 * 60 * 1000;    // 2 min
    const BUBBLE_DURATION_MS = 4500;              // 4.5 s visible

    // ─────────────────────────────────────
    // Bocadillos contextuales por página
    // ─────────────────────────────────────
    const CONTEXTUAL_TIPS = {
        dashboard: [
            '¿Iniciamos una reunión?',
            '¿Quieres ver tus proyectos por urgencia?',
            'Tip: puedes decirme "abre X 360" y te llevo.'
        ],
        'new-project': [
            'El entorno afecta cómo analizo la reunión.',
            'Sube un audio si ya lo tienes grabado.'
        ],
        day: [
            '¿Qué tienes pendiente hoy?',
            '¿Agendo algo?',
            'Dime "que tengo activo" para ver tus features premium.'
        ],
        meeting: null,   // no molestar durante grabación
        results: [
            '¿Quieres que te resuma esta reunión?',
            'Puedo generar slides si me lo pides.'
        ],
        config: [
            'Si no sabes qué activar, pregúntame.',
            'Prueba: "explica el pulso proactivo".',
            'Puedes decirme "activa la memoria" y lo hago.'
        ],
        index: [
            '¡Bienvenido! Regístrate y te acompaño.'
        ]
    };

    // Welcome instructivo: Gunter enseña y recomienda
    const WELCOME_BY_PAGE = {
        dashboard:   '🐧 ¡Wenk! Soy Gunter, tu asistente. Puedo:\n• Iniciar reuniones ("nueva reunión")\n• Explicarte funciones ("qué es el forecast")\n• Activar funciones ("activa la memoria")\n\n💡 Recomiendo activar la Memoria conversacional y el Pulso proactivo para empezar.',
        'new-project': '🐧 Antes de iniciar la reunión, elige un entorno (Empresarial, Artístico, Podcast o Zen). Cada uno adapta cómo yo analizo lo que dicen.\n\n¿Necesitas ayuda? Pregúntame "qué es Empresarial" o cualquier otra.',
        day:         '🐧 En tu Día puedes:\n• Escribir en la barra de captura ("recuérdame llamar a Ana")\n• Activar el Planificador diario ("activa el planificador")\n• Ver tus compromisos ("qué compromisos tengo")\n\n💡 Recomiendo activar la Memoria y el Planificador diario.',
        meeting:     '🐧 Estoy grabando y escuchando la reunión.\n\nAl terminar te ayudo con:\n• Análisis PMBOK\n• Detección de compromisos\n• Follow-up\n\nDurante la reunión mantén el volumen normal.',
        results:     '🐧 Aquí tienes el análisis. Puedo:\n• Resumirte los puntos clave ("resume")\n• Generar slides con IA ("genera slides")\n• Extraer compromisos ("detecta compromisos")\n\n¿Con cuál te ayudo?',
        config:      '🐧 En Configuración activas las funciones Premium.\n\nPregúntame:\n• "qué es la memoria conversacional"\n• "qué hace el forecast"\n• "activa el pulso proactivo"\n\nO explora las pestañas.',
        index:       '🐧 ¡Hola! Regístrate y te muestro cómo funciona todo. Puedes preguntarme cualquier cosa.',
        default:     '🐧 ¡Wenk! ¿En qué te ayudo? Prueba: "qué puedes hacer" para ver mis funciones.'
    };

    // ─────────────────────────────────────
    // Detectar página actual
    // ─────────────────────────────────────
    function detectPage() {
        const p = (location.pathname || '').toLowerCase();
        if (p.includes('dashboard'))    return 'dashboard';
        if (p.includes('new-project'))  return 'new-project';
        if (p.includes('day'))          return 'day';
        if (p.includes('meeting'))      return 'meeting';
        if (p.includes('results'))      return 'results';
        if (p.includes('config'))       return 'config';
        if (p === '/' || p.includes('index')) return 'index';
        return 'default';
    }

    // ─────────────────────────────────────
    // DOM builders
    // ─────────────────────────────────────
    function buildDom() {
        const wrapper = document.createElement('div');
        wrapper.className = 'gn-comp';
        wrapper.id = 'gunter-companion';
        wrapper.setAttribute('aria-label', 'Asistente Gunter');
        const MASCOT_PARTICLES = '<span class="gn-mascot gn-particle-surface" data-gunter-particles="chat" aria-hidden="true"></span>';

        wrapper.innerHTML = `
            <div class="gn-comp__chat" role="dialog" aria-label="Chat con Gunter">
                <header class="gn-comp__chat-header">
                    <div class="gn-comp__chat-avatar">${MASCOT_PARTICLES}</div>
                    <div class="gn-comp__chat-title">
                        <strong>Gunter</strong>
                        <small id="gn-comp-status">Tu asistente</small>
                    </div>
                    <button class="gn-comp__chat-close" aria-label="Cerrar chat" data-comp-action="close">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </header>
                <div class="gn-comp__chat-log" id="gn-comp-log"></div>
                <div class="gn-comp__quick" id="gn-comp-quick"></div>
                <form class="gn-comp__chat-form" id="gn-comp-form">
                    <input type="text" class="gn-comp__chat-input" id="gn-comp-input"
                           placeholder="Escribe o pregúntame algo…" autocomplete="off">
                    <button type="submit" class="gn-comp__chat-send" aria-label="Enviar">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/>
                        </svg>
                    </button>
                </form>
            </div>
            <div class="gn-comp__tooltip" data-comp-action="expand-from-tooltip"></div>
            <button class="gn-comp__bubble" data-comp-action="toggle" aria-label="Abrir Gunter">
                ${MASCOT_PARTICLES}
                <span class="gn-comp__notif is-hidden" id="gn-comp-notif"></span>
            </button>
        `;
        return wrapper;
    }

    // ─────────────────────────────────────
    // Mount
    // ─────────────────────────────────────
    function mount() {
        if (STATE.mounted) return;
        STATE.currentPage = detectPage();

        // Meeting: no montar durante grabación activa
        if (STATE.currentPage === 'meeting' && document.body.classList.contains('is-recording')) {
            return;
        }

        const dom = buildDom();
        document.body.appendChild(dom);
        STATE.mounted = true;

        bind(dom);
        loadLog();
        renderLog();
        renderQuick();
        if (window.GunterAuth?.isVerified?.()) greetOnEntry(window.GunterAuth.getUser());

        // v37 · Mood engine: humor del día → mascota + status del chat
        try {
            if (window.GunterMood) {
                const moodCls = window.GunterMood.moodClass();
                if (moodCls) {
                    dom.querySelectorAll('.gn-mascot').forEach(m => m.classList.add(moodCls));
                }
                const status = document.getElementById('gn-comp-status');
                if (status) status.textContent = window.GunterMood.statusLabel();
            }
        } catch { /* mood opcional */ }

        // Restaurar estado abierto si el user lo tenía
        if (localStorage.getItem(OPEN_KEY) === '1') {
            expand();
        } else {
            scheduleContextualBubble();
        }
    }

    function bind(root) {
        // Click en bubble → toggle
        root.querySelector('[data-comp-action="toggle"]').addEventListener('click', toggle);
        root.querySelector('[data-comp-action="close"]').addEventListener('click', minimize);
        root.querySelector('[data-comp-action="expand-from-tooltip"]').addEventListener('click', () => {
            hideBubble();
            expand();
        });

        // Form submit
        const form = root.querySelector('#gn-comp-form');
        const input = root.querySelector('#gn-comp-input');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const text = input.value.trim();
            if (!text) return;
            input.value = '';
            await handleUserMessage(text);
        });

        // Cerrar al escapar
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && STATE.expanded) minimize();
        });

        // Reunión activa → esconder
        window.addEventListener('gunter-recording-started', () => hide());
        window.addEventListener('gunter-recording-stopped', () => show());
    }

    async function greetOnEntry(user) {
        if (!STATE.mounted || STATE.currentPage === 'meeting' || !window.GunterPresence || window.GunterPresence.preferences().entryGreeting === false) return;
        const turnId = STATE.turnId;
        try {
            const greeting = await window.GunterPresence.greet(user);
            if (!greeting || turnId !== STATE.turnId || STATE.hidden) return;
            addMessage('assistant', greeting, { voiceContext: 'entry', fullVoice: true });
            if (!STATE.expanded) showBubble(greeting, 12000);
        } catch (error) { console.warn('[companion] greeting unavailable:', error.message); }
    }

    function interrupt() {
        STATE.turnId += 1;
        STATE.turnController?.abort();
        STATE.turnController = null;
        window.GunterVoice?.cancel?.('user-interruption');
        setTyping(false);
        setMascotState('listening');
    }

    // ─────────────────────────────────────
    // Show / Hide / Expand
    // ─────────────────────────────────────
    function toggle() {
        if (STATE.expanded) minimize();
        else expand();
    }

    function expand() {
        const root = document.getElementById('gunter-companion');
        if (!root) return;
        STATE.expanded = true;
        root.classList.remove('is-bubble');
        root.classList.add('is-expanded');
        localStorage.setItem(OPEN_KEY, '1');

        // Foco en input
        setTimeout(() => {
            root.querySelector('#gn-comp-input')?.focus();
            scrollLogToBottom();
        }, 100);

        // Si no hay log, mostrar welcome (con el humor del día si aplica)
        if (STATE.log.length === 0) {
            const welcome = WELCOME_BY_PAGE[STATE.currentPage] || WELCOME_BY_PAGE.default;
            let moodGreet = '';
            try { moodGreet = window.GunterMood?.greetLine?.() || ''; } catch {}
            addMessage('assistant', moodGreet ? moodGreet + '\n\n' + welcome : welcome);
        }
    }

    function minimize() {
        const root = document.getElementById('gunter-companion');
        if (!root) return;
        STATE.expanded = false;
        root.classList.remove('is-expanded');
        localStorage.setItem(OPEN_KEY, '0');
        scheduleContextualBubble();
    }

    function hide() {
        const root = document.getElementById('gunter-companion');
        if (!root) return;
        STATE.hidden = true;
        root.classList.add('is-hidden');
        clearTimeout(STATE.pendingBubbleTimer);
    }

    function show() {
        const root = document.getElementById('gunter-companion');
        if (!root) return;
        STATE.hidden = false;
        root.classList.remove('is-hidden');
    }

    // ─────────────────────────────────────
    // Bocadillos contextuales
    // ─────────────────────────────────────
    function scheduleContextualBubble() {
        clearTimeout(STATE.pendingBubbleTimer);
        const tips = CONTEXTUAL_TIPS[STATE.currentPage];
        if (!tips || !tips.length) return;
        if (STATE.expanded || STATE.hidden) return;

        STATE.pendingBubbleTimer = setTimeout(() => {
            if (STATE.expanded || STATE.hidden) return;
            const tip = tips[Math.floor(Math.random() * tips.length)];
            showBubble(tip);
        }, BUBBLE_INTERVAL_MS);
    }

    function showBubble(text, duration = BUBBLE_DURATION_MS) {
        const root = document.getElementById('gunter-companion');
        if (!root) return;
        const tooltip = root.querySelector('.gn-comp__tooltip');
        tooltip.textContent = text;
        root.classList.add('is-bubble');
        STATE.bubbleShown = true;

        clearTimeout(STATE.pendingHideTimer);
        STATE.pendingHideTimer = setTimeout(() => {
            hideBubble();
            scheduleContextualBubble();
        }, duration);
    }

    function hideBubble() {
        const root = document.getElementById('gunter-companion');
        if (!root) return;
        root.classList.remove('is-bubble');
        STATE.bubbleShown = false;
        clearTimeout(STATE.pendingHideTimer);
    }

    // ─────────────────────────────────────
    // Mensajes
    // ─────────────────────────────────────
    // Fix bug "el chat se queda y no continúa": timeout de seguridad
    // que garantiza que setTyping(false) SIEMPRE se llama, aunque el LLM
    // cuelgue, el fetch nunca resuelva, o alguna promesa quede colgada.
    const SAFETY_TIMEOUT_MS = 45000;

    function withTimeout(promise, ms, timeoutMsg) {
        return Promise.race([
            promise,
            new Promise((_, reject) => setTimeout(
                () => reject(new Error(timeoutMsg || 'Tiempo de espera agotado')),
                ms
            ))
        ]);
    }

    // ─────────────────────────────────────
    // Intercepts client-side: logs, service status, self-diagnosis
    // Corren ANTES de llamar al server. Gunter responde con la verdad
    // sobre qué está cargado, qué falló, y qué logs hay.
    // ─────────────────────────────────────
    function tryClientIntercepts(text) {
        const t = (text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
        const temporal = window.GunterTemporalContext?.answer?.(text, {
            timezone: window.GunterPresence?.timezone?.() || Intl.DateTimeFormat().resolvedOptions().timeZone,
            locale: navigator.language || 'es-CO'
        });
        if (temporal) {
            return { reply: temporal.reply, intent: `temporal-${temporal.intent}`, __clientHandled: true };
        }
        const buf = window.GunterLogBuffer;
        if (!buf) return null;

        // ¿Muéstrame los logs / qué salió mal / errores?
        if (/\b(log|logs|errore?s?|salio mal|salió mal|que fallo|que fallo|que paso|que pasó|paso algo|diagnostico|diagnóstico|debug)\b/.test(t)) {
            const summary = buf.getSummary();
            const errors = buf.formatForChat({ level: 'error', limit: 5 });
            const warns  = buf.formatForChat({ level: 'warn',  limit: 5 });
            const lines = [];
            lines.push(`📋 Resumen de logs (últimos ${summary.total}/${summary.capacity}):`);
            lines.push(`• Errores: ${summary.byLevel.error} · Advertencias: ${summary.byLevel.warn} · Info: ${summary.byLevel.info}`);
            if (errors) lines.push('\n🔴 Últimos errores:\n' + errors);
            else lines.push('\n✅ Sin errores recientes.');
            if (warns) lines.push('\n🟡 Últimas advertencias:\n' + warns);
            return {
                reply: lines.join('\n'),
                intent: 'logs-report',
                __clientHandled: true
            };
        }

        // ¿Qué servicios tienes cargados?
        if (/\b(servicios? cargados|que servicios|estado de servicios|que tienes cargado|servicios activos|que puedes usar aqui)\b/.test(t)) {
            const st = buf.getServiceStatus();
            const lines = [];
            lines.push(`🔌 En esta página (${st.page}) tengo cargados ${st.loaded.length}/${st.loaded.length + st.missing.length} services:`);
            if (st.loaded.length) {
                lines.push('\n✅ Cargados:');
                lines.push(st.loaded.map(s => `• ${s.name}`).join('\n'));
            }
            if (st.missing.length) {
                lines.push('\n⚠️ Faltan (funciones que dependan de estos NO podrán correr aquí):');
                lines.push(st.missing.map(s => `• ${s.name} (${s.path})`).join('\n'));
            }
            return { reply: lines.join('\n'), intent: 'services-report', __clientHandled: true };
        }

        // ¿Cómo activo "Hi Gunter" / setup del wake word?
        if (/\b(hi gunter|como (activo|prendo|inicio|uso).*(voz|wake|escucha)|escuchame|escuchar por voz|activar micro|activar microfono|activar micrófono|permiso de micro|setup de voz|configurar voz|permisos de voz)\b/.test(t)) {
            const svc = window.GunterWakeWord;
            const flagOn = window.PremiumFeaturesService?.isEnabled?.('wakeWordEnabled');
            const supported = svc?.supported ?? false;
            const state = svc?.getState ? svc.getState() : null;

            const lines = [];
            lines.push('🎙️ **Cómo activar "Hi Gunter"**\n');
            if (!supported) {
                lines.push('⚠️ Tu navegador no soporta reconocimiento de voz. Usá Chrome, Edge o un navegador moderno.');
            } else if (state?.permission !== 'granted') {
                lines.push('1. Activá la función: escribime "activa wake word" o andá a Configuración → Voz.');
                lines.push('2. Cuando el navegador te pida permiso de micrófono, aceptá.');
                lines.push('3. Verás un pill "Escuchando…" en la esquina inferior izquierda.');
                lines.push('4. Decí "Hi Gunter", "Hey Gunter", "Hola Gunter" o solo "Gunter" seguido de tu orden.\n');
                lines.push('Ejemplos:\n• "Gunter, activa el forecast"\n• "Hi Gunter, qué tengo hoy"\n• "Hey Gunter, apaga el pulso"');
            } else if (flagOn && state?.active) {
                lines.push('✅ Ya estoy escuchando. Decí "Hi Gunter" seguido de tu orden.\n');
                lines.push('Ejemplos:\n• "Gunter, activa el forecast"\n• "Hi Gunter, qué tengo pendiente"');
            } else {
                lines.push('Está listo pero apagado. Escribí "activa wake word" y confirmá el permiso de micrófono cuando aparezca.');
            }
            if (window.__gunter_isAndroid || /Android/i.test(navigator.userAgent || '')) {
                lines.push('\n📱 En Android solo funciona con la app en pantalla — al bloquear el teléfono se detiene.');
            }
            return { reply: lines.join('\n'), intent: 'wake-guide', __clientHandled: true };
        }

        // ¿Qué voces / tonos hay? ¿Cómo cambio la voz?
        if (/\b(que voces tienes|que tonos|estilos de voz|tipos de voz|como cambio (la|de) voz|configurar voz|cambiar (mi )?voz|(que|cuales) son (los )?estilos|voces disponibles)\b/.test(t)) {
            const currentStyle = window.PremiumFeaturesService?.get?.('voiceStyle') || 'professional';
            const currentSpeed = window.PremiumFeaturesService?.get?.('voiceSpeed') || 'normal';
            const currentMode  = window.PremiumFeaturesService?.get?.('voiceMode')  || 'voice_optional';
            const voiceOn      = window.PremiumFeaturesService?.isEnabled?.('voiceEnabled');

            const styles = [
                ['professional',     '🎩 Asistente ejecutivo (sobrio, estratégico, sin ruido)'],
                ['warm',             '☕ Cálido (cercano, amigo relajado)'],
                ['chaotic_scientist','🧪 Científico caótico (sarcástico, ácido, mordaz)'],
                ['energetic_cartoon','🎉 Caricatura energética (hiperactivo, exclamaciones)'],
                ['minimal_penguin',  '🐧 Pingüino minimalista (seco, breve, raro)'],
                ['executive',        '💼 Ejecutivo premium (clara, profesional, calmada)'],
                ['focus_coach',      '🎯 Coach de enfoque (firme, motivador, guiado)']
            ];
            const lines = [
                '🗣️ **Configuración de voz de Gunter**\n',
                `Estado actual: voz ${voiceOn ? '✅ activa' : '⚪ apagada'}, estilo **${currentStyle}**, velocidad **${currentSpeed}**, modo **${currentMode}**.\n`,
                '**Estilos disponibles** (escribí "cambia el estilo a X"):',
                ...styles.map(([id, desc]) => `• \`${id}\` — ${desc}`),
                '\n**Velocidad** (escribí "cambia la voz a X"):',
                '• `slow` (despacio) · `normal` · `fast` (rápido)',
                '\n**Modos** (cómo activa la voz):',
                '• `text_only` — solo texto, nunca habla',
                '• `voice_optional` — texto y voz según contexto',
                '• `live_voice` — habla siempre',
                '• `voice_first` — voz principal',
                '\nEjemplos:\n• "activa la voz"\n• "cambia el estilo a chaotic_scientist"\n• "cambia la voz a rápido"\n• "modo de voz live_voice"'
            ];
            return { reply: lines.join('\n'), intent: 'voice-guide', __clientHandled: true };
        }

        // Modo tutor: ¿qué libros / biblioteca / ruta de estudio?
        if (/\b(que libros|cuales libros|biblioteca|que puedes enseñarme|que puedes ensename|ruta de estudio|curriculum|curriculo|catalog(o|ue)|obras (del|de|disponibles)|autor)\b/.test(t)) {
            const tutor = window.GunterTutor;
            if (!tutor) return { reply: 'El módulo tutor no está cargado en esta página. Recargá.', intent: 'tutor-guide', __clientHandled: true };
            if (!tutor.isEnabled?.()) {
                const authorized = !window.GunterAuth || window.GunterAuth.canTutor?.();
                return {
                    reply: authorized
                        ? 'El modo Sabio está desactivado, así que no consulté su biblioteca ni sus rutas de estudio. Puedes activarlo en Configuración → funciones inteligentes. Si quieres, aún puedo conversar sobre temas generales con mi conocimiento habitual.'
                        : 'El modo Sabio está desactivado para esta cuenta y además requiere autorización del administrador. No consulté la biblioteca. Puedo conversar sobre temas generales con mi conocimiento habitual.',
                    intent: 'tutor-disabled', __clientHandled: true
                };
            }
            // Async — usamos setTimeout-then dentro de client handler
            return {
                __asyncPromise: (async () => {
                    const cat = await tutor.catalog();
                    if (!cat) return { reply: '📚 No pude cargar el catálogo. Ver logs.', intent: 'tutor-error' };
                    const lines = [];
                    lines.push(`📚 **Biblioteca del tutor: ${cat.author.name}**`);
                    lines.push(`_${cat.author.bio}_\n`);
                    lines.push(`${cat.filesOnDisk}/${cat.totalWorks} obras disponibles.\n`);
                    lines.push('**Rutas sugeridas:**');
                    for (const c of cat.curricula) {
                        lines.push(`• ${c.label} (${c.path.length} obras)`);
                    }
                    lines.push('\n**Obras (primeras 10):**');
                    for (const w of cat.works.slice(0, 10)) {
                        lines.push(`  #${w.n} · ${w.title} — ${w.difficulty}`);
                    }
                    lines.push('\nDecime: "empezar por [n]", "ruta [nombre]", o simplemente "explícame [tema]".');
                    return { reply: lines.join('\n'), intent: 'tutor-catalog' };
                })(),
                __clientHandled: true
            };
        }

        // ═══ REGLAS PERSONALES (v38) ═══
        // Crear: "regla: ..." / "recuerda que ..." / "a partir de ahora ..."
        const ruleMatch = text.match(/^\s*(?:regla:\s*|record[aá] que\s+|recuerda que\s+|a partir de ahora\s+|de ahora en adelante\s+)(.{4,})$/i);
        if (ruleMatch && window.GunterRules) {
            const res = window.GunterRules.addRule(ruleMatch[1].trim());
            if (res?.dup) return { reply: 'Esa regla ya existe. Escribí "mis reglas" para verlas.', intent: 'rule', __clientHandled: true };
            if (res?.full) return { reply: 'Límite de 40 reglas alcanzado. Borrá alguna con "borra la regla N".', intent: 'rule', __clientHandled: true };
            return { reply: `📏 Regla guardada: "${res.text}"\n\nLa voy a respetar en todas nuestras conversaciones. Si me equivoco, recordámela — soy un pingüino, no un santo.`, intent: 'rule', __clientHandled: true };
        }
        if (/^\s*(mis reglas|que reglas|qué reglas|lista de reglas)\s*\??\s*$/i.test(text) && window.GunterRules) {
            return { reply: window.GunterRules.formatList(), intent: 'rule', __clientHandled: true };
        }
        const ruleDel = text.match(/^\s*(?:borra|elimina|quita)\s+la\s+regla\s+(\d+)\s*$/i);
        if (ruleDel && window.GunterRules) {
            const ok = window.GunterRules.removeRule(ruleDel[1]);
            return { reply: ok ? `Regla ${ruleDel[1]} eliminada. Una carga menos.` : `No encontré la regla ${ruleDel[1]}. "mis reglas" para ver la lista.`, intent: 'rule', __clientHandled: true };
        }
        const ruleToggle = text.match(/^\s*(desactiva|activa)\s+la\s+regla\s+(\d+)\s*$/i);
        if (ruleToggle && window.GunterRules) {
            const active = window.GunterRules.toggleRule(ruleToggle[2], ruleToggle[1].toLowerCase() === 'activa');
            return { reply: active === false ? `Regla ${ruleToggle[2]} desactivada (sigue guardada).` : active === true ? `Regla ${ruleToggle[2]} activa de nuevo.` : 'No encontré esa regla.', intent: 'rule', __clientHandled: true };
        }

        // ═══ ENSÉÑALE A GUNTER (v38) ═══
        // "aprende esto: ..." / "aprende (título): ..." / "enséñate: ..."
        const teachMatch = text.match(/^\s*(?:aprende(?:te)?\s*(?:esto)?|ens[eé][ñn]ate)\s*(?:\(([^)]{2,80})\))?\s*:\s*([\s\S]{10,})$/i);
        if (teachMatch) {
            return {
                __asyncPromise: (async () => {
                    try {
                        const resp = await fetch((window.GUNTER_CONFIG?.PROXY_BASE_URL || '') + '/api/tutor', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ op: 'teach-add', title: teachMatch[1] || '', text: teachMatch[2].trim() })
                        });
                        const json = await resp.json();
                        if (json?.success) {
                            return { reply: `🧠 Aprendido: "${json.data.title}"\n\nYa forma parte de mi saber sobre vos (${json.data.total} entrada${json.data.total === 1 ? '' : 's'}). Preguntame cuando lo necesites — lo voy a citar como fuente tuya, no voy a inventar encima.`, intent: 'teach' };
                        }
                        return { reply: '⚠ No pude guardarlo: ' + (json?.message || json?.error || 'error desconocido'), intent: 'teach' };
                    } catch (e) {
                        return { reply: '⚠ Server no disponible para guardar tu saber: ' + e.message, intent: 'teach' };
                    }
                })(),
                __clientHandled: true
            };
        }
        if (/^\s*(mi saber|que te ense[ñn][eé]|qué te ense[ñn][eé]|que sabes de mi|qué sabés de mí|lista de saber)\s*\??\s*$/i.test(text)) {
            return {
                __asyncPromise: (async () => {
                    try {
                        const resp = await fetch((window.GUNTER_CONFIG?.PROXY_BASE_URL || '') + '/api/tutor', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ op: 'teach-list' })
                        });
                        const json = await resp.json();
                        const entries = json?.data?.entries || [];
                        if (!entries.length) return { reply: '🧠 Todavía no me enseñaste nada. Probá: "aprende esto: mi proceso de onboarding tiene 3 pasos…"', intent: 'teach' };
                        return {
                            reply: `🧠 Tu saber (${entries.length} entrada${entries.length === 1 ? '' : 's'}):\n` +
                                entries.map((e, i) => `${i + 1}. ${e.title} (${Math.round(e.chars / 100) / 10}k chars)`).join('\n') +
                                '\n\nBorrar: "olvida el saber N".',
                            intent: 'teach'
                        };
                    } catch (e) { return { reply: '⚠ ' + e.message, intent: 'teach' }; }
                })(),
                __clientHandled: true
            };
        }
        const teachDel = text.match(/^\s*olvida\s+el\s+saber\s+(\d+)\s*$/i);
        if (teachDel) {
            return {
                __asyncPromise: (async () => {
                    try {
                        const resp = await fetch((window.GUNTER_CONFIG?.PROXY_BASE_URL || '') + '/api/tutor', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ op: 'teach-remove', id: teachDel[1] })
                        });
                        const json = await resp.json();
                        return { reply: json?.data?.removed ? 'Olvidado. Como si nunca hubiera existido.' : 'No encontré esa entrada.', intent: 'teach' };
                    } catch (e) { return { reply: '⚠ ' + e.message, intent: 'teach' }; }
                })(),
                __clientHandled: true
            };
        }

        // ¿Qué está pasando ahora / diagnóstico completo?
        if (/\b(diagnostico completo|diagnóstico completo|que esta pasando|qué está pasando|estado general|todo bien|check up|checkup|health)\b/.test(t)) {
            const st = buf.getServiceStatus();
            const summary = buf.getSummary();
            const latest = summary.latestError || summary.latestWarn;
            const lines = [
                `🩺 Diagnóstico (${st.page}):`,
                `• Services cargados: ${st.loaded.length}, faltantes: ${st.missing.length}`,
                `• Logs: ${summary.byLevel.error} errores, ${summary.byLevel.warn} advertencias`,
                latest ? `• Último issue: [${latest.level}] ${latest.msg.slice(0, 160)}` : '• Sin issues recientes',
                st.missing.length ? `\n💡 Para que ejecuten TODAS mis funciones, faltan services aquí. Escribe "servicios cargados" para el detalle.` : '\n✅ Todos los services core están.'
            ];
            return { reply: lines.join('\n'), intent: 'diagnostic', __clientHandled: true };
        }

        return null;
    }

    async function handleUserMessage(text, messageOptions = {}) {
        const voiceInput = messageOptions.inputSource === 'voice';
        interrupt();
        const turnId = STATE.turnId;
        const controller = new AbortController();
        STATE.turnController = controller;
        const toolHint = window.GunterAssistantTools?.detect?.(text) || window.GunterAssistantTools?.getPending?.();
        const toolTimeout = toolHint?.toolId?.startsWith('desktop.browser.') ? 95000 : toolHint?.toolId?.startsWith('desktop.') ? 65000 : 8000;
        const finishTyping = () => { if (turnId === STATE.turnId) setTyping(false); };
        const reply = message => { if (turnId === STATE.turnId) addMessage('assistant', message, messageOptions); };
        addMessage('user', text);
        setTyping(true);

        // Navegación determinista de respaldo: las rutas son estáticas y
        // allowlistadas; evita que el planificador de tareas interprete
        // "ve a tareas" como una solicitud temporal.
        const directDestination = !toolHint || toolHint.toolId === 'app.navigate' ? resolveGunterNavigation(text) : null;
        if (directDestination) {
            finishTyping();
            reply(`Abriendo ${directDestination.label}.`);
            window.location.assign(directDestination.href);
            return;
        }

        // Safety net: siempre limpiar el typing indicator al terminar
        const safetyTimer = setTimeout(() => {
            if (turnId !== STATE.turnId) return;
            finishTyping();
            reply('⚠️ El servidor no respondió a tiempo. Verifica que `npm run dev` esté corriendo y prueba de nuevo.');
        }, Math.max(SAFETY_TIMEOUT_MS, toolTimeout) + 5000);

        try {
            // Navegación y configuración propia de Gunter deben llegar primero
            // al registro allowlist; interceptores históricos pueden interpretar
            // "memoria semántica" como una pregunta sobre memoria conversacional.
            const earlyIntent = window.GunterAssistantTools?.detect?.(text);
            if (!voiceInput && /\b(personalidad|estilo de voz|modo de personalidad|intensidad|ponte|comportamiento)\b/i.test(text) && window.GunterActions?.dispatch) {
                const styleResult = await window.GunterActions.dispatch(text);
                if (turnId !== STATE.turnId) return;
                if (styleResult?.reply) { clearTimeout(safetyTimer); finishTyping(); reply(styleResult.reply); return; }
            }
            if (earlyIntent && ['app.navigate', 'preferences.update', 'desktop.permissions.update', 'settings.list', 'settings.update'].includes(earlyIntent.toolId)) {
                const earlyResult = await withTimeout(window.GunterAssistantTools.dispatch(text, { inputSource: voiceInput ? 'voice' : 'text' }), 8000, 'assistant-settings-timeout');
                if (turnId !== STATE.turnId) return;
                if (earlyResult?.handled) {
                    clearTimeout(safetyTimer);
                    finishTyping();
                    reply(earlyResult.reply);
                    if (earlyResult.status === 'complete') {
                        setMascotState('celebration');
                        setTimeout(() => setMascotState('default'), 800);
                    }
                    return;
                }
            }

            // 0. Client intercepts (logs, service status, diagnosis) — antes del server
            const clientResp = voiceInput ? null : tryClientIntercepts(text);
            if (clientResp) {
                // Algunas responses son async (ej. tutor catalog)
                if (clientResp.__asyncPromise) {
                    try {
                        const resolved = await withTimeout(clientResp.__asyncPromise, 8000, 'client-async-timeout');
                        clearTimeout(safetyTimer);
                        finishTyping();
                        reply(resolved.reply);
                    } catch (e) {
                        clearTimeout(safetyTimer);
                        finishTyping();
                        reply('⚠ Se demoró la consulta: ' + e.message);
                    }
                    return;
                }
                clearTimeout(safetyTimer);
                finishTyping();
                reply(clientResp.reply);
                return;
            }

            // 0.2. Planes multipaso durables. Solo intercepta cuando detecta
            // dos o más habilidades Web permitidas y siempre propone antes de actuar.
            if (!voiceInput && window.GunterWorkflowOrchestrator?.dispatch) {
                try {
                    const workflowResponse = await withTimeout(
                        window.GunterWorkflowOrchestrator.dispatch(text),
                        30000,
                        'workflow-orchestrator-timeout'
                    );
                    if (turnId !== STATE.turnId) return;
                    if (workflowResponse?.handled) {
                        clearTimeout(safetyTimer);
                        finishTyping();
                        reply(workflowResponse.reply);
                        if (workflowResponse.status === 'complete') {
                            setMascotState('celebration');
                            setTimeout(() => setMascotState('default'), 900);
                        } else if (workflowResponse.status === 'awaiting_confirmation') {
                            setMascotState('thinking');
                        }
                        window.GunterActivityPanel?.refresh?.();
                        return;
                    }
                } catch (workflowError) {
                    console.warn('[companion] workflow error:', workflowError.message);
                }
            }

            // 0.25. Registro local de herramientas (agenda, tareas, eventos).
            if (turnId !== STATE.turnId) return;
            // Se ejecuta antes del dispatcher/LLM porque tiene validación,
            // confirmación y verificación de persistencia propias.
            if (window.GunterAssistantTools?.dispatch) {
                try {
                    const toolResponse = await withTimeout(
                        window.GunterAssistantTools.dispatch(text, { inputSource: voiceInput ? 'voice' : 'text' }),
                        toolTimeout,
                        'assistant-tools-timeout'
                    );
                    if (turnId !== STATE.turnId) return;
                    if (toolResponse?.handled) {
                        clearTimeout(safetyTimer);
                        finishTyping();
                        reply(toolResponse.reply);
                        if (toolResponse.status === 'complete') {
                            setMascotState('celebration');
                            setTimeout(() => setMascotState('default'), 800);
                        }
                        return;
                    }
                } catch (toolError) {
                    console.warn('[companion] assistant tools error:', toolError.message);
                    clearTimeout(safetyTimer); finishTyping();
                    reply('La acción no ha devuelto un resultado verificable. Consulta Actividad para comprobar su estado antes de volver a pedirla.');
                    return;
                }
            }

            // Si el usuario expresa una acción que no coincide con una skill,
            if (turnId !== STATE.turnId) return;
            // aclarar la intención antes del fallback libre del modelo. Las
            // sugerencias salen del registro real de herramientas disponibles.
            const clarification = window.GunterAssistantTools?.clarifyRequest?.(text);
            if (clarification) {
                clearTimeout(safetyTimer);
                finishTyping();
                reply(clarification.reply);
                return;
            }

            // 0.5. Resolver referencias anafóricas ("activalo", "y ese?")
            //      usando el último tema tratado antes de dispatcher.
            const resolvedText = resolveAnaphora(text);
            if (resolvedText !== text) {
                console.info('[companion] anaphora resolved:', text, '→', resolvedText);
            }

            // 1. Intentar action dispatcher (toggle, query, list) con timeout
            let response = null;
            if (!voiceInput && window.GunterActions?.dispatch) {
                try {
                    response = await withTimeout(
                        window.GunterActions.dispatch(resolvedText),
                        6000,
                        'actions-timeout'
                    );
                } catch (actErr) {
                    console.warn('[companion] actions timeout/error:', actErr.message);
                    // Continúa al LLM
                }
            }

            if (response?.reply) {
                if (turnId !== STATE.turnId) return;
                clearTimeout(safetyTimer);
                finishTyping();
                reply(response.reply);
                updateLastTopic(response);

                // Celebration si aplicó acción exitosamente
                if (response.intent === 'applied') {
                    setMascotState('celebration');
                    setTimeout(() => setMascotState('default'), 800);
                    if (navigator.vibrate) { try { navigator.vibrate([30, 20, 30]); } catch {} }
                }

                // Refresh quick actions
                renderQuick();
                return;
            }

            // 1.5. LLM classifier bridge — si el regex no matcheó nada, preguntamos
            //      al LLM si es realmente un intent de feature (typos, phrasing raro).
            //      Solo si tenemos NLP + tiempo.
            if (!voiceInput && window.GunterNlpLlm?.complete && window.GunterActions?.dispatch && text.length < 200 && /\b(feature|funci[oó]n|herramienta|configuraci[oó]n|opci[oó]n|ajuste|modo|personalidad|activa|desactiva|habilita|enciende|apaga|prende)\b/i.test(text)) {
                if (turnId !== STATE.turnId) return;
                try {
                    const classifier = await withTimeout(
                        _classifyWithLLM(text, controller.signal),
                        4500,
                        'classify-timeout'
                    );
                    if (turnId !== STATE.turnId) return;
                    if (classifier?.rewrittenCommand) {
                        console.info('[companion] LLM classified:', text, '→', classifier.rewrittenCommand);
                        const retry = await withTimeout(
                            window.GunterActions.dispatch(classifier.rewrittenCommand),
                            5000,
                            'retry-timeout'
                        );
                        if (retry?.reply) {
                            clearTimeout(safetyTimer);
                            finishTyping();
                            reply(retry.reply);
                            updateLastTopic(retry);
                            if (retry.intent === 'applied') {
                                setMascotState('celebration');
                                setTimeout(() => setMascotState('default'), 800);
                            }
                            renderQuick();
                            return;
                        }
                    }
                } catch (clErr) {
                    console.warn('[companion] classifier fail:', clErr.message);
                    // continúa al LLM libre
                }
            }

            // 2. Fallback: LLM libre con personalidad (con timeout)
            if (turnId !== STATE.turnId) return;
            if (window.GunterNlpLlm?.complete) {
                const prompt = await buildLLMPrompt(text);
                if (turnId !== STATE.turnId) return;
                try {
                    const raw = await withTimeout(
                        window.GunterNlpLlm.complete(prompt, {
                            temperature: 0.6,
                            maxTokens: 260,
                            skipMemory: true,
                            signal: controller.signal
                        }),
                        SAFETY_TIMEOUT_MS,
                        'llm-timeout'
                    );
                    clearTimeout(safetyTimer);
                    finishTyping();
                    reply(raw?.trim() || 'No supe responder eso, prueba de otra forma.');
                    return;
                } catch (llmErr) {
                    console.warn('[companion] LLM error:', llmErr.message);
                    clearTimeout(safetyTimer);
                    finishTyping();
                    if (llmErr.message === 'llm-timeout') {
                        reply('⌛ Tardé demasiado. Verifica que el servidor esté corriendo (`npm run dev`) y que tu OPENAI_API_KEY esté configurada en el `.env`.');
                    } else if (/network|fetch|CORS|failed to fetch/i.test(llmErr.message || '')) {
                        reply('⚠️ No pude conectar con el servidor. ¿Tu tunnel de Cloudflare sigue activo?');
                    } else {
                        reply('⚠️ Error: ' + llmErr.message);
                    }
                    return;
                }
            }

            clearTimeout(safetyTimer);
            finishTyping();
            reply('⚠️ El servicio de IA no cargó en esta página. Recarga (Ctrl+Shift+R) y prueba de nuevo.');
        } catch (e) {
            clearTimeout(safetyTimer);
            finishTyping();
            reply('⚠️ Error: ' + (e?.message || 'algo salió mal'));
        } finally {
            clearTimeout(safetyTimer);
            if (STATE.turnController === controller) STATE.turnController = null;
        }
    }

    function resolveGunterNavigation(text) {
        const normalized = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/^(?:(?:hi|hey|hola|oye)\s+)?(?:gunter|gonter|gunder)\s*[,;:!\-]*\s*/, '').trim();
        if (!/^(?:ve a|ir a|lleva(?:me)? a|abre|abrir|navega(?:r)? a|entra a|muestrame)\b/.test(normalized)) return null;
        const routes = [
            { label: 'las opciones avanzadas', href: 'config.html#premium', aliases: ['opciones avanzadas', 'ajustes avanzados', 'configuracion avanzada', 'asistente ia', 'configuracion de voz'] },
            { label: 'Conversaciones', href: 'day.html#conversations', aliases: ['conversaciones', 'mensajes', 'chats', 'bandeja'] },
            { label: 'Nueva reunión', href: 'new-project.html', aliases: ['nueva reunion', 'preparar reunion'] },
            { label: 'Reuniones', href: 'dashboard.html', aliases: ['reuniones', 'reunion', 'panel de reuniones'] },
            { label: 'Resultados', href: 'results.html', aliases: ['resultados', 'transcripciones'] },
            { label: 'Captura rápida', href: 'day.html#capture', aliases: ['captura rapida', 'captura'] },
            { label: 'Tareas', href: 'day.html#tasks', aliases: ['tareas', 'pendientes'] },
            { label: 'Agenda', href: 'day.html#events', aliases: ['agenda', 'calendario', 'eventos'] },
            { label: 'Recordatorios', href: 'day.html#reminders', aliases: ['recordatorios'] },
            { label: 'Actividad', href: 'day.html#activity', aliases: ['actividad', 'historial'] },
            { label: 'Conexiones', href: 'config.html#data', aliases: ['conexiones', 'redes sociales'] },
            { label: 'Preferencias', href: 'config.html#preferences', aliases: ['preferencias'] },
            { label: 'Configuración', href: 'config.html#preferences', aliases: ['configuracion', 'ajustes'] },
            { label: 'Inicio', href: 'day.html', aliases: ['inicio', 'principal', 'hoy'] }
        ];
        const target = normalized.replace(/^(?:ve a|ir a|lleva(?:me)? a|abre|abrir|navega(?:r)? a|entra a|muestrame)\s+/, '').trim();
        const matches = routes.flatMap(route => route.aliases.map(alias => ({ route, alias })))
            .sort((a, b) => b.alias.length - a.alias.length);
        return matches.find(({ alias }) => new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(target))?.route || null;
    }

    // ─────────────────────────────────────
    // Context tracking (para no perder el hilo)
    // ─────────────────────────────────────
    // STATE.lastTopic guarda la última feature/tema mencionada.
    // Se actualiza cuando Gunter responde con intent 'applied' o 'query',
    // o cuando el usuario menciona explícitamente una feature.
    STATE.lastTopic = null;

    function updateLastTopic(response) {
        if (!response) return;
        if (response.feature) {
            STATE.lastTopic = {
                feature: response.feature,
                value: response.value,
                intent: response.intent,
                at: Date.now()
            };
        }
    }

    // Referencias anafóricas comunes en español latino.
    // Si el usuario dice "activalo" tras hablar de una feature, resolvemos
    // la referencia al último tópico para que el dispatcher no pierda el hilo.
    const REF_PATTERNS = [
        /^\s*activ(a|alo|ala|arlo|arla|ame|amelo)\s*(la|el|eso|esa|ese|esto)?\s*\.?$/i,
        /^\s*(prende|enciende|dale|hazlo|activo)\s*(la|el|eso|esa|ese)?\s*\.?$/i,
        /^\s*(apag|desactiv)a(lo|la|rlo|rla|arme|melo)?\s*(la|el|eso|esa|ese)?\s*\.?$/i,
        /^\s*(y (eso|esa|ese)|y ese que|para que sirve|que hace|que es( eso| esa| ese)?)\s*\??\s*$/i,
        /^\s*(mas info|cuéntame más|dime más)\s*\.?$/i
    ];

    function resolveAnaphora(text) {
        // ¿Es una referencia corta que necesita contexto?
        const isRef = REF_PATTERNS.some(re => re.test(text));
        if (!isRef) return text;
        if (!STATE.lastTopic) return text;

        // ¿Es toggle on/off/query?
        const lower = text.toLowerCase();
        const feature = STATE.lastTopic.feature;
        if (/^\s*(desactiv|apag)/.test(lower)) {
            return 'desactiva ' + feature;
        }
        if (/(que es|que hace|para que sirve|cuentame|cuéntame|mas info|dime mas|dime más)/.test(lower)) {
            return 'qué es ' + feature;
        }
        // Default: toggle on
        return 'activa ' + feature;
    }

    // Últimos N turnos como transcripción para el LLM.
    function buildConversationTranscript(currentText, maxTurns = 8) {
        // Excluye el último mensaje user (es "currentText") — ya viene aparte
        const turns = STATE.log.slice(-maxTurns - 1, -1);
        if (!turns.length) return '';
        return turns
            .map(m => (m.role === 'user' ? 'Usuario' : 'Gunter') + ': ' + m.text.replace(/\n+/g, ' ').slice(0, 220))
            .join('\n');
    }

    // ─────────────────────────────────────
    // LLM classifier — cuando el dispatcher regex no matcheó nada,
    // pregunta al LLM en JSON estricto si el usuario está pidiendo
    // toggle/query/list de una feature. Reescribe el comando canónico.
    // ─────────────────────────────────────
    const KNOWN_FEATURES_HINT = [
        'conversationMemory', 'proactivePulse', 'commitmentTracker',
        'meetingClimate', 'mirrorStyle', 'projectForecast',
        'dailyPlanner', 'weeklyPlanner', 'urgencyRanking', 'project360',
        'decisionCenter', 'delegationMode', 'smartWhatsappAlerts',
        'meetingSmartFollowUp', 'projectAutoFollowUp', 'projectExecutiveSummary',
        'meetingMemory', 'smartDocuments', 'productivityPanel',
        'googleCalendarSync', 'googleCalendarNaturalLanguage', 'googleCalendarAutoReminders',
        'whatsappAssistant', 'documentSync', 'notionSync', 'googleDriveSync',
        'adaptivePersonality', 'personalityMode', 'personalityIntensity',
        'voiceEnabled', 'voiceMode', 'voiceStyle', 'voiceSpeed', 'voiceInMeetings',
        'wakeWordEnabled', 'wakeWordListeningMode', 'wakeWordResponseMode', 'wakeWord',
        'tutorMode',
        'focusCoachEnabled', 'distractionBlocker', 'smartTimer'
    ];

    async function _classifyWithLLM(text, signal) {
        const prompt = `Tarea: clasificar si el mensaje del usuario es un intent de configuración de Gunter, y si sí, reescribirlo como comando canónico.

Features conocidas (flags técnicos):
${KNOWN_FEATURES_HINT.join(', ')}

Reglas:
- Si el usuario pide activar/prender/encender una feature → intent="toggle_on".
- Si pide apagar/desactivar → intent="toggle_off".
- Si pregunta "qué es/qué hace/para qué sirve" → intent="query".
- Si pide listar/enumerar features → intent="list".
- Si NO es sobre features de Gunter → intent="none" y rewrittenCommand=null.
- El comando canónico debe ser: "activa <feature>" / "desactiva <feature>" / "qué es <feature>" / "qué features hay".

Mensaje del usuario: "${text.replace(/"/g, '\\"')}"

Responde SOLO JSON estricto:
{"intent": "toggle_on|toggle_off|query|list|none", "feature": "<flag técnico o null>", "rewrittenCommand": "<comando canónico o null>", "confidence": 0.0-1.0}`;

        const raw = await window.GunterNlpLlm.complete(prompt, {
            temperature: 0.1,
            maxTokens: 120,
            skipMemory: true,
            jsonMode: true,
            signal
        });
        if (!raw) return null;
        try {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            if (parsed.intent === 'none' || parsed.confidence < 0.55) return null;
            return parsed;
        } catch {
            const m = String(raw).match(/\{[\s\S]*\}/);
            if (!m) return null;
            try {
                const parsed = JSON.parse(m[0]);
                if (parsed.intent === 'none' || parsed.confidence < 0.55) return null;
                return parsed;
            } catch { return null; }
        }
    }

    async function buildLLMPrompt(text) {
        const pageCtx = {
            dashboard:   'El usuario está en el dashboard viendo sus proyectos.',
            'new-project': 'El usuario está creando una nueva reunión.',
            day:         'El usuario está en su vista diaria (tareas, eventos, chat).',
            meeting:     'El usuario está en medio de una reunión.',
            results:     'El usuario está viendo el análisis de una reunión pasada.',
            config:      'El usuario está en configuración.',
            index:       'El usuario está en la pantalla de bienvenida.'
        };
        const ctx = pageCtx[STATE.currentPage] || '';

        // Bloque 1: transcripción reciente
        const recent = buildConversationTranscript(text, 8);

        // Bloque 2: último tópico (referente para pronombres)
        const topicLine = STATE.lastTopic
            ? `Último tema tratado: ${STATE.lastTopic.feature} (intent=${STATE.lastTopic.intent}).`
            : '';

        // Bloque 3: memoria de largo plazo (si flag ON y service cargado)
        let memoryBlock = '';
        try {
            const memSvc = window.GunterConversationMemory;
            const memOn  = window.PremiumFeaturesService?.isEnabled?.('conversationMemory');
            if (memOn && memSvc?.recall) {
                const memTurns = await memSvc.recall(text, { topK: 4, minScore: 0.34 });
                if (memTurns && memTurns.length && memSvc.contextSnippet) {
                    memoryBlock = '\n\nMEMORIA DE SESIONES PREVIAS:\n' + memSvc.contextSnippet(memTurns);
                }
            }
        } catch { /* memoria opcional, sigue sin ella */ }

        // Bloque 4: modo tutor (si flag ON) — inyecta biblioteca + rol profesor
        // + pasajes RAG relacionados a la pregunta actual.
        let tutorBlock = '';
        try {
            if (window.GunterTutor?.isEnabled?.() && window.GunterTutor.buildTutorContext) {
                const ctx = await window.GunterTutor.buildTutorContext(text);
                if (ctx) tutorBlock = '\n\n' + ctx;
            }
        } catch { /* opcional */ }

        // Bloque 5 (v31): notas + marcadores + huella de estudio del usuario
        try {
            if (window.GunterTutor?.isEnabled?.() && window.GunterTutorNotes?.contextBlock) {
                const sess = await window.GunterTutor.session?.().catch(() => null);
                const workN = sess?.currentWorkMeta?.n || null;
                const notesCtx = window.GunterTutorNotes.contextBlock({ workN });
                if (notesCtx) tutorBlock += '\n\n' + notesCtx;
            }
        } catch { /* opcional */ }

        // Cada 4-6 turnos, aproximadamente, permitimos un chiste seco/humor negro
        // (dado el usuario, y solo cuando no rompe el flow útil).
        const turnCount = STATE.log.filter(m => m.role === 'user').length;
        const jokeWindow = turnCount > 0 && turnCount % 5 === 0;

        // v37 · Humor del día (mood engine) — tiñe el tono sin dominar
        let moodLine = '';
        try { moodLine = window.GunterMood?.promptLine?.() || ''; } catch {}

        // v38 · Reglas personales del usuario — SIEMPRE presentes
        let rulesBlock = '';
        try { rulesBlock = window.GunterRules?.promptBlock?.() || ''; } catch {}

        // v38 · Saber personal (RAG): si la query matchea conocimiento que el
        // usuario le enseñó a Gunter, inyectarlo como fuente citable.
        let teachBlock = '';
        try {
            if (text && text.length >= 4) {
                const resp = await fetch((window.GUNTER_CONFIG?.PROXY_BASE_URL || '') + '/api/tutor', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ op: 'teach-search', query: text, limit: 3 })
                });
                const json = await resp.json();
                const hits = json?.data?.hits || [];
                if (hits.length) {
                    teachBlock = '\n\n# SABER PERSONAL DEL USUARIO (él te lo enseñó — citalo como "según lo que me enseñaste")\n' +
                        hits.map(h => `▸ "${h.title}": ${h.snippet}`).join('\n') +
                        '\nSi respondés con esto, dejá claro que es SU conocimiento, no de los libros. No lo mezcles con Grinberg sin avisar.';
                }
            }
        } catch { /* saber opcional */ }

        return `${rulesBlock ? rulesBlock + '\n\n' : ''}# QUIÉN ERES
${window.GunterPresence?.personalityPrompt?.() || 'Eres Gunter, un asistente personal amigable, atento y preciso.'}
Español neutro latinoamericano (es-419). ${moodLine ? 'Matiz del momento (secundario al estilo elegido): ' + moodLine : ''}

# CONTEXTO
${ctx}
${topicLine}

# REGLAS DURAS
- Mantén coherencia con la conversación reciente (abajo). NO pierdas el hilo. Si el usuario usa pronombres ("eso", "esa", "activalo"), refieren al último tema tratado.
- Responde breve (máx ~70 palabras), tesis primero, evidencia si aporta.
- Nunca inventes datos, fuentes, estado de una integración, ejecución o resultado. Distingue claramente conocimiento general, datos comprobados en esta app e inferencias; si no puedes verificar, dilo y no lo presentes como hecho.
- No afirmes que puedes ejecutar una acción solo porque sabes explicarla. Solo declara disponible una acción si existe una herramienta cargada/permitida en esta sesión; nunca inventes nombres de opciones, rutas, permisos ni resultados.
- Si la petición de acción es ambigua o no reconoces el nombre de una herramienta, explica brevemente qué entendiste, sugiere únicamente capacidades que consten en el contexto/herramientas disponibles y pregunta por el resultado deseado, aplicación/dispositivo o una descripción de la herramienta. Si faltan datos, pregunta antes de actuar.
- Si una capacidad no existe o no está disponible, dilo sin rodeos y ofrece una alternativa realista; no simules que la hiciste.
- ${jokeWindow ? 'Puedes usar humor ligero si encaja con el estilo elegido y la situación.' : 'Prioriza utilidad y el estilo elegido.'}
${memoryBlock}${tutorBlock}${teachBlock}

${recent ? 'CONVERSACIÓN RECIENTE:\n' + recent + '\n\n' : ''}Usuario: ${text}
Gunter:`;
    }

    // ─────────────────────────────────────
    // Message splitter — divide respuestas largas en bubbles independientes
    // para que todo se lea. Splits por doble salto de línea, luego por bullets,
    // luego por frases si sigue siendo muy largo.
    // ─────────────────────────────────────
    const SPLIT_CHAR_THRESHOLD = 320;   // > 320 chars → considera dividir
    const SPLIT_MAX_CHUNK = 500;        // ningún chunk debe superar esto

    function splitLongMessage(text) {
        if (!text || text.length <= SPLIT_CHAR_THRESHOLD) return [text];

        // 1) Preferido: dividir por dobles saltos de línea (párrafos)
        let chunks = text.split(/\n\s*\n+/).map(s => s.trim()).filter(Boolean);

        // 2) Si algún chunk sigue siendo enorme, dividir por líneas de bullets
        chunks = chunks.flatMap(chunk => {
            if (chunk.length <= SPLIT_MAX_CHUNK) return [chunk];
            // Si tiene bullets, agruparlos con encabezado
            const bulletMatch = chunk.match(/^([^•\-\*\n]*?)((?:\n[\s•\-\*].+)+)$/);
            if (bulletMatch) {
                const head = bulletMatch[1].trim();
                const bullets = bulletMatch[2].trim().split(/\n(?=[\s•\-\*])/);
                const groups = [];
                let current = head ? head : '';
                for (const b of bullets) {
                    if ((current + '\n' + b).length > SPLIT_MAX_CHUNK) {
                        if (current) groups.push(current.trim());
                        current = b;
                    } else {
                        current = current ? current + '\n' + b : b;
                    }
                }
                if (current) groups.push(current.trim());
                return groups;
            }
            // Fallback: dividir por oraciones
            const sentences = chunk.split(/(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ])/);
            const groups = [];
            let buf = '';
            for (const s of sentences) {
                if ((buf + ' ' + s).length > SPLIT_MAX_CHUNK && buf) {
                    groups.push(buf.trim());
                    buf = s;
                } else {
                    buf = buf ? buf + ' ' + s : s;
                }
            }
            if (buf) groups.push(buf.trim());
            return groups;
        });

        // Sin nada útil que dividir → devolver original
        return chunks.length ? chunks : [text];
    }

    function _pushOne(role, text) {
        STATE.log.push({ role, text, ts: Date.now() });
        if (STATE.log.length > MAX_LOG) STATE.log.shift();
    }

    function _afterAssistantMessage(fullText, options = {}) {
        // Memoria de LT
        try {
            const memSvc = window.GunterConversationMemory;
            const memOn  = window.PremiumFeaturesService?.isEnabled?.('conversationMemory');
            if (memOn && memSvc?.remember) {
                memSvc.remember({
                    role: 'assistant',
                    text: fullText,
                    channel: 'companion',
                    sessionId: STATE.currentPage + ':' + (STATE.sessionStartTs || Date.now())
                });
            }
        } catch (e) { console.warn('[companion] remember fail:', e.message); }

        // Voz (habla el mensaje completo, no por chunks)
        if (window.GunterVoice?.speak) {
            try {
                if (options.wakeWordResponse && window.PremiumFeaturesService?.getWakeWordConfig?.().responseMode !== 'voice') {
                    setMascotState('default');
                    return;
                }
                window.GunterVoice.speak(fullText, {
                    context: options.voiceContext || 'chat',
                    full: options.fullVoice === true,
                    force: options.forceVoice === true
                });
            } catch { /* noop */ }
        }
        // Mascota talking
        setMascotState('talking');
        setTimeout(() => setMascotState('default'), Math.min(3500, 800 + fullText.length * 30));
    }

    function _afterUserMessage(text) {
        try {
            const memSvc = window.GunterConversationMemory;
            const memOn  = window.PremiumFeaturesService?.isEnabled?.('conversationMemory');
            if (memOn && memSvc?.remember) {
                memSvc.remember({
                    role: 'user',
                    text,
                    channel: 'companion',
                    sessionId: STATE.currentPage + ':' + (STATE.sessionStartTs || Date.now())
                });
            }
        } catch (e) { console.warn('[companion] remember fail:', e.message); }
        if (navigator.vibrate) { try { navigator.vibrate(10); } catch {} }
    }

    function addMessage(role, text, options = {}) {
        // Si es del assistant y es largo, dividimos en varios bubbles
        // con delay para que se vean escalonados y nada se corte.
        if (role === 'assistant') {
            const parts = splitLongMessage(text);
            if (parts.length > 1) {
                parts.forEach(part => _pushOne(role, part));
                saveLog(); renderLog(); _afterAssistantMessage(text, options);
                return;
            }
            _pushOne(role, text);
            saveLog();
            renderLog();
            _afterAssistantMessage(text, options);
            return;
        }

        // Usuario → flujo simple
        _pushOne(role, text);
        saveLog();
        renderLog();
        _afterUserMessage(text);
    }

    function renderLog() {
        const log = document.getElementById('gn-comp-log');
        if (!log) return;
        log.innerHTML = STATE.log.map(m => `
            <div class="gn-comp__msg gn-comp__msg--${m.role}">${escapeHtml(m.text)}</div>
        `).join('');
        scrollLogToBottom();
    }

    function scrollLogToBottom() {
        const log = document.getElementById('gn-comp-log');
        if (log) log.scrollTop = log.scrollHeight;
    }

    function setTyping(on) {
        const log = document.getElementById('gn-comp-log');
        if (!log) return;
        let t = log.querySelector('.gn-comp__typing');
        if (on && !t) {
            t = document.createElement('div');
            t.className = 'gn-comp__typing';
            t.innerHTML = '<span></span><span></span><span></span>';
            log.appendChild(t);
            scrollLogToBottom();
        } else if (!on && t) {
            t.remove();
        }
        // Estado del mascota: thinking cuando está escribiendo
        setMascotState(on ? 'thinking' : 'default');
    }

    function setMascotState(state) {
        document.querySelectorAll('.gn-mascot').forEach(m => {
            m.classList.remove('is-thinking', 'is-talking', 'is-listening', 'is-celebration');
            if (state && state !== 'default') m.classList.add('is-' + state);
        });
        // Status label en el header del chat
        const status = document.getElementById('gn-comp-status');
        if (status) {
            const labels = {
                thinking: 'Pensando…',
                talking:  'Hablando…',
                listening:'Escuchando…',
                celebration: '¡Genial!',
                default:  'Tu asistente'
            };
            status.textContent = labels[state] || labels.default;
        }
    }

    // ─────────────────────────────────────
    // Quick actions (según página)
    // ─────────────────────────────────────
    function renderQuick() {
        const el = document.getElementById('gn-comp-quick');
        if (!el) return;
        const items = quickForPage(STATE.currentPage);
        el.innerHTML = items.map(q => `<button data-comp-quick="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join('');
        el.querySelectorAll('button').forEach(b => {
            b.addEventListener('click', () => {
                handleUserMessage(b.dataset.compQuick);
            });
        });
    }

    function quickForPage(page) {
        const base = {
            dashboard:   ['¿Qué puedes hacer?', 'Iniciar reunión', 'Activa la memoria', 'Activa el pulso'],
            'new-project': ['¿Qué es Empresarial?', '¿Qué es Podcast?', '¿Qué es Zen?'],
            day:         ['¿Qué tengo hoy?', 'Activa el planificador', 'Ponte más divertido'],
            meeting:     [],
            results:     ['Resume la reunión', 'Genera slides', 'Detecta compromisos'],
            config:      ['¿Qué es la memoria?', '¿Qué es el forecast?', 'Activa el pulso proactivo', 'Ponte más suave'],
            index:       []
        };
        return base[page] || ['¿Qué puedes hacer?', 'Activa la memoria'];
    }

    // ─────────────────────────────────────
    // Persistencia
    // ─────────────────────────────────────
    function loadLog() {
        try {
            const raw = localStorage.getItem(LOG_KEY);
            STATE.log = raw ? JSON.parse(raw) : [];
        } catch { STATE.log = []; }
    }

    function saveLog() {
        try { localStorage.setItem(LOG_KEY, JSON.stringify(STATE.log.slice(-MAX_LOG))); } catch { /* noop */ }
    }

    // ─────────────────────────────────────
    // Utils
    // ─────────────────────────────────────
    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    // ─────────────────────────────────────
    // v66 · ACTITUDES VIVAS — reacciones + humor dinámico
    // La mascota reacciona a lo que pasa en el sistema y
    // re-evalúa su humor sin recargar la página.
    // ─────────────────────────────────────
    const LIVE = { lastReact: 0, idleTimer: null };

    function react(type, ms = 2000) {
        const now = Date.now();
        if (now - LIVE.lastReact < 4000) return;   // anti-spam
        LIVE.lastReact = now;
        document.querySelectorAll('.gn-mascot').forEach(m => {
            ['hop', 'shake', 'wave', 'look', 'peck'].forEach(t => m.classList.remove('is-react-' + t));
            void m.getBoundingClientRect();        // reflow: reinicia la animación
            m.classList.add('is-react-' + type);
            setTimeout(() => m.classList.remove('is-react-' + type), ms);
        });
    }

    // Operaciones del sistema → alegría o berrinche
    window.addEventListener('gunter-status-change', (e) => {
        const st = e.detail?.state;
        if (st === 'success') react('hop');
        else if (st === 'error') react('shake');
    });

    // Estado conversacional único para que el header y la mascota reflejen
    // escucha, procesamiento, voz y confirmaciones pendientes.
    window.addEventListener('gunter-conversation-state', event => {
        const value = event.detail?.value;
        if (value === 'listening_wake' || value === 'listening_query') setMascotState('listening');
        else if (value === 'thinking') setMascotState('thinking');
        else if (value === 'speaking') setMascotState('talking');
        else if (value === 'awaiting_confirmation') {
            setMascotState('listening');
            const status = document.getElementById('gn-comp-status');
            if (status) status.textContent = 'Esperando confirmación…';
        } else if (value === 'error') {
            const status = document.getElementById('gn-comp-status');
            if (status) status.textContent = 'Necesito atención';
        } else setMascotState('default');
    });

    // Humor dinámico: re-evaluar cada 5 min y al volver a la pestaña
    function refreshMood(withReaction) {
        try {
            if (!window.GunterMood?.compute) return;
            const m = window.GunterMood.compute();
            const cls = m && m.mood && m.mood !== 'neutral' ? 'is-mood-' + m.mood.replace(/_/g, '-') : '';
            document.querySelectorAll('.gn-mascot').forEach(el => {
                [...el.classList].filter(c => c.startsWith('is-mood-')).forEach(c => el.classList.remove(c));
                if (cls) el.classList.add(cls);
            });
            const status = document.getElementById('gn-comp-status');
            if (status && window.GunterMood.statusLabel) status.textContent = window.GunterMood.statusLabel();
            if (withReaction && cls) react(['excited', 'proud'].includes(m.mood) ? 'hop' : 'look');
        } catch { /* mood opcional */ }
    }
    setInterval(() => refreshMood(false), 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshMood(true); });

    // Vida en reposo: micro-gestos aleatorios (parece que respira y curiosea)
    function scheduleIdleLife() {
        clearTimeout(LIVE.idleTimer);
        LIVE.idleTimer = setTimeout(() => {
            if (!document.hidden && STATE.mounted) {
                const pool = ['look', 'peck', 'look', 'wave'];  // look pesa doble: gesto más natural
                react(pool[Math.floor(Math.random() * pool.length)], 1600);
            }
            scheduleIdleLife();
        }, 22000 + Math.random() * 26000);
    }
    scheduleIdleLife();

    // ─────────────────────────────────────
    // Public API
    // ─────────────────────────────────────
    window.GunterCompanion = {
        mount, expand, minimize, hide, show, toggle, interrupt,
        react,                                        // v66: otros módulos pueden dispararle gestos
        say: (text, options) => addMessage('assistant', text, options),
        showBubble,
        // Entry point cuando el wake word transcribió una orden hablada.
        // Se comporta como si el usuario hubiera escrito el texto.
        __handleFromWake: (text) => {
            if (!STATE.mounted) mount();
            expand();
            return handleUserMessage(text, { voiceContext: 'wake-word-response', wakeWordResponse: true, inputSource: 'voice' });
        }
    };

    document.addEventListener('gunter-auth-ready', event => greetOnEntry(event.detail?.user));
    window.addEventListener('gunter-barge-in', interrupt);

    // Auto-mount
    if (typeof window !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', mount);
        } else {
            mount();
        }
    }
})();
