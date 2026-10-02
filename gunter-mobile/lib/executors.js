/* Safe command dispatcher shared by Android/iOS native shells. */
const SKILLS = new Set([
    'mobile.open_app', 'mobile.media.next', 'mobile.media.play_pause',
    'mobile.files.list', 'mobile.files.search', 'mobile.files.open',
    'mobile.message.prepare', 'mobile.message.send', 'mobile.reminder'
]);

async function execute(command, adapter) {
    if (!SKILLS.has(command?.skill)) throw coded('mobile_skill_not_supported');
    if (!adapter) throw coded('mobile_native_bridge_unavailable');
    const payload = sanitize(command.skill, command.payload || {});
    let output;
    if (command.skill === 'mobile.open_app') output = await call(adapter, 'openApp', payload);
    else if (command.skill.startsWith('mobile.media.')) output = await call(adapter, 'media', { action: command.skill.slice('mobile.media.'.length) });
    else if (command.skill === 'mobile.files.list') output = await call(adapter, 'listFiles', payload);
    else if (command.skill === 'mobile.files.search') output = await call(adapter, 'searchFiles', payload);
    else if (command.skill === 'mobile.files.open') output = await call(adapter, 'openFile', payload);
    else if (command.skill === 'mobile.message.prepare') output = await call(adapter, 'prepareMessage', payload);
    else if (command.skill === 'mobile.message.send') output = await call(adapter, 'sendMessage', payload);
    else output = await call(adapter, 'scheduleReminder', payload);
    verify(command.skill, output?.evidence || {});
    return { result: output?.result || {}, evidence: output?.evidence || {} };
}

function sanitize(skill, payload) {
    const clean = (value, max = 500) => String(value || '').trim().replace(/[\u0000-\u001f]/g, '').slice(0, max);
    if (skill === 'mobile.open_app') return { appId: clean(payload.appId || payload.app, 180), deepLink: safeDeepLink(payload.deepLink) };
    if (skill === 'mobile.files.list') return { folderToken: clean(payload.folderToken, 500), limit: Math.max(1, Math.min(Number(payload.limit) || 100, 250)) };
    if (skill === 'mobile.files.search') return { folderToken: clean(payload.folderToken, 500), query: clean(payload.query, 180), limit: Math.max(1, Math.min(Number(payload.limit) || 50, 100)) };
    if (skill === 'mobile.files.open') return { fileToken: clean(payload.fileToken, 1000), fileName: clean(payload.fileName, 240), folderToken: clean(payload.folderToken, 500) };
    if (skill === 'mobile.message.prepare' || skill === 'mobile.message.send') return { channel: clean(payload.channel, 40), recipient: clean(payload.recipient, 180), text: clean(payload.text, 4000) };
    if (skill === 'mobile.reminder') return { title: clean(payload.title, 180), runAt: validDate(payload.runAt), priority: ['low', 'normal', 'high', 'urgent'].includes(payload.priority) ? payload.priority : 'normal' };
    return {};
}
function safeDeepLink(value) {
    const link = String(value || '').trim().slice(0, 1000);
    if (!link) return null;
    if (!/^(https:|mailto:|tel:|sms:|geo:|spotify:)/i.test(link)) throw coded('mobile_deep_link_not_allowed');
    return link;
}
function validDate(value) { const date = new Date(value); if (Number.isNaN(date.getTime())) throw coded('mobile_reminder_date_invalid'); return date.toISOString(); }
async function call(adapter, method, payload) { if (typeof adapter[method] !== 'function') throw coded(`mobile_adapter_${method}_unavailable`); return adapter[method](payload); }
function verify(skill, evidence) {
    const valid = skill === 'mobile.open_app' ? evidence.appOpened === true
        : skill.startsWith('mobile.media.') ? (evidence.playbackStateChanged === true || evidence.playbackStateObserved === true)
            : skill === 'mobile.files.list' ? evidence.folderRead === true
                : skill === 'mobile.files.search' ? evidence.searchCompleted === true
                    : skill === 'mobile.files.open' ? evidence.fileOpened === true
                        : skill === 'mobile.message.prepare' ? Boolean(evidence.draftId || evidence.preparedText)
                            : skill === 'mobile.message.send' ? evidence.channelAccepted === true
                                : Boolean(evidence.persistedId);
    if (!valid) throw coded('mobile_result_not_verified');
}
function coded(code) { const error = new Error(code); error.code = code; return error; }
module.exports = { execute, sanitize, SKILLS };
