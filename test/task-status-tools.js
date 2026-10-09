const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assistant = require('../js/core/assistant-tools.js');
const skills = require('../server/control-plane/skills.js');

const rows = [
    { id: 'task_a', title: 'Revisar informe', status: 'pending', ownerId: 'alice' },
    { id: 'task_b', title: 'Enviar propuesta', status: 'doing', ownerId: 'alice' },
    { id: 'task_c', title: 'Revisar informe', status: 'pending', ownerId: 'bob' },
    { id: 'task_d', title: 'Llamar a Ana', status: 'pending', ownerId: 'alice' },
    { id: 'task_e', title: 'Llamar a Ana', status: 'pending', ownerId: 'alice' }
];
let userId = 'alice';
let trusted = true;
const changes = [];
const tasksService = {
    list: async () => rows.map(row => ({ ...row })),
    create: async input => {
        const row = { id: 'task_new', status: 'pending', ...input };
        rows.push(row);
        return row;
    },
    complete: async (id, ownerId) => change(id, ownerId, ['pending', 'doing'], 'done'),
    reopen: async (id, ownerId) => change(id, ownerId, ['done', 'cancelled'], 'pending'),
    cancel: async (id, ownerId) => change(id, ownerId, ['pending', 'doing'], 'cancelled')
};
function change(id, ownerId, valid, status) {
    const row = rows.find(item => item.id === id);
    if (!row || row.ownerId !== ownerId || !valid.includes(row.status)) throw new Error('Tarea modificada o cuenta incorrecta');
    row.status = status;
    changes.push({ id, status });
    return { ...row };
}
const toolset = assistant.create({
    root: { GunterAuth: { canAccessLocalData: () => trusted, getUser: () => ({ id: userId }) } },
    tasksService
});

