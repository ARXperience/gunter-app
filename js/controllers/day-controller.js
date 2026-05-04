/* =============================================
   GUNTER DÍA - Page Controller
   -------------------------------------------------
   Orquesta la página day.html:
   - Header dinámico (saludo + fecha + stats)
   - Quick-add bar (captura rápida vía pipeline)
   - Cards de tareas, eventos y recordatorios
   - Chat embebido (reusa assistant-controller)
   - Próximo evento destacado ("next up")
   ============================================= */

(function () {
    let brandAvatar = null;

    function init() {
        mountAvatar();
        renderHeader();
        wireQuickBar();
        wireNotifications();
        wireNav();
        wireChatControls();
        wireDocumentUpload();
        mountPremiumPanels();

        // Mount premium intel shortcuts in panel Hoy (Sprint G)
        if (window.GunterTodayShortcuts?.mount) {
            window.GunterTodayShortcuts.mount('#gday-today-shortcuts').catch(() => {});
        }

        // Mount reused widgets into the Día shell
        if (window.GunterTodayWidget) {
            // Separate mounts: tasks + events lists
            mountTodayWidget();
        }
        if (window.GunterAssistantController) {
            // Embed assistant chat inside the chat card
            window.GunterAssistantController.mount({
                container: document.getElementById('gday-chat-mount')
            });
        }

        renderReminders();
        renderNextUp();

        // Refresh on any changes
        ['tasks-changed', 'events-changed', 'reminders-changed'].forEach(ev => {
            window.addEventListener(ev, () => {
                refreshStats();
                renderReminders();
                renderNextUp();
            });
        });

        // Tick every minute so "next up" stays fresh
        setInterval(() => { renderNextUp(); refreshStats(); }, 60_000);
    }

    function mountAvatar() {
        if (window.GunterAvatar) {
            try {
                brandAvatar = new window.GunterAvatar('gday-brand-avatar', { size: 44 });
            } catch {}
        }
    }

    function renderHeader() {
        const ctx = window.GunterContextProvider.build();
        const now = new Date();
        const h = now.getHours();
        const greeting = h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches';
        document.getElementById('gday-greeting').textContent = greeting;
        document.getElementById('gday-date').textContent = now.toLocaleDateString('es-MX', {
            weekday: 'long', day: 'numeric', month: 'long'
        });

        const user = localStorage.getItem('gunter_username') || ctx.userId || '';
        const uEl = document.getElementById('gday-user-name');
        if (uEl) uEl.textContent = user || 'Tu cuenta';

        refreshStats();
    }

    async function refreshStats() {
        const ctx = window.GunterContextProvider.build();
        const [tasksToday, eventsToday, overdue] = await Promise.all([
            window.GunterTasksService.listForToday(ctx),
            window.GunterEventsService.listForToday(),
            window.GunterTasksService.listOverdue()
        ]);
        document.getElementById('stat-tasks').textContent = tasksToday.length;
        document.getElementById('stat-events').textContent = eventsToday.length;
        const overdueChip = document.getElementById('stat-overdue-chip');
        const overdueEl = document.getElementById('stat-overdue');
        if (overdueEl) overdueEl.textContent = overdue.length;
        if (overdueChip) overdueChip.style.display = overdue.length > 0 ? 'inline-flex' : 'none';

        // Subtitle
        const sub = document.getElementById('gday-subtitle');
        if (sub) {
            if (tasksToday.length === 0 && eventsToday.length === 0) {
                sub.textContent = 'Un día despejado. Usa la barra de captura para agregar algo.';
            } else {
                const parts = [];
                if (tasksToday.length) parts.push(`${tasksToday.length} tarea${tasksToday.length === 1 ? '' : 's'}`);
                if (eventsToday.length) parts.push(`${eventsToday.length} evento${eventsToday.length === 1 ? '' : 's'}`);
                if (overdue.length) parts.push(`${overdue.length} vencida${overdue.length === 1 ? '' : 's'}`);
                sub.textContent = `Esto es lo que tienes hoy: ${parts.join(' · ')}.`;
            }
        }
    }

    function mountTodayWidget() {
        // We render tasks and events separately inside their own cards.
        // today-widget is built for one mount; we call its internal render against two containers.
        const tasksMount = document.getElementById('gday-tasks-mount');
        const eventsMount = document.getElementById('gday-events-mount');
        renderTasksInto(tasksMount);
        renderEventsInto(eventsMount);

        ['tasks-changed'].forEach(ev =>
            window.addEventListener(ev, () => renderTasksInto(tasksMount)));
        ['events-changed'].forEach(ev =>
            window.addEventListener(ev, () => renderEventsInto(eventsMount)));
    }

    async function renderTasksInto(mount) {
        if (!mount) return;
        const ctx = window.GunterContextProvider.build();
        const tasks = await window.GunterTasksService.listForToday(ctx);
        const overdue = await window.GunterTasksService.listOverdue();

        if (tasks.length === 0 && overdue.length === 0) {
            mount.innerHTML = '<p class="gday__empty">Sin tareas hoy. Escribe arriba una captura rápida para crear una.</p>';
            return;
        }
        mount.innerHTML = tasks.map(renderTaskTile).join('');
        if (overdue.length) {
            mount.innerHTML += `
                <details style="margin-top:14px;" open>
                    <summary style="cursor:pointer; color: var(--gday-danger); font-size: 12px; padding: 6px 0;">
                        Vencidas (${overdue.length})
                    </summary>
                    ${overdue.map(renderTaskTile).join('')}
                </details>
            `;
        }
        wireTaskActions(mount);
    }

    async function renderEventsInto(mount) {
        if (!mount) return;
        const events = await window.GunterEventsService.listForToday();
        if (events.length === 0) {
            mount.innerHTML = '<p class="gday__empty">Sin eventos hoy.</p>';
            return;
        }
        mount.innerHTML = events.map(renderEventTile).join('');
        wireEventActions(mount);
    }

    function renderTaskTile(t) {
        const done = t.status === 'done';
        const overdue = t.dueAt && new Date(t.dueAt) < new Date() && !done;
        const time = t.dueAt ? fmtTime(t.dueAt) : '';
        return `
            <div class="gn-tile ${done ? 'is-done' : ''} ${overdue ? 'is-overdue' : ''}">
                <button data-task-toggle="${t.id}" data-done="${done}" class="gn-tile__check">${done ? '✓' : ''}</button>
                <div class="gn-tile__body">
                    <div class="gn-tile__title">${escapeHtml(t.title)}</div>
                    <div class="gn-tile__meta">
                        ${time ? `<span>🕐 ${time}</span>` : ''}
                        ${t.priority && t.priority !== 'normal'
                            ? `<span class="gn-prio gn-prio--${t.priority}">${t.priority}</span>` : ''}
                        ${t.projectName ? `<span>· ${escapeHtml(t.projectName)}</span>` : ''}
                        ${(t.tags || []).map(tg => `<span class="gn-tag">#${escapeHtml(tg)}</span>`).join('')}
                    </div>
                </div>
                <button data-task-remove="${t.id}" class="gn-tile__remove">✕</button>
            </div>`;
    }

    function renderEventTile(e) {
        return `
            <div class="gn-tile gn-tile--event">
                <div class="gn-tile__time">${fmtTime(e.startAt)}</div>
                <div class="gn-tile__body">
                    <div class="gn-tile__title">${escapeHtml(e.title)}</div>
                    <div class="gn-tile__meta">
                        ${e.endAt ? `<span>hasta ${fmtTime(e.endAt)}</span>` : ''}
                        ${e.location ? `<span>📍 ${escapeHtml(e.location)}</span>` : ''}
                        ${(e.attendees || []).length ? `<span>👥 ${e.attendees.join(', ')}</span>` : ''}
                    </div>
                </div>
                <button data-event-remove="${e.id}" class="gn-tile__remove">✕</button>
            </div>`;
    }

    function wireTaskActions(root) {
        root.querySelectorAll('[data-task-toggle]').forEach(b =>
            b.addEventListener('click', async () => {
                const id = b.dataset.taskToggle;
                if (b.dataset.done === 'true') await window.GunterTasksService.reopen(id);
                else await window.GunterTasksService.complete(id);
            }));
        root.querySelectorAll('[data-task-remove]').forEach(b =>
            b.addEventListener('click', async () => {
                await window.GunterTasksService.remove(b.dataset.taskRemove);
            }));
    }
    function wireEventActions(root) {
        root.querySelectorAll('[data-event-remove]').forEach(b =>
            b.addEventListener('click', async () => {
                await window.GunterEventsService.remove(b.dataset.eventRemove);
            }));
    }

    // ---------- Reminders ----------
    async function renderReminders() {
        const mount = document.getElementById('gday-reminders-mount');
        if (!mount) return;
        const all = await window.GunterNotificationsService.list({ status: 'scheduled' });
        if (all.length === 0) {
            mount.innerHTML = '<p class="gday__empty">No tienes recordatorios activos.</p>';
            return;
        }
        mount.innerHTML = `
            <div class="gday__reminders">
                ${all.slice(0, 10).map(r => `
                    <div class="gday__reminder">
                        <span class="gday__reminder-time">${fmtTime(r.fireAt)}</span>
                        <span class="gday__reminder-title">${escapeHtml(r.title)}</span>
                        <button class="gday__reminder-cancel" data-rem-cancel="${r.id}" title="Cancelar">✕</button>
                    </div>
                `).join('')}
            </div>
        `;
        mount.querySelectorAll('[data-rem-cancel]').forEach(b =>
            b.addEventListener('click', async () => {
                await window.GunterNotificationsService.cancel(b.dataset.remCancel);
                renderReminders();
            }));
    }

    // ---------- Next up ribbon ----------
    async function renderNextUp() {
        const mount = document.getElementById('gday-next-ribbon');
        if (!mount) return;
        const now = Date.now();
        const [events, reminders, tasks] = await Promise.all([
            window.GunterEventsService.listUpcoming(5),
            window.GunterNotificationsService.list({ status: 'scheduled' }),
            window.GunterTasksService.list({ status: 'pending' })
        ]);

        const candidates = [
            ...events.map(e => ({ kind: 'event', when: new Date(e.startAt).getTime(), title: e.title, sub: fmtTime(e.startAt) })),
            ...reminders.filter(r => new Date(r.fireAt).getTime() > now).map(r => ({
                kind: 'reminder', when: new Date(r.fireAt).getTime(),
                title: r.title, sub: `Recordatorio · ${fmtTime(r.fireAt)}`
            })),
            ...tasks.filter(t => t.dueAt && new Date(t.dueAt).getTime() > now).map(t => ({
                kind: 'task', when: new Date(t.dueAt).getTime(),
                title: t.title, sub: `Tarea · ${fmtTime(t.dueAt)}`
            }))
        ].sort((a, b) => a.when - b.when);

        const next = candidates.find(c => c.when >= now);
        if (!next) { mount.innerHTML = ''; return; }

        const minsTo = Math.round((next.when - now) / 60000);
        const when = minsTo < 1 ? 'ahora' : minsTo < 60 ? `en ${minsTo} min` : `en ${Math.round(minsTo / 60)} h`;

        const icons = { event: '📅', reminder: '⏰', task: '📋' };
        mount.innerHTML = `
            <div class="gday__next">
                <div class="gday__next-icon">${icons[next.kind] || '🔔'}</div>
                <div class="gday__next-body">
                    <div class="gday__next-title">${escapeHtml(next.title)}</div>
                    <div class="gday__next-meta">${escapeHtml(next.sub)}</div>
                </div>
                <div class="gday__next-cta">${when}</div>
            </div>
        `;
    }

    // ---------- Quick-add ----------
    function wireQuickBar() {
        const form = document.getElementById('gday-quickbar-form');
        const input = document.getElementById('gday-quickbar-input');
        if (!form || !input) return;
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const text = input.value.trim();
            if (!text) return;
            input.disabled = true;
            form.querySelector('button').disabled = true;
            try {
                const { awaitingConfirmation, response } = await window.GunterPipeline.handleUserInput(text);
                if (response?.speech) {
                    window.GunterNotificationsService.showToast(response.speech, { priority: 'normal', duration: 4500 });
                }
                if (awaitingConfirmation) {
                    // Route to the chat panel so the user can answer there
                    window.GunterNotificationsService.showToast('Gunter necesita confirmación — revisa el chat abajo.', { priority: 'high', duration: 6000 });
                    // Replay the input in the chat so user sees it threaded
                    if (window.GunterAssistantController?.send) await window.GunterAssistantController.send(text);
                }
                input.value = '';
                if (brandAvatar && response?.animation && brandAvatar.playAnimation) {
                    brandAvatar.playAnimation(response.animation);
                }
            } catch (err) {
                if (window.GunterErrors) window.GunterErrors.toast(err);
                else window.GunterNotificationsService.showToast('⚠️ ' + (err.message || err), { priority: 'high' });
            } finally {
                input.disabled = false;
                form.querySelector('button').disabled = false;
                input.focus();
            }
        });
    }

    // ---------- Notifications permission ----------
    function wireNotifications() {
        const btn = document.getElementById('gday-enable-notifications');
        if (!btn) return;
        updateNotifBtn(btn);
        btn.addEventListener('click', async () => {
            const res = await window.GunterNotificationsService.requestPermission();
            updateNotifBtn(btn);
            if (res === 'granted') {
                window.GunterNotificationsService.showToast('✅ Notificaciones activadas.', { priority: 'normal' });
            } else if (res === 'denied') {
                window.GunterNotificationsService.showToast('Permiso denegado. Actívalo en ajustes del navegador.', { priority: 'high' });
            }
        });
    }
    function updateNotifBtn(btn) {
        if (!('Notification' in window)) {
            btn.textContent = '🔔 No soportado'; btn.disabled = true; return;
        }
        if (Notification.permission === 'granted') {
            btn.textContent = '🔔 Notificaciones activas';
            btn.disabled = true;
        } else if (Notification.permission === 'denied') {
            btn.textContent = '🔕 Bloqueadas en el navegador';
            btn.disabled = true;
        } else {
            btn.textContent = '🔔 Activar notificaciones';
        }
    }

    // ---------- Nav scroll ----------
    function wireNav() {
        document.querySelectorAll('[data-scroll-to]').forEach(a => {
            a.addEventListener('click', (e) => {
                const id = a.dataset.scrollTo;
                const target = document.getElementById(id);
                if (target) {
                    e.preventDefault();
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    document.querySelectorAll('.gday__nav-item').forEach(n => n.classList.remove('is-active'));
                    a.classList.add('is-active');
                }
            });
        });
    }

    // ---------- Chat controls ----------
    function wireChatControls() {
        const clearBtn = document.getElementById('gday-clear-chat');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                localStorage.removeItem('gunter_conversation');
                const log = document.querySelector('#gn-assistant-log');
                if (log) log.innerHTML = '';
                window.GunterNotificationsService.showToast('Historial de chat limpiado.', { duration: 2500 });
            });
        }
    }

    // ---------- Documents upload ----------
    let currentDoc = null; // { extracted, blob, mimeType }

    function wireDocumentUpload() {
        const btn = document.getElementById('gday-doc-btn');
        const fileInput = document.getElementById('gday-doc-file');
        const drop = document.getElementById('gday-quickbar-drop');
        if (!btn || !fileInput) return;

        btn.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', (e) => {
            const f = e.target.files?.[0];
            if (f) processDocumentFile(f);
            fileInput.value = '';
        });

        if (drop) {
            ['dragenter', 'dragover'].forEach(ev => {
                drop.addEventListener(ev, (e) => {
                    if (!e.dataTransfer?.types?.includes('Files')) return;
                    e.preventDefault();
                    drop.classList.add('is-dragover');
                });
            });
            ['dragleave', 'drop'].forEach(ev => {
                drop.addEventListener(ev, (e) => {
                    e.preventDefault();
                    drop.classList.remove('is-dragover');
                });
            });
            drop.addEventListener('drop', (e) => {
                const f = e.dataTransfer?.files?.[0];
                if (f) processDocumentFile(f);
            });
        }

        // Paste from clipboard anywhere on the page
        window.addEventListener('paste', (e) => {
            if (!e.clipboardData) return;
            for (const item of e.clipboardData.items) {
                if (item.kind === 'file') {
                    const f = item.getAsFile();
                    if (f) { processDocumentFile(f); break; }
                }
            }
        });
    }

    async function processDocumentFile(file) {
        const previewEl = document.getElementById('gday-doc-preview');
        if (!previewEl) return;

        // Show loading state immediately
        const objectUrl = URL.createObjectURL(file);
        previewEl.hidden = false;
        previewEl.innerHTML = `
            <div class="gday__doc-loading">
                <img src="${objectUrl}" alt="" class="gday__doc-thumb-loading">
                <div>
                    <strong>Gunter está leyendo el documento…</strong>
                    <p class="gday__doc-hint">Extrayendo empresa, valor, vencimiento y referencia con IA.</p>
                    <div class="gday__doc-skeleton"><span></span><span></span><span></span></div>
                </div>
            </div>
        `;
        if (brandAvatar?.playAnimation) brandAvatar.playAnimation('think');

        try {
            window.GunterDocumentService.validateFile(file);
            const extracted = await window.GunterDocumentService.extractFromFile(file, { hint: 'auto' });
            currentDoc = {
                extracted,
                blob: extracted.__originalBlob || file,
                mimeType: extracted.__originalMime || file.type,
                thumbUrl: objectUrl
            };
            renderDocumentPreview(previewEl, currentDoc);
            if (brandAvatar?.playAnimation) brandAvatar.playAnimation('idea');
        } catch (err) {
            URL.revokeObjectURL(objectUrl);
            previewEl.innerHTML = `
                <div class="gday__doc-error">
                    <strong>⚠️ No se pudo procesar el documento</strong>
                    <p>${escapeHtml(err.message || String(err))}</p>
                    <button class="gday__btn" onclick="document.getElementById('gday-doc-preview').hidden=true">Cerrar</button>
                </div>
            `;
            if (brandAvatar?.playAnimation) brandAvatar.playAnimation('shake');
        }
    }

    function renderDocumentPreview(mount, doc) {
        const ext = doc.extracted;
        const empresa = ext.empresa?.nombre || '(sin detectar)';
        const totalFmt = ext.valor?.total != null
            ? window.GunterDocumentService.fmtMoney(ext.valor.total, ext.valor.moneda)
            : '—';
        const due = ext.fecha_vencimiento
            ? new Date(ext.fecha_vencimiento + 'T00:00:00').toLocaleDateString('es-MX', {
                weekday: 'long', day: 'numeric', month: 'long'
            })
            : '(sin fecha)';
        const reference = ext.referencia?.numero_factura
            || ext.referencia?.codigo_pago
            || ext.referencia?.numero_cliente
            || '—';
        const conf = Math.round((ext.confidence?.overall || 0) * 100);
        const confClass = conf >= 85 ? 'ok' : conf >= 60 ? 'warn' : 'low';

        const suggested = window.GunterDocumentService.buildSuggestedTask(ext);

        const warningsHtml = (ext.warnings || []).length
            ? `<div class="gday__doc-warnings">⚠️ ${ext.warnings.map(escapeHtml).join(' · ')}</div>`
            : '';

        mount.innerHTML = `
            <div class="gday__doc-header">
                <span class="gday__doc-eyebrow">Documento detectado</span>
                <span class="gday__doc-conf gday__doc-conf--${confClass}" title="Confianza de la IA">${conf}% confianza</span>
                <button class="gday__doc-close" id="gday-doc-close" title="Descartar">✕</button>
            </div>
            <div class="gday__doc-body">
                <div class="gday__doc-thumb">
                    ${doc.mimeType === 'application/pdf'
                        ? `<div class="gday__doc-pdf">📄 PDF</div>`
                        : `<img src="${doc.thumbUrl}" alt="Documento">`}
                </div>
                <div class="gday__doc-fields">
                    <div class="gday__doc-row">
                        <label>Empresa</label>
                        <input type="text" data-field="empresa" value="${escapeAttr(empresa)}">
                    </div>
                    <div class="gday__doc-row gday__doc-row--split">
                        <div>
                            <label>Valor</label>
                            <input type="text" data-field="total" value="${escapeAttr(totalFmt)}">
                        </div>
                        <div>
                            <label>Moneda</label>
                            <input type="text" data-field="moneda" value="${escapeAttr(ext.valor?.moneda || '')}" maxlength="4">
                        </div>
                    </div>
                    <div class="gday__doc-row gday__doc-row--split">
                        <div>
                            <label>Tipo</label>
                            <select data-field="tipo">
                                <option ${ext.tipo === 'recibo' ? 'selected' : ''}>recibo</option>
                                <option ${ext.tipo === 'factura' ? 'selected' : ''}>factura</option>
                                <option ${ext.tipo === 'ticket' ? 'selected' : ''}>ticket</option>
                                <option ${ext.tipo === 'boleta' ? 'selected' : ''}>boleta</option>
                                <option ${ext.tipo === 'otro' ? 'selected' : ''}>otro</option>
                            </select>
                        </div>
                        <div>
                            <label>Vencimiento</label>
                            <input type="date" data-field="fecha_vencimiento" value="${escapeAttr(ext.fecha_vencimiento || '')}">
                        </div>
                    </div>
                    <div class="gday__doc-row">
                        <label>Referencia</label>
                        <input type="text" data-field="referencia" value="${escapeAttr(reference)}">
                    </div>
                    ${ext.resumen ? `<p class="gday__doc-summary">${escapeHtml(ext.resumen)}</p>` : ''}
                    ${warningsHtml}
                </div>
            </div>
            <div class="gday__doc-suggest">
                <div>
                    <strong>Tarea sugerida</strong>
                    <p>${escapeHtml(suggested.title)} · ${due}</p>
                </div>
                <div class="gday__doc-actions">
                    <button class="gday__btn" id="gday-doc-discard">Descartar</button>
                    <button class="gday__btn gday__btn--primary" id="gday-doc-confirm">✓ Crear tarea</button>
                </div>
            </div>
        `;

        // Wire close/discard
        mount.querySelector('#gday-doc-close').addEventListener('click', discardDocument);
        mount.querySelector('#gday-doc-discard').addEventListener('click', discardDocument);

        // Wire confirm
        mount.querySelector('#gday-doc-confirm').addEventListener('click', async () => {
            // Capture any edits from inputs
            const edits = captureEdits(mount);
            const mergedExtracted = applyEdits(ext, edits);
            await confirmDocumentTask(mergedExtracted, doc.blob);
        });

        // Re-build suggested task preview on input changes
        mount.querySelectorAll('[data-field]').forEach(inp => {
            inp.addEventListener('input', () => {
                const edits = captureEdits(mount);
                const merged = applyEdits(ext, edits);
                const s = window.GunterDocumentService.buildSuggestedTask(merged);
                const dueStr = s.dueAt
                    ? new Date(s.dueAt).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
                    : '(sin fecha)';
                mount.querySelector('.gday__doc-suggest p').textContent = `${s.title} · ${dueStr}`;
            });
        });
    }

    function captureEdits(mount) {
        const edits = {};
        mount.querySelectorAll('[data-field]').forEach(inp => {
            edits[inp.dataset.field] = inp.value.trim();
        });
        return edits;
    }

    function applyEdits(ext, e) {
        const clone = JSON.parse(JSON.stringify(ext));
        if (e.empresa) clone.empresa = { ...(clone.empresa || {}), nombre: e.empresa };
        if (e.moneda != null) clone.valor = { ...(clone.valor || {}), moneda: e.moneda.toUpperCase() || null };
        if (e.total != null) {
            const n = parseFloat(String(e.total).replace(/[^0-9.-]/g, ''));
            clone.valor = { ...(clone.valor || {}), total: isNaN(n) ? null : n };
        }
        if (e.tipo) clone.tipo = e.tipo;
        if (e.fecha_vencimiento != null) clone.fecha_vencimiento = e.fecha_vencimiento || null;
        if (e.referencia) clone.referencia = { ...(clone.referencia || {}), numero_factura: e.referencia };
        return clone;
    }

    function discardDocument() {
        const previewEl = document.getElementById('gday-doc-preview');
        if (currentDoc?.thumbUrl) URL.revokeObjectURL(currentDoc.thumbUrl);
        currentDoc = null;
        if (previewEl) { previewEl.hidden = true; previewEl.innerHTML = ''; }
    }

    async function confirmDocumentTask(extracted, blob) {
        try {
            const plan = window.GunterDecisionEngine.planFromDocument(extracted, blob);
            // Skip UI confirmation here — the preview WAS the confirmation
            const ctx = window.GunterContextProvider.build();
            const exec = await window.GunterActionEngine.execute(
                plan, { accepted: true, token: Date.now() }, ctx
            );
            if (exec?.uiResponse?.speech) {
                window.GunterNotificationsService.showToast(exec.uiResponse.speech, {
                    priority: 'normal', duration: 5500
                });
            }
            if (brandAvatar?.playAnimation && exec?.uiResponse?.animation) {
                brandAvatar.playAnimation(exec.uiResponse.animation);
            }
            discardDocument();
        } catch (err) {
            if (window.GunterErrors) window.GunterErrors.toast(err, { context: 'document' });
            else window.GunterNotificationsService.showToast('⚠️ ' + (err.message || err), { priority: 'high', duration: 5000 });
        }
    }

    function escapeAttr(s) {
        return String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    // ---------- Premium panels ----------
    // El montaje lo gestiona ahora day-tabs.js de forma lazy cuando el usuario
    // abre cada tab. Dejamos el método como no-op para no romper init().
    function mountPremiumPanels() { /* handled by day-tabs.js */ }

    // ---------- Helpers ----------
    function fmtTime(iso) {
        try { return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }); }
        catch { return iso; }
    }
    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.GunterDayController = { refreshStats, renderReminders, renderNextUp };
})();
