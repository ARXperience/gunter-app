/* =============================================
   GUNTER ADAPTER - Auth (Fase 7)
   -------------------------------------------------
   Hoy: Google OAuth client-side (GunterGoogleAuth).
   Mañana: provider real con sesión propia (Firebase,
   Auth0, JWT custom). El consumidor habla con la misma
   API.

   Interfaz:
     auth.signIn(provider?): Promise<{user, token, expiresAt}>
     auth.signOut(): Promise<void>
     auth.getUser(): {email, name?, avatarUrl?} | null
     auth.getToken(): string | null
     auth.isSignedIn(): boolean
     auth.onChange(fn): unsubscribe
     auth.use(implName): void
     auth.register(name, impl): void
   ============================================= */

(function () {
    const impls = {};
    let active = null;

    function register(name, impl) {
        impls[name] = impl;
        if (!active) active = name;
    }
    function use(name) {
        if (!impls[name]) throw new Error(`Auth impl "${name}" no registrada`);
        active = name;
    }
    function current() {
        const i = impls[active];
        if (!i) throw new Error('No hay auth adapter activo');
        return i;
    }

    // ---------- Google client-side (default) ----------
    const googleImpl = {
        async signIn() {
            const g = window.GunterGoogleAuth;
            if (!g) throw new Error('GunterGoogleAuth no disponible — carga google-auth-service.js antes.');
            const res = await g.connect();
            return {
                user: { email: g.getUserEmail() },
                token: g.getAccessToken?.() || null,
                expiresAt: g.status?.()?.expiresAt || null
            };
        },
        async signOut() {
            const g = window.GunterGoogleAuth;
            if (g?.disconnect) g.disconnect();
        },
        getUser() {
            const g = window.GunterGoogleAuth;
            if (!g?.isConnected?.()) return null;
            return { email: g.getUserEmail?.() || null };
        },
        getToken() {
            return window.GunterGoogleAuth?.getAccessToken?.() || null;
        },
        isSignedIn() {
            return !!window.GunterGoogleAuth?.isConnected?.();
        },
        onChange(fn) {
            const g = window.GunterGoogleAuth;
            if (!g?.onChange) return () => {};
            return g.onChange(fn);
        },
        get name() { return 'google'; }
    };

    register('google', googleImpl);

    const surface = {
        register, use,
        get current() { return current(); },
        get activeName() { return active; },
        signIn:     (...a) => current().signIn(...a),
        signOut:    (...a) => current().signOut(...a),
        getUser:    () => current().getUser(),
        getToken:   () => current().getToken(),
        isSignedIn: () => current().isSignedIn(),
        onChange:   (fn) => current().onChange(fn)
    };

    window.GunterAdapters = window.GunterAdapters || {};
    window.GunterAdapters.auth = surface;
})();
