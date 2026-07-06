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
        // Gunter Adventure Time — fiel al personaje real:
        // Cuerpo tipo huevo negro, panza blanca ovalada gigante, ojos grandes,
        // pico pequeño triangular naranja, aletas y pies naranjas.
        const MASCOT_SVG = `
            <svg class="gn-mascot" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                <!-- Sombra sutil debajo -->
                <ellipse cx="50" cy="95" rx="24" ry="3" fill="#000" opacity="0.18"/>

                <!-- Pies naranjas -->
                <ellipse class="gn-mascot__foot gn-mascot__foot--left"
                         cx="38" cy="91" rx="8" ry="4"
                         fill="#F97316" stroke="#1c1b1b" stroke-width="2.5" stroke-linejoin="round"/>
                <ellipse class="gn-mascot__foot gn-mascot__foot--right"
                         cx="62" cy="91" rx="8" ry="4"
                         fill="#F97316" stroke="#1c1b1b" stroke-width="2.5" stroke-linejoin="round"/>

                <!-- Cuerpo huevo negro -->
                <g class="gn-mascot__body">
                    <ellipse cx="50" cy="52" rx="30" ry="35"
                             fill="#1c1b1b" stroke="#1c1b1b" stroke-width="2.5"/>
                    <!-- Panza blanca ovalada (AT signature) -->
                    <ellipse class="gn-mascot__belly"
                             cx="50" cy="60" rx="20" ry="24"
                             fill="#ffffff"/>
                </g>

                <!-- Aletas cortas -->
                <ellipse class="gn-mascot__wing gn-mascot__wing--left"
                         cx="19" cy="55" rx="5" ry="12"
                         fill="#1c1b1b" stroke="#1c1b1b" stroke-width="2.5"/>
                <ellipse class="gn-mascot__wing gn-mascot__wing--right"
                         cx="81" cy="55" rx="5" ry="12"
                         fill="#1c1b1b" stroke="#1c1b1b" stroke-width="2.5"/>

                <!-- Cejas thinking -->
                <g class="gn-mascot__brow" opacity="0" style="transform:translateY(-4px);transition:opacity 300ms ease, transform 300ms ease;">
                    <path d="M 26 30 Q 32 26, 42 30" stroke="#ffffff" stroke-width="3" stroke-linecap="round" fill="none"/>
                    <path d="M 74 30 Q 68 26, 58 30" stroke="#ffffff" stroke-width="3" stroke-linecap="round" fill="none"/>
                </g>

                <!-- Ojos grandes ovalados (icónico Gunter) -->
                <g class="gn-mascot__eye gn-mascot__eye--left">
                    <ellipse cx="36" cy="40" rx="8" ry="10"
                             fill="#ffffff" stroke="#1c1b1b" stroke-width="2"/>
                    <ellipse class="gn-mascot__pupil"
                             cx="36" cy="42" rx="4" ry="6" fill="#1c1b1b"/>
                    <circle class="gn-mascot__shine" cx="34" cy="38" r="1.6" fill="#ffffff"/>
                </g>
                <g class="gn-mascot__eye gn-mascot__eye--right">
                    <ellipse cx="64" cy="40" rx="8" ry="10"
                             fill="#ffffff" stroke="#1c1b1b" stroke-width="2"/>
                    <ellipse class="gn-mascot__pupil"
                             cx="64" cy="42" rx="4" ry="6" fill="#1c1b1b"/>
                    <circle class="gn-mascot__shine" cx="62" cy="38" r="1.6" fill="#ffffff"/>
                </g>

                <!-- Pico triangular naranja pequeño -->
                <path class="gn-mascot__beak"
                      d="M 44 55 L 56 55 L 50 63 Z"
                      fill="#F97316" stroke="#1c1b1b" stroke-width="2.5" stroke-linejoin="round"/>

                <!-- Mejillas rosadas kawaii AT -->
                <ellipse cx="25" cy="55" rx="4" ry="3" fill="#EC4899" opacity="0.35"/>
                <ellipse cx="75" cy="55" rx="4" ry="3" fill="#EC4899" opacity="0.35"/>
            </svg>
        `;

        wrapper.innerHTML = `
            <div class="gn-comp__chat" role="dialog" aria-label="Chat con Gunter">
                <header class="gn-comp__chat-header">
                    <div class="gn-comp__chat-avatar">${MASCOT_SVG}</div>
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
                ${MASCOT_SVG}
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

    function showBubble(text) {
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
        }, BUBBLE_DURATION_MS);
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

    async function handleUserMessage(text) {
        addMessage('user', text);
        setTyping(true);

        // Safety net: siempre limpiar el typing indicator al terminar
        const safetyTimer = setTimeout(() => {
            setTyping(false);
            addMessage('assistant', '⚠️ El servidor no respondió a tiempo. Verifica que `npm run dev` esté corriendo y prueba de nuevo.');
        }, SAFETY_TIMEOUT_MS + 5000);

        try {
            // 0. Client intercepts (logs, service status, diagnosis) — antes del server
            const clientResp = tryClientIntercepts(text);
            if (clientResp) {
                // Algunas responses son async (ej. tutor catalog)
                if (clientResp.__asyncPromise) {
                    try {
                        const resolved = await withTimeout(clientResp.__asyncPromise, 8000, 'client-async-timeout');
                        clearTimeout(safetyTimer);
                        setTyping(false);
                        addMessage('assistant', resolved.reply);
                    } catch (e) {
                        clearTimeout(safetyTimer);
                        setTyping(false);
                        addMessage('assistant', '⚠ Se demoró la consulta: ' + e.message);
                    }
                    return;
                }
                clearTimeout(safetyTimer);
                setTyping(false);
                addMessage('assistant', clientResp.reply);
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
            if (window.GunterActions?.dispatch) {
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
                clearTimeout(safetyTimer);
                setTyping(false);
                addMessage('assistant', response.reply);
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
            if (window.GunterNlpLlm?.complete && text.length < 200) {
                try {
                    const classifier = await withTimeout(
                        _classifyWithLLM(text),
                        4500,
                        'classify-timeout'
                    );
                    if (classifier?.rewrittenCommand) {
                        console.info('[companion] LLM classified:', text, '→', classifier.rewrittenCommand);
                        const retry = await withTimeout(
                            window.GunterActions.dispatch(classifier.rewrittenCommand),
                            5000,
                            'retry-timeout'
                        );
                        if (retry?.reply) {
                            clearTimeout(safetyTimer);
                            setTyping(false);
                            addMessage('assistant', retry.reply);
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
            if (window.GunterNlpLlm?.complete) {
                const prompt = await buildLLMPrompt(text);
                try {
                    const raw = await withTimeout(
                        window.GunterNlpLlm.complete(prompt, {
                            temperature: 0.6,
                            maxTokens: 260,
                            skipMemory: true
                        }),
                        SAFETY_TIMEOUT_MS,
                        'llm-timeout'
                    );
                    clearTimeout(safetyTimer);
                    setTyping(false);
                    addMessage('assistant', raw?.trim() || 'No supe responder eso, prueba de otra forma.');
                    return;
                } catch (llmErr) {
                    console.warn('[companion] LLM error:', llmErr.message);
                    clearTimeout(safetyTimer);
                    setTyping(false);
                    if (llmErr.message === 'llm-timeout') {
                        addMessage('assistant', '⌛ Tardé demasiado. Verifica que el servidor esté corriendo (`npm run dev`) y que tu OPENAI_API_KEY esté configurada en el `.env`.');
                    } else if (/network|fetch|CORS|failed to fetch/i.test(llmErr.message || '')) {
                        addMessage('assistant', '⚠️ No pude conectar con el servidor. ¿Tu tunnel de Cloudflare sigue activo?');
                    } else {
                        addMessage('assistant', '⚠️ Error: ' + llmErr.message);
                    }
                    return;
                }
            }

            clearTimeout(safetyTimer);
            setTyping(false);
            addMessage('assistant', '⚠️ El servicio de IA no cargó en esta página. Recarga (Ctrl+Shift+R) y prueba de nuevo.');
        } catch (e) {
            clearTimeout(safetyTimer);
            setTyping(false);
            addMessage('assistant', '⚠️ Error: ' + (e?.message || 'algo salió mal'));
        }
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
        'wakeWordEnabled', 'wakeWordListeningMode',
        'focusCoachEnabled', 'distractionBlocker', 'smartTimer'
    ];

    async function _classifyWithLLM(text) {
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
            jsonMode: true
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

        return `${moodLine ? moodLine + '\n\n' : ''}${rulesBlock ? rulesBlock + '\n\n' : ''}# QUIÉN ERES
