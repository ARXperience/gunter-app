/* Source contracts only: no Android runtime, screenshot or device acceptance. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../gunter-mobile/android/app/src/main/java/com/gunter/mobile/LocalRemindersDialog.kt'), 'utf8');
let passed = 0;
const test = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };

test('alcance local explícito, sin red ni sincronización implícita', () => {
    assert.match(source, /no se sincronizan/);
    assert.doesNotMatch(source, /NodeApi|HttpURLConnection|addJavascriptInterface|SEND_SMS|SCHEDULE_EXACT_ALARM/);
    for (const method of ['list', 'schedule', 'update', 'cancel']) assert.ok(source.includes(`ReminderReceiver.${method}(`));
});
test('confirmación previa y revisión del registro antes de mutar', () => {
    assert.match(source, /setPositiveButton\("Revisar", null\)/);
    assert.match(source, /setPositiveButton\("Confirmar"\)/);
    assert.match(source, /record\.revision, mutationId/);
    assert.match(source, /ReminderReceiver\.cancel\(app, record.id, record.revision\)/);
    assert.match(source, /local_\$\{UUID.randomUUID\(\)\}/);
});
test('título acotado y fecha/hora nativas, futuras y no ambiguas', () => {
    for (const guard of ['InputFilter.LengthFilter(180)', 'DatePickerDialog(', 'TimePickerDialog(', 'ZoneId.systemDefault()', 'zone.rules.getValidOffsets(local)', 'offsets.size != 1', 'at.isAfter(Instant.now())']) assert.ok(source.includes(guard), guard);
});
test('permiso real, acceso explícito a Ajustes y errores seguros', () => {
    assert.match(source, /checkSelfPermission\(Manifest.permission.POST_NOTIFICATIONS\)/);
    assert.match(source, /manager.areNotificationsEnabled\(\)/);
    assert.match(source, /ACTION_APP_NOTIFICATION_SETTINGS/);
    assert.match(source, /safeError\(failure\)/);
    assert.doesNotMatch(source, /text\s*=\s*(error|failure)\.message/);
});
test('cierre terminal limpia ventanas y callbacks sin retener Activity en un worker', () => {
    for (const guard of ['WeakReference(activity)', 'closed = true', 'handler.removeCallbacksAndMessages(null)', 'worker.shutdownNow()', 'it.dismiss()', 'host.clear()', 'if (activeHost() == null) return@post']) assert.ok(source.includes(guard), guard);
    assert.match(source, /refresh\(if \(failure == null\) success else safeError\(failure\)\)/);
});
console.log(`ANDROID LOCAL REMINDERS DIALOG CONTRACTS: ${passed} passed; source checks are not Android UI/device acceptance.`);
