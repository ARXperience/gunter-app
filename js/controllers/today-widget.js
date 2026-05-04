/* =============================================
   GUNTER CONTROLLER - Today Widget
   -------------------------------------------------
   Panel "Hoy" que muestra tareas + eventos del día.
   Se auto-refresca cuando llegan eventos
   tasks-changed / events-changed / reminders-changed.
   ============================================= */

(function () {
    let mountEl = null;

    async function render() {
        if (!mountEl) return;
        const ctx = window.GunterContextProvider.build();

        const [tasks, events, overdue] = await Promise.all([
            window.GunterTasksService.listForToday(ctx),
            window.GunterEventsService.listForToday(),
            window.GunterTasksService.listOverdue()
        ]);

        mountEl.innerHTML = `
            <div class="gn-today__head">
                <div>
                    <div class="gn-today__eyebrow">Tu día</div>
                    <h2 class="gn-today__date">${humanToday(ctx.timezone)}</h2>
                </div>
                <div class="gn-today__stats">
                    <span title="Tareas hoy">📋 ${tasks.length}</span>
                    <span title="Eventos hoy">📅 ${events.length}</span>
                    <span title="Vencidas" style="color:#fca5a5;">⏰ ${overdue.length}</span>
                </div>
            </div>

            <div class="gn-today__grid">
                <section class="gn-today__col">
                    <h3>Próximos eventos</h3>
                    ${events.length === 0
                        ? '<p class="gn-today__empty">Sin eventos hoy.</p>'
                        : events.map(renderEvent).join('')}
                </section>
                <section class="gn-today__col">
                    <h3>Tareas de hoy</h3>
                    ${tasks.length === 0
                        ? '<p class="gn-today__empty">Sin tareas pendientes hoy. Escribe a Gunter para crear una.</p>'
                        : tasks.map(renderTask).join('')}
                    ${overdue.length > 0 ? `
                        <details class="gn-today__overdue" open>
                            <summary>Vencidas (${overdue.length})</summary>
                            ${overdue.map(renderTask).join('')}
                        </details>
                    ` : ''}
                </section>
            </div>
        `;

        mountEl.querySelectorAll('[data-task-toggle]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.taskToggle;
                const isDone = btn.dataset.done === 'true';
                if (isDone) await window.GunterTasksService.reopen(id);
                else await window.GunterTasksService.complete(id);
            });
        });
        mountEl.querySelectorAll('[data-task-remove]').forEach(btn => {
            btn.addEventListener('click', async () => {
                await window.GunterTasksService.remove(btn.dataset.taskRemove);
            });
        });
        mountEl.querySelectorAll('[data-event-remove]').forEach(btn => {
            btn.addEventListener('click', async () => {
                await window.GunterEventsService.remove(btn.dataset.eventRemove);
            });
        });
    }

    function renderTask(t) {
        const done = t.status === 'done';
        const overdue = t.dueAt && new Date(t.dueAt) < new Date() && !done;
        return `
            <div class="gn-tile ${done ? 'is-done' : ''} ${overdue ? 'is-overdue' : ''}">
                <button data-task-toggle="${t.id}" data-done="${done}" class="gn-tile__check" aria-label="Completar">
                    ${done ? '✓' : ''}
                </button>
                <div class="gn-tile__body">
                    <div class="gn-tile__title">${escapeHtml(t.title)}</div>
                    <div class="gn-tile__meta">
                        ${t.dueAt ? `<span>🕐 ${humanTime(t.dueAt)}</span>` : ''}
                        ${t.priority && t.priority !== 'normal' ? `<span class="gn-prio gn-prio--${t.priority}">${t.priority}</span>` : ''}
                        ${t.projectName ? `<span>· ${escapeHtml(t.projectName)}</span>` : ''}
                        ${(t.tags || []).map(tg => `<span class="gn-tag">#${escapeHtml(tg)}</span>`).join('')}
                    </div>
                </div>
                <button data-task-remove="${t.id}" class="gn-tile__remove" aria-label="Eliminar">✕</button>
            </div>
        `;
    }

    function renderEvent(e) {
        return `
            <div class="gn-tile gn-tile--event">
                <div class="gn-tile__time">${humanTime(e.startAt)}</div>
                <div class="gn-tile__body">
                    <div class="gn-tile__title">${escapeHtml(e.title)}</div>
                    <div class="gn-tile__meta">
                        ${e.endAt ? `<span>hasta ${humanTime(e.endAt)}</span>` : ''}
                        ${e.location ? `<span>📍 ${escapeHtml(e.location)}</span>` : ''}
                        ${(e.attendees || []).length ? `<span>👥 ${e.attendees.join(', ')}</span>` : ''}
                    </div>
                </div>
                <button data-event-remove="${e.id}" class="gn-tile__remove" aria-label="Eliminar">✕</button>
            </div>
        `;
    }

    function humanTime(iso) {
        try { return new Date(iso).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }); }
        catch { return iso; }
    }
    function humanToday(tz) {
        return new Date().toLocaleDateString('es-MX', {
            weekday: 'long', day: 'numeric', month: 'long', timeZone: tz
        });
    }
    function escapeHtml(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function injectStyles() {
        if (document.getElementById('gn-today-styles')) return;
        const s = document.createElement('style');
        s.id = 'gn-today-styles';
        s.textContent = `
            .gn-today {
                padding: 28px;
                border-radius: var(--theme-radius-lg, 14px);
                border: 1px solid var(--glass-border);
                background: color-mix(in srgb, var(--bg-deep-navy) 84%, transparent);
                backdrop-filter: blur(20px);
                -webkit-backdrop-filter: blur(20px);
            }
            .gn-today__head { display:flex; justify-content:space-between; align-items:center; margin-bottom: 24px; gap: 16px; flex-wrap: wrap; }
            .gn-today__eyebrow { font-size: 11px; letter-spacing: 3px; text-transform: uppercase; color: var(--accent-primary); margin-bottom: 4px; }
            .gn-today__date { margin: 0; font-size: 24px; text-transform: capitalize; }
            .gn-today__stats { display:flex; gap: 16px; font-size: 14px; color: var(--text-secondary); }
            .gn-today__grid { display:grid; grid-template-columns: 1fr 1fr; gap: 24px; }
            @media (max-width: 780px) { .gn-today__grid { grid-template-columns: 1fr; } }
            .gn-today__col h3 { font-size: 13px; text-transform: uppercase; letter-spacing: 2px; color: var(--text-muted); margin: 0 0 10px; }
            .gn-today__empty { color: var(--text-muted); font-size: 13px; padding: 18px; border: 1px dashed var(--glass-border); border-radius: 10px; margin: 0; text-align: center; }
            .gn-today__overdue { margin-top: 14px; }
            .gn-today__overdue summary { cursor: pointer; font-size: 12px; color: #fca5a5; padding: 4px 0; }

            .gn-tile {
                display:flex; align-items:center; gap: 10px;
                padding: 10px 12px; margin-bottom: 8px;
                border: 1px solid var(--glass-border); border-radius: 10px;
                background: color-mix(in srgb, var(--bg-obsidian) 60%, transparent);
                transition: border-color 200ms ease, transform 150ms ease;
            }
            .gn-tile:hover { border-color: var(--accent-primary); transform: translateX(2px); }
            .gn-tile.is-done { opacity: 0.55; }
            .gn-tile.is-done .gn-tile__title { text-decoration: line-through; }
            .gn-tile.is-overdue { border-color: rgba(239, 68, 68, 0.4); }

            .gn-tile__check {
                width: 22px; height: 22px; border-radius: 50%;
                border: 1.5px solid var(--accent-primary);
                background: transparent; color: var(--bg-deep-navy);
                font-weight: 700; cursor: pointer; flex-shrink: 0;
                display: inline-flex; align-items: center; justify-content: center;
            }
            .gn-tile.is-done .gn-tile__check { background: var(--accent-primary); }

            .gn-tile__time {
                font-family: 'JetBrains Mono', monospace;
                font-size: 13px; font-weight: 600; color: var(--accent-primary);
                min-width: 54px;
            }
            .gn-tile__body { flex: 1; }
            .gn-tile__title { font-size: 14px; color: var(--text-primary); margin-bottom: 2px; }
            .gn-tile__meta { font-size: 11px; color: var(--text-muted); display:flex; gap: 8px; flex-wrap: wrap; }
            .gn-prio { padding: 1px 6px; border-radius: 4px; font-size: 10px; text-transform: uppercase; }
            .gn-prio--high { background: rgba(239, 68, 68, 0.15); color: #fca5a5; }
            .gn-prio--urgent { background: #ef4444; color: white; }
            .gn-prio--low { background: rgba(148, 163, 184, 0.15); color: #94a3b8; }
            .gn-tag { color: var(--accent-primary); }
            .gn-tile__remove {
                background: transparent; border: none; color: var(--text-muted);
                font-size: 14px; cursor: pointer; padding: 4px 6px; border-radius: 4px;
                opacity: 0; transition: opacity 150ms ease, color 150ms ease;
            }
            .gn-tile:hover .gn-tile__remove { opacity: 1; }
            .gn-tile__remove:hover { color: #fca5a5; }
        `;
        document.head.appendChild(s);
    }

    function mount(selector) {
        mountEl = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!mountEl) return;
        injectStyles();
        mountEl.classList.add('gn-today');
        render();
        ['tasks-changed', 'events-changed', 'reminders-changed'].forEach(ev => {
            window.addEventListener(ev, () => render());
        });
    }

    window.GunterTodayWidget = { mount, render };
})();
