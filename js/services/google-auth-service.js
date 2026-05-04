/* =============================================
   GUNTER SERVICE - Google Auth (GIS)
   -------------------------------------------------
   Autenticación via Google Identity Services.
   Flow: OAuth2 access token en navegador, scope
   Calendar. Token en memoria + sessionStorage;
   nunca en localStorage. Silent refresh soportado.
   ============================================= */

(function () {
    const SS_TOKEN = 'g_cal_token';
    const SS_EXPIRES = 'g_cal_expires_at';
    const SS_EMAIL = 'g_cal_user_email';

    let tokenClient = null;
    let currentToken = null;
    let currentExpiresAt = 0;
    let serverConfig = null;      // { configured, clientId, scope }
    let gisLoaded = false;
    let initializing = false;
    const listeners = new Set();

    // ---------- Server-side config ----------
    async function loadServerConfig() {
        if (serverConfig) return serverConfig;
        const url = (window.GUNTER_CONFIG && window.GUNTER_CONFIG.PROXY_GOOGLE_STATUS_URL)
            || '/api/google/status';
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error('status HTTP ' + resp.status);
            serverConfig = await resp.json();
        } catch {
            serverConfig = { configured: false, clientId: null };
        }
        return serverConfig;
    }

    // ---------- Load GIS SDK ----------
    function loadGis() {
        if (gisLoaded && window.google?.accounts?.oauth2) return Promise.resolve();
        return new Promise((resolve, reject) => {
            if (document.querySelector('script[data-gis]')) {
                // already loading
                const wait = setInterval(() => {
                    if (window.google?.accounts?.oauth2) {
                        gisLoaded = true;
                        clearInterval(wait);
                        resolve();
                    }
                }, 50);
                setTimeout(() => { clearInterval(wait); reject(new Error('GIS load timeout')); }, 8000);
                return;
            }
            const s = document.createElement('script');
            s.src = 'https://accounts.google.com/gsi/client';
            s.async = true;
            s.defer = true;
            s.setAttribute('data-gis', '1');
            s.onload = () => { gisLoaded = true; resolve(); };
            s.onerror = () => reject(new Error('No se pudo cargar GIS SDK'));
            document.head.appendChild(s);
        });
    }

    // ---------- Init ----------
    async function init() {
        if (initializing || tokenClient) return;
        initializing = true;
        try {
            const cfg = await loadServerConfig();
            if (!cfg.configured) { initializing = false; return false; }
            await loadGis();

            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: cfg.clientId,
                scope: cfg.scope || 'https://www.googleapis.com/auth/calendar',
                callback: onTokenResponse
            });

            // Rehydrate from sessionStorage if still valid
            const saved = sessionStorage.getItem(SS_TOKEN);
            const expAt = parseInt(sessionStorage.getItem(SS_EXPIRES) || '0', 10);
            if (saved && expAt > Date.now() + 60_000) {
                currentToken = saved;
                currentExpiresAt = expAt;
                emit('connected');
            }
            initializing = false;
            return true;
        } catch (e) {
            console.warn('[google-auth] init failed:', e);
            initializing = false;
            return false;
        }
    }

    function onTokenResponse(response) {
        if (response.error) {
            console.warn('[google-auth] token error:', response.error);
            emit('error', response);
            return;
        }
        currentToken = response.access_token;
        currentExpiresAt = Date.now() + (Number(response.expires_in) || 3600) * 1000;
        sessionStorage.setItem(SS_TOKEN, currentToken);
        sessionStorage.setItem(SS_EXPIRES, String(currentExpiresAt));
        // Fetch user email (best effort)
        fetchUserInfo().catch(() => {});
        emit('connected');
    }

    async function fetchUserInfo() {
        if (!currentToken) return null;
        try {
            const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                headers: { Authorization: `Bearer ${currentToken}` }
            });
            if (!r.ok) return null;
            const data = await r.json();
            if (data.email) sessionStorage.setItem(SS_EMAIL, data.email);
            emit('userinfo', data);
            return data;
        } catch { return null; }
    }

    // ---------- Public API ----------
    async function connect({ silent = false } = {}) {
        const ready = await init();
        if (!ready || !tokenClient) {
            throw new Error('Google no está configurado. Añade GOOGLE_CLIENT_ID al .env y reinicia el servidor.');
        }
        return new Promise((resolve, reject) => {
            const origCb = tokenClient.callback;
            tokenClient.callback = (resp) => {
                origCb(resp);
                if (resp.error) reject(new Error(resp.error));
                else resolve(resp);
            };
            // prompt:'' intenta silencioso; con consent si es primera vez
            try {
                tokenClient.requestAccessToken({ prompt: silent ? '' : 'consent' });
            } catch (e) { reject(e); }
        });
    }

    function disconnect() {
        if (currentToken && window.google?.accounts?.oauth2?.revoke) {
            try { google.accounts.oauth2.revoke(currentToken, () => {}); } catch {}
        }
        currentToken = null;
        currentExpiresAt = 0;
        sessionStorage.removeItem(SS_TOKEN);
        sessionStorage.removeItem(SS_EXPIRES);
        sessionStorage.removeItem(SS_EMAIL);
        emit('disconnected');
    }

    function isConnected() {
        return !!currentToken && currentExpiresAt > Date.now() + 30_000;
    }

    async function getAccessToken() {
        if (isConnected()) return currentToken;
        // Try silent refresh
        try {
            await connect({ silent: true });
            if (isConnected()) return currentToken;
        } catch {}
        throw new Error('No conectado a Google. Reconecta desde Configuración.');
    }

    function getUserEmail() {
        return sessionStorage.getItem(SS_EMAIL) || null;
    }

    function onChange(fn) {
        listeners.add(fn);
        return () => listeners.delete(fn);
    }

    function emit(type, payload) {
        listeners.forEach(fn => { try { fn(type, payload); } catch {} });
        window.dispatchEvent(new CustomEvent('google-auth', { detail: { type, payload } }));
    }

    async function status() {
        const cfg = await loadServerConfig();
        return {
            configured: !!cfg.configured,
            connected: isConnected(),
            email: getUserEmail(),
            expiresAt: currentExpiresAt
        };
    }

    window.GunterGoogleAuth = {
        init, connect, disconnect, isConnected, getAccessToken, getUserEmail, onChange, status
    };

    // Auto-init on load (does not prompt; just sets up)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => init().catch(() => {}));
    } else {
        init().catch(() => {});
    }
})();
