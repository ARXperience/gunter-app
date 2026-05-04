/* =============================================
   GUNTER DÍA - WhatsApp Tab
   Conversaciones agrupadas por número + envío.
   ============================================= */

(function () {
    let host = null;
    let pollTimer = null;
    let selectedPhone = null;
    let allMessages = [];

    function mount(selector) {
        host = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!host) return;
        render();
        tick();
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = setInterval(tick, 4000);
    }

    function render() {
        host.innerHTML = `
            <div class="gday__card gwa">
                <div class="gday__card-actions">
                    <h3>💬 WhatsApp</h3>
                    <span class="gwa__status" id="gwa-status">Conectando…</span>
                </div>

                <div class="gwa__layout">
                    <aside class="gwa__list" id="gwa-list">
                        <p class="gday__empty">Sin conversaciones todavía.</p>
                    </aside>
                    <section class="gwa__thread">
                        <header class="gwa__thread-head" id="gwa-thread-head">
                            <div class="gwa__thread-title">Selecciona una conversación</div>
                            <div class="gwa__thread-sub">Los mensajes aparecen cuando alguien escriba "Hi Gunter".</div>
                        </header>
                        <div class="gwa__thread-body" id="gwa-thread">
                            <p class="gday__empty" style="margin-top:40px;">Abre una conversación de la izquierda.</p>
                        </div>
                        <form class="gwa__send" id="gwa-send" hidden>
                            <input type="text" id="gwa-send-input" placeholder="Escribe un mensaje…" autocomplete="off">
                            <button type="submit">➤</button>
                        </form>
                    </section>
                </div>

                <div class="gwa__hint">
                    🔒 Solo Gunter responde cuando alguien escribe <strong>"Hi Gunter"</strong> (o variantes) al iniciar una conversación.
                    La sesión permanece activa 8 minutos por contacto.
                </div>

                <!-- Personality sync status -->
                <div class="gwa__meta-card">
                    <div class="gwa__meta-row">
                        <div>
                            <div class="gwa__meta-label">Personalidad activa en WhatsApp</div>
                            <div class="gwa__meta-value" id="gwa-personality-val">Cargando…</div>
                        </div>
                        <button class="gday__btn" id="gwa-sync-personality" title="Re-sincroniza la personalidad actual desde Premium">🔄 Sync</button>
                    </div>
                </div>

                <!-- Memory section -->
                <div class="gwa__memory">
                    <div class="gwa__memory-head">
                        <h4>🧠 Memoria de contactos</h4>
                        <span class="gwa__memory-hint">Gunter recuerda tus conversaciones por contacto</span>
                    </div>
                    <div id="gwa-memory-list" class="gwa__memory-list">
                        <p class="gday__empty" style="padding: 14px 0;">Cargando memoria…</p>
                    </div>
                </div>
            </div>
        `;
        // Personality sync button
        host.querySelector('#gwa-sync-personality')?.addEventListener('click', async () => {
            await window.GunterWhatsApp?.syncPersonality?.();
            await loadPersonality();
        });
        loadPersonality();
        loadMemory();

        const form = host.querySelector('#gwa-send');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const input = host.querySelector('#gwa-send-input');
            const text = input.value.trim();
            if (!text || !selectedPhone) return;
            input.disabled = true;
            try {
                await window.GunterWhatsApp.send(selectedPhone, text);
                input.value = '';
                await tick();
            } catch (err) {
                if (window.GunterErrors) alert(window.GunterErrors.format1(err, { context: 'whatsapp' }));
                else alert('Error: ' + (err.message || err));
            } finally {
                input.disabled = false;
                input.focus();
            }
        });
    }

    async function loadPersonality() {
        const el = host?.querySelector('#gwa-personality-val');
        if (!el) return;
        try {
            const r = await fetch('/api/whatsapp/personality');
            if (!r.ok) { el.textContent = '—'; return; }
            const p = await r.json();
            const names = {
                professional: 'Ejecutivo premium',
                warm: 'Cálido',
                chaotic_scientist: 'Científico caótico',
                energetic_cartoon: 'Caricatura energética',
                minimal_penguin: 'Pingüino minimalista',
                executive: 'Ejecutivo',
                focus_coach: 'Coach'
            };
            el.textContent = `${names[p.voiceStyle] || p.voiceStyle} · ${p.personalityIntensity}`;
        } catch { el.textContent = '—'; }
    }

    async function loadMemory() {
        const el = host?.querySelector('#gwa-memory-list');
        if (!el || !window.GunterWhatsApp) return;
        try {
            const { contacts } = await window.GunterWhatsApp.listMemory();
            if (!contacts || contacts.length === 0) {
                el.innerHTML = '<p class="gday__empty" style="padding: 14px 0;">Sin contactos memorizados todavía.</p>';
                return;
            }
            el.innerHTML = contacts.slice(0, 12).map(c => `
                <div class="gwa-mem-item">
                    <div class="gwa-mem-item__head">
                        <div>
                            <div class="gwa-mem-item__name">${esc(c.name || '+' + c.phone)}</div>
                            <div class="gwa-mem-item__meta">${c.turns} turnos · ${c.facts} facts · visto ${timeShort(c.lastSeen)}</div>
                        </div>
                        <div style="display:flex; gap:6px;">
                            <button class="gday__btn" data-mem-view="${esc(c.phone)}">Ver</button>
                            <button class="gday__btn" data-mem-forget="${esc(c.phone)}" title="Borrar memoria">✕</button>
                        </div>
                    </div>
                </div>
            `).join('');
            el.querySelectorAll('[data-mem-view]').forEach(b =>
                b.addEventListener('click', () => viewMemory(b.dataset.memView))
            );
            el.querySelectorAll('[data-mem-forget]').forEach(b =>
                b.addEventListener('click', async () => {
                    if (confirm('¿Borrar memoria de este contacto? Gunter perderá todo lo aprendido.')) {
                        await window.GunterWhatsApp.forgetContact(b.dataset.memForget);
                        loadMemory();
                    }
                })
            );
        } catch {}
    }

    async function viewMemory(phone) {
        const full = await window.GunterWhatsApp.getMemory(phone);
        if (!full) return;
        const overlay = document.createElement('div');
        overlay.className = 'gps-modal';
        overlay.innerHTML = `
            <div class="gps-modal__box" style="max-width: 540px; text-align: left; max-height: 80vh; overflow-y: auto;">
                <h3>Memoria de ${esc(full.name || '+' + full.phone)}</h3>
                ${Object.keys(full.facts || {}).length ? `
                    <h4 style="font-size:12px; letter-spacing:2px; text-transform:uppercase; color: var(--gday-accent); margin-top: 16px;">Hechos aprendidos</h4>
                    <ul style="padding-left: 18px; margin: 8px 0; font-size: 13px;">
                        ${Object.entries(full.facts).map(([k, v]) => `<li><strong>${esc(k)}</strong>: ${esc(v.value)}</li>`).join('')}
                    </ul>
                ` : ''}
                <h4 style="font-size:12px; letter-spacing:2px; text-transform:uppercase; color: var(--gday-accent); margin-top: 16px;">Conversación reciente</h4>
                <div style="max-height: 320px; overflow-y: auto; padding: 10px; background: var(--gday-bg); border-radius: 8px;">
                    ${full.history.map(h => `
                        <div style="margin-bottom: 10px;">
                            <div style="font-size: 10px; color: var(--gday-text-mute); letter-spacing: 0.5px;">
                                ${h.role === 'user' ? '👤 Usuario' : '🐧 Gunter'} · ${timeShort(h.at)}
                            </div>
                            <div style="font-size: 13px; color: var(--gday-text); margin-top: 2px;">${esc(h.content)}</div>
                        </div>
                    `).join('')}
                </div>
                <button class="gps-modal__close" style="margin-top:14px;">Cerrar</button>
            </div>
        `;
        document.body.appendChild(overlay);
        const close = () => overlay.remove();
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay || e.target.classList.contains('gps-modal__close')) close();
        });
    }

    async function tick() {
        if (!host || !window.GunterWhatsApp) return;
        loadMemory();
        loadPersonality();
        try {
            const [s, msgs] = await Promise.all([
                window.GunterWhatsApp.status(),
                window.GunterWhatsApp.messages(200)
            ]);
            allMessages = msgs;
            updateStatus(s);
            updateList();
            if (selectedPhone) updateThread();
        } catch {}
    }

    function updateStatus(s) {
        const el = host.querySelector('#gwa-status');
        if (!el) return;
        if (s.state === 'connected') {
            el.innerHTML = `<span class="gwa__dot gwa__dot--ok"></span> Conectado · ${esc(s.phone || '')}`;
        } else if (s.state === 'qr_ready') {
            el.innerHTML = `<span class="gwa__dot gwa__dot--warn"></span> Esperando QR — abre Configuración`;
        } else if (s.state === 'connecting') {
            el.innerHTML = `<span class="gwa__dot gwa__dot--warn"></span> Conectando…`;
        } else if (s.state === 'error') {
            el.innerHTML = `<span class="gwa__dot gwa__dot--err"></span> Error`;
        } else {
            el.innerHTML = `<span class="gwa__dot"></span> Desconectado — conéctate en Configuración`;
        }
    }

    function updateList() {
        const list = host.querySelector('#gwa-list');
        if (!list) return;

        // Group by phone
        const groups = new Map();
        for (const m of allMessages) {
            const who = m.direction === 'in' ? m.from : m.to;
            if (!who) continue;
            if (!groups.has(who)) groups.set(who, []);
            groups.get(who).push(m);
        }
        if (groups.size === 0) {
            list.innerHTML = '<p class="gday__empty">Sin conversaciones todavía.</p>';
            return;
        }

        const items = [...groups.entries()]
            .map(([phone, msgs]) => {
                const last = msgs[0]; // first in reversed order
                return { phone, last, count: msgs.length };
            })
            .sort((a, b) => (b.last?.timestamp || '').localeCompare(a.last?.timestamp || ''));

        list.innerHTML = items.map(it => `
            <button class="gwa__contact ${selectedPhone === it.phone ? 'is-active' : ''}" data-phone="${esc(it.phone)}">
                <div class="gwa__contact-name">+${esc(it.phone)}</div>
                <div class="gwa__contact-last">${esc((it.last?.text || '').slice(0, 48))}</div>
                <div class="gwa__contact-meta">
                    <span>${it.count} msg</span>
                    <span>${it.last ? timeShort(it.last.timestamp) : ''}</span>
                </div>
            </button>
        `).join('');

        list.querySelectorAll('[data-phone]').forEach(btn => {
            btn.addEventListener('click', () => selectPhone(btn.dataset.phone));
        });
    }

    function selectPhone(phone) {
        selectedPhone = phone;
        host.querySelectorAll('.gwa__contact').forEach(b => {
            b.classList.toggle('is-active', b.dataset.phone === phone);
        });
        const head = host.querySelector('#gwa-thread-head');
        head.innerHTML = `
            <div class="gwa__thread-title">+${esc(phone)}</div>
            <div class="gwa__thread-sub">Conversación vía WhatsApp</div>
        `;
        host.querySelector('#gwa-send').hidden = false;
        updateThread();
    }

    function updateThread() {
        const el = host.querySelector('#gwa-thread');
        if (!el || !selectedPhone) return;
        const msgs = allMessages
            .filter(m => (m.direction === 'in' ? m.from : m.to) === selectedPhone)
            .reverse(); // oldest first in chat
        if (msgs.length === 0) {
            el.innerHTML = '<p class="gday__empty">Sin mensajes.</p>';
            return;
        }
        el.innerHTML = msgs.map(m => `
            <div class="gwa__bubble gwa__bubble--${m.direction}">
                <div class="gwa__bubble-text">${esc(m.text)}</div>
                <div class="gwa__bubble-time">${timeLong(m.timestamp)}</div>
            </div>
        `).join('');
        el.scrollTop = el.scrollHeight;
    }

    function timeShort(iso) {
        try { return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }); }
        catch { return ''; }
    }
    function timeLong(iso) {
        try { return new Date(iso).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
        catch { return iso; }
    }
    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function injectStyles() {
        if (document.getElementById('gwa-styles')) return;
        const s = document.createElement('style');
        s.id = 'gwa-styles';
        s.textContent = `
            .gwa__status { font-size: 11px; color: var(--gday-text-mute); display:inline-flex; align-items:center; gap:6px; }
            .gwa__dot { width: 7px; height: 7px; border-radius: 50%; background: #6b7280; }
            .gwa__dot--ok { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
            .gwa__dot--warn { background: #fbbf24; }
            .gwa__dot--err { background: #ef4444; }
            .gwa__layout {
                display: grid;
                grid-template-columns: 280px 1fr;
                gap: 14px;
                min-height: 480px;
                margin-top: 10px;
            }
            @media (max-width: 780px) {
                .gwa__layout { grid-template-columns: 1fr; }
            }
            .gwa__list {
                background: var(--gday-bg);
                border: 1px solid var(--gday-border);
                border-radius: var(--gday-radius-sm);
                padding: 8px;
                overflow-y: auto;
                max-height: 560px;
                display: flex; flex-direction: column; gap: 4px;
            }
            .gwa__contact {
                text-align: left;
                background: transparent;
                border: 1px solid transparent;
                color: var(--gday-text);
                padding: 10px 12px;
                border-radius: 8px;
                cursor: pointer;
                font-family: inherit;
                transition: all 180ms ease;
            }
            .gwa__contact:hover { background: var(--gday-surface-2); }
            .gwa__contact.is-active {
                background: color-mix(in srgb, var(--gday-accent) 15%, var(--gday-surface-2));
                border-color: var(--gday-accent);
            }
            .gwa__contact-name { font-weight: 600; font-size: 13px; font-family: 'JetBrains Mono', monospace; }
            .gwa__contact-last { font-size: 12px; color: var(--gday-text-mute); margin: 3px 0; line-clamp: 1; -webkit-line-clamp: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .gwa__contact-meta { display: flex; justify-content: space-between; font-size: 10px; color: var(--gday-text-mute); }
            .gwa__thread {
                background: var(--gday-bg);
                border: 1px solid var(--gday-border);
                border-radius: var(--gday-radius-sm);
                display: flex; flex-direction: column;
                min-height: 480px;
                max-height: 560px;
                overflow: hidden;
            }
            .gwa__thread-head {
                padding: 12px 16px;
                border-bottom: 1px solid var(--gday-border);
                background: var(--gday-surface-2);
            }
            .gwa__thread-title { font-weight: 700; font-size: 14px; font-family: 'JetBrains Mono', monospace; }
            .gwa__thread-sub { font-size: 11px; color: var(--gday-text-mute); margin-top: 2px; }
            .gwa__thread-body {
                flex: 1; overflow-y: auto;
                padding: 14px 16px;
                display: flex; flex-direction: column; gap: 8px;
                background: linear-gradient(180deg, var(--gday-bg), color-mix(in srgb, var(--gday-bg) 70%, black));
            }
            .gwa__bubble {
                max-width: 75%;
                padding: 8px 12px;
                border-radius: 12px;
                font-size: 13px;
                line-height: 1.4;
            }
            .gwa__bubble--in {
                background: var(--gday-surface-2);
                align-self: flex-start;
                border: 1px solid var(--gday-border);
            }
            .gwa__bubble--out {
                background: color-mix(in srgb, var(--gday-accent) 25%, var(--gday-bg));
                color: var(--gday-text);
                align-self: flex-end;
                border: 1px solid color-mix(in srgb, var(--gday-accent) 40%, transparent);
            }
            .gwa__bubble-text { white-space: pre-wrap; word-wrap: break-word; }
            .gwa__bubble-time {
                font-size: 9px;
                color: var(--gday-text-mute);
                margin-top: 3px;
                letter-spacing: 0.5px;
                text-align: right;
            }
            .gwa__send {
                display: flex; gap: 8px;
                padding: 10px 12px;
                border-top: 1px solid var(--gday-border);
                background: var(--gday-surface-2);
            }
            .gwa__send input {
                flex: 1;
                background: var(--gday-bg);
                border: 1px solid var(--gday-border);
                color: var(--gday-text);
                padding: 9px 12px;
                border-radius: 8px;
                font-family: inherit;
                font-size: 13px;
                outline: none;
            }
            .gwa__send input:focus { border-color: var(--gday-accent); }
            .gwa__send button {
                width: 44px;
                background: var(--gday-accent);
                color: var(--gday-bg);
                border: none;
                border-radius: 8px;
                cursor: pointer;
                font-size: 16px;
            }
            .gwa__hint {
                margin-top: 14px;
                padding: 10px 14px;
                background: color-mix(in srgb, var(--gday-accent) 6%, var(--gday-bg));
                border-left: 3px solid var(--gday-accent);
                border-radius: 6px;
                font-size: 12px;
                color: var(--gday-text-dim);
                line-height: 1.5;
            }

            .gwa__meta-card {
                margin-top: 14px;
                padding: 12px 16px;
                background: var(--gday-bg);
                border: 1px solid var(--gday-border);
                border-radius: 10px;
            }
            .gwa__meta-row {
                display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;
            }
            .gwa__meta-label {
                font-size: 10px; letter-spacing: 2px; text-transform: uppercase;
                color: var(--gday-text-mute);
            }
            .gwa__meta-value {
                font-size: 14px; color: var(--gday-accent-2); font-weight: 600; margin-top: 2px;
            }

            .gwa__memory {
                margin-top: 14px;
                padding: 14px 18px;
                background: var(--gday-bg);
                border: 1px solid var(--gday-border);
                border-radius: 10px;
            }
            .gwa__memory-head { margin-bottom: 10px; }
            .gwa__memory-head h4 { margin: 0; font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase; color: var(--gday-text-mute); }
            .gwa__memory-hint { font-size: 11px; color: var(--gday-text-mute); }
            .gwa__memory-list { display: flex; flex-direction: column; gap: 8px; }
            .gwa-mem-item {
                padding: 10px 14px;
                background: var(--gday-surface-2);
                border-radius: 8px;
                border: 1px solid var(--gday-border);
            }
            .gwa-mem-item__head { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
            .gwa-mem-item__name { font-weight: 600; font-size: 13px; }
            .gwa-mem-item__meta { font-size: 11px; color: var(--gday-text-mute); margin-top: 2px; }
        `;
        document.head.appendChild(s);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectStyles);
    } else {
        injectStyles();
    }

    window.GunterWhatsAppTab = { mount };
})();