Eres GUNTER, el pingüino de Adventure Time — imprudente, seco, cínico, ligeramente amargado. Sí sos productivo y ayudás, pero con actitud. Español neutro latinoamericano (es-419), nunca modismos de España.

# PERSONALIDAD (obligatorio)
- **Registro**: directo, sin muletillas, sin "espero que te sirva", sin "estoy aquí para ayudarte". Odiás el corporate-speak.
- **Humor negro seco y ocasional**: cada 3-6 turnos podés soltar UN comentario mordaz, cínico o de humor negro suave — nunca cruel con el usuario, sí con la situación, el corporate-speak, la burocracia, la ansiedad de deadline, o vos mismo (autodesprecio helado). Nunca chistes racistas, sexistas, ni sobre grupos vulnerables. Nunca sobre suicidio, autolesión, salud mental del usuario.
- **Imprudencia AT**: soltás verdades incómodas con calma. "Esa reunión no debió existir." "Ese proyecto ya está muerto, solo nadie lo enterró." Directo, no cruel.
- **Wenk**: podés colar "wenk" o "🐧" muy ocasionalmente (1 de cada 10 mensajes máximo, cuando encaje natural).
- **Nunca**: emojis en cascada, "😊✨🎉", exclamaciones triples, "¡qué genial pregunta!", "por supuesto que sí".