(async () => {
    assert.equal(skills.get('tasks.complete')?.autonomyMax, 'L3');
    assert.equal(skills.get('tasks.reopen')?.risk, 'external_write');
    assert.equal(skills.get('tasks.cancel')?.autonomyMax, 'L3');

    assert.equal(toolset.detect('Gunter, completa la tarea Revisar informe')?.toolId, 'tasks.complete');
    assert.equal(toolset.detect('reabre la tarea Revisar informe')?.toolId, 'tasks.reopen');
    assert.equal(toolset.detect('cancela la tarea Revisar informe')?.toolId, 'tasks.cancel');
    assert.equal(toolset.detect('¿Cómo puedo completar una tarea?'), null);
    assert.equal(toolset.detect('¿Cómo puedo cancelar una tarea?'), null);

    let response = await toolset.dispatch('Gunter, completa la tarea Revisar informe');
    assert.equal(response.status, 'awaiting_confirmation');
    assert.equal(changes.length, 0);
    assert.equal((await toolset.dispatch('no')).status, 'cancelled');
    assert.equal(changes.length, 0);

    response = await toolset.dispatch('completa la tarea Revisar informe', { inputSource: 'voice' });
    assert.equal(response.status, 'awaiting_confirmation');
    assert.match(response.reply, /confirma por escrito/i);
    assert.equal((await toolset.dispatch('sí', { inputSource: 'voice' })).status, 'awaiting_confirmation');
    assert.equal(changes.length, 0);
    response = await toolset.dispatch('sí');
    assert.equal(response.status, 'complete');
    assert.equal(rows[0].status, 'done');
    assert.equal(rows[2].status, 'pending');

    response = await toolset.dispatch('reabre la tarea Revisar informe');
    assert.equal(response.status, 'awaiting_confirmation');
    assert.equal((await toolset.dispatch('confirmo')).status, 'complete');
    assert.equal(rows[0].status, 'pending');

    response = await toolset.dispatch('cancela la tarea Revisar informe', { inputSource: 'voice' });
    assert.equal(response.status, 'awaiting_confirmation');
    assert.match(response.reply, /No la borraré/i);
    assert.equal((await toolset.dispatch('sí', { inputSource: 'voice' })).status, 'awaiting_confirmation');
    assert.equal(rows[0].status, 'pending');
    assert.equal((await toolset.dispatch('sí')).status, 'complete');
    assert.equal(rows[0].status, 'cancelled');
    assert.equal(rows[2].status, 'pending');
    response = await toolset.dispatch('reactiva la tarea Revisar informe');
    assert.equal(response.status, 'awaiting_confirmation');
    assert.equal((await toolset.dispatch('confirmo')).status, 'complete');
    assert.equal(rows[0].status, 'pending');

    response = await toolset.dispatch('completa la tarea Llamar a Ana');
    assert.equal(response.status, 'needs_input');
    assert.match(response.reply, /varias tareas/i);
    assert.equal(changes.length, 4);
    assert.equal((await toolset.dispatch('cancela la tarea Llamar a Ana')).status, 'needs_input');

    response = await toolset.dispatch('completa la tarea Enviar propuesta');
    assert.equal(response.status, 'awaiting_confirmation');
    userId = 'bob';
    assert.notEqual((await toolset.dispatch('sí')).status, 'complete');
    assert.equal(rows[1].status, 'doing');
    userId = 'alice';

    response = await toolset.dispatch('completa la tarea Enviar propuesta');
    assert.equal(response.status, 'awaiting_confirmation');
    rows[1].status = 'done';
    assert.equal((await toolset.dispatch('sí')).status, 'error');
    assert.equal(changes.length, 4);

    trusted = false;
    response = await toolset.dispatch('reabre la tarea Enviar propuesta');
    assert.notEqual(response.status, 'complete');
    trusted = true;
    response = await toolset.dispatch('crea una tarea para revisar seguridad');
    assert.equal(response.status, 'complete');
    assert.equal(rows.at(-1).ownerId, 'alice');

    // Same-transaction owner/status guards must leave the row untouched on failure.
    const persisted = new Map([['task_guard', { id: 'task_guard', title: 'Privada', ownerId: 'alice', status: 'pending' }]]);
    const db = { close() {}, transaction() {
        const staged = new Map(persisted);
        let aborted = false;
        const tx = {
            error: null,
            objectStore() { return {
                get(id) {
                    const request = { result: staged.get(id) };
                    setTimeout(() => request.onsuccess?.(), 0);
                    return request;
                },
                put(row) {
                    staged.set(row.id, row);
                    setTimeout(() => {
                        if (!aborted) {
                            persisted.clear();
                            staged.forEach((value, key) => persisted.set(key, value));
                            tx.oncomplete?.();
                        }
                    }, 0);
                }
            }; },
            abort() { aborted = true; setTimeout(() => tx.onabort?.(), 0); }
        };
        return tx;
    } };
    const window = { dispatchEvent() {} };
    const context = { window, indexedDB: { open() {
        const request = { result: db };
        setTimeout(() => request.onsuccess?.(), 0);
        return request;
    } }, CustomEvent: class { constructor(name, details) { this.type = name; this.detail = details.detail; } }, Date, Math, Promise, setTimeout };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../js/services/tasks-service.js'), 'utf8'), context);
    const service = window.GunterTasksService;
    await assert.rejects(service.complete('task_guard', 'bob'), /TASK_OWNER_MISMATCH/);
    assert.equal(persisted.get('task_guard').status, 'pending');
    assert.equal((await service.complete('task_guard', 'alice')).status, 'done');
    await assert.rejects(service.complete('task_guard', 'alice'), /TASK_STATUS_CHANGED/);
    assert.equal(persisted.get('task_guard').status, 'done');
    assert.equal((await service.reopen('task_guard', 'alice')).status, 'pending');
    const beforeEdit = persisted.get('task_guard');
    const expected = { title: beforeEdit.title, status: beforeEdit.status, updatedAt: beforeEdit.updatedAt };
    assert.equal((await service.update('task_guard', { title: 'Actualizada' },
        { ownerId: 'alice', statuses: ['pending'], expected })).title, 'Actualizada');
    await assert.rejects(service.update('task_guard', { title: 'No aplicar' },
        { ownerId: 'alice', statuses: ['pending'], expected }), /TASK_CHANGED/);
    assert.equal(persisted.get('task_guard').title, 'Actualizada');
    await assert.rejects(service.update('task_guard', { title: 'Ajena' },
        { ownerId: 'bob', statuses: ['pending'] }), /TASK_OWNER_MISMATCH/);
    assert.equal(persisted.get('task_guard').title, 'Actualizada');
    assert.equal((await service.cancel('task_guard', 'alice')).status, 'cancelled');
    await assert.rejects(service.cancel('task_guard', 'alice'), /TASK_STATUS_CHANGED/);
    assert.equal(persisted.get('task_guard').status, 'cancelled');
    assert.equal((await service.reopen('task_guard', 'alice')).status, 'pending');
    assert.equal(persisted.get('task_guard').cancelledAt, null);

    console.log('task-status-tools: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
