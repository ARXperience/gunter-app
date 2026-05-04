/* =============================================
   GUNTER - Productivity Panel
   -------------------------------------------------
   Solo se monta si PremiumFeaturesService.isEnabled
   ('productivityPanel'). Muestra:
   - Tareas completadas hoy / semana (sparkline)
   - Horas en reuniones (últimos 7 días)
   - Cumplimiento de objetivos (tareas completadas / totales)
   - ROI del tiempo (items producidos / hora invertida)
   ============================================= */

(function () {
    let host = null;
    let mounted = false;
    let refreshTimer = null;

    function visible() {
        return !!(window.PremiumFeaturesService?.isEnabled?.('productivityPanel'));
    }

    function flag(k) {
        return !!(window.PremiumFeaturesService?.isEnabled?.(k));
    }

    function mount(selector) {
        host = typeof selector === 'string' ? document.querySelector(selector) : selector;
        if (!host) return;
        mounted = true;
        update();
        ['tasks-changed', 'events-changed'].forEach(ev =>
            window.addEventListener(ev, () => update()));
        window.addEventListener('gunterPremiumFeaturesChange', () => update());
        refreshTimer = setInterval(update, 60_000);
    }

    async function update() {
        if (!mounted || !host) return;
        if (!visible()) { host.innerHTML = ''; host.style.display = 'none'; return; }
        host.style.display = '';
        host.innerHTML = renderSkeleton();

        const stats = await computeStats();

        host.innerHTML = `
            <div class="gday__card gprod">
                <div class="gday__card-actions">
                    <h3>📊 Panel de productividad</h3>
                    <span class="gprod__hint">Última semana</span>
                </div>
                <div class="gprod__tiles">
                    ${flag('productivityTimeByTask') ? tile('Tareas hoy', stats.tasksToday, '✓', stats.tasksTodayDelta) : ''}
                    ${flag('productivityWeeklyEfficiency') ? tile('Eficiencia', stats.efficiencyPct + '%', '⚡', stats.efficiencyDelta) : ''}
                    ${flag('productivityGoalCompletion') ? tile('Cumplimiento', stats.goalCompletion + '%', '🎯') : ''}
                    ${flag('productivityRealProductiveHours') ? tile('Horas productivas', stats.hoursThisWeek + 'h', '⏱️') : ''}
                    ${flag('productivityTimeROI') ? tile('ROI tiempo', stats.roi, '💎', null, 'ítems/h') : ''}
                </div>
                ${renderSparkline(stats.completedByDay)}
            </div>
        `;
    }

    function tile(label, value, icon, delta, unit) {
        const deltaHtml = delta != null
            ? `<span class="gprod__delta gprod__delta--${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '↑' : '↓'} ${Math.abs(delta)}</span>`
            : '';
        return `
            <div class="gprod__tile">
                <div class="gprod__tile-top">
                    <span class="gprod__icon">${icon}</span>
                    ${deltaHtml}
                </div>
                <div class="gprod__value">${value}${unit ? `<span class="gprod__unit"> ${unit}</span>` : ''}</div>
                <div class="gprod__label">${label}</div>
            </div>
        `;
    }

    function renderSparkline(series) {
        if (!series || !series.length) return '';
        const max = Math.max(1, ...series.map(s => s.value));
        const w = 320, h = 60, gap = 4, bw = (w - gap * (series.length - 1)) / series.length;
        let x = 0;
        const bars = series.map((s, i) => {
            const bh = Math.max(2, (s.value / max) * (h - 8));
            const b = `<rect x="${x.toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="var(--gday-accent)" opacity="${0.4 + 0.6 * (s.value / max)}"/>`;
            x += bw + gap;
            return b;
        }).join('');
        const labels = series.map(s => s.label).join('  ·  ');
        return `
            <div class="gprod__spark">
                <svg viewBox="0 0 ${w} ${h}" width="100%" height="60" preserveAspectRatio="none">${bars}</svg>
                <div class="gprod__spark-labels">${labels}</div>
            </div>
        `;
    }

    function renderSkeleton() {
        return `
            <div class="gday__card gprod">
                <div class="gday__card-actions"><h3>📊 Panel de productividad</h3></div>
                <div class="gprod__tiles">
                    ${'<div class="gprod__tile gprod__tile--skel"></div>'.repeat(4)}
                </div>
            </div>
        `;
    }

    async function computeStats() {
        const tasks = await safe(() => window.GunterTasksService?.list() || []);
        const events = await safe(() => window.GunterEventsService?.list() || []);
        const now = new Date();

        const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
        const today = startOfDay(now);
        const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);

        const completedAt = t => t.completedAt || (t.status === 'done' ? t.updatedAt : null);
        const completedOn = (t, day) => {
            const c = completedAt(t); if (!c) return false;
            const d = startOfDay(new Date(c));
            return d.getTime() === day.getTime();
        };

        const tasksToday = tasks.filter(t => completedOn(t, today)).length;
        const tasksYesterday = tasks.filter(t => completedOn(t, yesterday)).length;

        // Last 7 days
        const completedByDay = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today); d.setDate(today.getDate() - i);
            const value = tasks.filter(t => completedOn(t, d)).length;
            completedByDay.push({
                label: ['D','L','M','X','J','V','S'][d.getDay()],
                value
            });
        }

        const weekCompleted = completedByDay.reduce((a, b) => a + b.value, 0);
        const totalActiveThisWeek = tasks.filter(t => {
            const created = new Date(t.createdAt);
            return (now - created) / 86_400_000 <= 7;
        }).length;
        const efficiencyPct = totalActiveThisWeek > 0
            ? Math.round((weekCompleted / totalActiveThisWeek) * 100)
            : 0;

        // Goal completion (all-time): tasks with priority 'high' or 'urgent'
        const goalTasks = tasks.filter(t => ['high', 'urgent'].includes(t.priority));
        const goalDone = goalTasks.filter(t => t.status === 'done').length;
        const goalCompletion = goalTasks.length > 0
            ? Math.round((goalDone / goalTasks.length) * 100)
            : 0;

        // Hours in events (last 7 days)
        const weekAgo = new Date(now); weekAgo.setDate(weekAgo.getDate() - 7);
        const eventHours = events
            .filter(e => new Date(e.startAt) >= weekAgo && new Date(e.startAt) <= now)
            .reduce((acc, e) => {
                try {
                    const dur = (new Date(e.endAt) - new Date(e.startAt)) / 3_600_000;
                    return acc + (Number.isFinite(dur) && dur > 0 ? dur : 1);
                } catch { return acc + 1; }
            }, 0);
        const hoursThisWeek = Math.round(eventHours * 10) / 10;

        const roi = hoursThisWeek > 0
            ? (weekCompleted / hoursThisWeek).toFixed(1)
            : weekCompleted > 0 ? weekCompleted.toString() : '—';

        return {
            tasksToday,
            tasksTodayDelta: tasksToday - tasksYesterday,
            efficiencyPct,
            efficiencyDelta: null,
            goalCompletion,
            hoursThisWeek,
            roi,
            completedByDay
        };
    }

    function safe(fn) { try { return Promise.resolve(fn()); } catch { return Promise.resolve([]); } }

    function injectStyles() {
        if (document.getElementById('gprod-styles')) return;
        const s = document.createElement('style');
        s.id = 'gprod-styles';
        s.textContent = `
            .gprod { animation: gprodIn 380ms cubic-bezier(.22,.61,.36,1); }
            @keyframes gprodIn { from { opacity:0; transform: translateY(8px); } to { opacity:1; transform: translateY(0); } }
            .gprod__hint { font-size: 11px; color: var(--gday-text-mute); letter-spacing: 1.5px; text-transform: uppercase; }
            .gprod__tiles {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
                gap: 10px;
                margin-bottom: 14px;
            }
            .gprod__tile {
                padding: 14px 16px;
                background: var(--gday-bg);
                border: 1px solid var(--gday-border);
                border-radius: var(--gday-radius-sm);
            }
            .gprod__tile--skel { min-height: 86px; background: linear-gradient(90deg, var(--gday-surface-2), var(--gday-surface), var(--gday-surface-2)); background-size: 200% 100%; animation: gprodShimmer 1.4s ease-in-out infinite; }
            @keyframes gprodShimmer { to { background-position: -200% 0; } }
            .gprod__tile-top { display:flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
            .gprod__icon { font-size: 18px; opacity: 0.85; }
            .gprod__value {
                font-family: 'JetBrains Mono', monospace;
                font-size: 24px; font-weight: 700;
                color: var(--gday-text);
                line-height: 1;
            }
            .gprod__unit { font-size: 12px; color: var(--gday-text-mute); font-weight: 400; }
            .gprod__label { font-size: 11px; color: var(--gday-text-mute); margin-top: 4px; letter-spacing: 0.5px; text-transform: uppercase; }
            .gprod__delta {
                padding: 2px 6px; border-radius: 4px;
                font-size: 10px; font-weight: 600;
            }
            .gprod__delta--up { background: rgba(34,197,94,0.15); color: #4ade80; }
            .gprod__delta--down { background: rgba(248,113,113,0.12); color: #fca5a5; }
            .gprod__spark {
                padding: 8px 10px;
                background: var(--gday-bg);
                border: 1px solid var(--gday-border);
                border-radius: var(--gday-radius-sm);
            }
            .gprod__spark-labels {
                display: flex; justify-content: space-around;
                margin-top: 4px;
                font-size: 10px; color: var(--gday-text-mute);
                font-family: 'JetBrains Mono', monospace;
            }
        `;
        document.head.appendChild(s);
    }

    // Auto-inject styles
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectStyles);
    } else {
        injectStyles();
    }

    window.GunterProductivityPanel = { mount, update };
})();