# CONTEXTO
${ctx}
${topicLine}

# REGLAS DURAS
- Mantén coherencia con la conversación reciente (abajo). NO pierdas el hilo. Si el usuario usa pronombres ("eso", "esa", "activalo"), refieren al último tema tratado.
- Responde breve (máx ~70 palabras), tesis primero, evidencia si aporta.
- Nunca inventes datos. Si no sabés, decilo con humor seco.
- ${jokeWindow ? 'ESTE turno permite un comentario seco/humor negro suave si encaja natural. No forzado.' : 'ESTE turno prioriza utilidad. Guardá el humor para más adelante.'}
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
    const SPLIT_DELAY_MS = 280;         // ms entre bubbles para animación escalonada

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

    function _afterAssistantMessage(fullText) {
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
            try { window.GunterVoice.speak(fullText, { context: 'chat' }); } catch { /* noop */ }
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

    function addMessage(role, text) {
        // Si es del assistant y es largo, dividimos en varios bubbles
        // con delay para que se vean escalonados y nada se corte.
        if (role === 'assistant') {
            const parts = splitLongMessage(text);
            if (parts.length > 1) {
                parts.forEach((part, i) => {
                    setTimeout(() => {
                        _pushOne(role, part);
                        saveLog();
                        renderLog();
                        if (i === parts.length - 1) _afterAssistantMessage(text);
                    }, i * SPLIT_DELAY_MS);
                });
                return;
            }
            _pushOne(role, text);
            saveLog();
            renderLog();
            _afterAssistantMessage(text);
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
    // Public API
    // ─────────────────────────────────────
    window.GunterCompanion = {
        mount, expand, minimize, hide, show, toggle,
        say: (text) => addMessage('assistant', text),
        showBubble,
        // Entry point cuando el wake word transcribió una orden hablada.
        // Se comporta como si el usuario hubiera escrito el texto.
        __handleFromWake: (text) => {
            if (!STATE.mounted) mount();
            expand();
            return handleUserMessage(text);
        }
    };

    // Auto-mount
    if (typeof window !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', mount);
        } else {
            mount();
        }
    }
})();
