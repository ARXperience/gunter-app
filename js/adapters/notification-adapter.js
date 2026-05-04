/* =============================================
   GUNTER ADAPTER - Notification (Fase 7)
   -------------------------------------------------
   Hoy: in-app toasts + Web Notification API
   (GunterNotificationsService). Mañana: push real
   server-side, FCM, OneSignal — la API se mantiene.

   Interfaz:
     notification.toast(message, opts?): handle
       opts: { variant, duration, sticky, silent, priority }
     notification.withOperation(label, asyncFn, opts?): Promise
     notification.schedule({title, fireAt, priority?, meta?}): Promise<reminder>
     notification.cancel(id): Promise
     notification.list(filter?): Promise<reminder[]>
     notification.requestPermission(): Promise<'granted'|'denied'|'unsupported'>
     notification.use(name): void
     notification.register(name, impl): void
   ============================================= */

(function () {
    const impls = {};
    let active = null;

    function register(name, impl) {
        impls[name] = impl;
        if (!active) active = name;
    }
    function use(name) {
        if (!impls[name]) throw new Error(`Notification impl "${name}" no registrada`);
        active = name;
    }
    function current() {
        const i = impls[active];
        if (!i) throw new Error('No hay notification adapter activo');
        return i;
    }

    // ---------- Default: GunterNotificationsService ----------
    const localImpl = {
        toast(message, opts = {}) {
            const svc = window.GunterNotificationsService;
            if (!svc?.showToast) {
                console.warn('[notification.toast] servicio no disponible:', message);
                return { update: () => {}, dismiss: () => {}, el: null };
            }
            return svc.showToast(message, opts);
        },
        async withOperation(label, asyncFn, opts = {}) {
            const svc = window.GunterNotificationsService;
            if (!svc?.withOperation) {
                // Fallback: ejecuta sin feedback
                return await asyncFn();
            }
            return svc.withOperation(label, asyncFn, opts);
        },
        async schedule(rem) {
            const svc = window.GunterNotificationsService;
            if (!svc?.schedule) throw new Error('GunterNotificationsService no disponible');
            return await svc.schedule(rem);
        },
        async cancel(id) {
            const svc = window.GunterNotificationsService;
            if (!svc?.cancel) throw new Error('GunterNotificationsService no disponible');
            return await svc.cancel(id);
        },
        async list(filter = {}) {
            const svc = window.GunterNotificationsService;
            if (!svc?.list) return [];
            return await svc.list(filter);
        },
        async requestPermission() {
            const svc = window.GunterNotificationsService;
            if (!svc?.requestPermission) return 'unsupported';
            return await svc.requestPermission();
        },
        get name() { return 'local'; }
    };

    register('local', localImpl);

    const surface = {
        register, use,
        get current() { return current(); },
        get activeName() { return active; },
        toast:             (...a) => current().toast(...a),
        withOperation:     (...a) => current().withOperation(...a),
        schedule:          (...a) => current().schedule(...a),
        cancel:            (...a) => current().cancel(...a),
        list:              (...a) => current().list(...a),
        requestPermission: ()     => current().requestPermission()
    };

    window.GunterAdapters = window.GunterAdapters || {};
    window.GunterAdapters.notification = surface;
})();
