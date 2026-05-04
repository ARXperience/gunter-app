/* =============================================
   GUNTER ADAPTER - Calendar (Fase 7)
   -------------------------------------------------
   Hoy: Google Calendar via GunterCalendarService.
   Mañana: Outlook, Apple Calendar (CalDAV), o un
   backend con sync propio. Misma API.

   Interfaz:
     calendar.list({maxResults?}): Promise<event[]>
     calendar.create(localEvent): Promise<remoteEvent>
     calendar.update(id, patch): Promise<remoteEvent>
     calendar.delete(id): Promise<void>
     calendar.flush(): Promise           // procesa cola offline
     calendar.use(name): void
     calendar.register(name, impl): void

   localEvent: {id, title, startAt(ISO), endAt(ISO)?, location?, description?}
   ============================================= */

(function () {
    const impls = {};
    let active = null;

    function register(name, impl) {
        impls[name] = impl;
        if (!active) active = name;
    }
    function use(name) {
        if (!impls[name]) throw new Error(`Calendar impl "${name}" no registrada`);
        active = name;
    }
    function current() {
        const i = impls[active];
        if (!i) throw new Error('No hay calendar adapter activo');
        return i;
    }

    // ---------- Default: Google ----------
    const googleImpl = {
        async list(opts = {}) {
            const svc = window.GunterCalendarService;
            if (!svc?.listUpcoming) return [];
            return await svc.listUpcoming({ maxResults: opts.maxResults || 10 });
        },
        async create(localEvent) {
            const svc = window.GunterCalendarService;
            if (!svc?.pushEvent) throw new Error('GunterCalendarService no disponible');
            return await svc.pushEvent(localEvent);
        },
        async update(id, patch) {
            const svc = window.GunterCalendarService;
            if (!svc?.updateEvent) throw new Error('GunterCalendarService.updateEvent no disponible');
            return await svc.updateEvent(id, patch);
        },
        async delete(id) {
            const svc = window.GunterCalendarService;
            if (!svc?.deleteEvent) throw new Error('GunterCalendarService.deleteEvent no disponible');
            return await svc.deleteEvent(id);
        },
        async flush() {
            const svc = window.GunterCalendarService;
            if (!svc?.flushQueue) return;
            return await svc.flushQueue();
        },
        get name() { return 'google'; }
    };

    register('google', googleImpl);

    const surface = {
        register, use,
        get current() { return current(); },
        get activeName() { return active; },
        list:   (...a) => current().list(...a),
        create: (...a) => current().create(...a),
        update: (...a) => current().update(...a),
        delete: (...a) => current().delete(...a),
        flush:  ()     => current().flush()
    };

    window.GunterAdapters = window.GunterAdapters || {};
    window.GunterAdapters.calendar = surface;
})();
