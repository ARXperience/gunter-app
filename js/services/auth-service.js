/* =============================================
   GUNTER — Auth Service (cliente)
   ---------------------------------------------
   Se carga PRIMERO en todas las páginas protegidas.
   - Verifica sesión via /api/auth/me (cookie HttpOnly)
   - Sin sesión → redirige a login.html?next=<página>
   - Cuenta pendiente/bloqueada → login.html muestra el estado
   - Con sesión → expone window.GunterAuth + chip de usuario flotante

   Páginas públicas (sin gate): login.html
   ============================================= */
(function () {
    'use strict';

    const PUBLIC_PAGES = ['login.html'];
    const page = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    const isPublic = PUBLIC_PAGES.includes(page);

    let _user = null;
    const _readyCallbacks = [];

    // Cache de sessionStorage para pintar el chip sin esperar la red
    // (la verificación real via /api/auth/me SIEMPRE corre igual).
    try { _user = JSON.parse(sessionStorage.getItem('gunter_auth_user') || 'null'); } catch { }

    function _goLogin(reason) {
        const next = encodeURIComponent(page + location.search);
        location.replace(`login.html?next=${next}${reason ? '&reason=' + reason : ''}`);
    }

    async function _verify() {
        try {
            const resp = await fetch('/api/auth/me', { cache: 'no-store' });
            if (resp.status === 401) {
                sessionStorage.removeItem('gunter_auth_user');
                if (!isPublic) _goLogin('');
                return null;
            }
            const json = await resp.json();
            if (!json?.success || !json.user) { if (!isPublic) _goLogin(''); return null; }
            const u = json.user;
            if (u.status === 'pending') { if (!isPublic) _goLogin('pending'); return null; }
            if (u.status === 'blocked') {
                sessionStorage.removeItem('gunter_auth_user');
                if (!isPublic) _goLogin('blocked');
                return null;
            }
            // Multi-tenant: si entra un usuario DISTINTO al último que usó este
            // navegador, se limpia todo el Gunter local (localStorage + IndexedDB)
            // — cada usuario tiene su propio Gunter, nadie ve datos ajenos.
            const prevUser = localStorage.getItem('gunter_device_user');
            if (prevUser && prevUser !== u.id) {
                console.warn('[auth] Cambio de usuario detectado — limpiando datos locales del anterior');
                await _wipeLocalData();
                localStorage.setItem('gunter_device_user', u.id);
                location.reload();
                return null;
            }
            localStorage.setItem('gunter_device_user', u.id);
            _user = u;
            try { sessionStorage.setItem('gunter_auth_user', JSON.stringify(u)); } catch { }
            document.dispatchEvent(new CustomEvent('gunter-auth-ready', { detail: { user: u } }));
            _readyCallbacks.splice(0).forEach(cb => { try { cb(u); } catch { } });
            _mountChip();
            return u;
        } catch (e) {
            // Server caído: no bloquear la página (modo local-first);
            // el connectivity-monitor ya muestra el banner offline.
            console.warn('[auth] No se pudo verificar sesión:', e.message);
            return _user;
        }
    }

    async function logout() {
        try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { }
        sessionStorage.removeItem('gunter_auth_user');
        location.replace('login.html');
    }

    // Borra TODO el estado local de Gunter (al detectar cambio de usuario).
    // localStorage: claves gunter* · IndexedDB: todas las bases gunter_*
    async function _wipeLocalData() {
        try {
            const keep = [];   // nada se conserva: Gunter nuevo para el usuario nuevo
            for (let i = localStorage.length - 1; i >= 0; i--) {
                const k = localStorage.key(i);
                if (k && k.toLowerCase().startsWith('gunter') && !keep.includes(k)) {
                    localStorage.removeItem(k);
                }
            }
        } catch { }
        try {
            let names = [];
            if (indexedDB.databases) {
                names = (await indexedDB.databases()).map(d => d.name).filter(Boolean);
            } else {
                names = ['gunter_daily', 'gunter_audio_vault', 'gunter_transcription_db',
                         'gunter_documents', 'gunter_embeddings', 'gunter_semantic_index',
                         'gunter_transcript_archive', 'gunter_conversation_memory'];
            }
            await Promise.all(names
                .filter(n => n.toLowerCase().startsWith('gunter'))
                .map(n => new Promise(res => {
                    const rq = indexedDB.deleteDatabase(n);
                    rq.onsuccess = rq.onerror = rq.onblocked = () => res();
                })));
        } catch { }
    }

    // ---------- Chip de usuario flotante ----------
    function _mountChip() {
        if (isPublic || !_user || document.getElementById('gauth-chip')) return;
        const mount = () => {
            if (document.getElementById('gauth-chip')) return;
            const chip = document.createElement('div');
            chip.id = 'gauth-chip';
            const initial = (_user.displayName || _user.username || '?').charAt(0).toUpperCase();
            chip.innerHTML = `
                <button class="gauth-chip__btn" title="${_esc(_user.displayName)} (${_user.role === 'admin' ? 'Admin' : 'Usuario'})" aria-label="Menú de usuario">${_esc(initial)}</button>
                <div class="gauth-chip__menu" hidden>
                    <div class="gauth-chip__who">
                        <strong>${_esc(_user.displayName)}</strong>
                        <span>@${_esc(_user.username)} · ${_user.role === 'admin' ? '👑 Admin' : 'Usuario'}</span>
                    </div>
                    ${_user.role === 'admin' ? '<a class="gauth-chip__item" href="admin.html">🛡️ Panel de administración</a>' : ''}
                    <button class="gauth-chip__item gauth-chip__item--wa" type="button">📱 ${_user.waPhone ? 'Mi WhatsApp: +' + _esc(_user.waPhone) : 'Vincular mi WhatsApp'}</button>
                    <a class="gauth-chip__item" href="config.html">⚙️ Configuración</a>
                    <button class="gauth-chip__item gauth-chip__item--out" type="button">🚪 Cerrar sesión</button>
                </div>`;
            document.body.appendChild(chip);
            _injectStyles();

            const btn = chip.querySelector('.gauth-chip__btn');
            const menu = chip.querySelector('.gauth-chip__menu');
            btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; });
            document.addEventListener('click', () => { menu.hidden = true; });
            chip.querySelector('.gauth-chip__item--out').addEventListener('click', logout);
            chip.querySelector('.gauth-chip__item--wa').addEventListener('click', _linkWhatsApp);
        };
        if (document.body) mount();
        else document.addEventListener('DOMContentLoaded', mount);
    }

    function _esc(s) {
        return String(s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    // Vincular el WhatsApp propio: con esto Gunter te reconoce cuando le
    // escribes al número puente y responde con TU Gunter (tus datos).
    async function _linkWhatsApp() {
        const current = _user?.waPhone ? '+' + _user.waPhone : '';
        const input = prompt(
            'Escribe tu número de WhatsApp en formato internacional (con código de país, sin espacios).\n' +
            'Ejemplo: 573001234567\n\n' +
            'Cuando le escribas a Gunter desde ese número, te va a reconocer y responder con TUS datos.\n' +
            (current ? '\nNúmero actual: ' + current + '\n(Déjalo vacío y acepta para desvincular)' : ''),
            _user?.waPhone || ''
        );
        if (input === null) return;   // canceló
        try {
            const resp = await fetch('/api/auth/set-phone', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: input.trim() })
            });
            const json = await resp.json();
            if (json?.success) {
                _user = json.user;
                try { sessionStorage.setItem('gunter_auth_user', JSON.stringify(_user)); } catch { }
                alert(json.user.waPhone
                    ? '✅ Listo. Tu WhatsApp +' + json.user.waPhone + ' quedó vinculado a tu Gunter.'
                    : 'Tu WhatsApp quedó desvinculado.');
                document.getElementById('gauth-chip')?.remove();
                _mountChip();   // re-render con el número actualizado
            } else {
                alert('No se pudo: ' + (json?.error || 'error desconocido'));
            }
        } catch {
            alert('No se pudo conectar con el servidor.');
        }
    }

    function _injectStyles() {
        if (document.getElementById('gauth-chip-styles')) return;
        const st = document.createElement('style');
        st.id = 'gauth-chip-styles';
        st.textContent = `
            #gauth-chip { position: fixed; top: 14px; right: 14px; z-index: 9500; font-family: 'Plus Jakarta Sans', system-ui, sans-serif; }
            .gauth-chip__btn { width: 40px; height: 40px; border-radius: 999px; border: 1px solid var(--border-strong, rgba(140,150,180,.35));
                background: var(--surface-2, #1c2333); color: var(--text-1, #eef1f8); font-weight: 800; font-size: 16px;
                cursor: pointer; box-shadow: 0 4px 14px rgba(0,0,0,.25); transition: transform .15s ease, box-shadow .15s ease; }
            .gauth-chip__btn:hover { transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,.3); }
            .gauth-chip__menu { position: absolute; top: 48px; right: 0; min-width: 230px; padding: 8px;
                background: var(--surface-1, #141a28); border: 1px solid var(--border-strong, rgba(140,150,180,.35));
                border-radius: 14px; box-shadow: 0 12px 34px rgba(0,0,0,.4); }
            .gauth-chip__who { padding: 10px 12px 12px; border-bottom: 1px solid var(--border-soft, rgba(140,150,180,.18)); margin-bottom: 6px; }
            .gauth-chip__who strong { display: block; color: var(--text-1, #eef1f8); font-size: 14px; }
            .gauth-chip__who span { color: var(--text-3, #8a93a8); font-size: 12px; }
            .gauth-chip__item { display: block; width: 100%; text-align: left; padding: 9px 12px; border: 0; background: none;
                color: var(--text-2, #c6cddd); font-size: 13.5px; font-weight: 600; border-radius: 9px; cursor: pointer; text-decoration: none; }
            .gauth-chip__item:hover { background: var(--surface-3, rgba(120,140,190,.14)); color: var(--text-1, #eef1f8); }
            .gauth-chip__item--out:hover { background: rgba(230,90,90,.14); color: #ff9c9c; }
            @media (max-width: 640px) { #gauth-chip { top: 10px; right: 10px; } .gauth-chip__btn { width: 36px; height: 36px; font-size: 14px; } }
            body.light-theme .gauth-chip__btn, [data-theme="light"] .gauth-chip__btn { background: #fff; color: #26304a; border-color: rgba(60,80,130,.25); }
            body.light-theme .gauth-chip__menu, [data-theme="light"] .gauth-chip__menu { background: #fff; border-color: rgba(60,80,130,.2); }
            body.light-theme .gauth-chip__who strong, [data-theme="light"] .gauth-chip__who strong { color: #1d2438; }
            body.light-theme .gauth-chip__item, [data-theme="light"] .gauth-chip__item { color: #3a465f; }
        `;
        document.head.appendChild(st);
    }

    // ---------- API pública ----------
    window.GunterAuth = {
        getUser: () => _user,
        isAdmin: () => _user?.role === 'admin',
        isLogged: () => !!_user,
        onReady: (cb) => { _user ? cb(_user) : _readyCallbacks.push(cb); },
        logout,
        refresh: _verify
    };

    if (!isPublic) _verify();
})();
