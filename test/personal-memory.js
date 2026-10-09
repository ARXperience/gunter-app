/* Explicit personal memory: CRUD, deduplication and text/voice command contract. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const records = new Map();
let owner = 'alice';
const context = { console, Date, Set, Promise, crypto: require('node:crypto').webcrypto,
    GunterAuth: { isVerified: () => true, getUser: () => ({ id: owner }) },
    GunterDataRepository: { memory: {
        get: async key => records.get(key),
        all: async store => store === 'turns' ? [] : [...records.values()],
        put: async record => { records.set(record.key, record); return record; },
        delete: async key => { records.delete(key); return true; }
    } }, localStorage: { getItem: () => null } };
context.window = context;
context.globalThis = context;
vm.createContext(context);
const root = path.resolve(__dirname, '..');
for (const file of ['js/services/gunter-memory.js', 'js/services/personal-memory-service.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file });
}

(async () => {
    const personal = context.GunterPersonalMemory;
    const first = await personal.handleCommand('Gunter, guarda en memoria que vivo en Bogotá');
    assert.equal(first.handled, true);
    assert.match(first.reply, /guardé/i);
    assert.equal(records.size, 1);
    const duplicate = await personal.handleCommand('guarda en memoria que vivo en bogota');
    assert.match(duplicate.reply, /ya está/i);
    assert.equal(records.size, 1);
    const preference = await personal.handleCommand('guarda preferencia: Me gustan las respuestas breves');
    assert.match(preference.reply, /guardé/i);
    assert.equal(records.size, 2);
    const all = await personal.list();
    assert.equal(all.length, 2);
    assert.equal((await personal.search('bogota')).length, 1);
    assert.equal((await personal.search('BREVES')).length, 1);
    assert.equal(personal.parseCommand('recuérdame pagar mañana'), null, 'task reminders must not become personal memories');
    assert.equal(personal.parseCommand('recuerda que mi regla es responder corto'), null, 'existing rule syntax remains unchanged');
    assert.equal(personal.parseCommand('¿Qué recuerdas de mí?').action, 'list');
    assert.equal(personal.parseCommand('Hola Gunter, guarda en memoria que me gusta el jazz').action, 'save');
    assert.match((await personal.handleCommand('¿Qué recuerdas de mí?')).reply, /Bogotá/);

    const fact = all.find(row => row.type === 'personal_fact');
    const updated = await personal.save({ id: fact.id, type: 'personal_fact', content: 'Vivo en Medellín' });
    assert.equal(updated.record.version, 2);
    assert.equal(records.size, 2);
    assert.equal((await personal.search('Bogotá')).length, 0);
    assert.equal((await personal.search('Medellín')).length, 1);
    await assert.rejects(personal.save({ type: 'personal_fact', content: 'x' }), /PERSONAL_MEMORY_CONTENT_INVALID/);
    owner = 'bob';
    assert.equal((await personal.list()).length, 0);
    assert.equal(await personal.remove(fact.id), false);
    owner = 'alice';
    assert.equal(await personal.remove(fact.id), true);
    assert.equal(records.size, 1);

    // The UI must still find and manage records older than the first page.
    for (let i = 0; i < 105; i++) await context.GunterMemory.put({
        id: `older_${i}`, type: 'personal_fact', source: 'test', content: `Dato histórico ${i}`
    });
    assert.equal((await personal.list()).length, 106);
    assert.equal((await personal.search('histórico 0')).length, 1);

    const html = fs.readFileSync(path.join(root, 'config.html'), 'utf8');
    for (const id of ['personal-memory-form', 'personal-memory-content', 'personal-memory-list', 'personal-memory-search'])
        assert.ok(html.includes(`id="${id}"`), `missing visible memory control: ${id}`);
    assert.ok(html.includes('js/controllers/personal-memory-panel.js'));
    for (const page of ['config.html', 'dashboard.html', 'day.html', 'index.html', 'meeting.html', 'new-project.html', 'results.html']) {
        const source = fs.readFileSync(path.join(root, page), 'utf8');
        const memoryAt = source.indexOf('js/services/gunter-memory.js?v3-backup');
        const personalAt = source.indexOf('js/services/personal-memory-service.js?v2-backup');
        const companionAt = source.indexOf('js/services/gunter-companion.js?v116-personal-memory');
        assert.ok(memoryAt >= 0 && memoryAt < personalAt && personalAt < companionAt, `incorrect script order: ${page}`);
    }
    console.log('PERSONAL MEMORY: save, dedupe, edit, search, delete, owner and command wiring ✓');
})().catch(error => { console.error(error); process.exitCode = 1; });
