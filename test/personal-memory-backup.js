/* Focused personal-memory backup and atomic IndexedDB merge contract. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const rows = new Map();
let owner = 'alice';
let failAfterAdds = -1;
const db = {
    objectStoreNames: { contains: () => true },
    transaction(_name, mode) {
        const snapshot = new Map(rows);
        let aborted = false;
        const tx = {
            error: null,
            objectStore() { return {
                getAll() {
                    const request = { result: [...snapshot.values()] };
                    setTimeout(() => {
                        if (aborted) return;
                        request.onsuccess?.();
                        if (mode === 'readwrite' && !aborted) setTimeout(() => {
                            if (!aborted) { rows.clear(); snapshot.forEach((row, key) => rows.set(key, row)); tx.oncomplete?.(); }
                        }, 0);
                    }, 0);
                    return request;
                },
                get(key) {
                    const request = { result: snapshot.get(key) };
                    setTimeout(() => request.onsuccess?.(), 0);
                    return request;
                },
                add(row) {
                    if (failAfterAdds === 0) { failAfterAdds = -1; throw new Error('SIMULATED_WRITE_FAILURE'); }
                    if (failAfterAdds > 0) failAfterAdds--;
                    if (snapshot.has(row.key)) throw new Error('DUPLICATE_KEY');
                    snapshot.set(row.key, row);
                }
            }; },
            abort() { aborted = true; setTimeout(() => tx.onabort?.(), 0); }
        };
        return tx;
    }
};
const indexedDB = { open() {
    const request = { result: db };
    setTimeout(() => request.onsuccess?.(), 0);
    return request;
} };
const context = { console, Date, Map, Set, Promise, TextEncoder, indexedDB,
    crypto: require('node:crypto').webcrypto,
    localStorage: { getItem: () => null },
    GunterAuth: { isVerified: () => true, getUser: () => ({ id: owner }) } };
context.window = context;
context.globalThis = context;
vm.createContext(context);
for (const file of ['js/services/data-repository.js', 'js/services/gunter-memory.js', 'js/services/personal-memory-service.js'])
    vm.runInContext(read(file), context, { filename: file });

(async () => {
    const personal = context.GunterPersonalMemory;
    const now = '2026-10-08T12:00:00.000Z';
    const record = (id, content, type = 'personal_fact') => ({ id, type, content, source: 'personal.ui',
        privacy: 'LOCAL', metadata: {}, createdAt: now, updatedAt: now, version: 2 });
    rows.set('alice:keep', { ...record('keep', 'Mi gato se llama Milo'), metadata: { category: 'familia' },
        ownerId: 'alice', key: 'alice:keep' });
    rows.set('bob:other', { ...record('other', 'Dato privado de Bob'), ownerId: 'bob', key: 'bob:other' });
    rows.set('alice:credential', { ...record('credential', 'Mi contraseña: abc123'), ownerId: 'alice', key: 'alice:credential' });
    rows.set('alice:token', { ...record('token', 'Tengo un dato privado'), metadata: { access_token: 'private-value' },
        ownerId: 'alice', key: 'alice:token' });
    rows.set('alice:legacy', { ...record('legacy', 'Dato en cuarentena'), legacy: true,
        ownerId: 'alice', key: 'alice:legacy' });
    const { backup, excluded } = await personal.exportBackup();
    assert.equal(excluded, 3);
    assert.equal(backup.records.length, 1);
    assert.equal(backup.records[0].id, 'keep');
    assert.equal(backup.records[0].version, 2);
    assert.equal(backup.records[0].createdAt, now);
    assert.equal(backup.records[0].metadata.category, 'familia');
    assert.equal(JSON.stringify(backup).includes('Bob'), false);
    assert.equal(JSON.stringify(backup).includes('contraseña'), false);
    assert.equal(JSON.stringify(backup).includes('ownerId'), false);
    assert.equal(JSON.stringify(backup).includes('key'), false);
    const json = JSON.stringify(backup);
    rows.delete('alice:keep');
    assert.equal((await personal.previewBackup(json)).newCount, 1);
    assert.equal((await personal.importBackup(json)).added, 1);
    assert.equal(rows.get('alice:keep').version, 2);
    assert.equal(rows.get('alice:keep').createdAt, now);
    assert.equal((await personal.previewBackup(json)).duplicates, 1);
    assert.equal((await personal.importBackup(json)).added, 0);
    assert.equal(rows.size, 5);

    const foreign = JSON.stringify({ ...backup, accountId: 'bob' });
    await assert.rejects(personal.previewBackup(foreign), /ACCOUNT_MISMATCH/);
    owner = 'bob';
    await assert.rejects(personal.importBackup(json), /ACCOUNT_MISMATCH/);
    owner = 'alice';
    await assert.rejects(personal.previewBackup('{bad json'), /JSON_INVALID/);
    await assert.rejects(personal.previewBackup(JSON.stringify({ ...backup, version: 9 })), /FORMAT_INVALID/);
    await assert.rejects(personal.previewBackup(json, 6 * 1024 * 1024), /SIZE_INVALID/);

    const mixed = JSON.stringify({ ...backup, records: [record('fresh', 'Vivo cerca del parque'),
        { ...record('bad', 'Prefiero caminar'), ownerId: 'bob' }] });
    const preview = await personal.previewBackup(mixed);
    assert.equal(preview.newCount, 1);
    assert.equal(preview.invalid, 1);
    await assert.rejects(personal.importBackup(mixed), /INVALID_RECORDS/);
    assert.equal(rows.has('alice:fresh'), false);

    const duplicateContent = JSON.stringify({ ...backup, records: [record('another', 'Mi gato se llama Milo')] });
    assert.equal((await personal.previewBackup(duplicateContent)).duplicates, 1);
    const conflict = JSON.stringify({ ...backup, records: [record('keep', 'Tengo un perro')] });
    assert.equal((await personal.previewBackup(conflict)).invalid, 1);
    const valid = JSON.stringify({ ...backup, records: [record('one', 'Me gusta cocinar'), record('two', 'Prefiero música tranquila')] });
    failAfterAdds = 1;
    await assert.rejects(personal.importBackup(valid), /SIMULATED_WRITE_FAILURE/);
    assert.equal(rows.has('alice:one'), false);
    assert.equal(rows.has('alice:two'), false);
    assert.ok(rows.has('alice:keep'));
    assert.equal((await personal.importBackup(valid)).added, 2);
    assert.equal(rows.get('alice:two').content, 'Prefiero música tranquila');

    const html = read('config.html');
    for (const id of ['personal-memory-export', 'personal-memory-import-file', 'personal-memory-import-preview', 'personal-memory-import-confirm'])
        assert.ok(html.includes(`id="${id}"`), `missing UI control: ${id}`);
    console.log('PERSONAL MEMORY BACKUP: export, restore, validation, dedupe, account isolation and atomic abort ✓');
})().catch(error => { console.error(error); process.exitCode = 1; });
