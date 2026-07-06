/* =============================================
   GUNTER ONBOARDING — Tour interactivo (v1)
   -------------------------------------------------
   Se auto-dispara la PRIMERA vez que el usuario entra
   al dashboard. Overlay con Gunter al centro guía por
   los conceptos clave en 5 pasos. Botón "Saltar" siempre.

   Detección "primera vez": localStorage 'gunter_onboarding_done'.
   Se puede re-lanzar manualmente vía window.GunterOnboarding.start().
   ============================================= */

(function () {
    if (window.GunterOnboarding) return;

    const KEY = 'gunter_onboarding_done';
    const KEY_STEP = 'gunter_onboarding_step';

    const STEPS = [
        {
            title: '¡Hola! Soy Gunter 🐧',
            body: 'Tu asistente para reuniones y proyectos. Puedo grabar, transcribir, analizar y hasta responder desde WhatsApp.\n\n¿Te muestro lo esencial?',
            primary: 'Sí, muéstrame',
            skip: 'Saltar',
            emoji: '👋'
        },
        {
            title: 'Nueva Reunión',
            body: 'Aquí inicias reuniones. Yo grabo el audio, transcribo lo que se dice y hago un análisis estratégico al final.',
            highlightSelector: 'a[href*="new-project"]',
            primary: 'Siguiente',
            emoji: '🎙️'
        },
        {
            title: 'Tu día',
            body: 'En "Día" tienes tus tareas, eventos y puedes hablar conmigo por chat o voz. También activo las funciones premium desde allí.',
            highlightSelector: 'a[href*="day.html"]',
            primary: 'Siguiente',
            emoji: '📅'
        },
        {
            title: 'Funciones avanzadas',
            body: 'En Configuración → Premium activas cosas como memoria de largo plazo, forecast de proyectos o alertas por WhatsApp. Todo lo controlo yo también hablándome.',
            highlightSelector: 'a[href*="config"]',
            primary: 'Siguiente',
            emoji: '✨'
        },
        {
            title: 'Estoy aquí para ti',
            body: 'Este botón flotante 🐧 me abre desde cualquier página. Prueba decirme:\n\n• "activa la memoria"\n• "ponte más divertido"\n• "qué es el forecast"\n\nO simplemente charla conmigo.',
            highlightSelector: '#gunter-companion',
            primary: 'Empezar',
            emoji: '💜'
        }
    ];

    let currentStep = 0;
    let overlayEl = null;

    function isFirstTime() {
        return localStorage.getItem(KEY) !== '1';
    }

    function shouldAutoStart() {
        const p = (location.pathname || '').toLowerCase();
        return isFirstTime() && (p.includes('dashboard') || p === '/' || p.includes('index'));
    }

    function markDone() {
        localStorage.setItem(KEY, '1');
        localStorage.removeItem(KEY_STEP);
    }

    // ─────────────────────────────────────
    // Build DOM
    // ─────────────────────────────────────
    function buildOverlay() {
        const el = document.createElement('div');
        el.className = 'gn-onboarding';
        el.innerHTML = `
            <div class="gn-onboarding__backdrop"></div>
            <div class="gn-onboarding__spotlight"></div>
            <div class="gn-onboarding__card" role="dialog" aria-modal="true">
                <div class="gn-onboarding__emoji"></div>
                <div class="gn-onboarding__progress">
                    ${STEPS.map((_, i) => `<span class="gn-onboarding__dot"></span>`).join('')}
                </div>
                <h2 class="gn-onboarding__title"></h2>
                <p class="gn-onboarding__body"></p>
                <div class="gn-onboarding__actions">
                    <button class="gn-onboarding__skip" data-onb-action="skip">Saltar tour</button>
                    <button class="gn-onboarding__next gn-glass-btn" data-onb-action="next">Siguiente</button>
                </div>
            </div>
        `;
        return el;
    }

    function ensureCss() {
        if (document.getElementById('gn-onboarding-css')) return;
        const style = document.createElement('style');
        style.id = 'gn-onboarding-css';
        style.textContent = `
            .gn-onboarding {
                position: fixed;
                inset: 0;
                z-index: var(--z-onboarding, 600);
                pointer-events: none;
            }
            .gn-onboarding__backdrop {
                position: absolute;
                inset: 0;
                background: rgba(0, 0, 0, 0.72);
                backdrop-filter: blur(6px);
                -webkit-backdrop-filter: blur(6px);
                pointer-events: auto;
                animation: gn-backdrop-in var(--dur-fast) var(--ease-out) both;
            }
            .gn-onboarding__spotlight {
                position: absolute;
                border-radius: var(--radius-md);
                animation: gn-spotlight 1.6s var(--ease-in-out) infinite;
                pointer-events: none;
                display: none;
                transition: all var(--dur-normal) var(--ease-out);
            }
            .gn-onboarding__spotlight.is-active { display: block; }
            .gn-onboarding__card {
                position: absolute;
                left: 50%;
                bottom: 40px;
                transform: translateX(-50%);
                width: min(400px, calc(100vw - 32px));
                padding: 28px 24px 22px;
                background: var(--glass-elevated);
                border: 1px solid var(--glass-border-hi);
                border-radius: var(--radius-lg);
                backdrop-filter: blur(28px) saturate(160%);
                -webkit-backdrop-filter: blur(28px) saturate(160%);
                box-shadow: var(--shadow-xl);
                color: var(--text-primary);
                pointer-events: auto;
                text-align: center;
                animation: gn-modal-in var(--dur-normal) var(--ease-emphasized) both;
            }
            .gn-onboarding__emoji {
                font-size: 56px;
                margin-bottom: 12px;
                line-height: 1;
                animation: gn-comp-idle 3s var(--ease-in-out) infinite;
            }
            .gn-onboarding__progress {
                display: flex;
                justify-content: center;
                gap: 8px;
                margin-bottom: 16px;
            }
            .gn-onboarding__dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: rgba(255, 255, 255, 0.20);
                transition: all var(--dur-fast) var(--ease-out);
            }
            .gn-onboarding__dot.is-active {
                background: var(--grad-primary);
                width: 24px;
                border-radius: var(--radius-full);
                box-shadow: var(--shadow-glow-purple);
            }
            .gn-onboarding__title {
                font-family: var(--font-display);
                font-size: var(--text-2xl);
                font-weight: var(--font-bold);
                margin-bottom: 12px;
                line-height: 1.2;
            }
            .gn-onboarding__body {
                font-size: var(--text-sm);
                line-height: 1.55;
                color: var(--text-secondary);
                margin-bottom: 22px;
                white-space: pre-line;
                text-align: left;
            }
            .gn-onboarding__actions {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 12px;
            }
            .gn-onboarding__skip {
                background: transparent;
                border: none;
                color: var(--text-muted);
                cursor: pointer;
                font-size: var(--text-sm);
                padding: 8px 14px;
                border-radius: var(--radius-md);
                transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
            }
            .gn-onboarding__skip:hover {
                background: rgba(255, 255, 255, 0.06);
                color: var(--text-primary);
            }
            .gn-onboarding__next {
                min-width: 140px;
            }
            @media (max-width: 480px) {
                .gn-onboarding__card {
                    bottom: 20px;
                    padding: 24px 20px 18px;
                }
                .gn-onboarding__emoji { font-size: 48px; }
                .gn-onboarding__title { font-size: var(--text-xl); }
            }
        `;
        document.head.appendChild(style);
    }

    // ─────────────────────────────────────
    // Render step
    // ─────────────────────────────────────
    function renderStep() {
        if (!overlayEl) return;
        const step = STEPS[currentStep];

        overlayEl.querySelector('.gn-onboarding__emoji').textContent = step.emoji || '';
        overlayEl.querySelector('.gn-onboarding__title').textContent = step.title;
        overlayEl.querySelector('.gn-onboarding__body').textContent = step.body;

        const nextBtn = overlayEl.querySelector('.gn-onboarding__next');
        nextBtn.textContent = step.primary || 'Siguiente';

        // Dots
        overlayEl.querySelectorAll('.gn-onboarding__dot').forEach((d, i) => {
            d.classList.toggle('is-active', i === currentStep);
        });

        // Spotlight (highlight)
        const spotlight = overlayEl.querySelector('.gn-onboarding__spotlight');
        if (step.highlightSelector) {
            const target = document.querySelector(step.highlightSelector);
            if (target) {
                const rect = target.getBoundingClientRect();
                const pad = 8;
                spotlight.style.left   = (rect.left - pad) + 'px';
                spotlight.style.top    = (rect.top - pad) + 'px';
                spotlight.style.width  = (rect.width + pad * 2) + 'px';
                spotlight.style.height = (rect.height + pad * 2) + 'px';
                spotlight.classList.add('is-active');
                return;
            }
        }
        spotlight.classList.remove('is-active');
    }

    // ─────────────────────────────────────
    // Flow
    // ─────────────────────────────────────
    function start() {
        if (overlayEl) return;
        ensureCss();
        overlayEl = buildOverlay();
        document.body.appendChild(overlayEl);
        currentStep = 0;
        renderStep();

        overlayEl.addEventListener('click', (e) => {
            const act = e.target.closest('[data-onb-action]');
            if (!act) return;
            if (act.dataset.onbAction === 'skip') skip();
            else if (act.dataset.onbAction === 'next') next();
        });

        // Escuchar teclado
        overlayEl.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') skip();
            if (e.key === 'ArrowRight' || e.key === 'Enter') next();
        });

        // Focus el botón principal
        setTimeout(() => overlayEl.querySelector('.gn-onboarding__next')?.focus(), 100);
    }

    function next() {
        if (currentStep >= STEPS.length - 1) {
            complete();
            return;
        }
        currentStep++;
        localStorage.setItem(KEY_STEP, String(currentStep));
        renderStep();
    }

    function skip() {
        markDone();
        cleanup();
    }

    function complete() {
        markDone();
        cleanup();
        // Abre el companion para que el usuario lo descubra
        setTimeout(() => {
            if (window.GunterCompanion?.showBubble) {
                window.GunterCompanion.showBubble('¡Aquí estoy cuando me necesites!');
            }
        }, 500);
    }

    function cleanup() {
        if (!overlayEl) return;
        overlayEl.style.opacity = '0';
        overlayEl.style.transition = 'opacity 300ms ease-out';
        setTimeout(() => {
            overlayEl?.remove();
            overlayEl = null;
        }, 320);
    }

    function reset() {
        localStorage.removeItem(KEY);
        localStorage.removeItem(KEY_STEP);
    }

    window.GunterOnboarding = { start, skip, reset, isFirstTime };

    // Auto-start si aplica
    if (typeof window !== 'undefined') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                if (shouldAutoStart()) setTimeout(start, 1500);
            });
        } else {
            if (shouldAutoStart()) setTimeout(start, 1500);
        }
    }
})();
