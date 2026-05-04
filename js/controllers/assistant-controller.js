/* =============================================
   GUNTER CONTROLLER - Assistant UI
   -------------------------------------------------
   Inyecta un panel de chat conversacional que
   consume GunterPipeline. Muestra historia,
   confirmaciones y respuestas enriquecidas.
   ============================================= */

(function () {
    let panel = null, pending = null, avatarRef = null;

    function mount(options = {}) {
        if (panel) return;
        injectStyles();
        panel = document.createElement('section');
        panel.className = 'gn-assistant';
        panel.innerHTML = `
            <header class="gn-assistant__header">
                <div class="gn-assistant__avatar" id="gn-assistant-avatar"></div>
                <div class="gn-assistant__title">
                    <strong>Gunter</strong>
                    <small id="gn-assistant-subtitle">Tu asistente del día</small>
                </div>
                <button class="gn-assistant__close" aria-label="Cerrar" title="Cerrar">✕</button>
            </header>

            <div class="gn-assistant__log" id="gn-assistant-log"></div>

            <div class="gn-assistant__quick" id="gn-assistant-quick">
                <button data-q="¿Qué tengo hoy?">¿Qué tengo hoy?</button>
                <button data-q="Recuérdame tomar agua cada día a las 10">Recordatorio diario</button>
                <button data-q="Agenda reunión con el equipo mañana a las 10">Agendar reunión</button>
            </div>

            <form class="gn-assistant__form" id="gn-assistant-form">
                <input type="text" id="gn-assistant-input" placeholder="Escribe: crea una tarea, agenda una reunión, pregunta…" autocomplete="off">
                <button type="submit" title="Enviar">➤</button>
            </form>
        `;
        (options.container || document.body).appendChild(panel);

        // Avatar
        try {
            if (window.GunterAvatar) {
                avatarRef = new window.GunterAvatar('gn-assistant-avatar', { size: 52 });
                window.__GUNTER_PRIMARY_AVATAR__ = avatarRef;
            }
        } catch {}

        // Welcome line
        push('assistant', greeting(), 'wave');

        // Events
        panel.querySelector('.gn-assistant__close').addEventListener('click', toggle);
        panel.querySelector('#gn-assistant-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = panel.querySelector('#gn-assistant-input');
            const text = input.value.trim();
            if (!text) return;
            input.value = '';
            await send(text);
        });
        panel.querySelectorAll('#gn-assistant-quick button').forEach(b => {
            b.addEventListener('click', () => send(b.dataset.q));
        });

        // Ask notification permission on first interaction
        panel.addEventListener('click', () => {
            if (window.GunterNotificationsService?.requestPermission) {
                window.GunterNotificationsService.requestPermission();
            }
        }, { once: true });
    }

    async function send(text) {
        push('user', text);
        setTyping(true);
        try {
            const { state, awaitingConfirmation, response } = await window.GunterPipeline.handleUserInput(text);
            setTyping(false);
            if (awaitingConfirmation) {
                pending = state;
                renderConfirmation(response);
            } else {
                push('assistant', response.speech || '…', response.animation);
            }
            refreshPanels(response?.panels || []);
        } catch (err) {
            setTyping(false);
            push('assistant', '⚠️ Error: ' + (err.message || err), 'alert');
        }
    }

    function renderConfirmation(response) {
        const log = panel.querySelector('#gn-assistant-log');
        const item = document.createElement('div');
        item.className = 'gn-msg gn-msg--assistant gn-msg--confirm';
        item.innerHTML = `
            <div class="gn-msg__text">${escapeHtml(response.speech)}</div>
            <div class="gn-msg__actions">
                <button data-answer="yes" class="gn-btn gn-btn--primary">Sí</button>
                <button data-answer="no" class="gn-btn">No</button>
            </div>
        `;
        log.appendChild(item);
        log.scrollTop = log.scrollHeight;
        item.querySelectorAll('button').forEach(b => b.addEventListener('click', async () => {
            const yes = b.dataset.answer === 'yes';
            item.querySelectorAll('button').forEach(x => x.disabled = true);
            setTyping(true);
            try {
                const { response: r } = await window.GunterPipeline.handleConfirmation(pending, { accepted: yes, token: Date.now() });
                setTyping(false);
                push('assistant', r?.speech || (yes ? 'Listo.' : 'Entendido.'), r?.animation);
                refreshPanels(r?.panels || []);
            } catch (err) {
                setTyping(false);
                push('assistant', '⚠️ ' + err.message, 'alert');
            }
            pending = null;
        }));
        if (avatarRef && avatarRef.playAnimation) avatarRef.playAnimation(response.animation || 'think');
    }

    function push(role, text, animation) {
        const log = panel.querySelector('#gn-assistant-log');
        const item = document.createElement('div');
        item.className = `gn-msg gn-msg--${role}`;
        item.innerHTML = `<div class="gn-msg__text">${escapeHtml(text)}</div>`;
        log.appendChild(item);
        log.scrollTop = log.scrollHeight;
        if (role === 'assistant' && avatarRef?.playAnimation && animation) {
            avatarRef.playAnimation(animation);
        }
        // Speak assistant responses if voice is enabled
        if (role === 'assistant' && window.GunterVoice) {
            window.GunterVoice.speak(text, { context: 'chat' });
        }
        // v2 (F1) — Memoria conversacional cross-sesión: fire-and-forget.
        // Silencioso si flag OFF o texto trivial (ver service).
        if (window.GunterConversationMemory?.remember) {
            try {
                const projectId = window.GunterCurrentProject?.id || null;
                window.GunterConversationMemory.remember({
                    role,
                    text,
                    channel: 'chat',
                    projectId
                }).catch(() => {});
            } catch { /* noop */ }
        }
    }

    function setTyping(on) {
        let t = panel.querySelector('.gn-typing');
        if (on) {
            if (!t) {
                t = document.createElement('div');
                t.className = 'gn-typing gn-msg gn-msg--assistant';
                t.innerHTML = '<div class="gn-msg__text"><span></span><span></span><span></span></div>';
                panel.querySelector('#gn-assistant-log').appendChild(t);
            }
        } else if (t) {
            t.remove();
        }
    }

    function refreshPanels(list) {
        for (const p of list) {
            window.dispatchEvent(new CustomEvent('gunter-refresh', { detail: p }));
        }
    }

    function greeting() {
        const h = new Date().getHours();
        const p = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
        return `${p}. Escríbeme tareas, recordatorios, reuniones o preguntas. Ejemplo: "recuérdame llamar al banco mañana a las 10".`;
    }

    function toggle() {
        if (!panel) return;
        panel.classList.toggle('is-collapsed');
    }

    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function injectStyles() {
        if (document.getElementById('gn-assistant-styles')) return;
        const s = document.createElement('style');
        s.id = 'gn-assistant-styles';
        s.textContent = `
            .gn-assistant{
                position: fixed; right: 20px; bottom: 20px;
                width: min(380px, calc(100vw - 40px)); max-height: 70vh;
                display: flex; flex-direction: column;
                background: color-mix(in srgb, var(--bg-deep-navy) 92%, transparent);
                border: 1px solid var(--glass-border, rgba(255,255,255,0.1));
                border-radius: 16px;
                backdrop-filter: blur(24px) saturate(1.1);
                -webkit-backdrop-filter: blur(24px) saturate(1.1);
                box-shadow: 0 30px 80px -30px rgba(0,0,0,0.6), 0 2px 0 rgba(255,255,255,0.03) inset;
                z-index: 9900;
                font-family: var(--font-primary, Inter, sans-serif);
                color: var(--text-primary, #fff);
                animation: gnAssistantIn 380ms cubic-bezier(.22,.61,.36,1);
            }
            @keyframes gnAssistantIn { from { opacity:0; transform: translateY(20px); } to { opacity:1; transform: translateY(0); } }
            .gn-assistant.is-collapsed { transform: translateY(calc(100% - 60px)); transition: transform 300ms ease; }
            .gn-assistant__header{
                display:flex; align-items:center; gap:12px;
                padding: 14px 16px; border-bottom: 1px solid var(--glass-border);
            }
            .gn-assistant__avatar { width: 52px; height: 52px; flex-shrink: 0; }
            .gn-assistant__title strong { font-size: 15px; letter-spacing: -0.01em; }
            .gn-assistant__title small { display:block; color: var(--text-muted); font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase; margin-top: 2px; }
            .gn-assistant__close { margin-left:auto; background:transparent; border:none; color: var(--text-muted); font-size: 18px; cursor: pointer; }
            .gn-assistant__close:hover { color: var(--text-primary); }
            .gn-assistant__log {
                flex: 1; overflow-y: auto; padding: 14px 16px; display:flex; flex-direction:column; gap: 10px;
            }
            .gn-msg { max-width: 85%; padding: 10px 14px; border-radius: 12px; font-size: 14px; line-height: 1.5; }
            .gn-msg--user { align-self: flex-end; background: var(--accent-primary, #00d4ff); color: #02121e; }
            .gn-msg--assistant { align-self: flex-start; background: color-mix(in srgb, var(--bg-obsidian) 70%, transparent); border: 1px solid var(--glass-border); }
            .gn-msg--confirm { background: color-mix(in srgb, var(--accent-primary) 14%, var(--bg-obsidian)); border-color: var(--accent-primary); }
            .gn-msg__actions { display:flex; gap:6px; margin-top: 8px; }
            .gn-btn { padding: 6px 14px; border-radius: 8px; border:1px solid var(--glass-border); background:transparent; color: var(--text-primary); cursor:pointer; font-size: 13px; font-family: inherit; }
            .gn-btn--primary { background: var(--accent-primary); color: var(--bg-deep-navy); border-color: var(--accent-primary); font-weight: 600; }
            .gn-btn:hover { transform: translateY(-1px); }
            .gn-typing .gn-msg__text { display:flex; gap: 3px; }
            .gn-typing span { width: 6px; height: 6px; border-radius: 50%; background: var(--accent-primary); animation: gnType 1s infinite; }
            .gn-typing span:nth-child(2) { animation-delay: .15s; }
            .gn-typing span:nth-child(3) { animation-delay: .3s; }
            @keyframes gnType { 0%,60%,100% { opacity: 0.3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }
            .gn-assistant__quick { display:flex; gap:6px; flex-wrap: wrap; padding: 0 16px 10px; }
            .gn-assistant__quick button {
                padding: 6px 10px; border-radius: 999px; font-size: 11px;
                background: transparent; border: 1px solid var(--glass-border); color: var(--text-secondary);
                cursor: pointer; font-family: inherit;
            }
            .gn-assistant__quick button:hover { border-color: var(--accent-primary); color: var(--accent-primary); }
            .gn-assistant__form { display:flex; gap:8px; padding: 10px 12px; border-top: 1px solid var(--glass-border); }
            .gn-assistant__form input {
                flex: 1; background: color-mix(in srgb, var(--bg-obsidian) 75%, transparent);
                border: 1px solid var(--glass-border); color: var(--text-primary);
                padding: 10px 14px; border-radius: 10px; font-family: inherit; font-size: 14px;
                outline: none;
            }
            .gn-assistant__form input:focus { border-color: var(--accent-primary); }
            .gn-assistant__form button {
                width: 42px; background: var(--accent-primary); color: var(--bg-deep-navy);
                border: none; border-radius: 10px; cursor:pointer; font-size: 18px;
            }
            @media (max-width: 640px) {
                .gn-assistant { right: 10px; left: 10px; width: auto; bottom: 10px; }
            }
        `;
        document.head.appendChild(s);
    }

    window.GunterAssistantController = { mount, toggle, send };
})();
