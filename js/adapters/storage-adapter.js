/* =============================================
   GUNTER ADAPTER - Storage (Fase 7)
   -------------------------------------------------
   Interfaz uniforme para persistencia. Hoy: local-first
   (gunterData + IndexedDB + localStorage). Mañana puede
   apuntar a un backend (REST/GraphQL/Firebase) sin que
   los consumidores cambien.

   Interfaz:
     storage.getCollection(name): Promise<array>
     storage.getOne(name, id): Promise<obj|null>
     storage.put(name, item): Promise<obj>
     storage.delete(name, id): Promise<boolean>
     storage.kv.get(key): any            (sync, localStorage)
     storage.kv.set(key, value): void
     storage.kv.del(key): void
     storage.use(implName): void
     storage.register(name, impl): void

   Colecciones canónicas:
     'projects' | 'tasks' | 'events' | 'documents' | 'reminders'
   ============================================= */

(function () {
    const impls = {};
    let active = null;

    function register(name, impl) {
        impls[name] = impl;
        if (!active) active = name;
    }

    function use(name) {
        if (!impls[name]) throw new Error(`Storage impl "${name}" no registrada`);
        active = name;
    }

    function current() {
        const i = impls[active];
        if (!i) throw new Error('No hay storage adapter activo');
        return i;
    }

    // ---------- Implementación local-first ----------
    // Mapea a las APIs existentes (gunterData, GunterTasksService, etc.)
    const localImpl = {
        async getCollection(name) {
            const gd = window.gunterData;
            switch (name) {
                case 'projects':
                    if (gd?.getAllProjects) return gd.getAllProjects().filter(p => !p.deletedAt);
                    return [];
                case 'tasks':
                    if (window.GunterTasksService?.list) return await window.GunterTasksService.list();
                    return [];
                case 'events':
                    if (window.GunterEventsService?.list) return await window.GunterEventsService.list();
                    return [];
                case 'documents':
                    if (window.GunterDocumentService?.list) return await window.GunterDocumentService.list();
                    return [];
                case 'reminders':
                    if (window.GunterNotificationsService?.list) return await window.GunterNotificationsService.list();
                    return [];
                default:
                    throw new Error(`Colección desconocida: ${name}`);
            }
        },

        async getOne(name, id) {
            // Documents tiene get(id) directo: úsalo para evitar listar todo.
            if (name === 'documents' && window.GunterDocumentService?.get) {
                return await window.GunterDocumentService.get(id);
            }
            const all = await this.getCollection(name);
            return all.find(x => x.id === id) || null;
        },

        async put(name, item) {
            const gd = window.gunterData;
            switch (name) {
                case 'projects':
                    if (gd?.createOrUpdateProject) return gd.createOrUpdateProject(item);
                    throw new Error('gunterData.createOrUpdateProject no disponible');
                case 'tasks':
                    if (window.GunterTasksService?.update && item.id)
                        return await window.GunterTasksService.update(item.id, item);
                    if (window.GunterTasksService?.create)
                        return await window.GunterTasksService.create(item);
                    throw new Error('GunterTasksService no disponible');
                case 'events':
                    if (window.GunterEventsService?.update && item.id)
                        return await window.GunterEventsService.update(item.id, item);
                    if (window.GunterEventsService?.create)
                        return await window.GunterEventsService.create(item);
                    throw new Error('GunterEventsService no disponible');
                case 'documents':
                    if (window.GunterDocumentService?.saveOriginal)
                        return await window.GunterDocumentService.saveOriginal(item);
                    throw new Error('GunterDocumentService no disponible');
                case 'reminders':
                    if (window.GunterNotificationsService?.update && item.id)
                        return await window.GunterNotificationsService.update(item.id, item);
                    if (window.GunterNotificationsService?.schedule)
                        return await window.GunterNotificationsService.schedule(item);
                    throw new Error('GunterNotificationsService no disponible');
                default:
                    throw new Error(`Colección desconocida: ${name}`);
            }
        },

        async delete(name, id) {
            switch (name) {
                case 'projects':
                    if (window.gunterData?.deleteProject) {
                        window.gunterData.deleteProject(id);
                        return true;
                    }
                    return false;
                case 'tasks':
                    if (window.GunterTasksService?.remove) {
                        await window.GunterTasksService.remove(id);
                        return true;
                    }
                    return false;
                case 'events':
                    if (window.GunterEventsService?.remove) {
                        await window.GunterEventsService.remove(id);
                        return true;
                    }
                    return false;
                case 'documents':
                    if (window.GunterDocumentService?.remove) {
                        await window.GunterDocumentService.remove(id);
                        return true;
                    }
                    return false;
                case 'reminders':
                    if (window.GunterNotificationsService?.cancel) {
                        await window.GunterNotificationsService.cancel(id);
                        return true;
                    }
                    return false;
                default:
                    throw new Error(`Colección desconocida: ${name}`);
            }
        },

        kv: {
            get(key) {
                try {
                    const raw = localStorage.getItem(key);
                    if (raw === null) return null;
                    try { return JSON.parse(raw); } catch { return raw; }
                } catch { return null; }
            },
            set(key, value) {
                try {
                    const v = typeof value === 'string' ? value : JSON.stringify(value);
                    localStorage.setItem(key, v);
                } catch (e) { console.warn('[storage.kv.set] fail:', e); }
            },
            del(key) {
                try { localStorage.removeItem(key); } catch {}
            }
        },

        get name() { return 'local'; }
    };

    register('local', localImpl);

    // Public surface
    const surface = {
        register, use,
        get current() { return current(); },
        get activeName() { return active; },
        getCollection: (...a) => current().getCollection(...a),
        getOne:        (...a) => current().getOne(...a),
        put:           (...a) => current().put(...a),
        delete:        (...a) => current().delete(...a),
        kv: {
            get: (k) => current().kv.get(k),
            set: (k, v) => current().kv.set(k, v),
            del: (k) => current().kv.del(k)
        }
    };

    window.GunterAdapters = window.GunterAdapters || {};
    window.GunterAdapters.storage = surface;
})();
