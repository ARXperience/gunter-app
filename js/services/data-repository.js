/* Repository contract for a later migration. No new database is opened here. */
(function (root) {
    if (root.GunterDataRepository) return;
    class WebRepository {
        constructor(existingStore) {
            if (!existingStore || typeof existingStore.get !== 'function' || typeof existingStore.put !== 'function')
                throw new TypeError('existing_web_store_required');
            this.store = existingStore;
            this.status = 'CURRENT_STORE_ADAPTER';
        }
        get(key) { return this.store.get(key); }
        put(key, value) { return this.store.put(key, value); }
        remove(key) { if (typeof this.store.remove !== 'function') throw new Error('REMOVE_NOT_SUPPORTED'); return this.store.remove(key); }
    }
    class SQLiteRepository {
        constructor() { this.status = 'NOT_CONFIGURED'; }
        get() { throw new Error('SQLITE_NOT_CONFIGURED'); }
        put() { throw new Error('SQLITE_NOT_CONFIGURED'); }
        remove() { throw new Error('SQLITE_NOT_CONFIGURED'); }
    }
    root.GunterDataRepository = { version: 1, WebRepository, SQLiteRepository };
})(typeof window !== 'undefined' ? window : globalThis);
