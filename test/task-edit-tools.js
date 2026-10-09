const assert = require('node:assert/strict');
const assistant = require('../js/core/assistant-tools.js');
const skills = require('../server/control-plane/skills.js');

const now = new Date('2026-10-08T15:00:00.000Z');
const dueAt = '2026-10-09T10:00:00-05:00';
const rows = [
    { id: 'one', title: 'Revisar informe', status: 'pending', ownerId: 'alice', dueAt: null, updatedAt: 'rev1' },
    { id: 'other', title: 'Revisar informe', status: 'pending', ownerId: 'bob', dueAt: null, updatedAt: 'rev1' },
    { id: 'legacy', title: 'Tarea antigua', status: 'pending', ownerId: 'local-user', dueAt: null, updatedAt: 'rev1' },
    { id: 'dup1', title: 'Llamar a Ana', status: 'pending', ownerId: 'alice', dueAt: null, updatedAt: 'rev1' },
    { id: 'dup2', title: 'Llamar a Ana', status: 'pending', ownerId: 'alice', dueAt: null, updatedAt: 'rev1' }
];
let userId = 'alice';
let trusted = true;
let writes = 0;
const service = {
    list: async () => rows.map(row => ({ ...row })),
    update: async (id, patch, guard) => {
        const row = rows.find(item => item.id === id);
        assert.equal(row.ownerId, guard.ownerId);
        assert.ok(guard.statuses.includes(row.status));
        assert.deepEqual({ ...guard.expected }, { title: row.title, dueAt: row.dueAt, status: row.status, updatedAt: row.updatedAt });
        Object.assign(row, patch, { updatedAt: `rev${++writes + 1}` });
        return { ...row };
    }
};
const toolset = assistant.create({
    root: { GunterAuth: { canAccessLocalData: () => trusted, getUser: () => ({ id: userId }) } },
    tasksService: service,
    eventsService: { list: async () => [
        { id: 'own-event', ownerId: 'alice', title: 'Reunión propia', startAt: '2026-10-08T16:00:00-05:00' },
        { id: 'other-event', ownerId: 'bob', title: 'Reunión ajena', startAt: '2026-10-08T16:00:00-05:00' }
    ] },
    now: () => now,
    timezone: () => 'America/Bogota',
    timeParser: { parse: async phrase => {
        if (phrase === 'mañana a las 10') return { iso: dueAt, kind: 'instant' };
        if (phrase === 'ayer') return { iso: '2026-10-07T10:00:00-05:00', kind: 'instant' };
        if (phrase === 'el viernes') return { iso: dueAt, kind: 'instant', ambiguity: { reason: 'Viernes ambiguo' } };
        return { iso: null };
    } }
});

(async () => {
    assert.equal(skills.get('tasks.update')?.autonomyMax, 'L3');
    assert.equal(skills.get('tasks.update')?.risk, 'external_write');
    assert.equal(toolset.detect('renombra la tarea "Revisar informe" a "Informe final"')?.toolId, 'tasks.update');
    assert.equal(toolset.detect('reprograma la tarea "Revisar informe" para mañana a las 10')?.toolId, 'tasks.update');
    assert.equal(toolset.detect('¿Cómo puedo cambiar una tarea?'), null);

    let result = await toolset.dispatch('renombra la tarea "Revisar informe" a "Informe final"');
    assert.equal(result.status, 'awaiting_confirmation');
    assert.equal(writes, 0);
    assert.equal((await toolset.dispatch('no')).status, 'cancelled');
    assert.equal(rows[0].title, 'Revisar informe');

    result = await toolset.dispatch('renombra la tarea "Revisar informe" a "Informe final"', { inputSource: 'voice' });
    assert.equal(result.status, 'awaiting_confirmation');
    assert.equal((await toolset.dispatch('sí', { inputSource: 'voice' })).status, 'awaiting_confirmation');
    assert.equal(writes, 0);
    assert.equal((await toolset.dispatch('sí')).status, 'complete');
    assert.equal(rows[0].title, 'Informe final');
    assert.equal(rows[1].title, 'Revisar informe');

    const alternate = await toolset.prepareMatch(toolset.detect('cambia la fecha de la tarea Informe final a mañana a las 10'));
    assert.equal(alternate.args.reference, 'Informe final');
    assert.equal(alternate.args.dueAt, dueAt);
    assert.equal((await toolset.dispatch('reprograma la tarea Informe para mañana a las 10')).status, 'needs_input');

    result = await toolset.dispatch('reprograma la tarea "Informe final" para mañana a las 10');
    assert.equal(result.status, 'awaiting_confirmation');
    assert.match(result.reply, /9 de octubre/i);
    assert.equal((await toolset.dispatch('confirmo')).status, 'complete');
    assert.equal(rows[0].dueAt, dueAt);

    result = await toolset.dispatch('mi agenda');
    assert.equal(result.status, 'complete');
    assert.ok(result.result.tasks.every(item => item.ownerId === 'alice'));
    assert.ok(result.result.events.every(item => item.ownerId === 'alice'));
    assert.doesNotMatch(result.reply, /Reunión ajena|Tarea antigua/);

    assert.equal((await toolset.dispatch('renombra la tarea "Llamar a Ana" a "Contactar Ana"')).status, 'needs_input');
    assert.equal((await toolset.dispatch('renombra la tarea "Tarea antigua" a "Nueva"')).status, 'needs_input');
    assert.equal((await toolset.dispatch('reprograma la tarea "Informe final" para ayer')).status, 'needs_input');
    assert.equal((await toolset.dispatch('reprograma la tarea "Informe final" para el viernes')).status, 'needs_input');
    assert.equal((await toolset.dispatch('reprograma la tarea "Informe final" para un día cualquiera')).status, 'needs_input');

    result = await toolset.dispatch('renombra la tarea "Informe final" a "Versión nueva"');
    assert.equal(result.status, 'awaiting_confirmation');
    userId = 'bob';
    assert.notEqual((await toolset.dispatch('sí')).status, 'complete');
    assert.equal(rows[0].title, 'Informe final');
    userId = 'alice';

    result = await toolset.dispatch('renombra la tarea "Informe final" a "Versión nueva"');
    assert.equal(result.status, 'awaiting_confirmation');
    rows[0].updatedAt = 'changed-externally';
    assert.equal((await toolset.dispatch('sí')).status, 'error');
    assert.equal(rows[0].title, 'Informe final');

    trusted = false;
    assert.equal((await toolset.dispatch('renombra la tarea "Informe final" a "Nuevo"')).status, 'needs_input');
    assert.equal(writes, 2);
    console.log('task-edit-tools: PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
