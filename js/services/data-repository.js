/* Existing Web repository contract and the shared IndexedDB memory store. */
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

    // Upgrade the existing conversation DB in place. The legacy `turns` store
    // remains readable; structured records are never copied into a new DB.
    const MEMORY_DB = 'gunter_conversation_memory';
    const MEMORY_VERSION = 2;
    let dbPromise = null;
    function openMemoryDb() {
        if (dbPromise) return dbPromise;
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(MEMORY_DB, MEMORY_VERSION);
            let blocked = false;
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains('turns')) {
                    const turns = db.createObjectStore('turns', { keyPath: 'id' });
                    turns.createIndex('ts', 'ts', { unique: false });
                    turns.createIndex('channel', 'channel', { unique: false });
                    turns.createIndex('projectId', 'projectId', { unique: false });
                }
                if (!db.objectStoreNames.contains('records')) {
                    const records = db.createObjectStore('records', { keyPath: 'key' });
                    records.createIndex('ownerId', 'ownerId', { unique: false });
                    records.createIndex('type', 'type', { unique: false });
                    records.createIndex('updatedAt', 'updatedAt', { unique: false });
                }
            };
            request.onblocked = () => {
                blocked = true;
                reject(new Error('MEMORY_UPGRADE_BLOCKED_RELOAD_OLD_TABS'));
            };
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                const db = request.result;
                if (blocked) { db.close(); return; }
                db.onversionchange = () => { db.close(); dbPromise = null; };
                resolve(db);
            };
        }).catch(error => { dbPromise = null; throw error; });
        return dbPromise;
    }

    function requestResult(request) {
        return new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    class MemoryRepository {
        open() { return openMemoryDb(); }
        async get(key, storeName = 'records') {
            const db = await openMemoryDb();
            return requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).get(key));
        }
        async all(storeName = 'records') {
            const db = await openMemoryDb();
            return requestResult(db.transaction(storeName, 'readonly').objectStore(storeName).getAll());
        }
        async put(record) {
            const db = await openMemoryDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction('records', 'readwrite');
                tx.objectStore('records').put(record);
                tx.oncomplete = () => resolve(record);
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error || new Error('MEMORY_WRITE_ABORTED'));
            });
        }
        async delete(key, storeName = 'records') {
            const db = await openMemoryDb();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, 'readwrite');
                tx.objectStore(storeName).delete(key);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error || new Error('MEMORY_DELETE_ABORTED'));
            });
        }
    }
    root.GunterDataRepository = { version: 2, WebRepository, SQLiteRepository,
        MemoryRepository, memory: new MemoryRepository(), openMemoryDb };
})(typeof window !== 'undefined' ? window : globalThis);
