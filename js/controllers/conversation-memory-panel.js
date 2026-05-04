/* =============================================
   GUNTER CONTROLLER - Conversation Memory Panel
   -------------------------------------------------
   UI de gestión de la Memoria Conversacional Cross-Sesión (v2 — F1)
   en config.html → tab Datos.
     - Stats (total, oldest, byChannel, estimateBytes)
     - Lista últimos 20 turnos
     - Olvidar por patrón
     - Olvidar TODO
   ============================================= */

(function () {
    if (window.GunterConvMemoryPanel) return;

    const STATS_EL_ID = 'conv-memory-stats';
    const LIST_EL_ID  = 'conv-memory-list';

    function esc(s) {
        return String(s ?? '').replace(/[&<>"']/g, c => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
        }[c]));
    }

    function fmtBytes(n) {
        if (!n || n < 1024) return `${n || 0} B`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
        return `${(n / 1024 / 1024).toFixed(2)} MB`;
    }

    function fmtDate(iso) {
        if (!iso) return '—';
        try {
            return new Date(iso).toLocaleDateString('es-MX', {
                day: 'numeric', month: 'short', year: 'numeric'
            });
        } catch { return iso; }
    }

    async function loadStats() {
        const el = document.getElementById(STATS_EL_ID);
        if (!el) return;
        if (!window.GunterConversationMemory?.stats) {
            el.innerHTML = `<p style="color:var(--text-muted);font-size:13px;grid-column:1/-1;">⚠️ Servicio de memoria no disponible.</p>`;
            return;
        }
        try {
            const s = await window.GunterConversationMemory.stats();
            const channels = Object.entries(s.byChannel || {})
                .map(([k, v]) => `${k}: ${v}`)
                .join(' · ') || 'sin datos';
            el.innerHTML = `
                <div class="settings-kv-tile"><strong>${s.total}</strong><span>turnos guardados</span></div>
                <div class="settings-kv-tile"><strong>${esc(channels)}</strong><span>por canal</span></div>
                <div class="settings-kv-tile"><strong>${fmtDate(s.oldestAt)}</strong><span>turno más antiguo</span></div>
                <div class="settings-kv-tile"><strong>${fmtBytes(s.estimateBytes)}</strong><span>uso estimado</span></div>
            `;
        } catch (e) {
            el.innerHTML = `<p style="color:#c33;font-size:13px;grid-column:1/-1;">Error: ${esc(e?.message || e)}</p>`;
        }
    }

    async function listRecent() {
        const el = document.getElementById(LIST_EL_ID);
        if (!el) return;
        if (!window.GunterConversationMemory?.list) {
            el.innerHTML = '';
            return;
        }
        try {
            const turns = await window.GunterConversationMemory.list({ limit: 20 });
            if (!turns.length) {
                el.innerHTML = `<p style="color:var(--text-muted);font-size:13px;margin-top:8px;">Sin turnos guardados todavía. Activa la flag "Memoria conversacional cross-sesión" y empieza a chatear con Gunter.</p>`;
                return;
            }
            const rows = turns.map(t => {
                const when = new Date(t.ts).toLocaleString('es-MX', {
                    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                });
                const role = t.role === 'assistant' ? 'Gunter' : 'Tú';
                const txt = String(t.text || '').slice(0, 280);
                return `
                    <li style="padding:8px 10px;border-bottom:1px solid rgba(0,0,0,0.06);font-size:13px;">
                        <div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline;">
                            <strong style="color:var(--accent,#5b8def);">${esc(role)}</strong>
                            <span style="font-size:11px;color:var(--text-muted);">${esc(when)} · ${esc(t.channel || 'chat')}</span>
                        </div>
                        <div style="margin-top:4px;color:var(--text-primary);white-space:pre-wrap;">${esc(txt)}</div>
                    </li>`;
            }).join('');
            el.innerHTML = `<ul style="list-style:none;padding:0;margin:8px 0 0 0;border:1px solid rgba(0,0,0,0.08);border-radius:8px;max-height:360px;overflow:auto;">${rows}</ul>`;
        } catch (e) {
            el.innerHTML = `<p style="color:#c33;font-size:13px;">Error: ${esc(e?.message || e)}</p>`;
        }
    }

    async function forgetPattern() {
        const needle = window.prompt('¿Qué quieres que Gunter olvide? (texto o palabra exacta a buscar)');
        if (!needle || !needle.trim()) return;
        if (!confirm(`Confirmar: borrar todos los turnos que contengan "${needle.trim()}".`)) return;
        try {
            const n = await window.GunterConversationMemory.forget(needle.trim());
            (window.GunterNotificationsService?.showToast || alert)(
                `🩹 ${n} turnos olvidados.`,
                { variant: 'success', duration: 3500 }
            );
            await loadStats();
            await listRecent();
        } catch (e) {
            alert('Error olvidando: ' + (e?.message || e));
        }
    }

    async function clearAll() {
        if (!confirm('⚠️ Esto borrará TODA la memoria conversacional de Gunter en este navegador. ¿Seguro?')) return;
        if (!confirm('Última confirmación: no se puede deshacer. ¿Continuar?')) return;
        try {
            await window.GunterConversationMemory.clear();
            (window.GunterNotificationsService?.showToast || alert)(
                '🧹 Memoria conversacional borrada.',
                { variant: 'success', duration: 3500 }
            );
            await loadStats();
            await listRecent();
        } catch (e) {
            alert('Error: ' + (e?.message || e));
        }
    }

    function bind() {
        const card = document.getElementById('conv-memory-card');
        if (!card) return;
        document.getElementById('conv-memory-refresh-btn')?.addEventListener('click', () => {
            loadStats(); listRecent();
        });
        document.getElementById('conv-memory-list-btn')?.addEventListener('click', listRecent);
        document.getElementById('conv-memory-forget-btn')?.addEventListener('click', forgetPattern);
        document.getElementById('conv-memory-clear-btn')?.addEventListener('click', clearAll);
        loadStats();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bind);
    } else {
        bind();
    }

    window.GunterConvMemoryPanel = { loadStats, listRecent, forgetPattern, clearAll };
})();
