/* =============================================
   GUNTER DÍA - Tabs secundarios
   Voz · Wake word · Documentos
   Controles ligeros por tab premium.
   ============================================= */

(function () {
    const S = () => window.PremiumFeaturesService;

    // ---------- VOICE ----------
    window.GunterVoiceTab = {
        mount(sel) {
            const host = typeof sel === 'string' ? document.querySelector(sel) : sel;
            if (!host) return;
            render();
            // Clean up previous listener
            if (host._voiceListener) window.removeEventListener('gunterPremiumFeaturesChange', host._voiceListener);
            host._voiceListener = () => render();
            window.addEventListener('gunterPremiumFeaturesChange', host._voiceListener);

            function render() {
            const cfg = S().getVoiceConfig();
            host.innerHTML = `
                <div class="gday__card">
                    <div class="gday__card-actions">
                        <h3>🗣️ Voz de Gunter</h3>
                        <span style="font-size:11px; color: var(--gday-text-mute);">Cómo responde cuando habla</span>
                    </div>
                    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; margin-bottom: 14px;">
                        <div class="gday__tile-stat">
                            <div class="gday__tile-stat__label">Estilo actual</div>
                            <div class="gday__tile-stat__value">${styleName(cfg.style)}</div>
                        </div>
                        <div class="gday__tile-stat">
                            <div class="gday__tile-stat__label">Modo</div>
                            <div class="gday__tile-stat__value">${modeName(cfg.mode)}</div>
                        </div>
                        <div class="gday__tile-stat">
                            <div class="gday__tile-stat__label">Velocidad</div>
                            <div class="gday__tile-stat__value">${cfg.speed}</div>
                        </div>
                        <div class="gday__tile-stat">
                            <div class="gday__tile-stat__label">Tono</div>
                            <div class="gday__tile-stat__value">${cfg.tone}</div>
                        </div>
                    </div>
                    <div style="display:flex; gap:8px; flex-wrap:wrap;">
                        <button class="gday__btn" id="gvo-test">🔊 Probar voz</button>
                        <button class="gday__btn" id="gvo-test-short">📢 Frase corta</button>
                        <a href="config.html#premium" class="gday__btn">⚙️ Cambiar estilo</a>
                    </div>
                    ${!cfg.supported ? '<p style="margin-top:10px; color: var(--gday-danger); font-size: 13px;">⚠️ Tu navegador no soporta síntesis de voz. Usa Chrome o Edge.</p>' : ''}
                    <p style="margin-top:14px; color: var(--gday-text-dim); font-size:13px;">
                        Gunter habla cuando: ${humanMode(cfg.mode)}. Cambia a <em>live voice</em> para que hable siempre.
                    </p>
                </div>
            `;
            host.querySelector('#gvo-test')?.addEventListener('click', () => {
                testVoice('¡Hola! Soy Gunter, tu asistente. Así suena mi voz con el estilo que elegiste.');
            });
            host.querySelector('#gvo-test-short')?.addEventListener('click', () => {
                const phrases = {
                    chaotic_scientist: 'Listo, genio. Problema resuelto.',
                    energetic_cartoon: '¡Eso quedó agendadísimo!',
                    minimal_penguin:   'Hecho. Bien.',
                    executive:         'Calendario actualizado.',
                    warm:              'Listo, cuídate.',
                    focus_coach:       'Vamos. Un paso a la vez.',
                    professional:      'Todo listo.'
                };
                testVoice(phrases[S().get('voiceStyle')] || phrases.professional);
            });
            }
        }
    };

    function testVoice(text) {
        if (window.GunterVoice?.speak) {
            // force: true bypasses filters to allow testing regardless of mode
            window.GunterVoice.speak(text, { context: 'chat', force: true });
        } else if ('speechSynthesis' in window) {
            const u = new SpeechSynthesisUtterance(text);
            u.lang = 'es-MX';
            speechSynthesis.cancel();
            speechSynthesis.speak(u);
        }
    }

    function styleName(id) {
        return ({
            professional: 'Ejecutivo premium',
            warm: 'Cálido',
            chaotic_scientist: 'Científico caótico',
            energetic_cartoon: 'Caricatura energética',
            minimal_penguin: 'Pingüino minimalista',
            executive: 'Ejecutivo clásico',
            focus_coach: 'Coach de enfoque'
        })[id] || id;
    }
    function modeName(m) {
        return ({
            text_only: 'Solo texto',
            notifications_only: 'Solo alertas',
            live_voice: 'Voz en vivo',
            wake_word_only: 'Tras wake word'
        })[m] || m;
    }
    function humanMode(m) {
        return ({
            text_only: 'nunca (solo texto)',
            notifications_only: 'solo con alertas importantes',
            live_voice: 'en toda respuesta',
            wake_word_only: 'solo cuando lo invocas con "Hi Gunter"'
        })[m] || m;
    }

    // ---------- WAKE WORD ----------
    window.GunterWakeTab = {
        mount(sel) {
            const host = typeof sel === 'string' ? document.querySelector(sel) : sel;
            if (!host) return;

            function render() {
                const cfg = S().getWakeWordConfig();
                const state = window.GunterWakeWord?.getState?.() || { active: false, permission: 'unknown' };
                const supported = cfg.supported !== false;

                host.innerHTML = `
                    <div class="gday__card">
                        <div class="gday__card-actions">
                            <h3>🎙️ Wake word "${esc(cfg.wakeWord)}"</h3>
                            <span id="gww-status-chip" style="font-size:11px;"></span>
                        </div>
                        ${!supported ? `
                            <div class="gww-alert gww-alert--err">
                                ⚠️ Tu navegador no soporta <code>SpeechRecognition</code>. Usa Chrome, Edge o Safari.
                            </div>
                        ` : `
                            ${state.permission !== 'granted' ? `
                                <div class="gww-activate">
                                    <div class="gww-activate__icon">🎤</div>
                                    <div>
                                        <div class="gww-activate__title">Activa el micrófono</div>
                                        <div class="gww-activate__sub">Gunter necesita permiso para escucharte. El audio nunca sale de tu navegador.</div>
                                    </div>
                                    <button class="gday__btn gday__btn--primary" id="gww-permission">Dar permiso</button>
                                </div>
                            ` : ''}

                            <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; margin: 14px 0;">
                                <div class="gday__tile-stat">
                                    <div class="gday__tile-stat__label">Palabra</div>
                                    <div class="gday__tile-stat__value" style="font-family: 'JetBrains Mono', monospace; font-size: 14px;">${esc(cfg.wakeWord)}</div>
                                </div>
                                <div class="gday__tile-stat">
                                    <div class="gday__tile-stat__label">Respuesta</div>
                                    <div class="gday__tile-stat__value">${cfg.responseMode === 'voice' ? '🔊 Voz' : '💬 Texto'}</div>
                                </div>
                                <div class="gday__tile-stat">
                                    <div class="gday__tile-stat__label">Auto-stop</div>
                                    <div class="gday__tile-stat__value">${cfg.autoStopSeconds}s</div>
                                </div>
                                <div class="gday__tile-stat">
                                    <div class="gday__tile-stat__label">Estado</div>
                                    <div class="gday__tile-stat__value" id="gww-state-val">—</div>
                                </div>
                            </div>
                            <div style="display:flex; gap:8px; flex-wrap:wrap;">
                                <button class="gday__btn gday__btn--primary" id="gww-toggle">${state.active ? '⏸ Pausar' : '▶ Iniciar escucha'}</button>
                                <a href="config.html#premium" class="gday__btn">⚙️ Ajustar</a>
                            </div>

                            <!-- DIAGNOSTIC LIVE PANEL -->
                            <div class="gww-live" style="margin-top:14px;">
                                <div class="gww-live__label">Último audio escuchado:</div>
                                <div class="gww-live__text" id="gww-live-text">—</div>
                                <div class="gww-live__hint" id="gww-live-hint">Di <strong>"Gunter"</strong> en voz alta. Si no aparece texto aquí, el navegador no está captando tu voz.</div>
                            </div>

                            <div style="margin-top:14px; padding:14px 16px; background: var(--gday-bg); border:1px solid var(--gday-border); border-radius:10px; font-size:13px; line-height:1.65;">
                                <strong>Cómo usar:</strong><br>
                                1. Pulsa <em>"▶ Iniciar escucha"</em>. El indicador flotante abajo-izquierda se enciende.<br>
                                2. Di <em>"Gunter"</em> solo (o "Hi Gunter", "Oye Gunter", "Hola Gunter").<br>
                                3. El indicador se pone verde → habla tu comando.<br>
                                4. Ejemplos: <em>"Gunter, crea una tarea"</em>, <em>"Gunter agenda reunión mañana diez"</em>, <em>"Gunter qué tengo hoy"</em>.<br>
                                5. Tras ${cfg.autoStopSeconds}s de silencio vuelve al modo dormido.<br><br>
                                <strong>Si no funciona:</strong> abre la consola (F12) y añade <code>?debug=wake</code> a la URL para ver qué escucha.
                            </div>
                        `}
                    </div>
                `;

                host.querySelector('#gww-permission')?.addEventListener('click', async () => {
                    if (!window.GunterWakeWord) return;
                    const res = await window.GunterWakeWord.requestPermission();
                    if (res === 'granted') {
                        window.GunterWakeWord.start(true);
                        render();
                    } else {
                        alert('No se otorgó permiso de micrófono. Actívalo en ajustes del navegador.');
                    }
                });
                host.querySelector('#gww-toggle')?.addEventListener('click', () => {
                    const s = window.GunterWakeWord?.getState?.();
                    if (s?.active) window.GunterWakeWord.stop();
                    else window.GunterWakeWord.start(true);
                    setTimeout(render, 150);
                });

                updateChip();
                const pollId = setInterval(updateChip, 1500);
                // Clean up interval when host is unmounted (simple heuristic)
                host._gwwPoll = pollId;
            }

            function updateChip() {
                const chip = host.querySelector('#gww-status-chip');
                const stateVal = host.querySelector('#gww-state-val');
                const liveText = host.querySelector('#gww-live-text');
                if (!chip) return;
                const s = window.GunterWakeWord?.getState?.() || { active: false, mode: 'off', lastHeard: '' };
                if (!s.active) {
                    chip.innerHTML = '<span style="color: var(--gday-text-mute);">○ Inactivo</span>';
                    if (stateVal) stateVal.textContent = 'Inactivo';
                } else if (s.mode === 'query') {
                    chip.innerHTML = '<span style="color: #22c55e;">● Escuchando comando</span>';
                    if (stateVal) stateVal.textContent = '🎤 Comando';
                } else {
                    chip.innerHTML = '<span style="color: var(--gday-accent);">● Esperando wake word</span>';
                    if (stateVal) stateVal.textContent = '😴 Esperando';
                }
                if (liveText && s.lastHeard) {
                    liveText.textContent = s.lastHeard;
                }
            }

            // Clean previous poller if re-mounted
            if (host._gwwPoll) clearInterval(host._gwwPoll);

            render();

            // React to flag changes and state updates
            if (window.GunterWakeWord?.onStateChange) {
                window.GunterWakeWord.onStateChange(() => {
                    const el = host.querySelector('#gww-state-val');
                    if (el) updateChip();
                });
            }
            window.addEventListener('gunterPremiumFeaturesChange', render);
        }
    };

    // ---------- DOCUMENTS ----------
    window.GunterDocumentsTab = {
        mount(sel) {
            const host = typeof sel === 'string' ? document.querySelector(sel) : sel;
            if (!host) return;
            render();
            async function render() {
                let docs = [];
                try {
                    if (window.GunterDocumentService?.list) {
                        docs = await window.GunterDocumentService.list();
                    }
                } catch {}
                host.innerHTML = `
                    <div class="gday__card">
                        <div class="gday__card-actions">
                            <h3>📄 Documentos guardados</h3>
                            <button class="gday__btn" id="gdoc-upload">📤 Subir documento</button>
                        </div>
                        ${docs.length === 0
                            ? '<p class="gday__empty">Aún no has guardado documentos. Arrastra un recibo en la pestaña Hoy.</p>'
                            : `
                            <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px;">
                                ${docs.map(d => `
                                    <div class="gdoc-card">
                                        <div class="gdoc-card__type">${esc(d.tipo || 'doc')}</div>
                                        <div class="gdoc-card__company">${esc(d.empresa || 'Sin empresa')}</div>
                                        <div class="gdoc-card__total">${d.total != null ? fmtMoney(d.total, d.moneda) : '—'}</div>
                                        ${d.dueDate ? `<div class="gdoc-card__due">Vence ${new Date(d.dueDate + 'T00:00:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</div>` : ''}
                                        <div class="gdoc-card__date">Guardado ${new Date(d.createdAt).toLocaleDateString('es-MX')}</div>
                                        ${d.taskId ? '<div class="gdoc-card__link">→ Tarea vinculada</div>' : ''}
                                    </div>
                                `).join('')}
                            </div>
                            `
                        }
                        <p style="margin-top:14px; color: var(--gday-text-dim); font-size:13px;">
                            Cuando activas <em>Gestión inteligente de documentos</em>, todas las facturas que arrastres en "Hoy" se guardan aquí con su análisis.
                        </p>
                    </div>
                `;
                host.querySelector('#gdoc-upload')?.addEventListener('click', () => {
                    // Trigger the file input that already exists in the Hoy tab
                    document.getElementById('gday-doc-file')?.click();
                });
            }
        }
    };

    function fmtMoney(n, cur) {
        try {
            return new Intl.NumberFormat('es-MX', {
                style: 'currency', currency: cur || 'COP', maximumFractionDigits: 0
            }).format(n);
        } catch { return `${n} ${cur || ''}`; }
    }
    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // ---------- Inject shared styles for secondary tabs ----------
    function injectStyles() {
        if (document.getElementById('gday-secondary-styles')) return;
        const s = document.createElement('style');
        s.id = 'gday-secondary-styles';
        s.textContent = `
            .gday__tile-stat {
                padding: 10px 14px;
                background: var(--gday-bg);
                border: 1px solid var(--gday-border);
                border-radius: 8px;
            }
            .gday__tile-stat__label {
                font-size: 10px; letter-spacing: 2px; text-transform: uppercase;
                color: var(--gday-text-mute); margin-bottom: 4px;
            }
            .gday__tile-stat__value {
                font-size: 16px; font-weight: 600; color: var(--gday-text);
            }
            .gdoc-card {
                padding: 14px;
                background: var(--gday-bg);
                border: 1px solid var(--gday-border);
                border-radius: 10px;
                display: flex; flex-direction: column; gap: 4px;
            }
            .gdoc-card__type {
                font-size: 10px; letter-spacing: 2px; text-transform: uppercase;
                color: var(--gday-accent); font-weight: 600;
            }
            .gdoc-card__company { font-size: 15px; font-weight: 700; }
            .gdoc-card__total {
                font-family: 'JetBrains Mono', monospace;
                font-size: 18px; color: var(--gday-accent-2);
            }
            .gdoc-card__due { font-size: 12px; color: var(--gday-amber); }
            .gdoc-card__date { font-size: 11px; color: var(--gday-text-mute); margin-top: 4px; }
            .gdoc-card__link { font-size: 11px; color: var(--gday-accent); margin-top: 4px; }

            .gday__btn--primary {
                background: var(--gday-accent); color: var(--gday-bg);
                border-color: var(--gday-accent); font-weight: 600;
            }
            .gday__btn--primary:hover { background: var(--gday-accent-2); border-color: var(--gday-accent-2); color: var(--gday-bg); }

            .gww-alert {
                padding: 12px 16px; border-radius: 10px;
                background: rgba(248,113,113,0.1); color: #fca5a5;
                border: 1px solid rgba(248,113,113,0.3); font-size: 13px;
            }
            .gww-activate {
                display: flex; align-items: center; gap: 14px;
                padding: 14px 18px;
                background: linear-gradient(135deg, color-mix(in srgb, var(--gday-accent) 14%, var(--gday-surface)) 0%, var(--gday-surface) 100%);
                border: 1px solid color-mix(in srgb, var(--gday-accent) 30%, var(--gday-border));
                border-radius: 12px;
                flex-wrap: wrap;
            }
            .gww-activate__icon { font-size: 32px; }
            .gww-activate__title { font-weight: 700; font-size: 15px; }
            .gww-activate__sub { font-size: 12px; color: var(--gday-text-mute); margin-top: 2px; }
            .gww-activate button { margin-left: auto; }

            .gww-live {
                padding: 14px 18px;
                background: linear-gradient(135deg, rgba(34,197,94,0.06), transparent);
                border: 1px solid color-mix(in srgb, var(--gday-accent) 25%, var(--gday-border));
                border-radius: 10px;
            }
            .gww-live__label {
                font-size: 10px; letter-spacing: 2px; text-transform: uppercase;
                color: var(--gday-text-mute); margin-bottom: 6px;
            }
            .gww-live__text {
                font-family: 'JetBrains Mono', monospace;
                font-size: 14px; color: var(--gday-accent-2);
                min-height: 20px;
                padding: 6px 0;
            }
            .gww-live__hint {
                font-size: 11px; color: var(--gday-text-mute);
                margin-top: 4px;
            }
        `;
        document.head.appendChild(s);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectStyles);
    } else {
        injectStyles();
    }
})();
